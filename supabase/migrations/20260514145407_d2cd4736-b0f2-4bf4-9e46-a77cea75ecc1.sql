ALTER TABLE public.remote_prospects
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS neighborhood text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS sector text,
  ADD COLUMN IF NOT EXISTS rating numeric,
  ADD COLUMN IF NOT EXISTS reviews_count integer,
  ADD COLUMN IF NOT EXISTS hours text,
  ADD COLUMN IF NOT EXISTS maps_url text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS price_level integer,
  ADD COLUMN IF NOT EXISTS photos jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS scrape_source text;

CREATE INDEX IF NOT EXISTS idx_remote_prospects_state_city ON public.remote_prospects(state, city);
CREATE INDEX IF NOT EXISTS idx_remote_prospects_neighborhood ON public.remote_prospects(neighborhood);
CREATE INDEX IF NOT EXISTS idx_remote_prospects_sector ON public.remote_prospects(sector);