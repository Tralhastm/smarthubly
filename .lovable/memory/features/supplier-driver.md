---
name: Fornecedor e Motoboy
description: Painéis externos para fornecedores e motoboys com controle de estoque, pedidos e entregas
type: feature
---
- Tabela suppliers: nome, endereço, telefone, access_token, responsible_for_delivery
- Tabela drivers: nome, telefone, access_token
- Fornecedor acessa /loja/{slug}/fornecedor/{token} - controla estoque e avança status pedidos
- Se fornecedor é responsável pela entrega, endereço dele vira base do frete
- Motoboy acessa /loja/{slug}/motoboy/{token} - marca entregue, atraso, nota personalizada
- Notificação sonora para fornecedor quando chega pedido novo
- Ambos os painéis atualizam automaticamente a cada 5 segundos
