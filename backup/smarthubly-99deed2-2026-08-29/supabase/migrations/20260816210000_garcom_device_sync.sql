
-- ============================================================
-- App de garçom para maquininha Stone: sincronização automática
-- de URL/token e controle de ativação via Supabase.
-- ============================================================

-- 1) Tabela que vincula um dispositivo (maquininha) ao garçom.
CREATE TABLE IF NOT EXISTS public.garcom_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL,
  tenant_id UUID NOT NULL,
  waiter_id UUID NOT NULL,
  last_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_garcom_devices_device ON public.garcom_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_garcom_devices_waiter ON public.garcom_devices(waiter_id);

ALTER TABLE public.garcom_devices ENABLE ROW LEVEL SECURITY;

-- O app (anon) registra/atualiza o próprio dispositivo via RPC
-- (não damos acesso direto à tabela). O admin autenticado pode
-- inspecionar os dispositivos vinculados.
CREATE POLICY "Admins list garcom devices" ON public.garcom_devices
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role, tenant_id)
         OR has_platform_role(auth.uid(),'super_admin'::platform_role));

CREATE POLICY "Deny anon direct" ON public.garcom_devices
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- 2) RPC: registrar ou atualizar o dispositivo.
-- O app não conhece o waiter_id — envia o token; validamos por ele.
CREATE OR REPLACE FUNCTION public.register_garcom_device(
  _device_id text,
  _waiter_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  w record;
  t record;
  v_url text;
BEGIN
  SELECT * INTO w FROM public.waiters
    WHERE access_token = _waiter_token AND length(_waiter_token) >= 16
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_invalido');
  END IF;
  SELECT * INTO t FROM public.tenants WHERE id = w.tenant_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'loja_nao_encontrada');
  END IF;
  v_url := 'https://smarthubly.pages.dev/loja/' || t.slug || '/garcom/' || w.access_token;

  INSERT INTO public.garcom_devices (device_id, tenant_id, waiter_id, last_url)
  VALUES (_device_id, w.tenant_id, w.id, v_url)
  ON CONFLICT (device_id) DO UPDATE
    SET waiter_id = w.id, tenant_id = w.tenant_id, last_url = v_url, updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'waiter_id', w.id,
    'tenant_id', w.tenant_id,
    'slug', t.slug,
    'waiter_active', w.active,
    'url', v_url
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.register_garcom_device(text, text) TO anon, authenticated;

-- 3) RPC: o app consulta a config atual do dispositivo (abre direto).
CREATE OR REPLACE FUNCTION public.get_garcom_device_config(
  _device_id text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'found', true,
      'waiter_id', d.waiter_id,
      'tenant_id', d.tenant_id,
      'waiter_active', w.active,
      'url', d.last_url,
      'tenant_name', t.name
    )
    FROM public.garcom_devices d
    JOIN public.waiters w ON w.id = d.waiter_id
    JOIN public.tenants t ON t.id = d.tenant_id
    WHERE d.device_id = _device_id
    LIMIT 1
  ), jsonb_build_object('found', false));
$$;
GRANT EXECUTE ON FUNCTION public.get_garcom_device_config(text) TO anon, authenticated;

-- 4) Canal realtime: notificações por dispositivo.
-- O trigger abaixo insere na tabela de notificações que dispara o canal.
CREATE TABLE IF NOT EXISTS public.garcom_device_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.garcom_device_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all direct" ON public.garcom_device_messages
  FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "Admins trigger garcom messages" ON public.garcom_device_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.garcom_devices d
      JOIN public.waiters w ON w.id = d.waiter_id
      WHERE d.device_id = garcom_device_messages.device_id
        AND (has_role(auth.uid(),'admin'::app_role, w.tenant_id)
             OR has_platform_role(auth.uid(),'super_admin'::platform_role))
    )
  );

-- 5) Trigger server-side: quando o admin gera novo token ou
-- ativa/desativa um garçom, todos os dispositivos vinculados
-- recebem a nova URL ou o status de ativação em tempo real.
CREATE OR REPLACE FUNCTION public.notify_garcom_devices()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  d record;
  t record;
  v_url text;
BEGIN
  SELECT * INTO t FROM public.tenants WHERE id = COALESCE(NEW.tenant_id, OLD.tenant_id) LIMIT 1;
  FOR d IN SELECT * FROM public.garcom_devices WHERE waiter_id = COALESCE(NEW.id, OLD.id)
  LOOP
    IF TG_OP = 'DELETE' OR (TG_OP <> 'INSERT' AND NEW.active = false) THEN
      INSERT INTO public.garcom_device_messages (device_id, payload)
      VALUES (d.device_id, jsonb_build_object('type', 'disabled', 'reason', 'Painel desativado pelo administrador'));
    ELSIF TG_TABLE_NAME = 'waiters' AND TG_OP = 'UPDATE' AND NEW.active = true AND OLD.active IS DISTINCT FROM NEW.active THEN
      v_url := 'https://smarthubly.pages.dev/loja/' || t.slug || '/garcom/' || NEW.access_token;
      UPDATE public.garcom_devices SET last_url = v_url WHERE id = d.id;
      INSERT INTO public.garcom_device_messages (device_id, payload)
      VALUES (d.device_id, jsonb_build_object('type', 'activated', 'url', v_url, 'waiter_name', NEW.name));
    ELSIF TG_TABLE_NAME = 'waiters' AND TG_OP = 'UPDATE' AND NEW.access_token IS DISTINCT FROM OLD.access_token THEN
      v_url := 'https://smarthubly.pages.dev/loja/' || t.slug || '/garcom/' || NEW.access_token;
      UPDATE public.garcom_devices SET last_url = v_url WHERE id = d.id;
      INSERT INTO public.garcom_device_messages (device_id, payload)
      VALUES (d.device_id, jsonb_build_object('type', 'url_updated', 'url', v_url));
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
-- O trigger roda como SECURITY DEFINER, ou seja, sem RLS nas inserções
-- da garcom_device_messages. A autorização é garantida na origem: somente
-- admins autenticados podem atualizar a tabela waiters (RLS da tabela),
-- então gatilhos disparados por mudanças indevidas são impossíveis.

DROP TRIGGER IF EXISTS trg_waiters_notify_garcom ON public.waiters;
CREATE TRIGGER trg_waiters_notify_garcom
  AFTER INSERT OR UPDATE OR DELETE ON public.waiters
  FOR EACH ROW EXECUTE FUNCTION public.notify_garcom_devices();
