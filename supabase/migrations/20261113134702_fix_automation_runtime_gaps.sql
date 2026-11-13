-- Corrige lacunas de execução das automações:
-- 1) auto_cancel_expired_orders passa a revalidar status e ausência de pagamento aprovado
--    no próprio UPDATE (evita cancelar pedido pago por webhook concorrente).
-- 2) Agenda o executor de auto-cancel-pending-orders, que existia sem cron.

CREATE OR REPLACE FUNCTION public.auto_cancel_expired_orders()
 RETURNS TABLE(cancelled_id uuid, t_id uuid, c_phone text, c_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH expired AS (
    SELECT o.id
    FROM public.orders o
    JOIN public.tenants t ON t.id = o.tenant_id
    WHERE o.status = 'pending_payment'
      AND t.auto_cancel_pending_payment = TRUE
      AND COALESCE(t.store_mode, 'own') <> 'affiliate'
      AND o.created_at < now() - (t.auto_cancel_pending_minutes || ' minutes')::interval
      -- Nunca cancela pedido que já tem pagamento aprovado registrado.
      AND NOT EXISTS (
        SELECT 1 FROM public.payment_transactions pt
        WHERE pt.order_id = o.id AND pt.status = 'paid'
      )
    ORDER BY o.created_at
    LIMIT 200
  ),
  upd AS (
    UPDATE public.orders o
       SET status = 'cancelled',
           cancel_reason = 'pending_payment_expired',
           auto_cancelled = TRUE,
           updated_at = now()
     FROM expired
     WHERE o.id = expired.id
       -- Revalidação condicional: se o webhook confirmou o pagamento entre o
       -- SELECT e o UPDATE, o pedido não é cancelado.
       AND o.status = 'pending_payment'
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_transactions pt
         WHERE pt.order_id = o.id AND pt.status = 'paid'
       )
   RETURNING o.id AS cid, o.tenant_id AS tid, o.customer_phone AS cph, o.customer_name AS cnm
  )
  SELECT cid, tid, cph, cnm FROM upd;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.auto_cancel_expired_orders() FROM anon, authenticated;

-- Agenda o executor a cada 15 minutos reaproveitando a credencial já usada pelos
-- demais jobs (nenhum segredo novo é gravado aqui; apenas o endpoint é trocado).
DO $$
DECLARE
  v_cmd text;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'smarthubly_auto_cancel_pending') THEN
    RAISE NOTICE 'auto-cancel job already scheduled';
    RETURN;
  END IF;

  SELECT command INTO v_cmd
  FROM cron.job
  WHERE jobname = 'smarthubly_ghost_detector'
  LIMIT 1;

  IF v_cmd IS NULL OR position('/functions/v1/ghost-orders-detector' in v_cmd) = 0 THEN
    RAISE NOTICE 'reference cron job not found; auto-cancel not scheduled';
    RETURN;
  END IF;

  v_cmd := replace(v_cmd, '/functions/v1/ghost-orders-detector', '/functions/v1/auto-cancel-pending-orders');
  PERFORM cron.schedule('smarthubly_auto_cancel_pending', '*/15 * * * *', v_cmd);
END $$;
