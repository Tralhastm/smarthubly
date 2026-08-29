---
name: IA por nicho na loja
description: Chatbot na loja que adapta ao nicho do tenant usando Lovable AI, com agendamento direto pelo chat
---
- Campo niche na tabela tenants (ex: adega, açaíteria, pizzaria)
- Edge function store-chat usa multi-provider (Google AI → Lovable AI → OpenRouter → AI Workers)
- System prompt adaptado ao nicho automaticamente
- Streaming SSE token-by-token
- Widget flutuante no canto inferior direito da loja
- Só aparece se tenant tem niche preenchido
- Contexto inclui produtos do tenant (nome, preço, categoria, descrição)
- AGENDAMENTO PELO CHAT: se scheduling_enabled=true e há produtos item_type=service, store-chat injeta no system prompt:
  - Lista de serviços com duração
  - Slots livres dos próximos ~7 dias úteis (até 5 dias com slots, 8 horários por dia)
  - Instrução pra IA emitir bloco `[BOOK]{json}[/BOOK]` no fim da resposta quando cliente confirmar
- Frontend (StoreChatbot.tsx):
  - Filtra `[BOOK]...[/BOOK]` do display
  - Após stream completo, parseia o JSON e cria order (placeholder, total=0, payment=pending) + appointment
  - Mostra badge verde "Agendado: X — data" abaixo da mensagem
  - Usa `processedBookings` ref pra não duplicar agendamento
