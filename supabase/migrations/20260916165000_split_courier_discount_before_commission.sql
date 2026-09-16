-- Custos internos antes do repasse: fornecedor, checkout 4,99%, motoboy e desconto real.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS courier_cost numeric(12,2) NOT NULL DEFAULT 50.00;
-- A função financeira é mantida no banco pela migração aplicada nesta rodada.
