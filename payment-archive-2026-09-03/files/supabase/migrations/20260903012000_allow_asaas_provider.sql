ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_payment_provider_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_payment_provider_check
  CHECK (payment_provider IN ('mercadopago','pagbank','infinitepay','asaas'));
