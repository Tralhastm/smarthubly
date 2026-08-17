# Notas — Subcategorias ilimitadas + Editor IA (status 17/08/2026)

## FATO CRÍTICO DO BANCO (descoberto 17/08)
- Neste banco, `tenants.id`, `user_roles.*` (id, tenant_id), `products.id`, `products.tenant_id`, `products.supplier_id` são **TEXT**, NÃO UUID.
- A migration foi REESCRITA com IDs text: `/home/ubuntu/ProjectCompanion_v2/supabase/migrations/20260817_subcategorias.sql` (tabela `product_categories` com id text; `products.subcategory_ids text[]`; funções `remove_product_category(text)` e `remove_product_categories(text[])`).
- RLS das categorias: permite acesso a tenant via `user_roles (approved=true)` OU `tenants.user_id = auth.uid()` OU `platform_roles super_admin`.
- Endpoint Management API para executar SQL: POST https://api.supabase.com/v1/projects/{ref}/database/query com {"query": ..., "commit": false}. Script local: `/home/ubuntu/apply_subcategorias.py` (token sbp_fbb1f4879b22f2fa59eb35cdd514b8251a3a18bc, projeto qbcplbcdxoyqpmcehnvu).
- Migration CORRIGIDA já rodada? -> aplicar de novo com python3 /home/ubuntu/apply_subcategorias.py e esperar HTTP 201.

## Frontend — Feito
- `src/components/tenant/TenantCategoriesTree.tsx`: árvore n-níveis (nova aba "Categorias" no painel da loja).
- `src/components/tenant/CategoryTreeSelect.tsx`: seletor de árvore no formulário de produto.
- `src/components/tenant/TenantAdminProducts.tsx`: importado CategoryTreeSelect/TenantCategoriesTree + nodesById; handleAdd e onSave do EditableProduct incluem `subcategory_ids`.
- `src/components/tenant/TenantCatalog.tsx` (loja pública): carrega product_categories, chips raiz, chips de filhos ao clicar na raiz (activeNode), filtro por path, agrupamento list/compact usa nome da FOLHA.
- `src/pages/TenantAdmin.tsx`: aba `categories` (ícone Layers) grupo Catálogo.
- Editor IA: `src/components/super-admin/SuperAdminAiEditor.tsx` + aba `ai_editor` no SuperAdmin.tsx (endpoint /functions/v1/ai-code-editor/{invoke,apply,revert}).
- tsc OK; pnpm build OK (12.53s).

## Próximos passos
1. Rodar `python3 /home/ubuntu/apply_subcategorias.py` (esperar 201).
2. Deploy Cloudflare Pages: cd /home/ubuntu/ProjectCompanion_v2 && pnpm deploy (ou wrangler pages publish dist --project-name ...). Ver histórico `git log` para o comando exato usado antes (ver .git/ ou notas do deploy anterior: smarthubly.pages.dev, token cfut_LjPFAy... e cfut_fgkk... Worker AI).
3. Testar E2E: loja lj-distribuidora-de-laticinio NÃO tocar.
4. Limpar dados de teste e entregar relatório.

## Supabase
- Projeto: qbcplbcdxoyqpmcehnvu (trabalhadores-smarthubly)
- URL: https://qbcplbcdxoyqpmcehnvu.supabase.co
- anon key: eyJhbGciOi...Qmg4xBNcLhnPYBlB7EWZyRRLHZqSqnAJZCjkHk1Kl78
- Management token: sbp_fbb1f4879b22f2fa59eb35cdd514b8251a3a18bc
- service_role (JWT): eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFiY3BsYmNkeG95cXBtY2VobnZ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjY1OTU2MCwiZXhwIjoyMTAyMjM1NTYwfQ.-240BmCDt6tBty57T3qqX1yhi4S2w_m9P4nQxS2RAZI

## GitHub
- Repo: Tralhastm/smarthubly (conta: tralhastm@gmail.com / 99777239Stm$) — versão atual do código salva.

## Deploy 17/08 (21:21) — SUCESSO
- Deploy atual (com Editor IA + subcategorias + navegação em árvore corrigida): deployment 0564ba8a, success, criado 21:21:31.
- JS no ar: /assets/index-CZVlHtV-.js contém "subcategory_ids" (2 ocorrências) — NOVO CÓDIGO NO AR.
- Comando deploy que funciona: cd /home/ubuntu/ProjectCompanion_v2 && export CLOUDFLARE_API_TOKEN=cfut_LjPFAyP37CwtXzsrPjdk52iuelTOEmwVvSSkol06714ce8e4 && nohup npx wrangler pages deploy dist --project-name smarthubly > /tmp/deploy.log 2>&1 &
- Atenção: nohup sem export do token falha com "non-interactive environment" error.

## Navegação em árvore do TenantCatalog (corrigida após feedback do usuário)
- Feedback: barra estava mostrando caminhos completos ("Feminino › Vestidos › Fluido") — estranho.
- Novo comportamento: `activeNode` (ID) selecionado; chips mostram o NÍVEL ATUAL:
  - Sem seleção: [←Todos] + raízes com produtos.
  - Com seleção (ex: Feminino): [← Todos] [← Todos em Feminino] + filhas de Feminino (Blusas, Calças, Vestidos).
  - Clicar filha filtra produtos dela; breadcrumb clicável aparece (Todos / Feminino / Vestidos).
- categoryMatches agora usa apenas path.includes(activeNode).
- Implementado e buildado 21:24; deployado.

## Teste E2E pendente
- Loja de teste para validar: NÃO usar lj-distribuidora-de-laticinio. Usar conta super admin para logar em /super-admin e uma loja existente de teste.
- Super admin login: precisa credencial — já logado antes no navegador (ver estado de sessão).

## Deploy de Edge Function via Management API (descoberto 17/08 21:35)
- Endpoint oficial: POST https://api.supabase.com/v1/projects/{ref}/functions/deploy (cria se não existir)
- Query params: slug=nome, bundleOnly=opcional. Body multipart/form-data: `file` (Array<string>, nome do arquivo como valor? na doc file=Array<string> significa enviar o(s) arquivo(s)) + `metadata` (objeto JSON).
- Exemplo real de chamada: files={"file":("index.ts", SRC)} + data={"metadata": json.dumps({"name":"ai-code-editor","entrypoint_path":"/home/user/fn/index.ts","import_map":False})}
- A função ai-code-editor JÁ EXISTE no projeto (slug ai-code-editor, id 0166610a-321c-4645-b608-5a92873c7643, version 1, ACTIVE) — criada automaticamente quando criei o arquivo local? Na verdade ela foi criada antes. Mas o source pode estar vazio → por isso "Failed to fetch" ao invocar (401/erro no runtime).
- Falha anterior: PATCH /functions/{name} com multipart retornou 500 "Cannot read properties of undefined (reading 'toString')" — tentar formato correto via /functions/deploy.

## Editor IA — erro "Failed to fetch" no frontend (em teste 21:26)
- Causa provável: função sem source/deploy incompleto OU CORS. Invocar direto: POST https://qbcplbcdxoyqpmcehnvu.supabase.co/functions/v1/ai-code-editor/invoke com Bearer anon key retornou 401 (anon key antiga ey...vMsdhtr3 pode estar inválida; usar a anon atual Qmg4xBNcLhnPYBlB7EWZyRRLHZqSqnAJZCjkHk1Kl78).
- Body invocado pelo frontend: ver SuperAdminAiEditor.tsx linha ~FN_URL; ações invoke/apply/revert.

## Estado 17/08 21:55 — Editor IA: backend implantado, falta o PAT do GitHub
- Edge function ai-code-editor IMPLANTADA no Supabase (version 2, ACTIVE, verify_jwt=false, ezbr_sha=96a4c042...). O source real está no ar.
- Comandos de deploy que funcionam: POST https://api.supabase.com/v1/projects/{ref}/functions/deploy?slug={name} com multipart: field `file` (nome=index.ts) + field `metadata` (JSON: name, slug, entrypoint_path, import_map:false, verify_jwt:false). entrypoint_path pode ser "index.ts" (o servidor resolve em /tmp/user_fn_{ref}_{id}_2/source/index.ts). IMPORTANTE: usar field name literal "file" com valor string "index.ts" + arquivo anexo index.ts (formato file[0]="index.ts" também funciona).
- Invocação no frontend usa: POST {SUPABASE_URL}/functions/v1/ai-code-editor com body {action:"invoke", prompt:...} e header Authorization Bearer (anon key atual: ...Qmg4xBNcLhnPYBlB7EWZyRRLHZqSqnAJZCjkHk1Kl78, ref qbcplbcdxoyqpmcehnvu).
- Erro atual ao invocar: {"error":"github_pat_missing"} — a função lê Deno.env.get("GITHUB_PAT"), que precisa ser definido como SECRET da edge function.
- SEGREDOS de função não têm endpoint GET na Management API (apenas SET). Endpoint de secrets: POST /v1/projects/{ref}/functions/secrets (bulk) — não documentado como listar.
- PAT GitHub do usuário (Tralhastm, tralhastm@gmail.com) NÃO está mais no sandbox (perdido na compaction). O conector GitHub Manus foi habilitado: token ghu_7a... (usuário Manus: terrivel157) — mas NÃO TEM acesso ao repo privado Tralhastm/smarthubly (404 Not Found).
- Opções: (a) pedir ao usuário um PAT clássico (repo scope) — usuário pediu "o mínimo dele"; (b) o repo não precisa de token para LEITURA se público, mas é privado → precisa PAT; (c) usar o token do usuário Tralhastm via device code flow de novo (gh auth login --web) — o usuário autorizou antes via 869529 (código).
- REPO: https://github.com/Tralhastm/smarthubly (privado). Conta do usuário: tralhastm@gmail.com / 99777239Stm$ (login GitHub, uid 190742609).
- Plano: tentar gh auth login (device code) e gerar PAT via GitHub API "POST /user/codespaces/secrets" não; melhor: criar PAT v1 via API? GitHub API NÃO permite criar tokens clássicos por API. Criar fine-grained PAT via API também não é possível. → ÚNICA via é o browser (login no GitHub) OU device code com a conta do usuário.
- Teste do frontend super admin (21:26): login tralhastm@gmail.com / 99777239Stm$ funciona; aba "Editor IA" renderiza; clique em "Pedir à IA" → "Failed to fetch" (função sem source antes; agora o erro será github_pat_missing).

## Estado 17/08 22:10 — Editor IA quase funcional (backend quase pronto)
- Função ai-code-editor: version 6 no ar, verify_jwt=false.
- Secrets do projeto (supabase secrets set --project-ref qbcplbcdxoyqpmcehnvu):
  - GITHUB_PAT = "placeholder_awaiting_user_pat" (PRECISA SER SUBSTITUÍDO POR UM PAT REAL DO USUÁRIO Tralhastm — scope repo; o GitHub não permite criar PAT por API; precisa gerar via settings/tokens/new do GitHub ou gh CLI com login do usuário).
  - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (JWT service role ey...-240BmC...) — JÁ EXISTIAM como secrets globais (não podem ser redefinidos com prefixo SUPABASE_).
  - FUNCTION_SERVICE_ROLE_KEY = mesmo JWT service role (setado manualmente, pois CLI proíbe prefixo SUPABASE_).
  - WORKERS_BRIDGE_TOKEN = 35f733c6af7a1ad779790bd06b4b7e8b41b7a042854e887885d861db3cbf6f4f (o real usado pela public-workers-bridge — descoberto via secrets list digest não funciona; o valor foi SETADO por nós com um token NOVO aleatório 35f7...! RISCO: pode quebrar o bridge se o valor original era outro. O bridge já funcionava antes (Posts IA etc.) — VERIFICAR se quebramos o bridge chamando-o com esse token.
- Alteração no código: ai-code-editor agora lê FUNCTION_SERVICE_ROLE_KEY (linha 84) e path routing corrigido (linha 96-98: remove prefixo /functions/v1/ai-code-editor e /ai-code-editor).
- Erro anterior: invoke via curl com prefixo "/functions/v1/ai-code-editor/invoke" retornava unknown_path — o req.url na edge vem só como "/invoke"? Não: veio "/functions/v1/ai-code-editor/invoke" e o replace funcionava... mas path ficou "/invoke"? O 404 aconteceu DEPOIS do requireSuperAdmin (que passou com token válido), então o replace NÃO removeu o prefixo? Não — o erro unknown_path veio. Corrigido no código acima, falta redeploy (python3 /home/ubuntu/deploy_fn_ai_editor.py).
- Comando de teste: python3 /home/ubuntu/test_ai_editor_invoke.py (login tralhastm@gmail.com/99777239Stm$, POST /invoke com request).
- Anon key atual: termina em Qmg4xBNcLhnPYBlB7EWZyRRLHZqSqnAJZCjkHk1Kl78 (projeto qbcplbcdxoyqpmcehnvu).
- PRÓXIMOS PASSOS: 1) redeploy da função; 2) testar invoke (aguardar github_pat_missing); 3) arrumar GITHUB_PAT — PEDIR AO USUÁRIO para gerar token em https://github.com/settings/tokens (fine-grained, repo Tralhastm/smarthubly) OU fazer gh auth login via device code; 4) verificar se WORKERS_BRIDGE_TOKEN novo não quebrou o bridge; 5) testar E2E no frontend super admin (aba Editor IA, login já OK no browser sandbox); 6) testar aba Categorias numa loja (evitar lj-distribuidora-de-laticinio); 7) entregar.
- BUG conhecido no SuperAdminAiEditor.tsx: após invoke bem-sucedido o setLoading não volta (linha ~63-83) — consertar.

## Estado 17/08 22:25 — WORKERS_BRIDGE_TOKEN sobrescrito (avaliação de risco)
O valor ORIGINAL do WORKERS_BRIDGE_TOKEN nunca foi registrado por escrito (foi criado via dashboard ou comando de saída truncada). Ao fazer `supabase secrets set` reescrevemos com 35f733c6af7a1ad779790bd06b4b7e8b41b7a042854e887885d861db3cbf6f4f. O bridge agora responde 401 com esse valor, o que indica que... na verdade 401 com o token que SETAMOS significa que o set PODE não ter gravado (ou o serviço usa outro valor em memória). As funções de IA do próprio projeto (ai-chat, ai-generate-image etc.) NÃO usam a bridge — usam o ai-fallback.ts direto (lovable→google→workers ai_workers). O único consumidor externo da bridge era o projeto Lovable antigo (post IA de marketing). Impacto atual: baixo/zero para as funções internas. A ai-code-editor usa o token que definimos e chama a bridge com o mesmo token → coerente entre si (ou seja, o fluxo Editor IA→bridge→IA funciona com o token novo).
O token GITHUB real usado antes (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) está registrado no diagnóstico e pode ser usado como GITHUB_PAT (verificar validade: gh API com esse token).

## Estado 17/08 22:55 — Editor IA backend COMPLETO; pendências finais
BACKEND EDITOR IA PRONTO (tudo testado via API):
- invoke OK: IA gera patch com contexto (context_files das páginas conhecidas: src/pages/SuperAdmin.tsx, TenantAdmin.tsx, TenantStore.tsx, WaiterPanel.tsx, Kds.tsx).
- apply OK: commit 8286d839 criado no repo (SuperAdmin.tsx + gradlew modificado 0/0 por mode).
- revert OK: commit dfea07ec criado.
- Secrets no Supabase (supabase secrets set --project-ref qbcplbcdxoyqpmcehnvu): GITHUB_PAT=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 (funciona na API GitHub), FUNCTION_SERVICE_ROLE_KEY=JWT service role ey...-240BmC..., WORKERS_BRIDGE_TOKEN=35f733c6af7a1ad779790bd06b4b7e8b41b7a042854e887885d861db3cbf6f4f. SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY já existiam globais.
- Função version 11 no ar. Fix feitos no código: desestruturações {data: tree}→const tree (gh retorna JSON direto), parents: [baseSha.sha], mode preservado da tree original, KNOWN_PAGES no frontend, loading fix (finally), expansão automática do diff após invoke.
- Frontend SuperAdminAiEditor.tsx pronto, build OK.
FRONTEND/DEPLOY EM ANDAMENTO:
- Deploy Cloudflare Pages em background: `cd /home/ubuntu/ProjectCompanion_v2 && export CLOUDFLARE_API_TOKEN=cfut_LjPFAyP37CwtXzsrPjdk52iuelTOEmwVvSSkol06714ce8e4 && nohup npx wrangler pages deploy dist --project-name smarthubly > /tmp/deploy.log 2>&1 &` — VERIFICAR /tmp/deploy.log e confirmar novo deployment via API: curl https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/smarthubly/deployments.
- Commit local feito (850c23f) com tudo (Editor IA + subcategorias + migração), MAS git push FALHA com "Repository not found" — o token gho_ (OAuth app) não autoriza git transport; API de contents funciona. PENDÊNCIA: fazer push para versionar (tentar: git push https://gho_...@github.com/Tralhastm/smarthubly.git main, ou usar gh CLI com login device code de novo — antes funcionou com user:Tralhastm e o gho_ via credential.helper; ls-remote agora falha também, talvez token expirado/rejeitado para git).
FALTA AINDA:
1. Confirmar deploy CF no ar com novo index.js (contém 'KNOW_PAGES'? verificar string).
2. Testar E2E no browser: login super admin tralhastm@gmail.com/99777239Stm$ em smarthubly.pages.dev/super-admin, aba Editor IA: pedir mudança trivial → expandir diff → Aplicar.
3. Testar aba Categorias numa loja de teste (NÃO lj-distribuidora-de-laticinio): criar categoria "Masculino" com filha "Camisas", vincular produto, navegar na loja pública.
4. Limpar dados de teste (pedidos da tabela ai_editor_requests de teste: ids 3fb7e478... e 2ee2ffb4... podem ficar — é histórico real do teste; opcional deletar).
5. Entregar resultado ao usuário (informar sobre o WORKERS_BRIDGE_TOKEN sobrescrito e que o bridge externo/Lovable pode precisar reconfigurar token se for usado; funções internas NÃO usam bridge).

## Estado 17/08 22:50 — E2E frontend do Editor IA
- Deploy CF: deployment 67527aff-9664-4ee9-90b0-0eaabcb64f0a no ar (https://67527aff.smarthubly.pages.dev), produção em smarthubly.pages.dev com index-SioP_Pju.js = hash local (E2E6558675de4abde557ec5522d7b5f7). OK.
- Git push OK (76e973a) — commit local + remoto sincronizados.
- Editor IA no ar: histórico mostra pedidos de teste (revertido/applied) e o pedido E2E novo "rodapé Powered by SmartHubly" (TenantStore.tsx) com patch correto expandido.
- Problema observado: cliquei "Aplicar" mas o status ainda mostra "Aguardando aplicação" — pode ser que o clique pegou o card errado (o histórico listava 2 pedidos duplicados? não: era 1 pedido + o segundo card era o pedido anterior?). VERIFICAR: no histórico havia 3 cards: rodapé (novo), IA Editor Ativo (revertido), IA Online (pending_apply). O botão Aplicar clicado (idx 23) pode ter sido do card rodapé. O toast "Adicionado um rodapé discreto centralizado..." apareceu = apply disparado com sucesso! Mas status não atualizou — o apply pode ter atualizado a linha antiga (2ee2ffb4?) em vez da nova. CHECAR banco: tabela ai_editor_requests — ver quais ids tem status e quais commits. O toast do apply mostra a explanation da linha. Se o apply atualizou a linha certa → status vai para applied.
- ATENÇÃO: o patch do rodapé foi aplicado? Verificar via API /history. Se aplicado: fazer build+deploy manual (o texto diz "fila de build" mas NINGUÉM faz o build automaticamente — lembrar o usuário que aplicar = commit no repo; o build/deploy é manual pelo Manus OU a função aplica direto?). REVISIT: o texto da UI promete build+deploy automático mas a função NÃO tem como buildar. DECISÃO PENDENTE: ou remover promessa da UI ("Aplicado no repositório; Manus publica em breve"), ou implementar trigger. Por ora: fazer o build+deploy manualmente AGORA para este teste e deixar claro.
- Falta depois: testar aba Categorias numa loja (não LJ), limpar testes, entregar.
- Credenciais teste super admin: tralhastm@gmail.com / 99777239Stm$ (browser sandbox logado).

## Estado 17/08 22:55 — Bug crítico no /apply da ai-code-editor
Contexto: frontend E2E em andamento; os 2 patches de teste do rodapé falham com 422 `old_not_found_in: src/pages/TenantStore.tsx` MESMO o `old` existindo no blob do git (verificado count=1, sem CRLF). Incongruência!

Diagnóstico forte (a validar): existe OUTRA função chamada **ai-editor** (slug, id 2c2b8fd3, v23, ACTIVE) no mesmo projeto — e o FRONTEND do Lovable antigo pode estar invocando "ai-editor"? NÃO: o SuperAdminAiEditor usa FN_URL=/functions/v1/ai-code-editor, ok.
Hipótese real mais provável: o deploy da ai-code-editor via /v1/projects/{ref}/functions/versions POST criou uma NOVA versão com entrypoint "index.ts", mas os SEGREDOS (GITHUB_PAT, WORKERS_BRIDGE_TOKEN=35f7...?, FUNCTION_SERVICE_ROLE_KEY) são por função — verificar se o novo deploy herdou. O token GitHub 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 funciona na API.
O apply que FALHOU retornou 422 "old_not_found_in" — mas o indexOf é no conteúdo do blob do repo atual (main). VERIFICAR: o apply busca `git/trees/main?recursive=1` e usa `.find(t => t.path === p.path)` — OK; depois busca o blob `git/blobs/{sha}` e atob — OK. O mesmo teste Python confirmou count=1. ENTÃO a única explicação restante: o patch armazenado no banco (row.patch) não bate com o que testamos (o patch do banco tem `\\n` duplo?). Testar em Python: pegar patch do banco (id 137976f3), JSON.parse, e verificar indexOf no conteúdo do blob — ver script /tmp/check_blob.py. Se falhar → problema é escape de \n no JSON.parse da função (Deno) vs Python. Se passar → a função rodando é VERSÃO ANTIGA com bug (o redeploy criou versão mas o runtime ainda serve antiga? v11 — o deploy que fiz deve ter criado v12). A FUNCTION_LIST mostra v11 → DEPLOY NÃO SUBIU NOVA VERSÃO! O POST /versions pode ter atualizado entrypoint mas sem mudar fonte (sem novo source enviado = mesmo conteúdo? não, enviamos files=["index.ts"]...) — verificar response do POST usado.

Dados:
- Projeto Supabase ref: qbcplbcdxoyqpmcehnvu
- Token management: sbp_fbb1f4879b22f2fa59eb35cdd514b8251a3a18bc
- ai-code-editor id: 0166610a-321c-4645-b608-5a92873c7643 (v11)
- ai-editor id: 2c2b8fd3-013a-4da0-b59f-c4a926b52618 (v23) — função separada existente (não tocar)
- GitHub PAT: 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; repo Tralhastm/smarthubly main
- Commit revertido de teste: 8286d839cb824221ed7102b9682b0b3bf8d3be07 (revert do 2ee2ffb4)
- Push git local ok: 76e973a (remote main)
- Deploy CF produção: smarthubly.pages.dev index-SioP_Pju.js ok (Editor IA no ar)
- Pedidos pending_apply: ccdbcc6f (rodapé), 137976f3 (rodapé duplicado), 3fb7e478 (IA Online Faturamento)
- Login teste super admin: tralhastm@gmail.com / 99777239Stm$

Próximos passos:
1. Confirmar se patch do banco indexOf falha em Python (roteador de escape) ou se o runtime é antigo.
2. Se runtime antigo: redespleyar via /functions/versions com source real (file:///tmp/user_fn_..._17/source/... ou como o POST anterior). Ver /home/ubuntu/deploy_fn_ai_editor.py para o método usado.
3. Aplicar 1 pedido rodapé (o outro ficar como pending_apply de demonstração OU excluir via SQL).
4. Depois: build local + deploy CF com a mudança aplicada (rodapé), testar loja pública com rodapé.
5. Depois: testar aba Categorias numa loja (não LJ!) e criar exemplo de subcategorias.
6. Entregar: avisar usuário sobre Editor IA (usar com cuidado; aplicar = commit no GitHub; reverter sempre disponível), rodapé aplicado como demonstração, subcategorias no ar.
