-- Mobiletec: o motoboy cobra R$ 2,50 por quilômetro percorrido.
-- O raio máximo permanece em 25 km e o teto do frete fica vazio para
-- permitir que o cliente pague a diferença quando o frete ultrapassar R$ 50.

UPDATE public.suppliers AS s
SET shipping_base_fee = 0,
    shipping_base_radius_km = 0,
    shipping_per_km_fee = 2.50,
    shipping_max_fee = NULL,
    delivery_max_radius_km = 25,
    shipping_mode = 'own'
FROM public.tenants AS t
WHERE s.tenant_id = t.id
  AND lower(t.slug) = 'mobiletec'
  AND s.id = '9f61817e-b6aa-49b7-99bb-4d5ecbadef71';

-- Mantém a mesma regra na configuração da loja para servir como fallback
-- caso algum item chegue ao checkout sem fornecedor explícito.
UPDATE public.tenants AS t
SET shipping_base_fee = 0,
    shipping_base_radius_km = 0,
    shipping_per_km_fee = 2.50,
    shipping_max_fee = NULL,
    delivery_max_radius_km = 25,
    shipping_mode = 'own'
WHERE lower(t.slug) = 'mobiletec';
