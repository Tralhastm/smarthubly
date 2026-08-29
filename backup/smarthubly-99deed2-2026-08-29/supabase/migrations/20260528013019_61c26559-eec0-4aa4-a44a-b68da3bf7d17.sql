
-- ===== Versão otimista em table_sessions e items =====
ALTER TABLE public.table_sessions
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.table_session_items
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Trigger genérico pra incrementar version em qualquer UPDATE
CREATE OR REPLACE FUNCTION public.bump_row_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_version_table_sessions ON public.table_sessions;
CREATE TRIGGER trg_bump_version_table_sessions
  BEFORE UPDATE ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS trg_bump_version_table_session_items ON public.table_session_items;
CREATE TRIGGER trg_bump_version_table_session_items
  BEFORE UPDATE ON public.table_session_items
  FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

-- ===== Update atômico de table_session com checagem de versão =====
CREATE OR REPLACE FUNCTION public.update_table_session_safe(
  _session_id UUID,
  _expected_version INTEGER,
  _patch JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current INTEGER;
BEGIN
  SELECT version INTO v_current FROM public.table_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_current <> _expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'version_mismatch', 'current_version', v_current);
  END IF;

  UPDATE public.table_sessions SET
    status = COALESCE(_patch->>'status', status),
    total = COALESCE((_patch->>'total')::numeric, total),
    customer_name = COALESCE(_patch->>'customer_name', customer_name),
    assigned_waiter_id = COALESCE((_patch->>'assigned_waiter_id')::uuid, assigned_waiter_id),
    assigned_waiter_name = COALESCE(_patch->>'assigned_waiter_name', assigned_waiter_name),
    updated_at = now()
  WHERE id = _session_id;

  RETURN jsonb_build_object('ok', true, 'new_version', v_current + 1);
END;
$$;

-- ===== Ajuste atômico de estoque (sem race) =====
-- Diferente do trigger atual: usa UPDATE direto e retorna o novo valor,
-- permitindo bloquear ou alertar quando o estoque ficaria negativo.
CREATE OR REPLACE FUNCTION public.adjust_ingredient_stock(
  _ingredient_id UUID,
  _delta NUMERIC,
  _allow_negative BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new NUMERIC;
  v_tenant UUID;
BEGIN
  -- UPDATE atômico em uma única expressão Postgres
  UPDATE public.ingredients
     SET stock = COALESCE(stock, 0) + _delta,
         updated_at = now()
   WHERE id = _ingredient_id
   RETURNING stock, tenant_id INTO v_new, v_tenant;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ingredient_not_found');
  END IF;

  IF v_new < 0 AND NOT _allow_negative THEN
    -- Reverte
    UPDATE public.ingredients
       SET stock = COALESCE(stock, 0) - _delta
     WHERE id = _ingredient_id;
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_stock', 'available', v_new - _delta);
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_stock', v_new, 'tenant_id', v_tenant);
END;
$$;

-- ===== Advisory lock pra NFC-e (impede dupla emissão simultânea no mesmo pedido) =====
CREATE OR REPLACE FUNCTION public.acquire_nfce_lock(_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key BIGINT;
BEGIN
  -- hashtextextended retorna BIGINT; namespace fixo pra NFC-e = 42001
  v_key := ('x' || substr(md5('nfce:' || _order_id::text), 1, 16))::bit(64)::bigint;
  RETURN pg_try_advisory_xact_lock(v_key);
END;
$$;
