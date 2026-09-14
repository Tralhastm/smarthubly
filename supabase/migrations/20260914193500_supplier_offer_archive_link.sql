-- Toda oferta disponível precisa apontar para a lista atual do fornecedor.
-- Sem esse vínculo, a reconciliação corretamente descarta a oferta como histórica.
CREATE OR REPLACE FUNCTION public.upsert_supplier_variant_offer_by_token(
  _token TEXT,
  _product_id TEXT,
  _product_variant_id TEXT,
  _variant_name TEXT,
  _variant_key TEXT,
  _unit_cost NUMERIC,
  _available BOOLEAN,
  _source TEXT DEFAULT 'supplier_panel'
)
RETURNS public.supplier_variant_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier public.suppliers%ROWTYPE;
  v_offer public.supplier_variant_offers;
  v_archive_id UUID;
BEGIN
  SELECT * INTO v_supplier
  FROM public.suppliers
  WHERE access_token = _token
    AND _token IS NOT NULL
    AND length(_token) >= 16;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_supplier_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _product_id AND tenant_id = v_supplier.tenant_id
  ) THEN
    RAISE EXCEPTION 'invalid_supplier_product';
  END IF;

  -- A chamada do painel não deve depender de uma segunda atualização do cliente.
  -- O arquivo mais recente do próprio fornecedor é a fonte desta oferta.
  SELECT a.id INTO v_archive_id
  FROM public.supplier_catalog_archives a
  WHERE a.tenant_id = v_supplier.tenant_id
    AND lower(trim(a.supplier_name)) = lower(trim(v_supplier.name))
    AND a.expires_at > now()
  ORDER BY a.created_at DESC
  LIMIT 1;

  INSERT INTO public.supplier_variant_offers (
    tenant_id, product_id, product_variant_id, supplier_id,
    variant_name, variant_key, unit_cost, available, source,
    last_seen_at, source_archive_id
  ) VALUES (
    v_supplier.tenant_id, _product_id, _product_variant_id, v_supplier.id,
    _variant_name, _variant_key, _unit_cost, _available,
    COALESCE(_source, 'supplier_panel'), now(), v_archive_id
  )
  ON CONFLICT (supplier_id, product_id, variant_key) DO UPDATE SET
    product_variant_id = EXCLUDED.product_variant_id,
    variant_name = EXCLUDED.variant_name,
    unit_cost = EXCLUDED.unit_cost,
    available = EXCLUDED.available,
    source = EXCLUDED.source,
    last_seen_at = now(),
    source_archive_id = COALESCE(EXCLUDED.source_archive_id, supplier_variant_offers.source_archive_id),
    updated_at = now()
  RETURNING * INTO v_offer;

  RETURN v_offer;
END;
$$;

-- Repara a janela atual: as ofertas disponíveis sem arquivo foram geradas pela
-- importação recente e devem apontar para o último arquivo vigente do fornecedor.
WITH latest AS (
  SELECT DISTINCT ON (a.tenant_id, lower(trim(a.supplier_name)))
    a.tenant_id, lower(trim(a.supplier_name)) AS supplier_name, a.id
  FROM public.supplier_catalog_archives a
  WHERE a.expires_at > now()
  ORDER BY a.tenant_id, lower(trim(a.supplier_name)), a.created_at DESC
)
UPDATE public.supplier_variant_offers o
SET source_archive_id = l.id, updated_at = now()
FROM public.suppliers s
JOIN latest l ON l.tenant_id = o.tenant_id
  AND l.supplier_name = lower(trim(s.name))
WHERE o.supplier_id = s.id
  AND o.available = true
  AND o.source_archive_id IS NULL;

-- Recalcula disponibilidade pelo menor custo entre as ofertas vigentes.
DO $$
DECLARE s RECORD;
BEGIN
  FOR s IN SELECT id FROM public.suppliers LOOP
    PERFORM public.reconcile_supplier_catalog(s.id);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.upsert_supplier_variant_offer_by_token(TEXT, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT) TO anon, authenticated;
