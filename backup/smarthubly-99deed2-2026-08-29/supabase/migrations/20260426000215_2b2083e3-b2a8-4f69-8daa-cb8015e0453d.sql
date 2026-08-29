-- Filtra automações de venda própria para ignorar tenants em modo afiliado.
-- 1) Atualiza detect_ghost_orders pra ignorar store_mode='affiliate'
CREATE OR REPLACE FUNCTION public.detect_ghost_orders()
 RETURNS TABLE(flagged_id uuid, flagged_tenant uuid, flagged_order uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT o.id, o.tenant_id, o.customer_phone
      FROM public.orders o
      JOIN public.tenants t ON t.id = o.tenant_id
     WHERE t.auto_detect_ghost_orders = TRUE
       AND COALESCE(t.store_mode, 'own') <> 'affiliate'
       AND o.status = 'out-for-delivery'
       AND o.updated_at < now() - INTERVAL '90 minutes'
       AND NOT EXISTS (SELECT 1 FROM public.ghost_order_flags g WHERE g.order_id = o.id)
     LIMIT 100
  ), ins AS (
    INSERT INTO public.ghost_order_flags (tenant_id, order_id, customer_phone, reason, ghost_score)
    SELECT tenant_id, id, customer_phone, 'out_for_delivery_no_confirm_90min', 70 FROM candidates
    RETURNING id, tenant_id, order_id
  )
  SELECT id, tenant_id, order_id FROM ins;
END;
$function$;

-- 2) Atualiza auto_cancel_expired_orders pra ignorar store_mode='affiliate'
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
   RETURNING o.id AS cid, o.tenant_id AS tid, o.customer_phone AS cph, o.customer_name AS cnm
  )
  SELECT cid, tid, cph, cnm FROM upd;
END;
$function$;

-- 3) Desliga automações incompatíveis com modo afiliado em TODAS as lojas afiliadas.
-- Mantém ativas: auto_categorize_nightly, auto_reorder_catalog (ranking de cliques), 
-- auto_affiliate_match, auto_review_ai_reply, auto_weekly_report.
UPDATE public.tenants SET
  auto_cancel_pending_payment = FALSE,
  auto_abandon_coupon         = FALSE,
  auto_detect_ghost_orders    = FALSE,
  auto_reconcile_mp           = FALSE,
  auto_backup_catalog         = FALSE,
  auto_low_stock_promo        = FALSE,
  auto_credit_reminders       = FALSE,
  auto_combo_suggestion       = FALSE,
  auto_peak_alert             = FALSE,
  auto_phantom_alert          = FALSE,
  auto_log_platform_fee       = FALSE
WHERE store_mode = 'affiliate';