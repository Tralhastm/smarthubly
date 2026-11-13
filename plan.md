# Precificador de Mercado

## Objetivo
Transformar a aba existente `Inteligência de Preços` em um precificador profissional separado da Sociedade. O fluxo será: colar texto ou importar arquivo textual de listas de fornecedores, consolidar produtos recorrentes, associar custos de fornecedor, pesquisar evidências reais de mercado, aplicar gastos configurados e calcular preço sugerido, lucro em reais, margem percentual e decisão comercial.

## Decisões
- Reaproveitar a aba `price-intelligence` e seu ponto de entrada no `TenantAdmin`, mudando o rótulo para `Precificador`.
- Usar parsing determinístico para consolidar linhas e contar recorrência; a IA não decide preço nem inventa demanda.
- Usar a Edge Function `market-price-research` para consultar fontes públicas verificáveis. A primeira fonte implementada será a busca pública do Mercado Livre; os resultados guardarão título, preço, link, condição e data.
- Se houver menos de duas evidências equivalentes ou nenhum custo, o item ficará `inconclusivo`.
- O preço mínimo determinístico será calculado por `(custo + gastos fixos + lucro mínimo) / (1 - taxas_percentuais/100)`.
- Se o preço mínimo ficar abaixo da mediana de mercado, a decisão será `carro-chefe`; caso contrário, havendo evidência, será `margem segura`.
- Todas as configurações usadas serão salvas no snapshot da análise para permitir auditoria histórica.

## Estrutura
- `src/components/tenant/TenantPriceIntelligence.tsx`: fluxo de importação, gastos, resultados e histórico.
- `supabase/migrations/*_market_pricer.sql`: regras de gastos, análises, itens e evidências com RLS.
- `supabase/functions/market-price-research/index.ts`: autorização, consulta de mercado e retorno de evidências verificáveis.
- `src/lib/market-pricer.ts`: parsing, normalização e fórmulas determinísticas testáveis.

## Limites explícitos
A primeira entrega aceita TXT, CSV e texto colado. PDF/XLSX exigirão parser específico posterior; o sistema não deve fingir que extraiu um formato que não conseguiu ler. Fontes que não retornarem link e preço verificáveis não entram no cálculo.

## Fonte consultada
A integração usa a documentação oficial de APIs do Mercado Livre como referência de plataforma: https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br. A Edge Function usa apenas anúncios que retornam título, preço e permalink; anúncios sem esses dados são descartados. A ausência de volume público de vendas é rotulada como demanda estimada.

# Automações — combos, ranking e correções

## Objetivo e escopo aprovado
- Implementar a detecção de pares de produtos comprados juntos e, na aprovação, criar um produto combo verdadeiro no catálogo com componentes vinculados e preço calculado a partir dos custos/despesas cadastrados.
- Automatizar o destaque no topo da vitrine dos produtos com maior saída nos últimos 30 dias, sem exigir aprovação por sugestão.
- Ativar `auto_combo_suggestion` em todas as lojas ativas com checkout/pedidos próprios; lojas afiliadas não têm compras próprias observáveis, portanto o combo permanece indisponível nelas. Ativar `auto_reorder_catalog` em todas as lojas ativas, inclusive afiliadas.
- Corrigir a reconciliação Mercado Pago para usar o campo de token que existe no schema (`mercadopago_token`) e não registrar sucesso quando a busca de lojas, pagamentos ou sugestões falhar.
- Preservar todas as flags dos demais recursos; não ativar em massa automações fora dos dois itens expressamente pedidos.
- Não alterar os webhooks Pix/cartão nesta rodada: a preparação automática de pedidos pagos foi explicitamente excluída pelo usuário.

## Regras de negócio
- Detectar pares que aparecem no mesmo pedido pelo menos três vezes dentro da janela móvel de 30 dias; contar pedidos distintos, não unidades repetidas na mesma venda.
- Só gerar sugestão de combo quando os produtos ainda pertencem ao tenant, estão visíveis e o custo necessário para precificar é conhecido. Não inventar custo nem prometer margem sem os registros correspondentes.
- Aplicar os gastos ativos (`market_pricer_expenses`, gerais e específicos quando existirem), `tenants.catalog_minimum_profit` e `tenants.catalog_seller_share_percent`, reutilizando a semântica de `calculateConfiguredFinalProfit`. Oferecer desconto nominal de 5% sobre a soma dos preços atuais, mas limitar o preço pela margem mínima configurada; se não houver preço viável que preserve a regra, não disponibilizar aprovação como combo precificado.
- Recalcular custo e preço com a configuração atual no momento da aprovação; a aprovação deve criar o produto e os vínculos dos componentes de forma idempotente, e somente então marcar a sugestão aplicada.
- A reordenação deve atualizar `storefront_rank` nos produtos da loja sem criar aprovação pendente. Lojas com checkout próprio usam unidades vendidas em pedidos válidos; lojas afiliadas usam cliques rastreados em produtos. Limpar ranks antigos fora do top 5 e manter os demais produtos na ordem normal do catálogo.
- A vitrine pública deve consultar o rank antes da ordenação atual por criação, preservando tenant, visibilidade, filtros e paginação.
- Na caixa de sugestões, botões de ação devem distinguir uma operação que realmente executa algo de um aviso que apenas é reconhecido; falhas na aplicação não podem marcar a sugestão como aplicada.

## Arquitetura e arquivos
- `src/components/tenant/TenantAdminAutomations.tsx`: interruptores, apresentação da caixa de sugestões, aprovação transacional de combos e texto de resultado honesto.
- `src/hooks/useProducts.ts`: query paginada do catálogo; integrar o rank sem alterar a consulta administrativa já existente.
- `src/lib/pricing.ts`: preservar a fórmula única de lucro líquido e usá-la como referência para o preço mínimo do combo.
- `supabase/functions/automations-cron/index.ts`: detectar pares, carregar custos/despesas de forma paginada, guardar sugestões idempotentes, ordenar vendas/cliques e gravar métricas reais; não aplicar mudanças não autorizadas a flags de outros recursos.
- `supabase/functions/mp-reconciliation-cron/index.ts`: consultar `mercadopago_token`, tratar erros e refletir divergências reais na caixa de sugestões.
- `supabase/migrations/*_automation_catalog_combos.sql`: rank de vitrine e relacionamento isolado de componentes de combo com RLS e autorização de tenant.
- `src/integrations/supabase/types.ts`: refletir colunas/tabelas necessárias sem editar tipos não relacionados.
- Reutilizar as telas, tokens e componentes já existentes; não introduzir novo padrão visual ou dependência de UI.

## Dependências e limites
- A cadência horária do cron geral e os schedules de carrinho abandonado, detector de pedidos fantasma, backup, reconciliação MP, respostas de avaliação e afiliados já existem no Supabase e tiveram execuções bem-sucedidas observadas. Não recriar schedules duplicados; a ausência de um schedule no Git não prova ausência no banco.
- Não ativar o cancelamento automático de pedidos nem mudar o fluxo de pagamentos; ambos podem alterar pedidos em andamento e precisam permanecer conforme o estado atual das flags/autorizações.
- A integração de combos deve limitar-se a compras próprias; não inferir co-compra de lojas afiliadas sem vendas próprias.
