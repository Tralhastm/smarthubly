-- Uma loja não pode possuir dois produtos com a mesma identidade técnica.
-- A chave ignora apenas formatação, unidades GB e pontuação; preserva 4G/5G,
-- NFC, Pro, Max, RAM, capacidade e edições distintas.

CREATE OR REPLACE FUNCTION public.catalog_product_identity_key(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(string_agg(token, ' ' ORDER BY token), '')
  FROM regexp_split_to_table(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(translate(coalesce(value, ''),
            'áàãâäéèêëíìîïóòõôöúùûüç',
            'aaaaaeeeeiiiiooooouuuuc')),
          '[^a-z0-9]+', ' ', 'g'),
        '([0-9]+)gb', '\\1', 'g'),
      '\\s+', ' ', 'g'),
    '\\s+') AS token
  WHERE token <> '';
$$;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_catalog_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.tenant_id = NEW.tenant_id
      AND p.id <> NEW.id
      AND public.catalog_product_identity_key(p.name) = public.catalog_product_identity_key(NEW.name)
  ) THEN
    RAISE EXCEPTION 'produto_duplicado_no_catalogo: %', NEW.name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_catalog_product ON public.products;
CREATE TRIGGER trg_prevent_duplicate_catalog_product
BEFORE INSERT OR UPDATE OF name, tenant_id ON public.products
FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_catalog_product();

GRANT EXECUTE ON FUNCTION public.catalog_product_identity_key(TEXT) TO authenticated, service_role;
