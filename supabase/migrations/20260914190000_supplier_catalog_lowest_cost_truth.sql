-- Fonte de verdade do catálogo: variantes equivalentes devem compartilhar uma única linha.
-- Ofertas continuam separadas por fornecedor e a reconciliação escolhe o menor custo.

CREATE OR REPLACE FUNCTION public.catalog_variant_match_key(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(string_agg(
    CASE token
      WHEN 'black' THEN 'preto'
      WHEN 'white' THEN 'branco'
      WHEN 'blue' THEN 'azul'
      WHEN 'green' THEN 'verde'
      WHEN 'purple' THEN 'roxo'
      WHEN 'violet' THEN 'roxo'
      WHEN 'pink' THEN 'rosa'
      WHEN 'gold' THEN 'dourado'
      WHEN 'golden' THEN 'dourado'
      WHEN 'silver' THEN 'prata'
      WHEN 'gray' THEN 'cinza'
      WHEN 'grey' THEN 'cinza'
      WHEN 'yellow' THEN 'amarelo'
      WHEN 'orange' THEN 'laranja'
      WHEN 'brown' THEN 'marrom'
      WHEN 'titanium' THEN 'titanio'
      ELSE token
    END, ' ' ORDER BY token), '')
  FROM regexp_split_to_table(
    regexp_replace(lower(translate(coalesce(value, ''),
      'áàãâäéèêëíìîïóòõôöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc')),
      '[^a-z0-9]+', ' ', 'g'), '\s+') AS token
  WHERE token <> '';
$$;

-- Consolida aliases de cor e variantes repetidas dentro do mesmo produto.
DO $$
DECLARE
  d RECORD;
  keep_id TEXT;
  canonical_name TEXT;
  o RECORD;
  existing_offer RECORD;
BEGIN
  FOR d IN
    SELECT pv.id, pv.product_id, pv.tenant_id, pv.name,
           public.catalog_variant_match_key(pv.name) AS variant_key
    FROM public.product_variants pv
    WHERE public.catalog_variant_match_key(pv.name) <> ''
      AND EXISTS (
        SELECT 1 FROM public.product_variants other
        WHERE other.product_id = pv.product_id
          AND public.catalog_variant_match_key(other.name) = public.catalog_variant_match_key(pv.name)
          AND other.id <> pv.id
      )
  LOOP
    SELECT chosen.id, chosen.name INTO keep_id, canonical_name
    FROM public.product_variants chosen
    WHERE chosen.product_id = d.product_id
      AND public.catalog_variant_match_key(chosen.name) = d.variant_key
    ORDER BY
      CASE lower(trim(chosen.name))
        WHEN 'preto' THEN 1 WHEN 'branco' THEN 1 WHEN 'azul' THEN 1
        WHEN 'verde' THEN 1 WHEN 'roxo' THEN 1 WHEN 'rosa' THEN 1
        WHEN 'dourado' THEN 1 WHEN 'prata' THEN 1 WHEN 'cinza' THEN 1
        ELSE 0
      END DESC,
      chosen.id
    LIMIT 1;

    IF keep_id IS NULL OR keep_id = d.id THEN CONTINUE; END IF;

    -- Move ofertas para a variante canônica. Em conflito, conserva o menor custo
    -- e mantém a oferta vigente se qualquer uma estiver vigente.
    FOR o IN SELECT * FROM public.supplier_variant_offers WHERE product_variant_id = d.id LOOP
      SELECT * INTO existing_offer
      FROM public.supplier_variant_offers
      WHERE supplier_id = o.supplier_id
        AND product_id = o.product_id
        AND variant_key = d.variant_key
        AND id <> o.id
      LIMIT 1;

      IF existing_offer.id IS NULL THEN
        UPDATE public.supplier_variant_offers
        SET product_variant_id = keep_id,
            variant_name = canonical_name,
            variant_key = d.variant_key,
            updated_at = now()
        WHERE id = o.id;
      ELSE
        UPDATE public.supplier_variant_offers
        SET unit_cost = LEAST(existing_offer.unit_cost, o.unit_cost),
            available = existing_offer.available OR o.available,
            source_archive_id = CASE
              WHEN o.available AND NOT existing_offer.available THEN o.source_archive_id
              ELSE existing_offer.source_archive_id
            END,
            last_seen_at = GREATEST(existing_offer.last_seen_at, o.last_seen_at),
            updated_at = now()
        WHERE id = existing_offer.id;
        DELETE FROM public.supplier_variant_offers WHERE id = o.id;
      END IF;
    END LOOP;

    UPDATE public.product_variants keep
    SET cost_price = CASE
          WHEN keep.cost_price IS NULL THEN dup.cost_price
          WHEN dup.cost_price IS NULL THEN keep.cost_price
          ELSE LEAST(keep.cost_price, dup.cost_price)
        END,
        suggested_price = COALESCE(keep.suggested_price, dup.suggested_price),
        price_delta = COALESCE(keep.price_delta, dup.price_delta, 0),
        in_stock = (keep.in_stock::text = 'true' OR dup.in_stock::text = 'true')::text,
        needs_price_review = COALESCE(keep.suggested_price, dup.suggested_price, 0) <= 0,
        updated_at = now()
    FROM public.product_variants dup
    WHERE keep.id = keep_id AND dup.id = d.id;

    DELETE FROM public.product_variants WHERE id = d.id;
  END LOOP;
END $$;

-- Recalcula todos os produtos da loja após a consolidação; a função existente
-- considera somente ofertas ativas ligadas a arquivos de catálogo ainda válidos.
DO $$
DECLARE s RECORD;
BEGIN
  FOR s IN SELECT id FROM public.suppliers LOOP
    PERFORM public.reconcile_supplier_catalog(s.id);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.catalog_variant_match_key(TEXT) TO authenticated, service_role;
