-- O botão amarelo cria pedidos pagos apenas em modo de teste.
-- O fluxo deve ser aceito pelo banco sem abrir cobrança em provedor oficial.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_flow_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_flow_check
  CHECK (
    payment_flow IS NULL
    OR payment_flow = ANY (ARRAY['online'::text, 'online_demo'::text, 'delivery_tap'::text])
  );
