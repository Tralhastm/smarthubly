UPDATE public.api_keys SET is_exhausted = false WHERE provider = 'google_ai';
UPDATE public.ai_workers SET is_exhausted = false, exhausted_at = NULL WHERE base_url LIKE '%ai-generate-image%';