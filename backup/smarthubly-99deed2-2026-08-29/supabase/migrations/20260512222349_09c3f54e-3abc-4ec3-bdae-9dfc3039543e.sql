
-- Campos novos waiters
ALTER TABLE public.waiters
  ADD COLUMN IF NOT EXISTS online boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_online_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_assigned_at timestamptz;

-- Campos novos table_sessions
ALTER TABLE public.table_sessions
  ADD COLUMN IF NOT EXISTS opened_by text NOT NULL DEFAULT 'customer';

-- Permitir anon atualizar online / last_online_at do garçom (presença)
DROP POLICY IF EXISTS "Anyone update waiter presence" ON public.waiters;
CREATE POLICY "Anyone update waiter presence" ON public.waiters
  FOR UPDATE TO anon, authenticated
  USING (active = true) WITH CHECK (active = true);

-- RPC: round-robin assignment
CREATE OR REPLACE FUNCTION public.assign_waiter_to_session(_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_existing uuid;
  v_waiter record;
BEGIN
  SELECT tenant_id, assigned_waiter_id INTO v_tenant, v_existing
    FROM public.table_sessions WHERE id = _session_id;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;

  -- Prefere online; senão qualquer ativo. Round-robin por last_assigned_at.
  SELECT id, name INTO v_waiter
    FROM public.waiters
    WHERE tenant_id = v_tenant AND active = true AND online = true
    ORDER BY last_assigned_at NULLS FIRST, created_at
    LIMIT 1;

  IF v_waiter.id IS NULL THEN
    SELECT id, name INTO v_waiter
      FROM public.waiters
      WHERE tenant_id = v_tenant AND active = true
      ORDER BY last_assigned_at NULLS FIRST, created_at
      LIMIT 1;
  END IF;

  IF v_waiter.id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.waiters SET last_assigned_at = now() WHERE id = v_waiter.id;
  UPDATE public.table_sessions
     SET assigned_waiter_id = v_waiter.id, assigned_waiter_name = v_waiter.name
   WHERE id = _session_id;

  RETURN v_waiter.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_waiter_to_session(uuid) TO anon, authenticated;

-- Trigger: ao enviar comanda (status -> sent), atribui garçom se ainda não tiver
CREATE OR REPLACE FUNCTION public.trg_assign_waiter_on_sent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'sent' AND (OLD.status IS DISTINCT FROM 'sent') AND NEW.assigned_waiter_id IS NULL THEN
    PERFORM public.assign_waiter_to_session(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS table_sessions_assign_on_sent ON public.table_sessions;
CREATE TRIGGER table_sessions_assign_on_sent
  AFTER UPDATE ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_assign_waiter_on_sent();
