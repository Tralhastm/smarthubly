---
name: Categorização Automática por IA
description: Botão universal que usa Lovable AI pra categorizar produtos/variáveis em massa, com opt-out por item
type: feature
---
- Edge function: `supabase/functions/auto-categorize/index.ts` — usa google/gemini-2.5-flash com tool calling, devolve `{id, category, subcategory}` por item (até 80 por chamada)
- Componente: `src/components/shared/AutoCategorizeButton.tsx` — recebe items + context + onResults callback
- Tabelas afetadas: `products` (campos novos: subcategory, auto_categorize) e `quote_variables` (campos novos: category, subcategory, auto_categorize)
- Aparece em: TenantAdminProducts (cobre Catálogo + Afiliados — mesmo componente) e TenantAdminQuotes (variáveis)
- Opt-out: checkbox "Incluir na categorização automática por IA" em cada item (default true). Quando false, item é ignorado no botão "Categorizar tudo"
- Display: card mostra "Categoria › Subcategoria" e badge "🚫 IA off" se opt-out
- Erros tratados: 429 (rate limit) e 402 (créditos esgotados) com toast amigável
