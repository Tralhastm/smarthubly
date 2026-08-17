
CREATE OR REPLACE FUNCTION public.calc_cash_session_expected(_session_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_opening NUMERIC := 0;
  v_cash_sales NUMERIC := 0;
  v_suprimento NUMERIC := 0;
  v_sangria NUMERIC := 0;
BEGIN
  SELECT opening_amount INTO v_opening FROM public.cash_register_sessions WHERE id = _session_id;

  -- Soma vendas em dinheiro considerando split_payments quando existir.
  -- Se split_payments é null, usa o total inteiro quando payment_method='dinheiro'.
  -- Se split_payments é um array, soma só as entradas com method='dinheiro'.
  SELECT COALESCE(SUM(
    CASE
      WHEN o.split_payments IS NOT NULL AND jsonb_typeof(o.split_payments) = 'array' THEN
        COALESCE((
          SELECT SUM((elem->>'amount')::numeric)
          FROM jsonb_array_elements(o.split_payments) elem
          WHERE LOWER(COALESCE(elem->>'method','')) = 'dinheiro'
        ), 0)
      WHEN LOWER(COALESCE(o.payment_method,'')) = 'dinheiro' THEN o.total
      ELSE 0
    END
  ), 0) INTO v_cash_sales
  FROM public.orders o
  WHERE o.cash_session_id = _session_id;

  SELECT COALESCE(SUM(amount),0) INTO v_suprimento
    FROM public.cash_movements WHERE session_id = _session_id AND type = 'suprimento';

  SELECT COALESCE(SUM(amount),0) INTO v_sangria
    FROM public.cash_movements WHERE session_id = _session_id AND type = 'sangria';

  RETURN COALESCE(v_opening,0) + v_cash_sales + v_suprimento - v_sangria;
END;
$function$;
