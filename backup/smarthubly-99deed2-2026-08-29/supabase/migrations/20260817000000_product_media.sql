-- Galeria multimídia por produto: array JSONB de {type:'image'|'video', url}
-- Carrossel opcional no cardápio e na sessão de mesa (QR).
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.products.media IS 'Galeria opcional do produto: [{"type":"image|video","url":"https://..."}]';
