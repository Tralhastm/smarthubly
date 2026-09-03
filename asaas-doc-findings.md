# Referências oficiais Asaas

- Webhooks são enviados via POST; o evento possui `id` para idempotência e o header de autenticação é `asaas-access-token`. O Asaas recomenda não usar a API Key como token do webhook. Fonte: https://docs.asaas.com/docs/sobre-os-webhooks
- Na criação manual do webhook: Menu do usuário > Integrações > Webhooks. O Auth Token deve ter 32–255 caracteres, sem espaços, e pode ser gerado pelo botão Gerar token. Fonte: https://docs.asaas.com/docs/criar-novo-webhook-pela-aplicacao-web
- Cobrança Pix/cartão pode usar `billingType` `UNDEFINED` para abrir a fatura hospedada com as formas habilitadas na conta. O endpoint Pix QR é `/v3/payments/{id}/pixQrCode`. Fonte: https://docs.asaas.com/reference/criar-nova-cobranca e https://docs.asaas.com/reference/obter-qr-code-para-pagamentos-via-pix
- Cobrança direta com cartão exige dados/token do cartão; para evitar armazenar dados sensíveis, o fluxo atual usa a fatura hospedada. Fonte: https://docs.asaas.com/reference/criar-cobranca-com-cartao-de-credito
