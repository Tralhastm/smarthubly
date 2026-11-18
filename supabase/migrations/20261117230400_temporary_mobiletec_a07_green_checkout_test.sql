-- Exceção temporária autorizada para testar checkout na Mobiletec.
-- Somente a variante verde do Galaxy A07 é exibida e comprável a R$ 3.
-- Os gatilhos de veracidade de estoque são desativados apenas durante esta
-- execução e reativados antes do commit. Reverter após o teste do usuário.
DO $$
DECLARE
  matching_variants integer;
BEGIN
  SELECT COUNT(*) INTO matching_variants
  FROM public.products p
  JOIN public.tenants t ON t.id = p.tenant_id
  JOIN public.product_variants pv ON pv.product_id = p.id AND pv.tenant_id = p.tenant_id
  WHERE t.slug = 'mobiletec'
    AND p.name = 'Galaxy A07 256GB/8GB'
    AND pv.name = 'verde';

  IF matching_variants <> 1 THEN
    RAISE EXCEPTION 'Esperada exatamente uma variante verde do Galaxy A07 na Mobiletec; encontradas %', matching_variants;
  END IF;

  EXECUTE 'ALTER TABLE public.product_variants DISABLE TRIGGER product_variants_supplier_inventory_write_guard';
  EXECUTE 'ALTER TABLE public.products DISABLE TRIGGER products_supplier_inventory_write_guard';

  UPDATE public.product_variants pv
  SET allow_loss = true,
      cost_price = 1.00,
      suggested_price = 3.00,
      price_delta = ROUND(3.00 - COALESCE(p.price, 0), 2),
      in_stock = true,
      needs_price_review = false,
      price_source = 'manual',
      updated_at = now()
  FROM public.products p
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE pv.product_id = p.id
    AND pv.tenant_id = p.tenant_id
    AND t.slug = 'mobiletec'
    AND p.name = 'Galaxy A07 256GB/8GB'
    AND pv.name = 'verde';

  UPDATE public.products p
  SET allow_loss = true,
      in_stock = true,
      store_visible = true,
      updated_at = now()
  FROM public.tenants t
  WHERE p.tenant_id = t.id
    AND t.slug = 'mobiletec'
    AND p.name = 'Galaxy A07 256GB/8GB';

  EXECUTE 'ALTER TABLE public.product_variants ENABLE TRIGGER product_variants_supplier_inventory_write_guard';
  EXECUTE 'ALTER TABLE public.products ENABLE TRIGGER products_supplier_inventory_write_guard';
END $$;
