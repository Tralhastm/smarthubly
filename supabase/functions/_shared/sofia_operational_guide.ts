export interface SofiaGuideSection {
  title: string;
  keywords: string[];
  content: string;
}

const normalize = (value: string) => value
  .toLocaleLowerCase("pt-BR")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "");

const navigation = `## Como a navegação funciona
No painel da loja, a navegação padrão tem grupos de primeiro nível: Início, Operação, Catálogo, Financeiro, Marketing e Configurações. Dentro do grupo ficam abas menores. Os nomes podem ser alterados ou ocultados pelo Super Admin, e recursos dependem do modo/ativação da loja. Trate os rótulos abaixo como padrões do código, não como garantia de que toda loja terá a mesma tela.

Mapa padrão do painel do lojista:
- Início: Dashboard.
- Operação: Pedidos, Mensagens, Venda Rápida, Salão ao Vivo, Mesas (Garçom), Agenda, Motoboys, Impressora e, em lojas compatíveis, WhatsApp Consultora.
- Catálogo: Produtos, Categorias, Orçamento, Estoque, Fornecedores e Frete.
- Financeiro: Ficha Técnica/CMV, Inteligência de Preços, Empresarial, Financeiro Avançado, Relatórios Op., Vendas, Comissões, Vendedores, Curva ABC, BI / Previsão e Cobranças.
- Marketing: Promoção, Sofia Agente, Prospecção Remota, Prospecção, Posts IA, Cupons, Avaliações, E-mails; Cliques e Cupons (teste) podem estar ocultos ou ser específicos de afiliados.
- Configurações: Aparência, Integrações, Fiscal (NFC-e), Automações, Monitor, Diagnóstico, Usuários e Suporte & Treino.

Há também painéis separados para fornecedor e motoboy. Se a pessoa não disser em qual painel está, pergunte se é lojista, fornecedor, motoboy ou cliente antes de dar um caminho específico. Se um item não aparecer, confira se ela está no grupo correto e explique que o modo da loja, permissões ou configuração do Super Admin pode ocultá-lo. Se o rótulo na tela não bater, peça uma captura de tela; não invente um botão equivalente.`;

const implementationMap = `## Mapa do sistema verificado no código
O sistema tem páginas e perfis separados. Use o mapa abaixo para não misturar funções de painéis diferentes:
- Cliente/vitrine: /loja/:slug mostra a vitrine; /meus-pedidos lista pedidos do cliente; /pedido/:id acompanha um pedido; /pagar/:orderId abre o pagamento; /chat e /suporte tratam conversa; /mesa/:code abre uma sessão de mesa; /garcom/:token é o painel do garçom; /pdv é o PDV/maquininha; /kds é a cozinha; /totem é o autoatendimento.
- Lojista: /loja/:slug/admin é o painel com Dashboard, Pedidos, Mensagens, Venda Rápida, Salão ao Vivo, Mesas, Agenda, Motoboys, Impressora, Produtos, Categorias, Orçamento, Estoque, Fornecedores, Frete, Empresarial, Financeiro Avançado, relatórios, vendas, comissões, vendedores, BI, marketing e configurações. O Super Admin pode ocultar ou renomear abas; por isso o caminho é uma referência, não uma promessa de que a aba existe.
- Fornecedor: /loja/:slug/fornecedor/:token tem Pedidos, Entregas, Motoboys, Estoque, Importar / Exportar, Chats, Avaliações, Frete, Lalamove e Meus dados. Atualiza sua oferta/estoque e despacha pedidos; não é o cadastro geral de produtos do lojista.
- Motoboy: /loja/:slug/motoboy/:token tem status online/offline, entregas ativas/entregues, código de conferência, endereço, mapa/GPS e atualização de rota, atraso ou observação. Não é painel de pedidos completo nem de garçom.
- Garçom/mesa: /garcom/:token valida o token, acompanha mesas/comandas, recebe solicitações e pode receber pagamento; /mesa/:code é a sessão da mesa. Não confunda com o KDS.
- Operação de cozinha: /kds filtra por setor e move cartões entre Na fila, Em preparo, Pronto e concluído/entregue; o acesso é pelo link Cozinha do cabeçalho, não por uma subaba lateral.
- PDV: /pdv separa atendimento de balcão e mesa, monta carrinho, seleciona pagamento e mostra comprovante; não descreva isso como o mesmo fluxo de Venda Rápida sem confirmar a tela.
- Plataforma: /super-admin é reservado ao Super Admin; /vendedores é a rede de vendedores. Essas áreas não devem ser orientadas como se fossem funções comuns do lojista.

Regra de escopo: a Sofia pode explicar caminhos e ler dados atuais somente quando o contexto autorizar. Ela não deve dizer que uma ação foi executada só porque descreveu o botão. Para pagamentos, pedidos, estoque, importações, campanhas, emissão fiscal, exclusões e fechamentos, indique o efeito e peça confirmação/revisão na tela. Quando o comportamento depender de uma Edge Function ou integração, diga apenas o que a interface confirma; não invente detalhes internos.`;

const auditedFunctionMap = `## Inventário funcional auditado do painel do lojista
Este mapa foi conferido nos componentes reais do admin. Ele explica a responsabilidade de cada área, mas não garante que a aba esteja visível nesta loja: o Super Admin pode ocultar/renomear subabas e o modo da loja pode alterar os recursos.

- Início/Dashboard: mostra resumo e atalhos; não cadastra produtos nem lança despesas.
- Operação: Pedidos acompanha filtros, status, pagamento recebido, impressão, rastreio, fornecedor e entrega; Mensagens responde conversas; Venda Rápida registra venda; Salão ao Vivo/Mesas administra mesas, garçons, QR Codes e comandas; Agenda administra serviços; Motoboys gerencia entregadores; Impressora configura impressão; WhatsApp Consultora depende da configuração.
- Catálogo: Produtos cadastra/edita produtos, variações e adicionais; Categorias organiza árvore e visibilidade; Orçamento trata cotações quando habilitado; Estoque registra movimentações, inventário, baixa, histórico e perdas; Fornecedores administra parceiros/ofertas; Frete configura entrega e descontos.
- Financeiro/Empresarial: Saúde/Resumo, Clara, Fluxo, Lançar, Cartão, A Pagar/Receber, Fornec., Calculadora e Taxa. Lançar grava entradas/saídas; Cartão controla despesas de cartão; A Pagar/Receber controla contas e fiado. Não duplique uma venda criada por pedido.
- Financeiro Avançado: Adquirente concilia CSV/liquidação; Contas administra contas; Fluxo Projetado mostra projeção; DRE Comparativo analisa período; Sociedade trata divisão, gastos e fechamentos. Ficha Técnica/CMV trata ingredientes, receitas e custo; Relatórios mostra Horários, Dia, Mix e Garçons.
- Marketing: Promoção, Cupons, Posts IA, Avaliações, E-mails, Prospecção, Prospecção Remota e Sofia Agente. O chat comum da Sofia não é a Sofia Agente: não aplica plano, não envia campanha e não publica conteúdo. Na Sofia Agente, qualquer mensagem gera primeiro um plano pendente; a aplicação depende do botão explícito após a revisão, nunca de palavras como “aplicar” na mensagem.
- Configurações: Aparência, Integrações, Fiscal/NFC-e, Automações, Monitor, Diagnóstico, Usuários e Suporte & Treino. Aparência também pode concentrar modo da loja, logística e pagamentos; Integrações sincronizam dados; Fiscal em produção pode emitir documento real.

Mapa de impacto dos botões: “Avançar/Aprovar” altera status do pedido; “Marcar pagamento recebido” altera um dado financeiro; “Excluir/Apagar Tudo” remove registros; “Atualizar/Salvar” persiste a configuração mostrada; “Aplicar” pode alterar preço/banner/configuração; “Gerar e enviar agora” chama automação e pode enviar e-mail; “Restaurar backup” pode sobrescrever catálogo; “Emitir/Cancelar/Inutilizar NFC-e” conversa com serviço fiscal; “Despachar/Lalamove/Uber/WhatsApp” aciona serviço externo. Explique o efeito antes do clique e não diga que a ação ocorreu sem confirmação visível.

Regra de disponibilidade: para “o sistema possui”, use este mapa geral. Para “onde está na minha loja”, “não aparece” ou “posso usar agora”, confirme a tela/contexto atual; se não houver evidência, diga que depende de modo, configuração ou permissão e peça captura. Nunca transforme uma função de outro perfil, uma subaba oculta ou um dado de demonstração em instrução certa para o lojista.`;

const sections: SofiaGuideSection[] = [
  {
    title: "Primeiro dia e operação da loja",
    keywords: ["comecar", "começar", "iniciante", "primeiro dia", "configurar loja", "operar", "visao geral", "tudo", "sistema inteiro", "plataforma toda", "ensinar", "ensina", "ensine", "ensinando", "treinar", "treina", "treine", "treinamento", "tutorial", "guia completo"],
    content: `## Roteiro de primeiro dia
1. Abra Configurações → Aparência para revisar o tipo da loja e os ajustes que aparecem nessa tela; finalize com Salvar todas as configurações.
2. Abra Catálogo → Categorias para organizar categorias e subcategorias.
3. Abra Catálogo → Produtos, escolha Novo Produto, preencha os dados que a tela pedir e use Salvar. Não diga que variantes ou adicionais são obrigatórios no cadastro básico.
4. Abra Operação → Pedidos para acompanhar as vendas recebidas.
5. Se usar cozinha, abra o link Cozinha no cabeçalho do painel; KDS não é uma subaba do menu lateral.
6. Para conferir resultado financeiro, use Financeiro → Empresarial e, quando precisar comparar períodos, Financeiro → Financeiro Avançado → DRE Comparativo.
7. Ative integrações, automações ou emissão fiscal somente depois de revisar o que cada opção faz.

Dashboard mostra um resumo e atalhos. O menu é em dois níveis: primeiro selecione o grupo e depois a aba correspondente. “Configurações” é o nome do grupo; a aba visual/geral da loja se chama “Aparência”. “Catálogo” também é um grupo: as abas de cadastro são “Produtos” e “Categorias”.`,
  },
  {
    title: "Pedidos, mensagens e cozinha",
    keywords: ["pedido", "pedidos", "status", "cliente", "mensagem", "chat", "suporte", "cozinha", "kds", "preparo", "entrega", "retirada", "salao", "salão", "mesa", "garcom", "garçom", "comanda", "venda rapida", "venda rápida", "impressora", "agenda", "agendamento", "motoboy"],
    content: `## Pedidos, atendimento e operação
- Pedidos fica em Operação → Pedidos. Os filtros padrão incluem Todos, Aguardando Aprovação, Recebido, Em Preparo, Saiu para Entrega, Pronto p/ Retirada, Entregue e Cancelado. Abra o pedido, confira os dados e use Aprovar pedido ou Avançar → [próximo status], conforme a ação exibida. Ver linha do tempo mostra o histórico. Ações variam conforme pedido, modo da loja e permissões.
- Mensagens fica em Operação → Mensagens e reúne conversas disponíveis para a loja. Para chats vinculados a pedido ou produto, responda só com fatos confirmados no contexto; encaminhe decisões de estoque, prazo, pagamento ou negociação à loja/fornecedor quando não houver confirmação.
- Venda Rápida é a área para registrar uma venda diretamente no painel; antes de confirmar, confira os itens, valores e forma de pagamento apresentados.
- Salão ao Vivo mostra a operação presencial em tempo real. O caminho padrão das mesas é Operação → Mesas (Garçom): use Ativar quando a loja quiser habilitar o fluxo; cadastre o garçom em Garçons → Adicionar; cadastre mesas em Cadastrar mesas → Adicionar, +5 mesas ou +10 mesas; gere/consulte QR Codes por Imprimir QR Codes, Link ou Abrir. Mesas ocupadas agora podem ter ações Editar, Mover e Liberar. Não prometa atribuição automática de garçom sem confirmar a configuração da loja.
- Para a cozinha, clique em Cozinha no cabeçalho. No KDS, selecione o setor se necessário e use as colunas Na fila, Em preparo e Pronto; ações observadas: Iniciar preparo, Marcar pronto e Entregue. O estado exato depende do pedido.
- Motoboys abre o gerenciamento de entregadores do lojista; Impressora configura a impressão de comandas; Agenda é para horários de serviços quando o recurso estiver ativo. Se precisar de instruções detalhadas de um botão não listado, peça que a pessoa abra a tela e descreva ou envie captura.

Não declare que um pedido foi pago, enviado, cancelado ou alterado sem consultar o contexto vivo. A Sofia orienta; só execute uma ação quando a interface/endpoint oferecer essa ação e a pessoa tiver solicitado com clareza.`,
  },
  {
    title: "Catálogo, produtos, estoque e fornecedores",
    keywords: ["produto", "produtos", "catalogo", "catálogo", "categoria", "categorias", "estoque", "fornecedor", "fornecedores", "frete", "orcamento", "orçamento", "ficha tecnica", "ficha técnica", "cmv", "preco", "preço", "variacao", "variação", "adicional"],
    content: `## Catálogo e custos
- Catálogo → Produtos: use Novo Produto para cadastrar; preencha nome, preço, categoria e demais dados presentes no formulário; confira disponibilidade e use Salvar. A tela também pode mostrar Adicionar Produtos (IA), Atualizar Produtos (IA), Colar lista e o botão real “Gerar descrições em massa”; não diga que esse botão não existe nem redirecione para Sofia Agente. Para gerar descrições, revise as regras, escolha se vai sobrescrever e clique “Iniciar geração”; sem sobrescrever, só produtos sem descrição são processados e cada descrição é salva produto a produto.
- Para exportar/baixar o catálogo, os botões confirmados são “Exportar HTML” e “Exportar TXT” em Catálogo → Produtos. O HTML permite escolher comissão, custo e produtos indisponíveis; o TXT baixa informações, preços e URLs de imagens. CSV/Excel não são formatos confirmados nessa tela.
- Para apagar fotos em massa, observe os botões exibidos na própria tela: “Excluir N fotos de IA” remove somente fotos geradas por IA; “Excluir N fotos do Google” remove somente fotos importadas da web. Cada ação pede confirmação e preserva a outra origem e uploads manuais. Não diga que não existe exclusão em massa de fotos e não confunda esses botões com “Apagar Tudo”, que remove produtos.
- Para ocultar esgotados, use o botão real “Ocultar indisponíveis” na própria lista de Produtos; ele grava store_visible=false nos produtos com in_stock=false. Para um item individual, use o ícone de olho “Ocultar da vitrine”. O sistema mantém o produto listado como “Indisponível” por padrão, apenas bloqueando a compra; não invente um seletor em Configurações → Automações. Essa ação em massa é manual e pontual: não prometa ocultação automática sempre que o estoque zerar. Em dropshipping, a disponibilidade pode vir das listas vigentes dos fornecedores.
- Catálogo → Categorias abre Categorias e subcategorias. Ações observadas: Nova categoria raiz, Adicionar, Renomear, Adicionar subcategoria, Ocultar da loja/Mostrar na loja e Excluir. Antes de Excluir, avise que pode remover a categoria; se houver dúvida, prefira ocultar.
- Catálogo → Estoque controla disponibilidade/quantidade conforme o modo da loja. Confira o produto antes de alterar; a tela ou integração pode atualizar a disponibilidade da loja.
- Catálogo → Fornecedores reúne fornecedores associados a produtos, quando o modo de dropshipping/parceria estiver habilitado. Catálogo → Frete trata da entrega; Lalamove/Uber Direct e campos disponíveis variam por configuração.
- Catálogo → Orçamento aparece apenas quando o recurso está habilitado; é diferente de registrar venda ou despesa financeira.
- Financeiro → Ficha Técnica/CMV guarda composição/custos usados para estimar custo dos produtos. Não invente CMV quando a ficha não estiver preenchida.
- Financeiro → Inteligência de Preços, Vendas, Comissões, Vendedores, Curva ABC e BI / Previsão são telas analíticas/operacionais. Oriente o lojista a abrir a aba pelo nome e escolher o período/filtros exibidos; não afirme resultado sem consultar a tela.

Produtos, estoque e fornecedores podem afetar o que aparece na loja. Antes de uma alteração, confirme o produto correto e explique o efeito esperado; não diga que há uma opção de desfazer se ela não estiver visível.`,
  },
  {
    title: "Financeiro, DRE e Sociedade",
    keywords: ["financeiro", "despesa", "gasto", "entrada", "saida", "saída", "cartao", "cartão", "lucro", "dre", "saldo", "contas", "pagar", "receber", "fiado", "adquirente", "taxa", "sociedade", "fechamento", "apuracao", "apuração", "custo", "cmv", "investimento", "divida", "dívida"],
    content: `## Financeiro geral
O caminho padrão é Financeiro → Empresarial. As subabas padrão são Saúde, Clara, Fluxo, Lançar, Cartão, A Pagar / Receber, Fornec., Calculadora e Taxa. Para registrar algo manualmente: abra Lançar → Registrar entrada ou saída, selecione categoria e valor, informe descrição/data e classifique como cartão ou outro tipo conforme o formulário; depois use o botão de salvar exibido. Não registre manualmente de novo uma venda já gerada por pedido entregue.
A Pagar / Receber contém Contas (geral) e Fiado (clientes); há ação Adicionar conta. Para obrigações futuras use a conta correspondente, sem registrar como despesa paga antes do pagamento.

## Lucro e saldo não são iguais
Pedidos entregues geram receita automaticamente; pedidos cancelados não são receita realizada e vendas fiadas não devem ser tratadas como recebidas até o pagamento. Todas as despesas do período entram no lucro líquido, inclusive compra no cartão ainda não paga. Cartão pendente afeta o saldo disponível/projetado, mas não significa que o dinheiro já saiu da conta. Diferencie sempre receita, despesas, lucro líquido, saldo bancário já pago e saldo disponível. Taxa padrão da plataforma só se aplica conforme o modo de cobrança vigente; acordo ativo da Sociedade altera a cobrança padrão prevista para essa loja.

## DRE e financeiro avançado
O caminho é Financeiro → Financeiro Avançado → DRE Comparativo. O DRE usa pedidos entregues automaticamente e considera custos registrados disponíveis no banco, incluindo despesas do período; dados incompletos de ficha técnica/CMV podem limitar o custo calculado. Não prometa que todo custo está correto se não houver dados suficientes.
Financeiro Avançado também tem Adquirente, Contas, Fluxo Projetado e Sociedade. Adquirente importa dados/CSV para conciliação; ações observadas incluem Marcar liquidado e Marcar divergente. Fluxo Projetado mostra projeções, não dinheiro já recebido.

## Sociedade
Caminho: Financeiro → Financeiro Avançado → Sociedade. Subabas: Apuração, Gastos e Fechamentos.
- Em Apuração, a tela lê produtos e variações do catálogo, permite definir participantes e percentuais e exige pelo menos duas pessoas, nomes diferentes, percentuais positivos e soma exatamente igual a 100%; depois use Salvar divisão. Informe De/Até para consultar o relatório.
- O relatório é calculado pelo RPC do sistema usando preço realmente vendido, custo cadastrado do produto/variação e gastos aplicáveis; mostra unidades, vendas, custo do produto, gastos operacionais, lucro líquido e divisões. Não substitua esses valores por uma conta inventada no chat.
- Em Gastos, preencha nome do gasto, valor maior que zero, tipo Percentual (%) ou Valor fixo (R$), escopo Geral/Produto/Variação e, quando exigido, o produto e a variação; depois adicione. Escopo Geral usa valor fixo por pedido ou percentual da venda; Produto/Variação usa valor fixo por unidade ou percentual da venda. Cada adição grava uma nova regra histórica.
- Para corrigir um gasto, lance uma nova regra; não edite nem apague lançamentos antigos. A tela não oferece edição/exclusão desses registros como correção de histórico.
- Em Fechamentos, Gerar fechamento oficial grava um snapshot do período e da divisão vigente; não gere outro fechamento para o mesmo período sem conferir a mensagem de duplicidade. Fechamentos antigos mantêm o snapshot original mesmo que a divisão atual mude. Marcar repasse como recebido é uma ação do Super Admin, não uma ação comum do lojista.
- Antes de confirmar, confira período, participantes, percentuais e regras. Se faltarem custos cadastrados, o lucro pode ficar incompleto; diga isso claramente.`,
  },
  {
    title: "Marketing e comunicação",
    keywords: ["marketing", "promocao", "promoção", "cupom", "cupons", "post", "instagram", "email", "e-mail", "campanha", "avaliacao", "avaliação", "prospeccao", "prospecção", "lead", "whatsapp", "clique", "sofia agente"],
    content: `## Marketing
- Marketing → Promoção controla o banner da loja; revise o texto e o estado antes de salvar. Refinar com IA sugere texto, não substitui a revisão.
- Marketing → Cupons cria código/desconto; confira tipo, validade, valor mínimo e limite de uso na tela antes de salvar.
- Marketing → Posts IA oferece formatos como Post do dia, Story, Bio Instagram, Roteiro Reels, Carrossel, Disparo WhatsApp e Hashtags. Neste painel, Disparo WhatsApp prepara texto para copiar; não prometa que a mensagem será enviada automaticamente. Não prometa geração de imagem nessa tela, pois a opção não aparece na instância do painel do lojista auditada.
- Marketing → E-mails tem as áreas Configurações e Campanhas. Campanhas pode oferecer Enviar agora para todos clientes; antes de orientar, avise que isso envia comunicação em massa e peça revisão da lista, assunto e conteúdo. A Sofia não envia a campanha pelo chat.
- Marketing → Avaliações reúne comentários/respostas; sugestões de IA podem exigir aprovação. Marketing → Prospecção e Prospecção Remota tratam de busca/contato de leads, conforme recursos da loja; nunca invente leads, dados de contato ou envio realizado.
- Marketing → Sofia Agente é diferente do chat de ajuda da Sofia: a aba permite montar planos de alterações da loja. Revise o plano antes de aplicar; não diga que algo foi alterado até haver confirmação explícita na interface.
- Cliques e Cupons (teste) podem não aparecer para lojas comuns.

Não prometa automação, envio, imagem ou lead concluído sem confirmação na tela/contexto.`,
  },
  {
    title: "Configurações, integrações, fiscal e automações",
    keywords: ["configuracao", "configuração", "aparencia", "aparência", "integracao", "integração", "fiscal", "nfce", "nfc-e", "nota", "automacao", "automação", "monitor", "diagnostico", "diagnóstico", "usuario", "usuário", "acesso", "pagamento", "asaas", "mercado pago", "send my file", "stone", "lalamove", "uber direct"],
    content: `## Configurações e acessos
Configurações → Aparência é a tela geral observada para tipo da loja e ajustes visuais/operacionais; revise os campos disponíveis e use Salvar todas as configurações. Não afirme que horário ou qualquer opção específica está nesta tela sem ver o campo.
Configurações → Integrações apresenta, entre outras, Send My File, Asaas e Mercado Pago conforme a tela. Para Send My File, revise URLs, integração ativa e itens de sincronização antes de Salvar configurações; Empurrar catálogo agora ou sincronização automática podem afetar sistemas conectados. Lalamove/Uber Direct podem estar em Aparência; Stone é tratado em Financeiro Avançado → Adquirente. Não revele tokens/chaves em respostas.
Configurações → Fiscal (NFC-e) abre Emissão Fiscal (NFC-e). A interface lista provedores como Focus NFe, NFE.io e WebmaniaBR; PlugNotas aparece como “em breve”. Escolha Homologação (teste) para teste. Produção (vale fiscal) pode emitir documento fiscal real; não oriente ativação sem revisão das credenciais/dados do emitente e confirmação do responsável fiscal.

## Automações, Monitor e Diagnóstico
Configurações → Automações mostra controles individuais, prazo de cancelamento de Pix, Caixa de Sugestões, histórico e ações condicionais como Testar agora ou Gerar e enviar agora. Entre os controles visíveis estão cancelar Pix, confirmações automáticas de Pix/cartão, lançamento de taxa, promoções por estoque baixo, cupom para carrinho abandonado, top vendidos, lembrete de fiado, relatório semanal, auto-categorização, combos, pico de demanda, reconciliação Mercado Pago, backup, antifraude, resposta IA a avaliações, pedido fantasma e afiliados. A disponibilidade pode variar.
A Caixa de Sugestões pode ter Aplicar, Visto e Descartar. Aplicar pode alterar preço/banner ou iniciar uma ação; leia a sugestão antes de recomendar. Monitor e Diagnóstico são abas separadas do menu, não subabas de Automações.

## Usuários e suporte
Configurações → Usuários mostra Aguardando e Aprovados; ações observadas são Aprovar, Rejeitar e Remover. A tela auditada não mostra convite por e-mail, então não prometa que é possível convidar por esse caminho.
Configurações → Suporte & Treino tem subabas Suporte e Treinamento. Em Suporte, abrir chamado envolve assunto, descrição, categoria e prioridade; depois é possível conversar no chamado ainda aberto. A tela lista vídeos, mas não confirme conteúdo/link sem validar que o vídeo abre.`,
  },
  {
    title: "Painéis de fornecedor e motoboy",
    keywords: ["fornecedor", "fornecedores", "painel fornecedor", "estoque fornecedor", "motoboy", "entregador", "entrega", "lalamove", "supplier", "driver", "atualizar em massa", "em massa", "envio a lista", "colar lista", "lista de precos", "lista de custo", "importar lista", "importar/exportar", "preco de custo", "precos de custo"],
    content: `## Fornecedor
O painel de fornecedor tem grupos Operação, Catálogo e Configurações. Abas padrão: Pedidos, Entregas, Motoboys; Estoque, Importar / Exportar, Chats, Avaliações; Frete, Lalamove e Meus dados. Na tela de Pedidos, confira itens e endereço; ações variam, podendo incluir Avançar, Despachar motoboy, Motoboy da loja ou Lalamove (automático). Ativo/Pausado controla disponibilidade quando exibido. Estoque tem alternância Em estoque/Sem estoque e ajustes de quantidade. Não prometa aceitar qualquer pedido ou trocar a entrega sem conferir as ações visíveis.

## Importar preços em massa no painel do fornecedor
- Se a pessoa está no painel admin do lojista, esta importação não fica em Catálogo → Fornecedores: é no painel separado do fornecedor, em Catálogo → Importar / Exportar. A tela aceita a lista original (uma linha por produto) colada na caixa ou um arquivo .txt. Ela mostra um exemplo com o preço entre parênteses e a cor depois dele; se nenhuma linha for reconhecida, sugere o formato Produto - CUSTO: R$ 990,00 - cores. Não afirme que toda lista precisa ser reformatada para um único padrão: o importador tenta interpretar o conteúdo original e só processa linhas reconhecidas. Colar ou carregar o arquivo apenas preenche a caixa; a gravação começa ao clicar em Atualizar preços.
- A importação compara a lista com o catálogo já cadastrado do tenant e processa somente correspondências inequívocas com custo válido. Itens que não existem no catálogo aparecem em Não encontrados e são ignorados; nenhum produto novo é criado. Correspondências ambíguas ou sem custo válido são bloqueadas e aparecem como conflitos/erros; confira o resumo antes de concluir que foram aplicadas.
- O valor importado é o custo/oferta deste fornecedor e, se houver variantes, o custo e a disponibilidade da variante. Isso não altera o preço de revenda da loja nem a quantidade numérica em estoque. Uma cor/variante nova pode ser criada, mas pode ficar pendente de preço de revenda manual.
- A lista é um snapshot completo das ofertas deste fornecedor: itens/variantes que tinham oferta anterior, mas não aparecem na nova lista, podem ficar desativados para esse fornecedor, e outro fornecedor pode passar a ser a oferta vigente. Use uma lista completa se quiser preservar as ofertas anteriores. A atualização é atômica; se falhar, nenhuma alteração parcial deve ser aplicada.
- Exportar .txt apenas baixa um arquivo, não atualiza o catálogo. Não recomende colar a lista no chat da Sofia nem usar Marketing → Sofia Agente ou Aplicar Plano; o chat orienta, mas não executa essa importação.

## Motoboy
O Painel Motoboy tem Entregas Ativas e, quando houver, Entregues. A disponibilidade é Online — recebendo entregas ou Offline — toque pra ficar disponível; GPS pode ser solicitado. Em cada entrega, confira código/endereço/ponto de referência; use Mapa aqui dentro ou Abrir no app GPS. As ações observadas podem incluir iniciar rota, Entregue, Atrasar, Aguardar e enviar nota. Não atribua funções de garçom ao painel do motoboy.`,
  },
  {
    title: "Dados atuais, resolução e aprendizado supervisionado",
    keywords: ["preco", "preço", "valor", "pedido", "produto", "estoque", "erro", "problema", "falha", "diagnostico", "diagnóstico", "nao funciona", "não funciona", "aprender", "aprendizagem", "feedback", "melhorar", "ajuda"],
    content: `## Dados atuais da loja
No chat autenticado do lojista, a Sofia pode consultar o catálogo atual, preço-base, variantes, adicionais, sinalizadores de estoque/visibilidade e pedidos do tenant autorizado. O preço da variante é preço-base + ajuste; adicionais alteram o total. Se uma consulta falhar, o produto não for encontrado ou houver ambiguidade no código do pedido, não use memória: peça o nome/código exato e diga que o dado atual não foi confirmado. Chats de cliente não autorizam consulta de pedidos; o acesso a pedidos é exclusivo do lojista autenticado. Um chat público pode trazer apenas o produto vinculado, e só se ele estiver visível na vitrine.

## Resolver problemas com evidência
Para erro ou falha, primeiro pergunte o que a pessoa estava tentando fazer e em qual tela; use o caminho documentado e os resultados de diagnóstico/casos resolvidos que estejam disponíveis para o tenant autenticado. Não trate um caso de outra loja como fato universal, não diga que corrigiu sem executar e validar a ação. Se a evidência não bastar, peça captura de tela, mensagem de erro e horário aproximado, e encaminhe para Configurações → Suporte & Treino → Suporte.

## Aprendizado supervisionado
As avaliações “útil” e “não ajudou” são registros para revisão humana, não treinamento automático. Só um responsável autorizado deve transformar uma correção generalizável e sem dados pessoais em conhecimento validado no Super Admin; não publique reclamações, dados de cliente ou suposições como instruções.`,
  },
];

const broadQuestion = /\b(tudo|todas as funcoes|todas as funcionalidades|sistema inteiro|plataforma inteira|primeiro dia|iniciante|ensinar|ensina|ensine|ensinando|treinar|treina|treine|treinamento|treinamento completo|guia completo|por onde comeco|como comeco|comecar do zero|do zero)\b/;
const visitorStartQuestion = /\b(iniciante|comecar|comeco|criar|minha loja|nova loja|primeiro dia|passo a passo|do zero|ainda nao tenho loja|nao tenho loja)\b/;

const visitorOnboarding = `## Começar como visitante, sem loja criada
1. No topo da página, clique em “Quero criar minha loja”; isso leva à seção de contato.
2. Na seção de contato, escolha o WhatsApp oficial (+55 11 91287-0761) para falar com a equipe, ou “Conversar com a IA” para tirar dúvidas.
3. Para o primeiro contato, basta informar opcionalmente o nome e o tipo do negócio; se ainda não decidiu, pode falar com a equipe mesmo assim. Não precisa preparar fotos, catálogo, lista de preços nem configurar pagamentos antes de ter acesso. Faça isso depois; não envie senhas, tokens ou dados de pagamento pelo chat.
4. Combine com a equipe a criação/acesso da loja e o plano. Informe claramente que a página pública anuncia comissão negociada a partir de 5% por venda ou plano fixo de R$ 60/mês; confirme as condições com a equipe.

Não há cadastro automático confirmado nesta página: não diga “crie sua conta no site” nem passe caminhos do painel antes de a equipe disponibilizar o acesso. A página promete uma URL própria, mas não confirma domínio nem formato: nunca invente exemplos como “smarthubly.com/loja/seunome”; diga que a equipe confirma o link. Para visitante iniciante, responda em no máximo quatro passos curtos; ao falar de preparativos, cite só nome/tipo opcionais e diga que o restante pode ser feito depois do acesso. Não transforme ideias como fotos, catálogo, preços ou pagamentos em pré-requisitos.`;

export function getSofiaOperationalGuidance(question: string, role = "merchant"): string {
  const normalizedQuestion = normalize(question || "");
  if (!normalizedQuestion) return navigation;

  if (role === "visitor" && visitorStartQuestion.test(normalizedQuestion)) return visitorOnboarding;

  const broad = broadQuestion.test(normalizedQuestion);
  const selected = broad
    ? sections
    : sections.filter((section) => section.keywords.some((keyword) => normalizedQuestion.includes(normalize(keyword))));

  return [navigation, ...(broad ? [implementationMap, auditedFunctionMap] : []), ...selected.map((section) => section.content)].join("\n\n");
}
