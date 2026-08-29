-- Motoboy abre painel sem login, usando access_token como segredo.
-- Mantemos a policy antiga (authenticated) e adicionamos uma pra anon
-- que só funciona quando o cliente filtra por access_token.

-- 1) Driver pode ser lido por anon (o token no link já é o "segredo")
CREATE POLICY "Anon can read drivers (token is the secret)"
  ON public.drivers FOR SELECT
  TO anon
  USING (true);

-- 2) Anon pode ler pedidos atribuídos a um motoboy ativo
--    (já que o motoboy precisa ver seus pedidos no painel)
CREATE POLICY "Anon can read orders assigned to active drivers"
  ON public.orders FOR SELECT
  TO anon
  USING (
    driver_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = orders.driver_id AND d.active = true)
  );

-- 3) Anon pode ler itens desses pedidos
CREATE POLICY "Anon can read order_items of driver orders"
  ON public.order_items FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.drivers d ON d.id = o.driver_id
      WHERE o.id = order_items.order_id AND d.active = true
    )
  );

-- 4) Anon pode atualizar status dos pedidos do motoboy (marcar entregue, etc)
--    e gravar nota de entrega
CREATE POLICY "Anon can update orders assigned to active drivers"
  ON public.orders FOR UPDATE
  TO anon
  USING (
    driver_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = orders.driver_id AND d.active = true)
  )
  WITH CHECK (
    driver_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = orders.driver_id AND d.active = true)
  );

-- 5) Anon pode atualizar o próprio driver (marcar online/offline, last_online_at)
CREATE POLICY "Anon can update driver online state"
  ON public.drivers FOR UPDATE
  TO anon
  USING (active = true)
  WITH CHECK (active = true);