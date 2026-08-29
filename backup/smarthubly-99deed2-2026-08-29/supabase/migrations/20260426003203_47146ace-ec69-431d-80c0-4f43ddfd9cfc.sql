ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS affiliate_coupon_code text,
  ADD COLUMN IF NOT EXISTS affiliate_coupon_discount_price numeric,
  ADD COLUMN IF NOT EXISTS affiliate_coupon_expires_at timestamptz;