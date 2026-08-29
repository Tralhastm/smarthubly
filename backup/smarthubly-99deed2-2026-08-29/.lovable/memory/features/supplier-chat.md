---
name: Chat Cliente-Fornecedor
description: Chat em tempo real entre cliente e fornecedor com filtro anti-roubo de clientes (apenas dropshipping)
type: feature
---
- Tabelas: supplier_chats, supplier_chat_messages (realtime habilitado)
- Apenas lojas dropshipping (is_dropshipping=true) mostram botão de chat no catálogo
- Chat é vinculado ao produto específico e ao fornecedor daquele produto (supplier_id)
- Lojas de terceiros NÃO mostram chat com fornecedor
- Filtro anti-contato: bloqueia telefones, emails, @instagram, URLs, "me liga", "meu número" etc
- Mensagem original salva em original_content, versão filtrada em content
- Cliente usa session_token (localStorage), não precisa de auth
- Fornecedor vê chats na aba "Chats" do painel (/loja/{slug}/fornecedor/{token})
