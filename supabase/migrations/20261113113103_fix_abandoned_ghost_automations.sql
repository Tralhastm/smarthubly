-- Abandoned-cart consent, retry state, idempotency, and ghost-order delivery recovery.
ALTER TABLE public.cart_sessions
  ADD COLUMN IF NOT EXISTS marketing_email_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS abandoned_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.cart_sessions.marketing_email_opt_in IS
  'Consentimento explícito e opcional do cliente para receber e-mails promocionais de carrinho abandonado.';
COMMENT ON COLUMN public.cart_sessions.abandoned_email_sent_at IS
  'Momento em que o e-mail promocional de carrinho abandonado foi aceito pelo provedor.';

CREATE INDEX IF NOT EXISTS idx_cart_sessions_abandoned_email_retry
  ON public.cart_sessions (tenant_id, last_activity_at)
  WHERE converted_order_id IS NULL
    AND marketing_email_opt_in = TRUE
    AND abandoned_email_sent_at IS NULL;

-- A instalação de produção possui a forma textual histórica dessas tabelas.
-- Acrescenta os campos que o monitoramento e o retry já esperam sem reescrever IDs.
ALTER TABLE public.ghost_order_flags
  ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ghost_order_flags' AND column_name = 'created_at'
  ) THEN
    EXECUTE 'UPDATE public.ghost_order_flags SET flagged_at = COALESCE(flagged_at, created_at, now()) WHERE flagged_at IS NULL';
  ELSE
    UPDATE public.ghost_order_flags SET flagged_at = now() WHERE flagged_at IS NULL;
  END IF;
END;
$$;

ALTER TABLE public.ghost_order_flags
  ALTER COLUMN flagged_at SET DEFAULT now(),
  ALTER COLUMN flagged_at SET NOT NULL;

-- Dedupe por carrinho e por pedido fantasma. Duplicatas foram verificadas antes da aplicação.
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_suggestions_abandoned_cart_once
  ON public.automation_suggestions (tenant_id, (payload->>'cart_id'))
  WHERE type = 'abandoned_cart' AND payload ? 'cart_id';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ghost_order_flags_order_once
  ON public.ghost_order_flags (order_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_events_ghost_flagged_once
  ON public.order_events (order_id, event_type)
  WHERE event_type = 'ghost_flagged';

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_suggestions_ghost_batch_once
  ON public.automation_suggestions (tenant_id, (payload->>'dedupe_key'))
  WHERE type = 'ghost_orders' AND payload ? 'dedupe_key';

-- The production tables store order/tenant IDs as text; keep that RPC contract consistent.
DROP FUNCTION IF EXISTS public.detect_ghost_orders();
CREATE FUNCTION public.detect_ghost_orders()
RETURNS TABLE(flagged_id UUID, flagged_tenant TEXT, flagged_order TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT o.id, o.tenant_id, o.customer_phone
      FROM public.orders o
      JOIN public.tenants t ON t.id = o.tenant_id
     WHERE t.auto_detect_ghost_orders = TRUE
       AND COALESCE(t.store_mode, 'own') <> 'affiliate'
       AND o.status = 'out-for-delivery'
       AND o.updated_at < now() - INTERVAL '90 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM public.ghost_order_flags g WHERE g.order_id = o.id
       )
     ORDER BY o.updated_at ASC
     LIMIT 100
  ), inserted AS (
    INSERT INTO public.ghost_order_flags (tenant_id, order_id, customer_phone, reason, ghost_score)
    SELECT tenant_id, id, customer_phone, 'out_for_delivery_no_confirm_90min', 70
      FROM candidates
    ON CONFLICT (order_id) DO NOTHING
    RETURNING id
  ), pending AS (
    SELECT g.id, g.tenant_id, g.order_id, g.flagged_at
      FROM public.ghost_order_flags g
     WHERE g.notified_at IS NULL
     ORDER BY g.flagged_at ASC
     LIMIT 100
  )
  SELECT p.id, p.tenant_id, p.order_id
    FROM pending p
    CROSS JOIN (SELECT count(*) FROM inserted) ensure_inserted_cte_ran
   ORDER BY p.flagged_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_ghost_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_ghost_orders() TO service_role;

-- Writes the tenant suggestion, timeline events, and notified marker atomically.
-- If any write fails, all effects roll back and detect_ghost_orders retries unnotified flags.
CREATE OR REPLACE FUNCTION public.process_ghost_order_notifications(_flag_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id TEXT;
  v_tenant_count INTEGER := 0;
  v_flag_ids UUID[];
  v_order_ids TEXT[];
  v_dedupe_key TEXT;
  v_processed INTEGER := 0;
BEGIN
  IF _flag_ids IS NULL OR cardinality(_flag_ids) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'processed', 0);
  END IF;

  SELECT count(DISTINCT g.tenant_id)
    INTO v_tenant_count
    FROM public.ghost_order_flags g
   WHERE g.id = ANY(_flag_ids);
  IF v_tenant_count > 1 THEN
    RAISE EXCEPTION 'Todos os flags de pedido fantasma precisam pertencer à mesma loja.';
  END IF;

  SELECT g.tenant_id
    INTO v_tenant_id
    FROM public.ghost_order_flags g
   WHERE g.id = ANY(_flag_ids)
   ORDER BY g.id
   LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'processed', 0);
  END IF;

  PERFORM g.id
    FROM public.ghost_order_flags g
   WHERE g.id = ANY(_flag_ids)
     AND g.tenant_id = v_tenant_id
   ORDER BY g.id
   FOR UPDATE;

  SELECT array_agg(g.id ORDER BY g.id), array_agg(g.order_id ORDER BY g.order_id)
    INTO v_flag_ids, v_order_ids
    FROM public.ghost_order_flags g
   WHERE g.id = ANY(_flag_ids)
     AND g.tenant_id = v_tenant_id
     AND g.notified_at IS NULL;

  IF v_flag_ids IS NULL OR cardinality(v_flag_ids) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'processed', 0, 'already_notified', true);
  END IF;

  v_dedupe_key := 'ghost-orders:' || md5(array_to_string(v_order_ids, ','));

  INSERT INTO public.automation_suggestions (tenant_id, type, title, description, payload, status)
  VALUES (
    v_tenant_id,
    'ghost_orders',
    format('%s pedido(s) fantasma detectado(s)', cardinality(v_order_ids)),
    'Pedidos saíram para entrega há 90 minutos sem confirmação. Confira a entrega e, se necessário, contate cliente ou entregador.',
    jsonb_build_object('order_ids', to_jsonb(v_order_ids), 'ghost_flag_ids', to_jsonb(v_flag_ids), 'dedupe_key', v_dedupe_key),
    'pending'
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.order_events (tenant_id, order_id, event_type, actor, description)
  SELECT g.tenant_id, g.order_id, 'ghost_flagged', 'system',
         'Pedido marcado como fantasma — sem confirmação há 90 minutos'
    FROM public.ghost_order_flags g
   WHERE g.id = ANY(v_flag_ids)
     AND g.tenant_id = v_tenant_id
  ON CONFLICT DO NOTHING;

  UPDATE public.ghost_order_flags g
     SET notified_at = now()
   WHERE g.id = ANY(v_flag_ids)
     AND g.tenant_id = v_tenant_id
     AND g.notified_at IS NULL;
  GET DIAGNOSTICS v_processed = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'processed', v_processed, 'order_ids', to_jsonb(v_order_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.process_ghost_order_notifications(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_ghost_order_notifications(UUID[]) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'ghost_order_flags'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.ghost_order_flags';
  END IF;
END;
$$;

-- Version the already-installed schedules without copying their stored bearer credential into Git.
DO $$
DECLARE
  v_abandoned_job_id BIGINT;
  v_ghost_job_id BIGINT;
BEGIN
  SELECT jobid INTO v_abandoned_job_id
    FROM cron.job WHERE jobname = 'smarthubly_abandoned_cart_cron' LIMIT 1;
  SELECT jobid INTO v_ghost_job_id
    FROM cron.job WHERE jobname = 'smarthubly_ghost_detector' LIMIT 1;

  IF v_abandoned_job_id IS NULL OR v_ghost_job_id IS NULL THEN
    RAISE EXCEPTION 'Os crons de carrinho abandonado e pedidos fantasma precisam existir antes desta migration.';
  END IF;

  PERFORM cron.alter_job(v_abandoned_job_id, schedule => '*/30 * * * *');
  PERFORM cron.alter_job(v_ghost_job_id, schedule => '*/30 * * * *');
END;
$$;
