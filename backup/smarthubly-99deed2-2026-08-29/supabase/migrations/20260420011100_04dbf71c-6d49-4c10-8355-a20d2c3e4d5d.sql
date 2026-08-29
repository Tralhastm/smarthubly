-- Adiciona supplier_id em drivers para distinguir motoboys da loja vs do fornecedor
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_drivers_supplier_id ON public.drivers(supplier_id);