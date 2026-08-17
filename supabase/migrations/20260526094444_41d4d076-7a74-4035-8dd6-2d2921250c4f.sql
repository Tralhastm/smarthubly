
-- 1) Pagamentos parciais por comanda
CREATE TABLE IF NOT EXISTS public.table_session_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'dinheiro',
  payer_name TEXT NOT NULL DEFAULT '',
  operator_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tsp_session ON public.table_session_payments(session_id);
CREATE INDEX IF NOT EXISTS idx_tsp_tenant ON public.table_session_payments(tenant_id);
ALTER TABLE public.table_session_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone read session payments" ON public.table_session_payments FOR SELECT USING (true);
CREATE POLICY "Anyone insert session payments" ON public.table_session_payments FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins manage session payments" ON public.table_session_payments FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

-- 2) Lugares por mesa e junção de mesas
ALTER TABLE public.restaurant_tables ADD COLUMN IF NOT EXISTS seats INTEGER;
ALTER TABLE public.table_sessions ADD COLUMN IF NOT EXISTS merged_into_session_id UUID REFERENCES public.table_sessions(id) ON DELETE SET NULL;

-- 3) Transferência de mesa
CREATE OR REPLACE FUNCTION public.transfer_table_session(_session_id UUID, _new_table_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant UUID; v_label TEXT; v_target_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.table_sessions WHERE id = _session_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
  SELECT tenant_id, label INTO v_target_tenant, v_label FROM public.restaurant_tables WHERE id = _new_table_id;
  IF v_target_tenant IS NULL OR v_target_tenant <> v_tenant THEN RAISE EXCEPTION 'invalid_target_table'; END IF;
  IF EXISTS (SELECT 1 FROM public.table_sessions WHERE table_id = _new_table_id AND status IN ('open','sent') AND id <> _session_id) THEN
    RAISE EXCEPTION 'target_table_occupied';
  END IF;
  UPDATE public.table_sessions SET table_id = _new_table_id, table_label = v_label, updated_at = now() WHERE id = _session_id;
  RETURN TRUE;
END;
$$;

-- 4) Junção de comandas (move itens e pagamentos da origem pra destino, fecha origem)
CREATE OR REPLACE FUNCTION public.merge_table_sessions(_source_id UUID, _target_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_st UUID; v_tt UUID;
BEGIN
  SELECT tenant_id INTO v_st FROM public.table_sessions WHERE id = _source_id;
  SELECT tenant_id INTO v_tt FROM public.table_sessions WHERE id = _target_id;
  IF v_st IS NULL OR v_tt IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF v_st <> v_tt THEN RAISE EXCEPTION 'tenant_mismatch'; END IF;
  IF _source_id = _target_id THEN RAISE EXCEPTION 'same_session'; END IF;

  UPDATE public.table_session_items SET session_id = _target_id WHERE session_id = _source_id;
  UPDATE public.table_session_payments SET session_id = _target_id WHERE session_id = _source_id;

  UPDATE public.table_sessions ts SET total = COALESCE((
    SELECT SUM(quantity * product_price) FROM public.table_session_items WHERE session_id = _target_id
  ), 0) WHERE ts.id = _target_id;

  UPDATE public.table_sessions
     SET status = 'paid', merged_into_session_id = _target_id, paid_at = now(), updated_at = now()
   WHERE id = _source_id;
  RETURN TRUE;
END;
$$;

-- 5) Toggle "86" — esgotar/restaurar produto em 1 clique
CREATE OR REPLACE FUNCTION public.toggle_product_86(_product_id UUID, _in_stock BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.products SET in_stock = _in_stock, updated_at = now() WHERE id = _product_id;
  RETURN FOUND;
END;
$$;

-- 6) Salão ao Vivo — uma chamada retorna todas as mesas com sessão atual, totais e pagamentos parciais
CREATE OR REPLACE FUNCTION public.get_live_floor(_tenant_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB; v_total_open NUMERIC := 0; v_count_open INT := 0;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table_id', t.id,
    'label', t.label,
    'seats', t.seats,
    'active', t.active,
    'session', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', s.id,
        'status', s.status,
        'customer_name', s.customer_name,
        'total', s.total,
        'opened_at', s.opened_at,
        'sent_at', s.sent_at,
        'assigned_waiter_name', s.assigned_waiter_name,
        'minutes_open', EXTRACT(EPOCH FROM (now() - s.opened_at))/60,
        'paid_partial', COALESCE((SELECT SUM(amount) FROM public.table_session_payments WHERE session_id = s.id), 0),
        'balance', s.total - COALESCE((SELECT SUM(amount) FROM public.table_session_payments WHERE session_id = s.id), 0),
        'items_count', (SELECT COUNT(*) FROM public.table_session_items WHERE session_id = s.id)
      ) END
  ) ORDER BY t.label), '[]'::jsonb) INTO v_result
  FROM public.restaurant_tables t
  LEFT JOIN LATERAL (
    SELECT * FROM public.table_sessions
     WHERE table_id = t.id AND status IN ('open','sent')
     ORDER BY opened_at DESC LIMIT 1
  ) s ON true
  WHERE t.tenant_id = _tenant_id;

  SELECT COALESCE(SUM(total), 0), COUNT(*) INTO v_total_open, v_count_open
    FROM public.table_sessions
   WHERE tenant_id = _tenant_id AND status IN ('open','sent');

  RETURN jsonb_build_object(
    'tables', v_result,
    'total_open', v_total_open,
    'count_open', v_count_open,
    'generated_at', now()
  );
END;
$$;

-- 7) Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.table_session_payments;
