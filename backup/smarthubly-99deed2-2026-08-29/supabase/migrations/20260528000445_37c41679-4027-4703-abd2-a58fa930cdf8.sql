
-- ============================================================
-- 1) Rollback financeiro ao cancelar pedido entregue
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_order_revenue_entry(_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order RECORD;
  v_marker TEXT;
  v_reverse_marker TEXT;
  v_orig_amount NUMERIC;
  v_exists INT;
BEGIN
  SELECT id, tenant_id, payment_method INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  v_marker := '#ORDER_REVENUE:' || _order_id::text;
  v_reverse_marker := '#ORDER_REVENUE_REVERSAL:' || _order_id::text;

  -- Já estornado?
  SELECT COUNT(*) INTO v_exists FROM public.financial_entries
    WHERE tenant_id = v_order.tenant_id AND description ILIKE '%' || v_reverse_marker || '%';
  IF v_exists > 0 THEN RETURN FALSE; END IF;

  -- Soma da receita original (em caso de duplicidade defensiva)
  SELECT COALESCE(SUM(amount),0) INTO v_orig_amount FROM public.financial_entries
    WHERE tenant_id = v_order.tenant_id AND type='income' AND description ILIKE '%' || v_marker || '%';
  IF v_orig_amount <= 0 THEN RETURN FALSE; END IF;

  INSERT INTO public.financial_entries (tenant_id, type, category, description, amount, date, payment_method, paid)
  VALUES (v_order.tenant_id, 'expense', 'estorno_venda',
          'Estorno cancelamento pedido ' || substr(_order_id::text,1,8) || ' ' || v_reverse_marker,
          v_orig_amount, now(), COALESCE(v_order.payment_method,'outro'), true);

  -- Estornar também a taxa da plataforma se houver
  DECLARE v_fee_marker TEXT := '#PLATFORM_FEE:' || _order_id::text;
          v_fee_amount NUMERIC;
  BEGIN
    SELECT COALESCE(SUM(amount),0) INTO v_fee_amount FROM public.financial_entries
      WHERE tenant_id = v_order.tenant_id AND type='expense' AND category='taxa_plataforma'
        AND description ILIKE '%' || v_fee_marker || '%';
    IF v_fee_amount > 0 THEN
      INSERT INTO public.financial_entries (tenant_id, type, category, description, amount, date, paid)
      VALUES (v_order.tenant_id, 'income', 'estorno_taxa_plataforma',
              'Estorno taxa plataforma pedido ' || substr(_order_id::text,1,8) || ' #PLATFORM_FEE_REVERSAL:' || _order_id::text,
              v_fee_amount, now(), true);
    END IF;
  END;

  RETURN TRUE;
END;
$$;

-- ============================================================
-- 2) Rollback de estoque ao cancelar pedido entregue
-- ============================================================
CREATE OR REPLACE FUNCTION public.restore_order_stock(_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_already INT;
  r RECORD;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.orders WHERE id = _order_id;
  IF v_tenant IS NULL THEN RETURN FALSE; END IF;

  -- Idempotência: se já existe ajuste de devolução, não duplica
  SELECT COUNT(*) INTO v_already FROM public.stock_movements
   WHERE order_id = _order_id AND type = 'ajuste' AND reason ILIKE 'Devolução cancelamento%';
  IF v_already > 0 THEN RETURN FALSE; END IF;

  -- Só repõe se houve baixa anterior por este pedido
  IF NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE order_id = _order_id AND type = 'venda') THEN
    RETURN FALSE;
  END IF;

  FOR r IN
    SELECT ingredient_id, SUM(quantity) AS qty
      FROM public.stock_movements
     WHERE order_id = _order_id AND type = 'venda'
     GROUP BY ingredient_id
  LOOP
    INSERT INTO public.stock_movements (tenant_id, ingredient_id, type, quantity, reason, order_id)
    VALUES (v_tenant, r.ingredient_id, 'ajuste', r.qty,
            'Devolução cancelamento pedido ' || substr(_order_id::text,1,8), _order_id);
  END LOOP;

  RETURN TRUE;
END;
$$;

-- ============================================================
-- 3) Trigger orquestrador: cancelamento -> rollback + auditoria
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_handle_order_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
    -- Rollback financeiro (se havia receita)
    PERFORM public.reverse_order_revenue_entry(NEW.id);
    -- Rollback estoque (se havia baixa)
    PERFORM public.restore_order_stock(NEW.id);
    -- Cancelamento NFC-e best-effort (somente se autorizada e dentro da janela)
    BEGIN
      IF EXISTS (SELECT 1 FROM public.fiscal_invoices fi
                  WHERE fi.order_id = NEW.id AND fi.status = 'authorized'
                    AND public.can_cancel_nfce(fi.id)) THEN
        PERFORM net.http_post(
          url := 'https://zcnuvemvhhspfrvbttsw.supabase.co/functions/v1/cancel-nfce',
          headers := jsonb_build_object('Content-Type','application/json'),
          body := jsonb_build_object('orderId', NEW.id, 'reason', COALESCE(NEW.cancel_reason,'cancelado'))
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_handle_cancelled ON public.orders;
CREATE TRIGGER orders_handle_cancelled
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_handle_order_cancelled();

-- ============================================================
-- 4) Trigger universal de auditoria de status em order_events
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_log_order_status_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_events (order_id, tenant_id, event_type, from_status, to_status, actor, description)
    VALUES (NEW.id, NEW.tenant_id, 'created', NULL, NEW.status, 'system', 'Pedido criado');
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_events (order_id, tenant_id, event_type, from_status, to_status, actor, description, metadata)
    VALUES (NEW.id, NEW.tenant_id,
            CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'status_changed' END,
            OLD.status, NEW.status, 'system',
            'Status atualizado de ' || COALESCE(OLD.status,'(novo)') || ' para ' || NEW.status,
            jsonb_build_object('cancel_reason', NEW.cancel_reason));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_log_status_event_ins ON public.orders;
CREATE TRIGGER orders_log_status_event_ins
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_log_order_status_event();

DROP TRIGGER IF EXISTS orders_log_status_event_upd ON public.orders;
CREATE TRIGGER orders_log_status_event_upd
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_log_order_status_event();

-- ============================================================
-- 5) Atribuição de garçom também no INSERT com status='sent'
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_assign_waiter_on_sent_ins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'sent' AND NEW.assigned_waiter_id IS NULL THEN
    PERFORM public.assign_waiter_to_session(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS table_sessions_assign_waiter_ins ON public.table_sessions;
CREATE TRIGGER table_sessions_assign_waiter_ins
AFTER INSERT ON public.table_sessions
FOR EACH ROW
EXECUTE FUNCTION public.trg_assign_waiter_on_sent_ins();
