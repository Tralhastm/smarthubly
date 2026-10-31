# Entregas

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
