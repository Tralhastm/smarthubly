-- Atomic idempotency for scheduled suggestions. Existing suggestion rows are preserved;
-- advisory transaction locks serialize a key, and each check+insert runs in one transaction.

CREATE OR REPLACE FUNCTION public.insert_automation_suggestion_once(
  _tenant_id TEXT,
  _type TEXT,
  _title TEXT,
  _description TEXT,
  _payload JSONB,
  _dedupe_key TEXT
)
RETURNS TABLE(inserted BOOLEAN, suggestion_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id TEXT;
  v_idempotency_key TEXT;
BEGIN
  IF _tenant_id IS NULL OR _type NOT IN ('low_stock_promo', 'combo_suggestion', 'peak_alert') THEN
    RAISE EXCEPTION 'Invalid tenant or suggestion type for atomic suggestion insert';
  END IF;
  IF COALESCE(_dedupe_key, '') = '' THEN
    RAISE EXCEPTION 'A non-empty dedupe key is required';
  END IF;

  -- Peak alerts retain their existing 24-hour pending cooldown for the tenant.
  v_idempotency_key := _tenant_id || ':' || _type || ':' ||
    CASE WHEN _type = 'peak_alert' THEN 'pending-24h' ELSE _dedupe_key END;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_idempotency_key, 0));

  IF _type = 'low_stock_promo' THEN
    -- Also recognize keyless pending rows created by the old implementation.
    SELECT s.id INTO v_existing_id
      FROM public.automation_suggestions s
     WHERE s.tenant_id = _tenant_id
       AND s.type = _type
       AND COALESCE(s.status, 'pending') = 'pending'
       AND (
         s.payload->>'dedupe_key' = _dedupe_key
         OR s.payload->>'product_id' = _payload->>'product_id'
       )
     ORDER BY s.created_at DESC
     LIMIT 1;
  ELSIF _type = 'combo_suggestion' THEN
    -- Preserve the existing 90-day cooldown, including legacy rows without a key.
    SELECT s.id INTO v_existing_id
      FROM public.automation_suggestions s
     WHERE s.tenant_id = _tenant_id
       AND s.type = _type
       AND s.created_at >= now() - INTERVAL '90 days'
       AND (
         s.payload->>'dedupe_key' = _dedupe_key
         OR (NOT (s.payload ? 'dedupe_key') AND s.payload->'product_ids' = _payload->'product_ids')
       )
     ORDER BY s.created_at DESC
     LIMIT 1;
  ELSE
    -- Preserve the existing 24-hour pending cooldown for peak alerts.
    SELECT s.id INTO v_existing_id
      FROM public.automation_suggestions s
     WHERE s.tenant_id = _tenant_id
       AND s.type = _type
       AND COALESCE(s.status, 'pending') = 'pending'
       AND s.created_at >= now() - INTERVAL '24 hours'
     ORDER BY s.created_at DESC
     LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, v_existing_id;
    RETURN;
  END IF;

  INSERT INTO public.automation_suggestions (tenant_id, type, title, description, payload, status)
  VALUES (_tenant_id, _type, _title, _description, COALESCE(_payload, '{}'::jsonb) || jsonb_build_object('dedupe_key', _dedupe_key), 'pending')
  RETURNING id INTO v_existing_id;

  RETURN QUERY SELECT TRUE, v_existing_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_automation_suggestion_once(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_automation_suggestion_once(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.insert_affiliate_match_suggestion_once(
  _tenant_id TEXT,
  _dedupe_key TEXT,
  _product_name TEXT,
  _product_description TEXT,
  _category TEXT,
  _suggested_network TEXT,
  _rationale TEXT,
  _match_score NUMERIC,
  _title TEXT,
  _description TEXT,
  _payload JSONB
)
RETURNS TABLE(inserted BOOLEAN, affiliate_suggestion_id TEXT, automation_suggestion_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT := regexp_replace(lower(trim(COALESCE(_product_name, ''))), '\s+', ' ', 'g');
  v_category TEXT := regexp_replace(lower(trim(COALESCE(_category, ''))), '\s+', ' ', 'g');
  v_network TEXT := regexp_replace(lower(trim(COALESCE(_suggested_network, ''))), '\s+', ' ', 'g');
  v_affiliate_id TEXT;
  v_automation_id TEXT;
BEGIN
  IF _tenant_id IS NULL OR COALESCE(_dedupe_key, '') = '' THEN
    RAISE EXCEPTION 'Tenant and dedupe key are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id || ':affiliate_match:' || _dedupe_key, 0));

  -- Match both old and new pending rows before writing either table. This avoids
  -- adding another copy to the historical backlog and keeps the two tables aligned.
  IF EXISTS (
    SELECT 1
      FROM public.affiliate_match_suggestions s
     WHERE s.tenant_id = _tenant_id
       AND COALESCE(s.status, 'pending') = 'pending'
       AND regexp_replace(lower(trim(COALESCE(s.product_name, ''))), '\s+', ' ', 'g') = v_name
       AND regexp_replace(lower(trim(COALESCE(s.category, ''))), '\s+', ' ', 'g') = v_category
       AND regexp_replace(lower(trim(COALESCE(s.suggested_network, ''))), '\s+', ' ', 'g') = v_network
  ) OR EXISTS (
    SELECT 1
      FROM public.automation_suggestions s
     WHERE s.tenant_id = _tenant_id
       AND s.type = 'affiliate_match'
       AND COALESCE(s.status, 'pending') = 'pending'
       AND (
         s.payload->>'dedupe_key' = _dedupe_key
         OR (
           regexp_replace(lower(trim(COALESCE(s.payload->>'product_name', ''))), '\s+', ' ', 'g') = v_name
           AND regexp_replace(lower(trim(COALESCE(s.payload->>'category', ''))), '\s+', ' ', 'g') = v_category
           AND regexp_replace(lower(trim(COALESCE(s.payload->>'suggested_network', ''))), '\s+', ' ', 'g') = v_network
         )
       )
  ) THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.affiliate_match_suggestions (
    tenant_id, product_name, product_description, category,
    suggested_network, rationale, match_score, status
  ) VALUES (
    _tenant_id, _product_name, _product_description, _category,
    _suggested_network, _rationale, _match_score, 'pending'
  ) RETURNING id INTO v_affiliate_id;

  INSERT INTO public.automation_suggestions (
    tenant_id, type, title, description, payload, status
  ) VALUES (
    _tenant_id, 'affiliate_match', _title, _description,
    COALESCE(_payload, '{}'::jsonb) || jsonb_build_object('dedupe_key', _dedupe_key), 'pending'
  ) RETURNING id INTO v_automation_id;

  RETURN QUERY SELECT TRUE, v_affiliate_id, v_automation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_affiliate_match_suggestion_once(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_affiliate_match_suggestion_once(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, JSONB) TO service_role;
