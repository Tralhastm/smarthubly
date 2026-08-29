---
name: Raio máximo de entrega
description: Bloqueio de pedidos fora do raio configurado pela loja e/ou fornecedor (km)
type: feature
---
- Coluna `delivery_max_radius_km` em `tenants` e `suppliers` (default 0 = sem limite)
- Loja: configurada em **Admin → Frete** (após "Teto máximo do frete")
- Fornecedor: configurada em **Painel do fornecedor → Frete** (após "Teto do frete")
- Validação no `TenantCartDrawer.submitOrder()`: bloqueia se `distance > tenant.delivery_max_radius_km` ou se algum produto vem de fornecedor cujo raio é excedido (`originDistances[origin] > supplier.delivery_max_radius_km`)
- Mensagem sugere "Retirar na loja" ou trocar endereço
- 0 ou vazio = sem limite (comportamento original preservado)
