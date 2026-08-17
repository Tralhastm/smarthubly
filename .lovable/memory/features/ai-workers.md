---
name: Workers de IA externos
description: Sistema de workers Lovable externos como fallback para IA (chat, parse TXT, imagens) com import em massa via TXT
type: feature
---
- Tabela ai_workers armazena URLs de projetos Lovable externos que servem como workers de IA
- Coluna `worker_type` classifica cada worker: 'chat' | 'txt' | 'image'
- Edge functions tentam: Google → Lovable → OpenRouter → Workers externos (nessa ordem)
- Workers são projetos Lovable criados em outras contas, usando a IA gratuita de cada conta
- Se worker retorna 429/402/503, é marcado como esgotado e o próximo é tentado
- Aba "Workers IA" no super admin para gerenciar workers
- **Import em massa via TXT**: cole/upload de arquivo no formato "IA Chat: https://...", "IA Imagem: https://...", "IA TXT: https://...". Parser detecta tipo por palavra-chave (imagem/image/img → image; parse-txt/txt/texto → txt; chat → chat) e enumera automaticamente baseado no count atual ("Chat 6", "Imagem 2"...). Dedup por URL.
- Endpoints dos workers: /functions/v1/ai-chat, /functions/v1/ai-parse-txt, /functions/v1/ai-generate-image
