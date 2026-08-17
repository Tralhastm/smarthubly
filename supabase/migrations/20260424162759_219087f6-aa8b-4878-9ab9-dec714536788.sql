-- Mudar defaults para FALSE nas automações Onda 3 (exceto affiliate match)
ALTER TABLE public.tenants
  ALTER COLUMN auto_reconcile_mp SET DEFAULT FALSE,
  ALTER COLUMN auto_backup_catalog SET DEFAULT FALSE,
  ALTER COLUMN auto_fraud_check SET DEFAULT FALSE,
  ALTER COLUMN auto_review_ai_reply SET DEFAULT FALSE,
  ALTER COLUMN auto_detect_ghost_orders SET DEFAULT FALSE,
  ALTER COLUMN auto_affiliate_match SET DEFAULT TRUE;

-- Aplicar nos tenants existentes
UPDATE public.tenants
   SET auto_reconcile_mp = FALSE,
       auto_backup_catalog = FALSE,
       auto_fraud_check = FALSE,
       auto_review_ai_reply = FALSE,
       auto_detect_ghost_orders = FALSE,
       auto_affiliate_match = TRUE;