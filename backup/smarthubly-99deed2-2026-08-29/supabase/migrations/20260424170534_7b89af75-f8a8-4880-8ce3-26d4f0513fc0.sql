ALTER TABLE public.financial_entries DROP CONSTRAINT IF EXISTS financial_entries_category_check;
ALTER TABLE public.financial_entries ADD CONSTRAINT financial_entries_category_check
  CHECK (category = ANY (ARRAY['fixed'::text, 'variable'::text, 'investment'::text, 'unexpected'::text, 'taxa_plataforma'::text, 'venda'::text, 'dropshipping'::text, 'taxa_entrega'::text]));