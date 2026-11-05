-- Algumas lojas já tinham o gasto legado "Motoboy". Quando a política
-- configurável foi inicializada, a linha equivalente "Motoboy / logística"
-- também foi criada. Mantém apenas um dos dois para não duplicar o custo.
DELETE FROM public.market_pricer_expenses duplicate_expense
 WHERE duplicate_expense.product_id IS NULL
   AND lower(trim(duplicate_expense.label)) = 'motoboy / logística'
   AND EXISTS (
     SELECT 1
       FROM public.market_pricer_expenses legacy_expense
      WHERE legacy_expense.tenant_id = duplicate_expense.tenant_id
        AND legacy_expense.product_id IS NULL
        AND lower(trim(legacy_expense.label)) = 'motoboy'
   );
