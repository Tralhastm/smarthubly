-- Mobiletec: a entrega não é limitada por km; a elegibilidade é por cidade.
UPDATE public.tenants AS t
SET delivery_max_radius_km = 0,
    shipping_per_km_fee = 2.50,
    updated_at = now()
WHERE lower(t.slug) = 'mobiletec';

UPDATE public.suppliers AS s
SET delivery_max_radius_km = 0,
    shipping_per_km_fee = 2.50,
    updated_at = now()
FROM public.tenants AS t
WHERE s.tenant_id = t.id
  AND lower(t.slug) = 'mobiletec';
