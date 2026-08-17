
ALTER TABLE public.products
  ADD COLUMN stock_quantity integer DEFAULT NULL;

ALTER TABLE public.tenants
  ADD COLUMN splash_bg_color text NOT NULL DEFAULT '#0F172A';
