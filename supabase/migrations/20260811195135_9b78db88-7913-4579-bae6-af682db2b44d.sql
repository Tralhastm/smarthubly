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
     AND (last_online_at IS NULL OR last_online_at < now() - interval '15 minutes');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;