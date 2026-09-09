-- Protege a identidade do catálogo sem apagar cadastros existentes.
-- O mesmo nome pode existir em categorias distintas; o conflito é definido por
-- loja + nome normalizado + categoria normalizada + tipo + condição.
CREATE OR REPLACE FUNCTION public.normalize_catalog_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(regexp_replace(
    translate(lower(coalesce(value, '')), 'áàãâäéèêëíìîïóòõôöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '\\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_catalog_product()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_item_type text := coalesce(NEW.item_type, 'product');
  v_condition text := coalesce(NEW.condition, 'new');
BEGIN
  IF NEW.tenant_id IS NULL OR nullif(trim(NEW.name), '') IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.products p
     WHERE p.tenant_id = NEW.tenant_id
       AND p.id <> coalesce(NEW.id, p.id)
       AND public.normalize_catalog_text(p.name) = public.normalize_catalog_text(NEW.name)
       AND public.normalize_catalog_text(coalesce(p.category, 'Geral')) = public.normalize_catalog_text(coalesce(NEW.category, 'Geral'))
       AND coalesce(p.item_type, 'product') = v_item_type
       AND coalesce(p.condition, 'new') = v_condition
  ) THEN
    RAISE EXCEPTION 'Produto já cadastrado nesta loja: nome, categoria, tipo e condição iguais.'
      USING ERRCODE = '23505', DETAIL = 'Use a atualização do produto existente ou altere a identidade do cadastro.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_catalog_product ON public.products;
CREATE TRIGGER trg_prevent_duplicate_catalog_product
  BEFORE INSERT OR UPDATE OF tenant_id, name, category, item_type, condition
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_catalog_product();

-- Mantém somente uma tentativa ativa por pedido/provedor. Tentativas antigas
-- continuam no histórico, mas deixam de competir com a cobrança vigente.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY provider, order_id ORDER BY created_at DESC, id DESC) AS rn
    FROM public.payment_transactions
   WHERE status IN ('pending', 'paid')
)
UPDATE public.payment_transactions pt
   SET status = 'superseded'
  FROM ranked r
 WHERE pt.id = r.id
   AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_active_order_provider_uidx
  ON public.payment_transactions (provider, order_id)
 WHERE status IN ('pending', 'paid');

COMMENT ON INDEX public.payment_transactions_active_order_provider_uidx IS
  'Impede mais de uma cobrança ativa do mesmo provedor para o mesmo pedido.';
