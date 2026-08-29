ALTER TABLE public.remote_prospects
  ADD COLUMN IF NOT EXISTS manual_intel TEXT,
  ADD COLUMN IF NOT EXISTS competitor_stack TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS stack_summary TEXT,
  ADD COLUMN IF NOT EXISTS stack_scraped_at TIMESTAMPTZ;