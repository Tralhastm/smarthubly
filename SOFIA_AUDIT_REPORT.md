
## Extensão implementada após a auditoria

- `sofia_tool_registry`: catálogo com finalidade, parâmetros, permissão, escopo, impacto e exigência de confirmação.
- `sofia_cases`: memória persistente de situações, diagnóstico, ação, resultado, evidências, confiança, status e escopo de compartilhamento.
- `sofia_knowledge_suggestions`: fila de sugestões de aprendizado para revisão humana.
- A central do Super Admin passou a exibir contadores, ferramentas, casos e sugestões pendentes.

## Validações realizadas

- O Supabase confirmou as tabelas de conhecimento, eventos, ferramentas e casos e os registros iniciais de conhecimento.
- O lint dos arquivos alterados foi executado; restaram apenas avisos existentes de dependências de hooks.
- O build de produção do frontend foi executado com sucesso.
- O diff não apresentou erro de whitespace.
- A Edge Function foi revisada por inspeção estática; o ambiente local não possui Deno para `deno check`.
- Nenhum deploy de frontend ou Edge Function foi realizado nesta etapa.

## Correção de isolamento multi-tenant

Durante a validação foi identificado que um cliente público não poderia escolher livremente o `tenantId` enviado ao modelo. A implementação foi ajustada para que chats públicos validem `chatId` e token de sessão no servidor e derivem a loja/pedido dessa sessão. Fluxos autenticados só recebem contexto da loja quando o servidor confirma o usuário como super admin ou administrador/gerente aprovado da loja. O contexto recuperado é rotulado como dado, não como instrução.

## Estado de publicação

O frontend e a Edge Function permanecem sem deploy/publicação. As estruturas SQL de auditoria, conhecimento, casos e ferramentas já estão disponíveis no projeto Supabase ativo para permitir a validação da central quando o código for publicado; a publicação do código continua aguardando confirmação explícita.

## Ampliação final sem deploy

A Sofia também foi conectada ao fluxo de chats de produto/fornecedor, com validação do token do chat, contexto do produto e RPC separado para a mensagem da IA. A central do Super Admin agora exibe uso observável por canal, quantidade de eventos e último uso. O inventário inclui rotas públicas, painel, pedidos, catálogo, operação, financeiro, integrações, automações, permissões e a própria central da Sofia.
