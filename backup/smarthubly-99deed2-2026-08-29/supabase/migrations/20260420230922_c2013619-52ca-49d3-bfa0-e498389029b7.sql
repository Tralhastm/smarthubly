-- Reclassifica workers existentes baseado no path da URL
UPDATE public.ai_workers
SET worker_type = CASE
  WHEN base_url ~* '(generate-image|gen-image|/image|/img)' THEN 'image'
  WHEN base_url ~* '(parse-txt|/txt|parse-text|extract-text)' THEN 'txt'
  ELSE 'chat'
END;

-- Renumera os nomes baseado na ordem de criação dentro de cada tipo
WITH ranked AS (
  SELECT
    id,
    worker_type,
    ROW_NUMBER() OVER (PARTITION BY worker_type ORDER BY created_at) AS rn
  FROM public.ai_workers
)
UPDATE public.ai_workers w
SET name = CASE r.worker_type
  WHEN 'chat' THEN 'Chat ' || r.rn
  WHEN 'txt' THEN 'TXT ' || r.rn
  WHEN 'image' THEN 'Imagem ' || r.rn
END
FROM ranked r
WHERE w.id = r.id;