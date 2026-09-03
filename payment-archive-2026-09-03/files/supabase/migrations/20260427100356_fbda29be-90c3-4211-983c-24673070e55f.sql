-- 1) Resolver ghost flags órfãos (pedidos não existem mais)
UPDATE public.ghost_order_flags g
SET resolved_at = now()
WHERE g.resolved_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = g.order_id);

-- 2) Lançar taxa de plataforma retroativa para pedidos delivered sem entry
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT o.id FROM public.orders o
    JOIN public.tenants t ON t.id = o.tenant_id
    WHERE o.status='delivered' AND COALESCE(o.platform_fee,0) > 0
      AND t.auto_log_platform_fee = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.financial_entries fe
        WHERE fe.tenant_id = o.tenant_id
          AND fe.description ILIKE '%#PLATFORM_FEE:'||o.id::text||'%'
      )
  LOOP
    PERFORM public.log_platform_fee_entry(r.id);
  END LOOP;
END $$;