---
name: Calculadora de Orçamento Universal
description: Sistema de orçamento adaptável pra qualquer prestador de serviço — variáveis dinâmicas + pacotes prontos + integração WhatsApp
type: feature
---
- Tabelas: `quote_variables` (item, unidade, preço/un, mín/máx, ativo) e `quote_packages` (nome, descrição, preço fixo)
- Tenants: `quotes_enabled` (toggle) e `quotes_intro_text` (boas-vindas opcional)
- Admin: aba "Orçamento" em Catálogo (`TenantAdminQuotes.tsx`) — cadastra variáveis e pacotes
- Loja pública: aba "Solicitar orçamento" (`StoreQuoteCalculator.tsx`) com calculadora dinâmica
  - Cliente preenche quantidades → vê total estimado
  - Botão verde abre WhatsApp do lojista com mensagem detalhada (todos os itens + total)
  - Pacotes prontos têm botão "Quero esse" próprio
- Serve pra: mecânico, pedreiro, tatuador, instalador papel parede, assistência técnica, eletricista, encanador, marceneiro — qualquer prestador
- Hook: `src/hooks/useQuotes.ts`
- Sofia atualizada pra mencionar a feature
