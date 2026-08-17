
-- Recria policy SELECT pra anon nas tabelas base. Combinada com as views
-- security_invoker=on, anon só vê colunas seguras (views não expõem secrets).
-- Quem usar a tabela base como anon ainda passa pela RLS, mas o frontend
-- agora aponta pras views nos contextos públicos.

CREATE POLICY "Anon can read tenants" ON public.tenants
  FOR SELECT TO anon USING (active = true);

CREATE POLICY "Anon can read drivers" ON public.drivers
  FOR SELECT TO anon USING (true);

CREATE POLICY "Anon can read suppliers" ON public.suppliers
  FOR SELECT TO anon USING (true);

CREATE POLICY "Anon can read orders" ON public.orders
  FOR SELECT TO anon USING (true);

CREATE POLICY "Anon can read appointments" ON public.appointments
  FOR SELECT TO anon USING (true);
