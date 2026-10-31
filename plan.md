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
