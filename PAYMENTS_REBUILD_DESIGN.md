# Reconstrução do sistema de pagamentos

## Objetivo

Reconstruir a lógica de pagamentos do SmartHubly de forma determinística, mantendo os tokens e os dados históricos existentes, mas substituindo a implementação das Edge Functions, do checkout e do processamento de webhooks.

## Dados preservados

Nenhuma tabela de pedidos, transações, cobranças, clientes, tokens, chaves, configurações de ambiente ou credencial será apagada. Migrações novas serão aditivas e compatíveis com o histórico.

## Contrato único do backend

Toda tentativa recebe `order_id` e `tenant_id`. O backend valida a existência do tenant e do pedido, resolve o provedor ativo no servidor, valida o estado do pedido e retorna um contrato uniforme: `provider`, `payment_id`, `init_point`, `pix_qr_code`, `pix_qr_image`, `status` e `message`. Falhas retornam JSON com `error`, `code` e `provider`, nunca uma tela genérica de outro provedor.

## Regras de provedor

Asaas é usado somente quando o tenant possui `payment_provider = asaas`, `asaas_enabled = true` e token no ambiente selecionado. Mercado Pago e PagBank permanecem como provedores alternativos explícitos. InfinitePay é separado entre Pix online e Tap na entrega. Um erro de configuração não troca silenciosamente de provedor: o fallback para Mercado Pago só ocorre quando o tenant estiver configurado para fallback, evitando cobrança no provedor errado.

## Webhooks

Cada webhook identifica o tenant sem confiar apenas no corpo recebido, valida o segredo configurado, registra a chave idempotente do evento e atualiza o pedido somente quando o novo status é conhecido e permitido. Eventos duplicados retornam HTTP 200 sem repetir efeitos. Eventos desconhecidos também retornam HTTP 200 após registro, para impedir reentregas inúteis.

## Estados

A cobrança pode estar pendente, aprovada/recebida, recusada, cancelada, estornada ou expirada. Somente estados de pagamento aprovados movem o pedido para `received`; estados posteriores de logística não são rebaixados. Uma atualização nunca altera pedidos já entregues ou cancelados sem regra explícita.

## Checkout

O frontend coleta CPF/CNPJ quando Asaas estiver ativo, não exibe texto de Mercado Pago durante uma tentativa Asaas e exibe a mensagem real devolvida pelo backend. A página de gateway só abre `init_point` depois de o backend retornar uma URL válida e mantém polling seguro do status público.

## Validação incremental

Cada etapa deverá passar por build local, teste unitário/estático, publicação isolada da função modificada, chamada HTTP Sandbox e inspeção de logs. A aprovação final só será declarada depois de uma cobrança Sandbox criada e de um evento de webhook confirmado.

## Segredos

Tokens e chaves não entram no Git. O código usa somente variáveis de ambiente e campos protegidos do banco. O arquivo de auditoria anterior permanece como cópia de segurança.
