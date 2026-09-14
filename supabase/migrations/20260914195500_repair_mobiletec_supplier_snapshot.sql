-- Restauração da fotografia atual já importada da Mobiletec.
-- Estes produtos tinham lista salva, mas suas ofertas foram desativadas pelo
-- fluxo antigo antes da correção do RLS/matching.
UPDATE public.supplier_variant_offers o
SET available = true,
    unit_cost = CASE
      WHEN p.name = 'Galaxy A07 256GB/8GB' THEN 860
      WHEN p.name = 'Poco M8s 5G NFC 256GB/8GB' AND s.name = 'MANIA DIGITAL' THEN 1300
      WHEN p.name = 'Poco M8s 5G NFC 256GB/8GB' AND s.name = 'HI PHONE' THEN 1340
      WHEN p.name = 'Realme C71 5G 256GB/8GB' THEN 1100
      WHEN p.name = 'Redmi 15C (256GB / 8GB RAM)' THEN 960
      ELSE o.unit_cost
    END,
    updated_at = now()
FROM public.products p, public.suppliers s
WHERE o.product_id = p.id
  AND o.supplier_id = s.id
  AND p.tenant_id = (SELECT id FROM public.tenants WHERE lower(slug) = 'mobiletec' LIMIT 1)
  AND (
    (p.name = 'Galaxy A07 256GB/8GB' AND s.name = 'MANIA DIGITAL')
    OR (p.name = 'Poco M8s 5G NFC 256GB/8GB' AND s.name IN ('MANIA DIGITAL', 'HI PHONE'))
    OR (p.name = 'Realme C71 5G 256GB/8GB' AND s.name = 'MANIA DIGITAL')
    OR (p.name = 'Redmi 15C (256GB / 8GB RAM)' AND s.name = 'MANIA DIGITAL')
  );

INSERT INTO public.supplier_variant_offers(
  tenant_id, product_id, product_variant_id, supplier_id,
  variant_name, variant_key, unit_cost, available, source, last_seen_at
)
SELECT p.tenant_id, p.id, pv.id, s.id, pv.name, lower(trim(pv.name)),
       810, true, 'supplier_panel', now()
FROM public.products p
JOIN public.product_variants pv ON pv.product_id = p.id
JOIN public.suppliers s ON s.tenant_id = p.tenant_id AND s.name = 'MANIA DIGITAL'
WHERE p.tenant_id = (SELECT id FROM public.tenants WHERE lower(slug) = 'mobiletec' LIMIT 1)
  AND p.name = 'Moto G06 256GB/4GB'
ON CONFLICT (supplier_id, product_id, variant_key) DO UPDATE SET
  unit_cost = EXCLUDED.unit_cost, available = true,
  last_seen_at = now(), updated_at = now();

UPDATE public.products p
SET store_visible = true, updated_at = now()
WHERE p.tenant_id = (SELECT id FROM public.tenants WHERE lower(slug) = 'mobiletec' LIMIT 1)
  AND p.in_stock::text = 'true'
  AND EXISTS (
    SELECT 1 FROM public.product_variants pv
    JOIN public.supplier_variant_offers o ON o.product_variant_id = pv.id AND o.available = true
    WHERE pv.product_id = p.id
  );

DO $$
DECLARE s RECORD;
BEGIN
  FOR s IN SELECT id FROM public.suppliers
    WHERE tenant_id = (SELECT id FROM public.tenants WHERE lower(slug) = 'mobiletec' LIMIT 1)
  LOOP
    PERFORM public.reconcile_supplier_catalog(s.id);
  END LOOP;
END;
$$;
