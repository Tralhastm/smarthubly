-- O checkout usa place_order(jsonb, jsonb). A versão antiga com json criava
-- ambiguidade no RPC e fazia o pedido falhar com erro genérico no frontend.
DROP FUNCTION IF EXISTS public.place_order(json, json);
