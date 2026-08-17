
ALTER TABLE public.financial_entries DROP CONSTRAINT IF EXISTS financial_entries_category_check;
ALTER TABLE public.financial_entries ADD CONSTRAINT financial_entries_category_check
  CHECK (category = ANY (ARRAY[
    'fixed','variable','investment','unexpected',
    'taxa_plataforma','venda','dropshipping','taxa_entrega',
    'estorno_venda','estorno_taxa_plataforma'
  ]));
