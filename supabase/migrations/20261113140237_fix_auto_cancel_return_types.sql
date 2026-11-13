-- orders.id/tenant_id e payment_transactions.order_id usam text como chave, mas a
-- versão anterior desta RPC declarava uuid. O corpo retornava text e o Postgres
-- abortava com "structure of query does not match function result type", o que
-- mantinha o cancelamento automático quebrado (HTTP 500) em toda execução.
DROP FUNCTION IF EXISTS public.auto_cancel_expired_orders();

CREATE FUNCTION public.auto_cancel_expired_orders()
 RETURNS TABLE(cancelled_id text, t_id text, c_phone text, c_name text)
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
