DROP FUNCTION IF EXISTS public.auto_cancel_expired_orders();

CREATE OR REPLACE FUNCTION public.auto_cancel_expired_orders()
RETURNS TABLE (cancelled_id UUID, t_id UUID, c_phone TEXT, c_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH expired AS (
    SELECT o.id
    FROM public.orders o
    JOIN public.tenants t ON t.id = o.tenant_id
    WHERE o.status = 'pending_payment'
      AND t.auto_cancel_pending_payment = TRUE
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
$$;