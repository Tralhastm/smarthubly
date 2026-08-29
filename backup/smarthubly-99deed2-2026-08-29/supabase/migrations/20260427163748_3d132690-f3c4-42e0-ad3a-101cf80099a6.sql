CREATE POLICY "Clients can read just-created orders"
ON public.orders
FOR SELECT
TO anon, authenticated
USING (created_at > now() - interval '10 minutes');