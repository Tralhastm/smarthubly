# Entregas

## Carrossel IA — curadoria de imagens por produto
- [x] Permitir selecionar produtos no catálogo ou detectar automaticamente produtos com galeria incompleta.
- [x] Buscar imagens adicionais específicas do modelo na web, evitando duplicatas das imagens já cadastradas.
- [x] Exibir uma prévia editável com capa, fotos do produto e imagens informativas encontradas.
- [x] Limitar cada carrossel a 10 mídias e só salvar depois da confirmação do administrador.
- [x] Salvar as imagens aceitas no Storage da loja e preservar a capa atual quando o usuário não a desmarcar.
- [x] Publicar a Edge Function `carousel-curator` no Supabase para busca, filtragem básica de formato e persistência das imagens.

## Sociedade — apuração e repasse entre plataforma e loja
- [x] Criar uma aba **Sociedade** dentro do Financeiro Avançado.
- [x] Permitir que o administrador informe gastos gerais, por produto ou por variação, incluindo taxa do checkout, motoboy e desconto ao cliente.
- [x] Aceitar cálculo por valor por unidade, percentual da venda e valor por pedido rateado pelos itens.
- [x] Usar o preço realmente vendido; usar o custo da variação quando existir e, na ausência, o custo geral do produto.
- [x] Apurar lucro líquido por produto e por variação em pedidos entregues, sem contar pedidos fiados.
- [x] Dividir o lucro líquido positivo em 50% para a plataforma e 50% para a loja/sócio.
- [x] Salvar fechamentos oficiais com snapshot imutável e trilha de auditoria.
- [x] Impedir edição e exclusão dos registros da Sociedade pelo painel; correções entram como novos registros.
- [x] Restringir o escopo dos administradores ao próprio tenant.
- [x] Permitir que somente o login Super Admin marque o repasse como recebido.


# Precificador de Mercado — resultados

## Entrada e consolidação
- [ ] A aba se chama `Precificador`.
- [ ] O usuário consegue colar texto de várias listas de fornecedores.
- [ ] O usuário consegue importar TXT, CSV ou TSV.
- [ ] O sistema identifica produto e custo sem inventar linhas.
- [ ] Produtos repetidos são consolidados e ordenados por recorrência.
- [ ] O usuário consegue selecionar até 40 produtos antes da pesquisa.
- [ ] O custo pode vir da linha importada ou do custo já cadastrado no catálogo.

## Gastos e cálculo
- [ ] Existe uma seção de gastos dentro do Precificador.
- [ ] Cada gasto tem nome livre, ativo/inativo, percentual ou valor fixo.
- [ ] Existe lucro líquido mínimo configurável.
- [ ] O cálculo mostra custos, gastos, preço sugerido, lucro em R$ e margem em %.
- [ ] Gastos usados e suas configurações ficam salvos no snapshot da análise.
- [ ] A IA não decide nem altera os cálculos financeiros.

## Mercado real e decisões
- [ ] A pesquisa guarda fonte, título, preço, link, condição e data.
- [ ] Produtos equivalentes não misturam memória, capacidade, modelo ou condição.
- [ ] Sem evidência suficiente o item fica `Inconclusivo`.
- [ ] `Carro-chefe` exige preço competitivo e lucro mínimo atingido.
- [ ] `Margem segura` usa preço mínimo lucrativo mesmo quando fica acima do mercado.
- [ ] A demanda sem dado de volume é mostrada como estimada, nunca como venda comprovada.

## Histórico e entrega
- [ ] Cada análise e seus itens ficam persistidos por loja.
- [ ] Usuários só acessam análises da própria loja; Super Admin pode acessar conforme RLS.
- [ ] Existe exportação CSV do resultado.
- [ ] `pnpm build`, testes e `git diff --check` passam.
- [ ] A migration e a Edge Function são aplicadas no projeto Supabase correto.
- [ ] O deploy do Cloudflare Pages recebe a aba atualizada.


# Automações de catálogo — combos e ranking

## Combo por co-compra com aprovação real
- [ ] Para cada loja ativa com checkout/pedidos próprios, detectar combinações de produtos que aparecem juntas em pelo menos 3 pedidos distintos nos últimos 30 dias; quantidade repetida no mesmo pedido conta como um pedido.
- [ ] Consultar custos reais cadastrados por produto/variante e os gastos gerais e específicos ativos da loja; reutilizar o lucro mínimo e o percentual de repasse da aba de preço. Se faltar algum custo necessário, não inventar valor nem liberar aprovação de um combo precificado.
- [ ] Sugerir 5% de desconto sobre a soma dos preços individuais, desde que o preço de combo ainda preserve o lucro mínimo configurado; se a conta não fechar, não apresentar preço como viável.
- [ ] Só depois de o administrador aprovar, criar no catálogo um produto combo idempotente com os itens que compõem o combo e o preço recalculado usando os custos e despesas atuais; marcar a sugestão como aplicada somente após a criação confirmar sucesso.
- [ ] Ativar `auto_combo_suggestion` em todas as lojas ativas que registram vendas próprias. Não ativar para lojas afiliadas que não têm pedidos próprios para detectar co-compras.

## Produtos de maior saída no topo da vitrine
- [ ] A cada execução horária da automação, ranquear os 5 produtos com maior quantidade vendida nos últimos 30 dias nas lojas de checkout próprio e colocá-los automaticamente no topo, sem criar pedido de aprovação.
- [ ] Nas lojas afiliadas, usar os cliques rastreados de produto como sinal disponível, sem apresentá-los como vendas.
- [ ] Limpar o rank anterior dos produtos que saírem do top 5, preservar a ordenação normal para os demais e fazer a vitrine pública respeitar o ranking em todas as páginas/filtros.
- [ ] Ativar `auto_reorder_catalog` para todas as lojas ativas, inclusive afiliadas.

## Reconciliação do Mercado Pago e honestidade da caixa de sugestões
- [ ] Usar o campo existente `tenants.mercadopago_token` para obter o token da reconciliação MP; erro na consulta de lojas/pagamentos/gravação deve ser reportado como falha, nunca como execução bem-sucedida.
- [ ] Se o operador clicar em aprovação e a ação não puder ser executada, manter a sugestão pendente e apresentar erro. Sugestões que só pedem reconhecimento não podem alegar que executaram uma alteração comercial.

## Limites explícitos desta rodada
- [ ] Manter os valores atuais de todas as automações diferentes de combos e ranking; não habilitar automações em massa fora das duas solicitadas.
- [x] Deixar os webhooks de pagamento Pix/cartão fora da rodada: não mudar o comportamento que move pedidos entre `Recebido` e `Preparando`.
