DROP VIEW IF EXISTS public.orders_public CASCADE;
CREATE VIEW public.orders_public WITH (security_invoker=on) AS
SELECT id, tenant_id, supplier_id, status, total, delivery_fee, discount_amount,
  delivery_type, payment_method, customer_name, customer_address, delivery_status_note,
  lalamove_status, lalamove_driver_name, lalamove_driver_plate, lalamove_share_link,
  external_tracking_url, external_tracking_provider,
  driver_id, distance, created_at, updated_at, coupon_code, change_for, print_count, printed_at
FROM public.orders;

CREATE OR REPLACE FUNCTION public.get_orders_by_phone(_tenant_id uuid, _phone text)
 RETURNS SETOF public.orders_public
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT op.* FROM public.orders_public op
  JOIN public.orders o ON o.id = op.id
  WHERE o.tenant_id = _tenant_id AND o.customer_phone = _phone
  ORDER BY o.created_at DESC
  LIMIT 100;
$function$;