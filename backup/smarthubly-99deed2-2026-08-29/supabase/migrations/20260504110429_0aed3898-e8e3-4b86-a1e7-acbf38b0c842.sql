
-- Permite solicitar acesso por email, mesmo quando o usuário já tem conta com senha diferente
CREATE OR REPLACE FUNCTION public.request_admin_role_by_email(_email text, _tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_existing int;
BEGIN
  IF _email IS NULL OR _email = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_required');
  END IF;

  -- Busca user_id se já existir conta
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(_email) LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    -- Já existe conta: cria/garante a solicitação vinculada
    INSERT INTO public.user_roles (user_id, tenant_id, role, approved, email)
    VALUES (v_user_id, _tenant_id, 'admin', false, _email)
    ON CONFLICT (user_id, tenant_id, role) DO UPDATE SET email = EXCLUDED.email
    RETURNING 1 INTO v_existing;
    RETURN jsonb_build_object('ok', true, 'has_account', true);
  END IF;

  -- Sem conta ainda: registra um "convite" pendente usando um user_id determinístico (placeholder)
  -- Vamos usar gen_random_uuid e só marcar email; na hora do signup, a aprovação será migrada manualmente.
  -- Para evitar duplicar pendências do mesmo email/tenant, checa antes.
  SELECT count(*) INTO v_existing FROM public.user_roles
   WHERE tenant_id = _tenant_id AND lower(email) = lower(_email) AND approved = false;
  IF v_existing > 0 THEN
    RETURN jsonb_build_object('ok', true, 'has_account', false, 'already_pending', true);
  END IF;

  INSERT INTO public.user_roles (user_id, tenant_id, role, approved, email)
  VALUES (gen_random_uuid(), _tenant_id, 'admin', false, _email);

  RETURN jsonb_build_object('ok', true, 'has_account', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_admin_role_by_email(text, uuid) TO anon, authenticated;
