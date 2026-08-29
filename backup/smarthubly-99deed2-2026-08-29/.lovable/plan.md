## Onde estamos vs F-Rest

Já temos (não vou refazer): PDV web + maquininha, mesas/comanda, QR mesa, garçom, delivery + iFood, marketplaces, cardápio digital, KDS, totem, caixa (abertura/fechamento/sangria/suprimento), divisão de conta, transferência de mesa, ficha técnica + CMV + DRE, financeiro (entradas/saídas/fiado), NFC-e, multi-pagamento, PIX, dashboard, BI básico, multi-tenant, IA, afiliados, prospecção SDR, onboarding.

**Gap real vs F-Rest hoje:** estoque profundo, conciliação de adquirente, contingência fiscal, KDS por setor, alguns relatórios operacionais e suporte estruturado.

## Plano em 5 ondas

### Onda 1 — Estoque profundo (núcleo F-Rest)
- Tabela `stock_movements` (entrada/saída/perda/ajuste/transferência) já parcialmente coberta por `ingredients` — estender com motivo, lote, validade
- Tela **Inventário** em `/admin` (contagem cíclica + foto, ajusta saldo automático)
- **Baixa automática** de ingredientes ao vender produto (já temos `product_recipes`, falta o trigger no `orders → delivered`)
- Alerta de **estoque mínimo** + sugestão de compra
- Relatório de **perdas/desperdício** por período

### Onda 2 — Cozinha pro (KDS evoluído + impressão setorizada)
- Coluna `kitchen_sector` em `products` (cozinha/bar/pizza/sobremesa)
- KDS filtra por setor (cada tela na sua estação)
- Impressão automática **por setor** ao receber pedido (bar imprime bebida, cozinha imprime prato)
- **Tempo médio** por item + alerta de pedido travado >15min

### Onda 3 — Financeiro profundo
- **Conciliação de adquirente**: upload CSV Stone/Cielo/Rede/Getnet → bate com `orders` → marca conciliado/divergente
- **Contas a pagar/receber** com vencimento, recorrência, alerta D-3
- **Fluxo de caixa projetado** (próximos 30 dias)
- **DRE comparativo** mês a mês

### Onda 4 — Fiscal & Contingência
- **Modo contingência NFC-e** (offline → fila → emite quando volta)
- **SAT** opcional (SP) — adapter no edge function
- **Cancelamento de NFC-e** dentro de 30min
- **Inutilização** de numeração

### Onda 5 — Relatórios + Suporte
- Relatórios operacionais: **ticket médio por hora/dia**, **mix de produtos**, **performance de garçom**, **horário de pico**
- Painel **suporte 24h** estruturado: chat ao vivo com SmartHubly + base de conhecimento (já temos `SofiaFAQ`, expandir)
- **Treinamento in-app**: vídeos tutoriais por módulo

## Ordem sugerida
1 → 2 → 3 → 4 → 5. Cada onda é independente e entrega valor sozinha.

## Confirmação
Posso começar pela **Onda 1 (Estoque profundo)** que é o gap mais citado pelo mercado vs F-Rest, OU prefere que eu siga outra ordem / pule alguma onda? Responde só "1" (ou a ordem que quiser) que eu já começo.