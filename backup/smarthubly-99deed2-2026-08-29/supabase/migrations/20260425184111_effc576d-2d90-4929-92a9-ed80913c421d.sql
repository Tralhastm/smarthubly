-- Reset workers e api keys exauridos pra reabilitar fallback
UPDATE public.ai_workers 
SET is_exhausted = false, exhausted_at = NULL, updated_at = now()
WHERE is_exhausted = true;

UPDATE public.api_keys 
SET is_exhausted = false, updated_at = now()
WHERE is_exhausted = true;