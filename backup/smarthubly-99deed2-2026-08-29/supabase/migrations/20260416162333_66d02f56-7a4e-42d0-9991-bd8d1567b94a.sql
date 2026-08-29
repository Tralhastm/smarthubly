
ALTER TABLE public.tenants
  ADD COLUMN promo_title text NOT NULL DEFAULT 'Promoção do Dia',
  ADD COLUMN promo_text text NOT NULL DEFAULT '',
  ADD COLUMN promo_active boolean NOT NULL DEFAULT false;
