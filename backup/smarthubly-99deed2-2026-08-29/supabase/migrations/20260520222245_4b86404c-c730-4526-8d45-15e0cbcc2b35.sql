-- Adiciona campo para site manual inserido pelo operador
ALTER TABLE public.remote_prospects 
ADD COLUMN IF NOT EXISTS manual_website_url text;