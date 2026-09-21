-- Bloqueio isolado de itens conflitantes durante importações de fornecedor.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS catalog_conflict BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_conflict_reason TEXT,
  ADD COLUMN IF NOT EXISTS catalog_conflict_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.mark_catalog_product_conflict(
  _product_id TEXT,
  _reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products
  SET catalog_conflict = true,
      catalog_conflict_reason = LEFT(COALESCE(_reason, 'Conflito detectado na importação do catálogo'), 1000),
      catalog_conflict_at = now(),
      in_stock = false,
      store_visible = true,
      updated_at = now()
  WHERE id = _product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_catalog_product_conflict(_product_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products
  SET catalog_conflict = false,
      catalog_conflict_reason = NULL,
      catalog_conflict_at = NULL,
      updated_at = now()
  WHERE id = _product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_catalog_product_conflict(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_catalog_product_conflict(TEXT, TEXT) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.clear_catalog_product_conflict(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_catalog_product_conflict(TEXT) TO authenticated, service_role;
