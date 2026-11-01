UPDATE public.api_keys
SET is_exhausted = false
WHERE is_exhausted IS NULL;

ALTER TABLE public.api_keys
  ALTER COLUMN is_exhausted SET DEFAULT false;
