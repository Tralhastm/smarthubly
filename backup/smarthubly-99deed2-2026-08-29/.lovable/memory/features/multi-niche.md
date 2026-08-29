---
name: Multi-nicho com produto vs serviço
description: Sistema adapta linguagem ao nicho da loja e suporta itens tipo produto ou serviço agendável
type: feature
---
- `src/lib/niche-labels.ts` centraliza textos por nicho (food/service/auto/retail/generic)
- Detecta nicho do tenant.niche (palavras-chave) e retorna: thanks, delivered, greeting, cartLabel, buyAction, serviceAction, quoteAction
- Cupom impresso usa frase do nicho como fallback se printer_footer_text vazio
- WhatsApp pós-entrega trocou "entregue" por "finalizado" (neutro)
- TenantOrderStatus: trocou "Bom apetite" por "Pedido finalizado"
- Produtos têm campo `item_type` (product|service) e `duration_minutes`
- Botão do catálogo muda conforme item_type + nicho: "Pedir"/"Comprar"/"Agendar"/"Solicitar orçamento"
- Tenants têm `scheduling_auto_confirm` (preparado pra Fase 2: agendamento real com slots)
- FASE 2 PENDENTE: sistema de slots/horários disponíveis baseado em duration_minutes, atraso, finalização antecipada
