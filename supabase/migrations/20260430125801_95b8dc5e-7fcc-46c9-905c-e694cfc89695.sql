-- Cron a cada 1 minuto: marca offline motoboys sem heartbeat há mais de 3 minutos.
-- Resolve o problema de motoboy que fechou o painel sem clicar "sair" continuar marcado online.
SELECT cron.schedule(
  'cleanup-stale-drivers-every-minute',
  '* * * * *',
  $$ SELECT public.cleanup_stale_drivers(); $$
);