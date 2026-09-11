-- Reconciliação final do catálogo: duas listas são snapshots independentes.
-- A oferta vencedora é sempre a menor disponível entre todos os fornecedores.
-- Ausência em todas as listas deixa o produto/variação indisponível.
-- Variação sem preço de venda continua visível apenas no painel, com alerta.

CREATE OR REPLACE FUNCTION public.reconcile_supplier_catalog(p_supplier_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant_id TEXT; v_products INTEGER := 0; v_variants INTEGER := 0;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.suppliers WHERE id=p_supplier_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'supplier_not_found'; END IF;
  WITH winner AS (
    SELECT DISTINCT ON (svo.product_variant_id) svo.product_variant_id,svo.supplier_id,svo.unit_cost
    FROM public.supplier_variant_offers svo
    JOIN public.suppliers s ON s.id=svo.supplier_id AND s.tenant_id=v_tenant_id
    WHERE svo.tenant_id=v_tenant_id AND svo.available=true AND svo.product_variant_id IS NOT NULL
    ORDER BY svo.product_variant_id,svo.unit_cost ASC,svo.updated_at DESC
  ), target AS (
    SELECT pv.id,p.price,pv.price_delta,pv.allow_loss,pv.suggested_price,
           w.supplier_id AS winner_supplier_id,w.unit_cost AS winner_cost
    FROM public.product_variants pv JOIN public.products p ON p.id=pv.product_id
    LEFT JOIN winner w ON w.product_variant_id=pv.id WHERE pv.tenant_id=v_tenant_id
  )
  UPDATE public.product_variants pv SET supplier_id=t.winner_supplier_id,cost_price=t.winner_cost,
    price_source=CASE WHEN t.winner_supplier_id IS NULL THEN NULL ELSE 'supplier_offer' END,
    in_stock=CASE WHEN t.winner_supplier_id IS NULL THEN false WHEN t.allow_loss THEN true
      ELSE (COALESCE(t.price+COALESCE(t.price_delta,0),t.price,0)
        -(COALESCE(t.price+COALESCE(t.price_delta,0),t.price,0)*0.046)-50-10-t.winner_cost)>=0 END,
    needs_price_review=CASE WHEN t.winner_supplier_id IS NULL THEN false ELSE COALESCE(t.suggested_price,0)<=0 END,
    updated_at=now() FROM target t WHERE pv.id=t.id;
  GET DIAGNOSTICS v_variants=ROW_COUNT;

  UPDATE public.products p SET supplier_id=NULL,
    in_stock=EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id AND pv.in_stock='true'),
    updated_at=now() WHERE p.tenant_id=v_tenant_id
    AND EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id);

  WITH winner AS (
    SELECT DISTINCT ON (p.id) p.id AS product_id,spp.supplier_id,spp.unit_price
    FROM public.products p
    JOIN public.supplier_product_prices spp ON spp.available=true
      AND public.catalog_product_match_key(spp.product_name)=public.catalog_product_match_key(p.name)
    JOIN public.suppliers s ON s.id=spp.supplier_id AND s.tenant_id=p.tenant_id
    WHERE p.tenant_id=v_tenant_id
      AND NOT EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id)
    ORDER BY p.id,spp.unit_price ASC,spp.updated_at DESC
  )
  UPDATE public.products p SET supplier_id=w.supplier_id,original_price=w.unit_price,
    in_stock=CASE WHEN p.allow_loss THEN true ELSE (COALESCE(p.price,0)
      -(COALESCE(p.price,0)*0.046)-50-10-w.unit_price)>=0 END,updated_at=now()
    FROM winner w WHERE p.id=w.product_id;
  GET DIAGNOSTICS v_products=ROW_COUNT;

  UPDATE public.products p SET supplier_id=NULL,original_price=NULL,in_stock=false,updated_at=now()
  WHERE p.tenant_id=v_tenant_id AND NOT EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM public.supplier_product_prices spp
      JOIN public.suppliers s ON s.id=spp.supplier_id AND s.tenant_id=p.tenant_id
      WHERE spp.available=true AND public.catalog_product_match_key(spp.product_name)=public.catalog_product_match_key(p.name));
  RETURN jsonb_build_object('products',v_products,'variants',v_variants);
END; $$;
GRANT EXECUTE ON FUNCTION public.reconcile_supplier_catalog(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_supplier_catalog(TEXT) TO service_role;

-- Consolida aliases de cor já existentes sem depender do idioma enviado pelo fornecedor.
DO $$
DECLARE d RECORD; c RECORD; o RECORD; existing_offer RECORD;
BEGIN
  FOR d IN SELECT pv.* FROM public.product_variants pv
    WHERE lower(trim(pv.name)) IN ('black','white','blue','green','purple','violet','pink','gold','golden','silver','gray','grey','yellow','orange','brown','titanium')
  LOOP
    SELECT pv.* INTO c FROM public.product_variants pv WHERE pv.product_id=d.product_id
      AND lower(trim(pv.name))=CASE lower(trim(d.name))
        WHEN 'black' THEN 'preto' WHEN 'white' THEN 'branco' WHEN 'blue' THEN 'azul'
        WHEN 'green' THEN 'verde' WHEN 'purple' THEN 'roxo' WHEN 'violet' THEN 'roxo'
        WHEN 'pink' THEN 'rosa' WHEN 'gold' THEN 'dourado' WHEN 'golden' THEN 'dourado'
        WHEN 'silver' THEN 'prata' WHEN 'gray' THEN 'cinza' WHEN 'grey' THEN 'cinza'
        WHEN 'yellow' THEN 'amarelo' WHEN 'orange' THEN 'laranja' WHEN 'brown' THEN 'marrom'
        WHEN 'titanium' THEN 'titanio' END LIMIT 1;
    IF c.id IS NULL THEN CONTINUE; END IF;
    FOR o IN SELECT * FROM public.supplier_variant_offers WHERE product_variant_id=d.id LOOP
      SELECT * INTO existing_offer FROM public.supplier_variant_offers
        WHERE supplier_id=o.supplier_id AND product_id=o.product_id
          AND variant_key=lower(trim(c.name)) AND id<>o.id LIMIT 1;
      IF existing_offer.id IS NOT NULL THEN
        UPDATE public.supplier_variant_offers SET unit_cost=LEAST(existing_offer.unit_cost,o.unit_cost),
          available=(existing_offer.available OR o.available),last_seen_at=GREATEST(existing_offer.last_seen_at,o.last_seen_at)
          WHERE id=existing_offer.id;
        DELETE FROM public.supplier_variant_offers WHERE id=o.id;
      ELSE
        UPDATE public.supplier_variant_offers SET product_variant_id=c.id,variant_name=c.name,variant_key=lower(trim(c.name)) WHERE id=o.id;
      END IF;
    END LOOP;
    UPDATE public.product_variants SET cost_price=CASE WHEN c.cost_price IS NULL THEN d.cost_price
      WHEN d.cost_price IS NULL THEN c.cost_price ELSE LEAST(c.cost_price,d.cost_price) END,
      suggested_price=COALESCE(c.suggested_price,d.suggested_price),price_delta=COALESCE(c.price_delta,d.price_delta,0),
      supplier_id=COALESCE(c.supplier_id,d.supplier_id),in_stock=(c.in_stock::boolean OR d.in_stock::boolean),
      needs_price_review=COALESCE(c.suggested_price,d.suggested_price,0)<=0,updated_at=now() WHERE id=c.id;
    DELETE FROM public.product_variants WHERE id=d.id;
  END LOOP;
END $$;
