ALTER TABLE public.financial_entries ADD COLUMN IF NOT EXISTS subcategory text;
CREATE INDEX IF NOT EXISTS idx_financial_entries_subcategory ON public.financial_entries(tenant_id, subcategory);

-- Backfill: tenta inferir subcategory a partir da description pra dados existentes
UPDATE public.financial_entries SET subcategory = 'inventory'
  WHERE subcategory IS NULL AND type = 'expense' AND category = 'variable'
    AND (description ILIKE '%estoque%' OR description ILIKE '%refrigerante%' OR description ILIKE '%bebida%' OR description ILIKE '%compra%');
UPDATE public.financial_entries SET subcategory = 'marketing'
  WHERE subcategory IS NULL AND type = 'expense' AND category = 'variable'
    AND (description ILIKE '%marketing%' OR description ILIKE '%anuncio%' OR description ILIKE '%anúncio%' OR description ILIKE '%instagram%' OR description ILIKE '%facebook%');
UPDATE public.financial_entries SET subcategory = 'rent' WHERE subcategory IS NULL AND type = 'expense' AND category = 'fixed' AND description ILIKE '%aluguel%';
UPDATE public.financial_entries SET subcategory = 'utilities' WHERE subcategory IS NULL AND type = 'expense' AND category = 'fixed' AND (description ILIKE '%luz%' OR description ILIKE '%agua%' OR description ILIKE '%água%' OR description ILIKE '%internet%' OR description ILIKE '%net%');
UPDATE public.financial_entries SET subcategory = 'salaries' WHERE subcategory IS NULL AND type = 'expense' AND category = 'fixed' AND (description ILIKE '%salario%' OR description ILIKE '%salário%' OR description ILIKE '%pro-labore%' OR description ILIKE '%pró-labore%');
UPDATE public.financial_entries SET subcategory = 'sales' WHERE subcategory IS NULL AND type = 'income' AND category = 'venda';
UPDATE public.financial_entries SET subcategory = 'other_in' WHERE subcategory IS NULL AND type = 'income' AND category = 'variable';
UPDATE public.financial_entries SET subcategory = 'other_out' WHERE subcategory IS NULL AND type = 'expense' AND category = 'variable';