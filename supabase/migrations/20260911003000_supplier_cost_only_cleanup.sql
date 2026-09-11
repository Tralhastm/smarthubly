-- Preços recebidos em listas de fornecedores representam somente custo.
-- Revenda é sempre manual e não deve ser inferida do catálogo do fornecedor.
UPDATE public.product_variants
SET suggested_price = NULL,
    price_delta = 0,
    needs_price_review = (in_stock = 'true'),
    updated_at = now()
WHERE price_source = 'supplier_offer'
  AND suggested_price IS NOT NULL;

UPDATE public.products p
SET price = 0,
    in_stock = false,
    updated_at = now()
WHERE p.supplier_id IS NOT NULL
  AND p.original_price IS NOT NULL
  AND p.price > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id
  );
