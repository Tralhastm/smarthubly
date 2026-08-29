# Progresso da Fragmentação de Pedidos e Fornecedores

## 1. Backend (Supabase)
- **Migration Aplicada:** `supabase/migrations/20260822210000_order_fragmentation.sql` enviada via GitHub Actions.
  - Cria tabela `order_fragments` com colunas `id`, `order_id`, `tenant_id`, `supplier_id`, `items`, `total`, `status`, `metadata`.
  - Adiciona colunas `variations`, `price_types` (jsonb), `description` à tabela `supplier_product_prices`.
  - Cria RPC `get_supplier_by_token(_token text)` para o portal do fornecedor.
  - Adiciona trigger `trg_ensure_supplier_token` para gerar tokens automáticos.

## 2. Frontend (Checkout)
- **TenantCartDrawer.tsx:** A lógica de fragmentação já existe no arquivo original (linhas 550-582 e 627-652).
  - O sistema busca o menor custo na tabela `supplier_product_prices`.
  - Cria um `fragmentation_map` no metadata do pedido.
  - Insere registros na tabela `order_fragments` para cada fornecedor envolvido.

## 3. Próximos Passos
- Validar o deploy da migration no GitHub Actions.
- Testar a importação de catálogo via IA com a nova rota `catalog` corrigida.
- Validar a fragmentação em um pedido real no sandbox.
- Corrigir o portal do fornecedor para usar os fragmentos.
