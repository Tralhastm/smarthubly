
-- ============================================
-- TESTE COMPLETO DOS 5 MODOS DA LOJA LANCHAR
-- ============================================
DO $$
DECLARE
  v_tid uuid := '1e022d8c-6218-4ac4-a5a7-4f96e4413b6e';
  v_pid uuid := '7d2c6ea4-ebc7-4757-b9a9-7bc0e758c9f3';
  v_order_id uuid;
  v_result text := '';
  v_count int;
BEGIN
  v_result := E'=== TESTE 5 MODOS — LANCHAR ===\n\n';

  -- ============ MODO 1: LOCAL ============
  UPDATE tenants SET store_mode='local', pickup_enabled=true, shipping_enabled=false WHERE id=v_tid;
  v_result := v_result || E'\n[1/5] 🏪 LOCAL: store_mode=local, shipping desligado\n';
  -- Tenta criar pedido delivery (deveria ser bloqueado pelo frontend, mas o DB aceita)
  INSERT INTO orders (tenant_id, customer_name, customer_phone, customer_address, delivery_type, total, delivery_fee, payment_method, status)
  VALUES (v_tid, 'TESTE_LOCAL_pickup', '11999990001', 'Retirada na loja', 'pickup', 22.90, 0, 'Pix', 'received')
  RETURNING id INTO v_order_id;
  INSERT INTO order_items(order_id, product_name, product_price, quantity) VALUES (v_order_id, 'X-Salada', 22.90, 1);
  v_result := v_result || '   ✓ Pedido pickup criado: ' || substr(v_order_id::text,1,8) || E'\n';

  -- ============ MODO 2: DELIVERY ============
  UPDATE tenants SET store_mode='delivery', pickup_enabled=false, shipping_enabled=true WHERE id=v_tid;
  v_result := v_result || E'\n[2/5] 🛵 DELIVERY: store_mode=delivery, pickup desligado, shipping ativo\n';
  INSERT INTO orders (tenant_id, customer_name, customer_phone, customer_address, delivery_type, total, delivery_fee, payment_method, status)
  VALUES (v_tid, 'TESTE_DELIVERY', '11999990002', 'Rua Teste 100', 'delivery', 35.80, 5.00, 'Pix', 'received')
  RETURNING id INTO v_order_id;
  INSERT INTO order_items(order_id, product_name, product_price, quantity) VALUES (v_order_id, 'X-Salada', 22.90, 1);
  v_result := v_result || '   ✓ Pedido delivery criado com frete R$5: ' || substr(v_order_id::text,1,8) || E'\n';

  -- ============ MODO 3: HYBRID ============
  UPDATE tenants SET store_mode='hybrid', pickup_enabled=true, shipping_enabled=true WHERE id=v_tid;
  v_result := v_result || E'\n[3/5] 🔀 HYBRID: store_mode=hybrid, ambos ativos\n';
  -- Pedido pickup
  INSERT INTO orders (tenant_id, customer_name, customer_phone, customer_address, delivery_type, total, delivery_fee, payment_method, status)
  VALUES (v_tid, 'TESTE_HYBRID_pickup', '11999990003', 'Retirada', 'pickup', 22.90, 0, 'Dinheiro', 'received')
  RETURNING id INTO v_order_id;
  INSERT INTO order_items(order_id, product_name, product_price, quantity) VALUES (v_order_id, 'X-Salada', 22.90, 1);
  -- Pedido delivery
  INSERT INTO orders (tenant_id, customer_name, customer_phone, customer_address, delivery_type, total, delivery_fee, payment_method, status)
  VALUES (v_tid, 'TESTE_HYBRID_delivery', '11999990003', 'Rua X 200', 'delivery', 30.80, 7.90, 'Pix', 'received')
  RETURNING id INTO v_order_id;
  INSERT INTO order_items(order_id, product_name, product_price, quantity) VALUES (v_order_id, 'X-Salada', 22.90, 1);
  v_result := v_result || E'   ✓ Pedidos pickup E delivery aceitos no mesmo modo\n';

  -- ============ MODO 4: DROPSHIPPING ============
  UPDATE tenants SET store_mode='dropshipping', is_dropshipping=true, pickup_enabled=false, shipping_enabled=true WHERE id=v_tid;
  v_result := v_result || E'\n[4/5] 📦 DROPSHIPPING: is_dropshipping=true, só delivery\n';
  INSERT INTO orders (tenant_id, customer_name, customer_phone, customer_address, delivery_type, total, delivery_fee, payment_method, status)
  VALUES (v_tid, 'TESTE_DROPSHIP', '11999990004', 'Av Drop 500', 'delivery', 22.90, 0, 'Cartao', 'received')
  RETURNING id INTO v_order_id;
  INSERT INTO order_items(order_id, product_name, product_price, quantity) VALUES (v_order_id, 'X-Salada', 22.90, 1);
  v_result := v_result || '   ✓ Pedido drop criado (fornecedor envia): ' || substr(v_order_id::text,1,8) || E'\n';

  -- ============ MODO 5: AFFILIATE ============
  UPDATE tenants SET store_mode='affiliate', is_dropshipping=false, pickup_enabled=false, shipping_enabled=false WHERE id=v_tid;
  v_result := v_result || E'\n[5/5] 🛒 AFFILIATE: store_mode=affiliate, sem checkout\n';
  -- Em afiliado, ao invés de pedido, registra clique
  INSERT INTO affiliate_clicks (tenant_id, product_id, ip_hash, user_agent)
  VALUES (v_tid, v_pid, 'test_hash_5mode', 'TestAgent/1.0');
  SELECT COUNT(*) INTO v_count FROM affiliate_clicks WHERE tenant_id=v_tid AND ip_hash='test_hash_5mode';
  v_result := v_result || '   ✓ Clique de afiliado registrado (count=' || v_count || E')\n';

  -- ============ RESTAURA ESTADO ORIGINAL ============
  UPDATE tenants SET store_mode='delivery', pickup_enabled=true, shipping_enabled=true, is_dropshipping=false WHERE id=v_tid;
  v_result := v_result || E'\n=== ESTADO RESTAURADO: delivery + pickup_enabled (híbrido de fato) ===\n';

  -- ============ VALIDAÇÃO BILLING ============
  v_result := v_result || E'\n--- VALIDAÇÃO BILLING (monthly_fixed=R$60) ---\n';
  SELECT COUNT(*) INTO v_count FROM orders WHERE tenant_id=v_tid AND customer_name LIKE 'TESTE_%' AND platform_fee > 0;
  v_result := v_result || 'Pedidos teste com platform_fee > 0: ' || v_count || ' (deve ser 0 — está em monthly_fixed)' || E'\n';

  RAISE NOTICE '%', v_result;
END $$;
