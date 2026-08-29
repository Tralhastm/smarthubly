ALTER TABLE public.remote_prospects
  ADD COLUMN IF NOT EXISTS reviews_sample jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pain_signals text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pain_summary text,
  ADD COLUMN IF NOT EXISTS reviews_scraped_at timestamptz;