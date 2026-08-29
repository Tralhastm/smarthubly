---
name: Sistema multi-provider IA
description: Fallback Google→Lovable→OpenRouter para chat, parse TXT e geração de imagens
type: feature
---
- Todas as edge functions (store-chat, parse-products-txt, generate-product-image) tentam 3 providers em ordem
- Ordem: Google AI (chaves do DB api_keys) → Lovable AI Gateway → OpenRouter
- Se um provider retorna 429/402/403, automaticamente tenta o próximo
- Chaves Google são rotacionadas via tabela api_keys (marcadas is_exhausted quando falham)
- OpenRouter usa modelo gratuito google/gemini-2.0-flash-exp:free
- Para imagens: Google → Lovable (gemini-2.5-flash-image), OpenRouter não suporta imagem
