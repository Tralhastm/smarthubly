-- Ao registrar uma regra do acordo na aba Sociedade, o modelo Sociedade
-- passa a ser a fonte de cobrança da loja em vez da taxa padrão da plataforma.
CREATE OR REPLACE FUNCTION public.enable_society_billing_on_cost_rule_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tenants
     SET society_billing_enabled = TRUE
   WHERE id = NEW.tenant_id
     AND society_billing_enabled IS DISTINCT FROM TRUE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partnership_cost_rules_enable_society_billing
  ON public.partnership_cost_rules;

CREATE TRIGGER partnership_cost_rules_enable_society_billing
AFTER INSERT ON public.partnership_cost_rules
FOR EACH ROW
EXECUTE FUNCTION public.enable_society_billing_on_cost_rule_insert();
