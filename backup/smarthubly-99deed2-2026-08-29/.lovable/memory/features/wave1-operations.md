---
name: Onda 1 — Operação balcão/cozinha
description: Caixa (abertura/fechamento/sangria), KDS em /loja/{slug}/kds, e split de pagamento no PDV
type: feature
---
Implementado na Onda 1 (paridade F-Rest):

**Caixa (cash register)**
- Tabelas: `cash_register_sessions`, `cash_movements`
- Função: `calc_cash_session_expected(_session_id)` calcula esperado = abertura + vendas em dinheiro + suprimento - sangria
- UI: botão "Caixa" no header do `PdvTableSelector` abre `PdvCashRegisterDialog` (abrir, sangria, suprimento, fechar com cálculo de diferença)
- Hook: `useCashRegister.ts`
- Pedidos vinculam à sessão aberta via `orders.cash_session_id`

**KDS — Kitchen Display**
- Rota: `/loja/:slug/kds` (`src/pages/Kds.tsx`)
- 3 colunas: queue → preparing → ready → done
- Realtime via supabase channel em orders + order_items
- Timer destaca em vermelho pedidos > 15min em preparo
- Colunas: `orders.kds_status`, `kds_started_at`, `kds_ready_at`

**Split de pagamento**
- `PdvPayment` ganhou modo split: várias formas de pagamento somando até o total
- Salvo em `orders.split_payments` (jsonb com array `{method, amount}`)
- Quando 1 só método, salva null (mantém compatibilidade)
