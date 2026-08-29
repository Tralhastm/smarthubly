-- PIN code for fast PDV login on payment terminal
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS pin_code text;
ALTER TABLE public.waiters    ADD COLUMN IF NOT EXISTS pin_code text;

-- Unique PIN per tenant (partial unique indexes; allow NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_tenant_pin_uniq
  ON public.user_roles(tenant_id, pin_code) WHERE pin_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS waiters_tenant_pin_uniq
  ON public.waiters(tenant_id, pin_code) WHERE pin_code IS NOT NULL;

-- Validation function: returns operator info if PIN matches in that tenant
CREATE OR REPLACE FUNCTION public.validate_pdv_pin(_tenant_id uuid, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin record;
  v_waiter record;
BEGIN
  IF _pin IS NULL OR length(_pin) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_too_short');
  END IF;

  -- Tries admin (user_roles) first
  SELECT user_id, role, email INTO v_admin
    FROM public.user_roles
   WHERE tenant_id = _tenant_id AND pin_code = _pin AND approved = true
   LIMIT 1;

  IF v_admin.user_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'operator_type', 'admin',
      'operator_id', v_admin.user_id,
      'operator_name', COALESCE(v_admin.email, 'Admin'),
      'role', v_admin.role
    );
  END IF;

  -- Then tries waiter
  SELECT id, name INTO v_waiter
    FROM public.waiters
   WHERE tenant_id = _tenant_id AND pin_code = _pin AND active = true
   LIMIT 1;

  IF v_waiter.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'operator_type', 'waiter',
      'operator_id', v_waiter.id,
      'operator_name', v_waiter.name,
      'role', 'waiter'
    );
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
END;
$$;

-- Allow anon to call this RPC (PIN itself is the secret)
GRANT EXECUTE ON FUNCTION public.validate_pdv_pin(uuid, text) TO anon, authenticated;