-- Mantém o produto antigo e todos os pedidos históricos, mas remove-o da vitrine
-- ativa para que exista uma única identidade comercial no catálogo.
UPDATE public.products
   SET manual_blocked = true,
       in_stock = false,
       updated_at = now()
 WHERE id = 'e2bcecea-39d5-4980-b9dd-cd2f20fbd692'
   AND tenant_id = '1e022d8c-6218-4ac4-a5a7-4f96e4413b6e';

CREATE OR REPLACE FUNCTION public.prevent_duplicate_catalog_product()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_item_type text := coalesce(NEW.item_type, 'product');
  v_condition text := coalesce(NEW.condition, 'new');
BEGIN
  IF NEW.tenant_id IS NULL OR nullif(trim(NEW.name), '') IS NULL OR coalesce(NEW.manual_blocked, false) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.products p
     WHERE p.tenant_id = NEW.tenant_id
       AND p.id <> coalesce(NEW.id, p.id)
       AND coalesce(p.manual_blocked, false) = false
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
