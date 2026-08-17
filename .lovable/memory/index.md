# Project Memory

## Core
Plataforma multi-tenant delivery. Dark theme azul. Inter font. Sem motoboy por enquanto (Fase 1 apenas).
Texas Bebidas (texas-bebidas) é o projeto de referência visual/funcional.
Cobrança 100% transparente: OU % por pedido OU mensalidade fixa, nunca os dois. Sem taxa escondida.
Super admin em /super-admin. Lojas geradas em /loja/{slug}. Admin de cada loja em /loja/{slug}/admin.

## Memories
- [Plano de cobrança](mem://features/business-plan) — Modos per_order vs monthly_fixed, validate_billing_mode trigger, transparência total
- [Estrutura DB](mem://features/db-schema) — Multi-tenant: tenants, products, orders, user_roles, platform_roles, financial_entries, debts, loyalty_records
- [Onda 1 operação](mem://features/wave1-operations) — Caixa, KDS em /loja/{slug}/kds, split de pagamento no PDV
