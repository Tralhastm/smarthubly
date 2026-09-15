-- Corrige o salvamento automático de preços principais e normaliza aliases de cores.
-- A tabela supplier_product_prices não possui tenant_id; o tenant é derivado de suppliers.

CREATE OR REPLACE FUNCTION public.normalize_supplier_variant_key(_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text;
BEGIN
  v := lower(trim(coalesce(_value, '')));
  v := translate(v,
    'áàãâäéèêëíìîïóòõôöúùûüçñ',
    'aaaaaeeeeiiiiooooouuuucn'
  );
  v := regexp_replace(v, '[^a-z0-9]+', ' ', 'g');
  v := trim(regexp_replace(v, '\s+', ' ', 'g'));
  IF v = 'titanium' THEN v := 'titanio'; END IF;
  IF v = 'black' THEN v := 'preto'; END IF;
  IF v = 'white' THEN v := 'branco'; END IF;
  IF v = 'blue' THEN v := 'azul'; END IF;
  IF v IN ('gray', 'grey') THEN v := 'cinza'; END IF;
  IF v = 'green' THEN v := 'verde'; END IF;
  IF v IN ('purple', 'violet') THEN v := 'roxo'; END IF;
  IF v = 'pink' THEN v := 'rosa'; END IF;
  IF v IN ('gold', 'golden') THEN v := 'dourado'; END IF;
  IF v = 'silver' THEN v := 'prata'; END IF;
  IF v = 'orange' THEN v := 'laranja'; END IF;
  IF v = 'brown' THEN v := 'marrom'; END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_supplier_variant_offer_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.variant_key := public.normalize_supplier_variant_key(coalesce(NEW.variant_key, NEW.variant_name));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_supplier_variant_offer_key_trigger ON public.supplier_variant_offers;
CREATE TRIGGER normalize_supplier_variant_offer_key_trigger
BEFORE INSERT OR UPDATE OF variant_key, variant_name ON public.supplier_variant_offers
FOR EACH ROW EXECUTE FUNCTION public.normalize_supplier_variant_offer_key();

-- Remove o registro duplicado legado titanium/titanio do Note 15.
-- O registro normalizado 'titanio' é a fonte correta e permanece disponível.
DELETE FROM public.supplier_variant_offers duplicate_offer
WHERE duplicate_offer.supplier_id = '9f61817e-b6aa-49b7-99bb-4d5ecbadef71'
  AND duplicate_offer.product_id = '2a1c0702-186a-4cbe-a408-66ed5c86da5f'
  AND duplicate_offer.variant_key = 'titanium'
  AND EXISTS (
    SELECT 1
    FROM public.supplier_variant_offers canonical_offer
    WHERE canonical_offer.supplier_id = duplicate_offer.supplier_id
      AND canonical_offer.product_id = duplicate_offer.product_id
      AND canonical_offer.variant_key = 'titanio'
  );

-- Corrige o RPC usado pelo painel/token: tenant_id não existe nesta tabela.
CREATE OR REPLACE FUNCTION public.upsert_supplier_product_price_by_token(
  _token text,
  _product_name text,
  _unit_price numeric,
  _source_archive_id uuid DEFAULT NULL
)
RETURNS public.supplier_product_prices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier public.suppliers%ROWTYPE;
  v_row public.supplier_product_prices;
BEGIN
  SELECT * INTO v_supplier
  FROM public.suppliers
  WHERE access_token = _token
    AND _token IS NOT NULL
    AND length(_token) >= 16;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_supplier_token'; END IF;

  INSERT INTO public.supplier_product_prices(
    supplier_id, product_name, unit_price,
    price_types, available, source_archive_id
  ) VALUES (
    v_supplier.id, lower(trim(_product_name)),
    _unit_price, '["cost"]'::jsonb, true, _source_archive_id
  )
  ON CONFLICT(supplier_id, product_name) DO UPDATE SET
    unit_price = EXCLUDED.unit_price,
    price_types = EXCLUDED.price_types,
    available = true,
    source_archive_id = COALESCE(EXCLUDED.source_archive_id, supplier_product_prices.source_archive_id),
    updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_supplier_product_price_by_token(text,text,numeric,uuid)
  TO anon, authenticated;
