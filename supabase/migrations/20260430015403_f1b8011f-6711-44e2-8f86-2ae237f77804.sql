-- Função pra marcar motoboys offline se ficaram +3min sem heartbeat
CREATE OR REPLACE FUNCTION public.cleanup_stale_drivers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.drivers
     SET is_online = false
   WHERE is_online = true
     AND (last_online_at IS NULL OR last_online_at < now() - interval '3 minutes');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Habilita realtime na tabela drivers para o admin/lojista ver mudanças de status ao vivo
ALTER TABLE public.drivers REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'drivers'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers';
  END IF;
END $$;