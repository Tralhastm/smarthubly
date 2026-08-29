-- Cancela fatura indevida gerada para loja doada (criada antes do flag is_donated)
UPDATE billing_invoices bi
SET status = 'cancelled',
    admin_note = COALESCE(admin_note,'') || ' [Auto-cancelada: loja doada]',
    updated_at = now()
FROM tenants t
WHERE bi.tenant_id = t.id
  AND t.is_donated = true
  AND bi.status IN ('pending','overdue','payment_declared');

-- Zera platform_fee de pedidos passados de lojas hoje doadas ou em mensalidade fixa
UPDATE orders o
SET platform_fee = 0
FROM tenants t
WHERE o.tenant_id = t.id
  AND (t.is_donated = true OR t.billing_mode = 'monthly_fixed')
  AND o.platform_fee > 0;