// Editor IA do código — Super Admin (V2 — agêntico)
//
// Autenticação: JWT da sessão do Supabase + plataforma_roles = 'super_admin'
//
// POST /invoke    -> pede uma edição à IA (pipeline agêntica):
//   1. EXPLORAR: IA analisa a tree completa do repo e escolhe os arquivos
//      relevantes do pedido (nada de contexto fixo e raso).
//   2. LER: baixa os arquivos escolhidos (até 12, <=100KB cada).
//   3. EDITAR: gera o patch JSON com diff mínimo.
//   4. AUTOCORRIGIR: se o JSON for inválido ou o patch vazio, re-tenta até
//      2x com instrução de correção explícita.
//   body: { request: string, context_files?: string[], auto_context?: boolean }
//
// POST /apply     -> aplica o patch no GitHub com 4 camadas de fallback:
//   1) diff exato
//   2) diff tolerante por âncoras flexíveis (linha inicial + final + âncoras intermediárias)
//   3) força bruta local: substitui o maior bloco comum contíguo do "old" no arquivo (match de linhas normalizadas)
//   4) REBASE VIA IA: reenvia o hunk + conteúdo ATUAL do arquivo para a IA regenerar o diff
//      contra o código vigente, e tenta aplicar o novo diff. S贸 falha se a IA também não conseguir.
//   body: { id: string, force?: boolean }
//
// POST /notify-deploy -> marca o pedido como "pending_deploy" e dispara
//   o workflow de build+deploy via repository_dispatch do GitHub.
//   body: { id: string }
//
// GET  /history   -> lista pedidos recentes (com status de deploy).
//
// POST /revert    -> reverte um pedido aplicado (commit de reversão).

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// atob() puro quebra com multibyte; decodifica base64 → UTF-8 correto.
function decodeContent(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function encodeBase64(s: string): string {
  const enc = new TextEncoder();
  let bin = "";
  enc.encode(s).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

const GH_OWNER = "Tralhastm";
const GH_REPO = "smarthubly";

async function requireSuperAdmin(supabase: any, authHeader: string | null): Promise<string> {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("unauthorized");
  const token = authHeader.slice(7);
  const { data: session, error } = await supabase.auth.getUser(token);
  if (error || !session?.user) throw new Error("unauthorized");
  const { data: role, error: rErr } = await supabase
    .from("platform_roles")
    .select("role")
    .eq("user_id", session.user.id)
    .eq("role", "super_admin")
    .maybeSingle();
  if (rErr || !role) throw new Error("super_admin_required");
  return session.user.id;
}

function ghHeaders(pat: string, accept = "application/vnd.github+json") {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: accept,
    "User-Agent": "smarthubly-ai-editor",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function gh(url: string, pat: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: ghHeaders(pat),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as any)?.message || JSON.stringify(data).slice(0, 300);
    throw new Error(`github_api_error: ${res.status} ${msg}`);
  }
  return data;
}

/**
 * Etapa EXPLORAR V3.1 — usa o índice ESTRUTURAL (code-index) para escolher
 * os arquivos de contexto: busca semântica sobre símbolos/docs + análise de
 * impacto (dependências diretas e transitivas). Fallback para o método V2
 * (inventário plano via LLM) se o índice falhar.
 * Retorna lista { path }.
 */
async function aiChooseFilesV3(
  bridgeToken: string,
  request: string,
): Promise<string[]> {
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/code-index/explore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.chosen_files)
      ? data.chosen_files.filter((p: any) => typeof p === "string").slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

/**
 * Etapa EXPLORAR (V2 — inventário plano via LLM) — fallback do V3.1.
 * Retorna lista { path } ou vazio em caso de falha (graceful).
 */
async function aiChooseFiles(
  pat: string,
  authHeader: string,
  bridgeToken: string,
  request: string,
  allFiles: { path: string; size?: number }[],
): Promise<string[]> {
  const fileIndex = allFiles
    .filter((f) => f.path.startsWith("src/") && (f.path.endsWith(".tsx") || f.path.endsWith(".ts")))
    .map((f) => `  - ${f.path} (${f.size || "?"} bytes)`)
    .join("\n");

  const explorePrompt = `Você é um engenheiro sênior que precisa escolher quais arquivos do projeto SmartHubly devem ser lidos para atender ao pedido abaixo com precisão.
Retorne APENAS JSON: {"files": ["src/pages/X.tsx", ...]} — no máximo 12 arquivos.
Critérios: arquivos diretamente afetados pela mudança, componentes pai que os renderizam, hooks/lib com a lógica envolvida e tipos do Supabase se mexer em banco.
Evite: componentes de UI genéricos (src/components/ui/*), arquivos de teste, assets.

INVENTÁRIO COMPLETO DO REPO:\n${fileIndex}

PEDIDO: ${request}`;

  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/public-workers-bridge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bridge-token": bridgeToken,
        Authorization: authHeader,
      },
      body: JSON.stringify({ mode: "json", systemPrompt: "Responda apenas com JSON válido. Idioma: português brasileiro.", userPrompt: explorePrompt }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const parsed = data.data ?? data;
    const obj = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    return Array.isArray(obj?.files) ? obj.files.filter((p: any) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** Chama a IA para gerar o patch com os arquivos de contexto carregados. */
async function aiGeneratePatch(
  authHeader: string,
  bridgeToken: string,
  request: string,
  ctx: { path: string; content: string }[],
  feedback?: string,
): Promise<{ files: { path: string; old: string; new: string }[]; explanation: string }> {
  const systemPrompt = `Você é o "Editor IA" do SmartHubly — engenheiro sênior especialista em React 18 + Vite + TypeScript + TailwindCSS (shadcn/ui) + Supabase (JS client), deploy em Cloudflare Pages.

Formato de resposta — SOMENTE JSON válido:
{"files": [{"path": "src/...", "old": "trecho exato atual", "new": "trecho novo"}], "explanation": "resumo curto"}

Regras de código (obrigatórias):
1. Diffs MÍNIMOS e EXATOS: "old" deve ser um trecho real do arquivo de contexto, com linhas suficientes para localizar de forma única (3-8 linhas). Nunca invente trechos que não existem.
2. Cite apenas caminhos presentes no contexto ou conhecidos do projeto: src/pages/*, src/components/tenant/*, src/components/super-admin/*, src/hooks/*, src/lib/*, src/contexts/*, supabase/migrations/*, src/integrations/supabase/types.ts.
3. Nunca crie arquivos novos em src/components/ui/; reutilize componentes shadcn existentes (Button, Input, Textarea, Card, Dialog, Sheet, Badge, Tabs, Switch, Select, Label, toast de sonner).
4. Estilo do projeto: classes Tailwind, ícones de lucide-react, hooks @tanstack/react-query (useQuery/useMutation), supabase client de src/integrations/supabase/client.ts, toasts com "sonner" (toast.success/toast.error).
5. Banco de dados: mudanças estruturais vão em supabase/migrations/YYYYMMDDHHMMSS__descricao.sql (CREATE TABLE/ALTER com políticas RLS); consultas via supabase.from().
6. Multi-tenant: tabelas de loja usam tenant_id; sempre filtrar por tenant do usuário.
7. Português brasileiro nos textos visíveis. Sem emojis no código.
8. Se o pedido for vago, escolha a interpretação mais útil e explique na "explanation".`;

  const userPrompt =
    `PEDIDO DO USUÁRIO (super admin):
${request}

${feedback ? `TENTATIVA ANTERIOR FALHOU COM O ERRO: ${feedback}\nCorrija e gere o patch novamente, garantindo que "old" exista literalmente nos arquivos abaixo.` : "CONTEXTO (conteúdo atual dos arquivos do projeto):"}

${ctx.map((c) => `=== ARQUIVO: ${c.path} ===\n${c.content}`).join("\n\n") || "(nenhum contexto)"}`;

  const res = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/public-workers-bridge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bridge-token": bridgeToken,
      Authorization: authHeader,
    },
    body: JSON.stringify({ mode: "json", systemPrompt, userPrompt }),
  });
  if (!res.ok) throw new Error(`ai_bridge_failed: ${res.status}`);
  const raw = await res.json();
  let data: any = raw.data ?? raw;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { throw new Error("ai_invalid_json"); }
  }
  if (!data || typeof data !== "object") throw new Error("ai_invalid_json");
  const files = Array.isArray(data.files) ? data.files : [];
  return {
    files: files.filter(
      (f: any) =>
        f &&
        typeof f.path === "string" &&
        typeof f.old === "string" &&
        typeof f.new === "string" &&
        f.old.length > 0,
    ),
    explanation: typeof data.explanation === "string" ? data.explanation : "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const pat = Deno.env.get("GITHUB_PAT");
  if (!pat) return j({ error: "github_pat_missing" }, 500);
  const bridgeToken = Deno.env.get("WORKERS_BRIDGE_TOKEN") || "";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("FUNCTION_SERVICE_ROLE_KEY")!,
  );

  const authHeader = req.headers.get("authorization");
  let userId: string;
  try {
    userId = await requireSuperAdmin(supabase, authHeader);
  } catch (e: any) {
    return j({ error: e.message }, e.message === "super_admin_required" ? 403 : 401);
  }

  // Rebase via IA precisa do header de autorização original (ponte workers)
  const aiAuthHeader = authHeader || "";
  const url = new URL(req.url);
  let path = url.pathname.replace(/^\/functions\/v1\/ai-code-editor|^\/ai-code-editor/, "").replace(/\/$/, "") || "/invoke";
  if (!path.startsWith("/")) path = "/" + path;

  try {
    if (path === "/history") {
      const { data, error } = await supabase
        .from("ai_editor_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return j({ requests: data || [] });
    }

    if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);
    const body = await req.json().catch(() => ({}));

    if (path === "/invoke") {
      const { request, context_files = [], auto_context = true } = body;
      if (!request || typeof request !== "string") return j({ error: "request_required" }, 400);
      if (request.length > 4000) return j({ error: "request_too_long" }, 400);

      const bridgeToken = Deno.env.get("WORKERS_BRIDGE_TOKEN") || "";

      // 1. Tree completa do repo
      const tree = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/trees/main?recursive=1`, pat);
      const allFiles: { path: string; sha: string; size?: number }[] = (tree?.tree || [])
        .filter((f: any) => f.type === "blob" && f.path.startsWith("src/"))
        .map((f: any) => ({ path: f.path, sha: f.sha, size: f.size }));

      // 2. EXPLORAR V3.1 — índice estrutural + busca semântica (fallback: inventário plano V2 → lista manual)
      let chosenPaths: string[] = [];
      if (auto_context) {
        chosenPaths = await aiChooseFilesV3(bridgeToken, request);
        if (chosenPaths.length === 0) {
          chosenPaths = await aiChooseFiles(pat, authHeader!, bridgeToken, request, allFiles);
        }
      }
      if (chosenPaths.length === 0 && Array.isArray(context_files)) {
        chosenPaths = context_files.slice(0, 12);
      }

      // 3. LER — baixa os arquivos (<=100KB cada)
      const ctx: { path: string; content: string }[] = [];
      for (const p of chosenPaths.slice(0, 12)) {
        const match = allFiles.find((f) => f.path === p);
        if (!match) continue;
        try {
          const blob = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/blobs/${match.sha}`, pat);
          const content = decodeContent(blob.content);
          if (content.length <= 100 * 1024) ctx.push({ path: p, content });
        } catch { /* ignora arquivo ilegível */ }
      }
      if (ctx.length === 0) return j({ error: "no_context_loaded" }, 502);

      // 4. EDITAR — gera o patch com loop de autocorreção (até 2 tentativas)
      let lastError = "";
      let result: { files: { path: string; old: string; new: string }[]; explanation: string } = { files: [], explanation: "" };
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          result = await aiGeneratePatch(authHeader!, bridgeToken, request, ctx, lastError || undefined);
          if (result.files.length > 0) break;
          lastError = lastError || "patch vazio — gere pelo menos um diff válido";
        } catch (e: any) {
          lastError = String(e?.message || e);
        }
      }

      if (result.files.length === 0) {
        return j({ error: "ai_no_patch", explanation: result.explanation || lastError || "A IA não gerou um patch válido após as tentativas." }, 502);
      }

      // 5. Valida caminhos permitidos
      for (const f of result.files) {
        if (!f.path.startsWith("src/") && !f.path.startsWith("supabase/")) {
          return j({ error: `path_not_allowed: ${f.path}` }, 400);
        }
        // Migrações só em supabase/migrations/
        if (f.path.startsWith("supabase/") && !f.path.startsWith("supabase/migrations/")) {
          return j({ error: `path_not_allowed: ${f.path}` }, 400);
        }
      }

      // 6. Salva o pedido
      const { data: row, error } = await supabase
        .from("ai_editor_requests")
        .insert({
          user_id: userId,
          request,
          patch: JSON.stringify(result.files),
          explanation: result.explanation || null,
          status: "pending_apply",
          context_files: JSON.stringify(ctx.map((c) => c.path)),
        })
        .select()
        .single();
      if (error) throw error;

      return j({
        ok: true,
        id: row.id,
        patch: result.files,
        explanation: result.explanation,
        context_files: ctx.map((c) => c.path),
        pending_apply: true,
      });
    }

    if (path === "/apply") {
      const { id, force } = body; // force mantém compat, mas agora o pipeline tenta todas as camadas sozinho
      if (!id) return j({ error: "id_required" }, 400);
      const { data: row, error: getErr } = await supabase
        .from("ai_editor_requests").select("*").eq("id", id).single();
      if (getErr || !row) return j({ error: "request_not_found" }, 404);
      if (row.status === "applied") return j({ ok: true, already: true, commit_sha: row.commit_sha });
      if (row.status !== "pending_apply") return j({ error: `invalid_status: ${row.status}` }, 409);

      const patch: { path: string; old: string; new: string }[] = JSON.parse(row.patch);

      // Baixa a tree do main
      const tree = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/trees/main?recursive=1`, pat);
      const blobs: { path: string; sha: string }[] = tree.tree.filter((f: any) => f.type === "blob");
      const newTree: { path: string; mode: string; type: "blob"; sha: string }[] = blobs.map((f: any) => ({
        path: f.path, mode: (f as any).mode || "100644", type: "blob", sha: f.sha,
      }));

      const failedPatches: string[] = [];

      for (const p of patch) {
        let existing = newTree.find((t) => t.path === p.path);
        let content = "";
        if (existing) {
          const blob = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/blobs/${existing.sha}`, pat);
          content = decodeContent(blob.content);
        }

        // Estratégia 1: diff exato
        let idx = content.indexOf(p.old);
        if (idx === -1) {
          // Estratégia 2: diff tolerante — busca por âncoras
          // Pega as primeiras N linhas do "old" e as últimas M linhas e procura
          // um trecho do arquivo que contenha ambas (com conteúdo qualquer entre elas).
          const anchorTry = tolerantMatch(content, p.old);
          if (anchorTry !== null) {
            idx = anchorTry;
          }
        }
        if (idx === -1) {
          // Estratégia 3: força bruta local — maior bloco comum contíguo
          const forced = forceApplyLocal(content, p.old);
          if (forced !== null) {
            idx = forced.offset;
            p.old = forced.matched; // substitui pelo trecho REAL que foi achado
          }
        }
        if (idx === -1 && existing) {
          // Estratégia 4: REBASE VIA IA — a IA regenera o diff contra o conteúdo ATUAL do arquivo
          try {
            const rebased = await aiRebaseHunk(aiAuthHeader, bridgeToken, p, content, row.request);
            if (rebased) {
              p.old = rebased.old;
              p.new = rebased.new;
              idx = content.indexOf(p.old);
              if (idx === -1) {
                const anchorTry = tolerantMatch(content, p.old);
                if (anchorTry !== null) idx = anchorTry;
                else {
                  const forced = forceApplyLocal(content, p.old);
                  if (forced !== null) {
                    idx = forced.offset;
                    p.old = forced.matched;
                  }
                }
              }
            }
          } catch (e: any) {
            console.warn("[ai-code-editor] rebase falhou:", String(e?.message || e));
          }
          if (idx === -1) {
            failedPatches.push(p.path);
            continue;
          }
        }

        content = content.slice(0, idx) + p.new + content.slice(idx + p.old.length);

        const blob = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/blobs`, pat, "POST", {
          content: encodeBase64(content),
          encoding: "base64",
        });
        if (existing) {
          existing.sha = blob.sha;
        } else {
          newTree.push({ path: p.path, mode: "100644", type: "blob", sha: blob.sha });
        }
      }

      if (failedPatches.length > 0) {
        return j({
          error: "patch_partial",
          failed_files: failedPatches,
          message: "Alguns diffs não casaram com o código atual (o arquivo pode ter mudado depois da geração). Regere o pedido ou aplique com force=true.",
        }, 422);
      }

      // Commit no main
      const baseSha = await gh(`/repos/${GH_OWNER}/${GH_REPO}/commits/main`, pat);
      const treeData = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/trees`, pat, "POST", { tree: newTree });
      const commit = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/commits`, pat, "POST", {
        message: `Editor IA: ${row.request.slice(0, 80)} (pedido ${row.id})`,
        tree: treeData.sha,
        parents: [baseSha.sha],
      });
      await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/refs/heads/main`, pat, "PATCH", { sha: commit.sha });

      await supabase
        .from("ai_editor_requests")
        .update({ status: "applied", commit_sha: commit.sha, applied_at: new Date().toISOString() })
        .eq("id", id);

      return j({ ok: true, id, commit_sha: commit.sha, applied: true });
    }

    if (path === "/notify-deploy") {
      const { id } = body;
      if (!id) return j({ error: "id_required" }, 400);
      const { data: row, error: getErr } = await supabase
        .from("ai_editor_requests").select("*").eq("id", id).single();
      if (getErr || !row) return j({ error: "request_not_found" }, 404);
      if (!row.commit_sha) return j({ error: "not_applied" }, 409);

      // Dispara o workflow do GitHub (build + deploy CF Pages) via repository_dispatch
      try {
        await gh(`/repos/${GH_OWNER}/${GH_REPO}/dispatches`, pat, "POST", {
          event_type: "smarthubly-deploy",
          client_payload: { request_id: id, commit_sha: row.commit_sha },
        });
      } catch (e: any) {
        // dispatch pode falhar se o workflow não existir; não bloqueia
        console.warn("[ai-code-editor] dispatch falhou:", e?.message);
      }

      await supabase
        .from("ai_editor_requests")
        .update({ status: "pending_deploy", deploy_requested_at: new Date().toISOString() })
        .eq("id", id);

      return j({ ok: true, id, message: "Deploy solicitado. O workflow de build + publicação no ar foi acionado (pode levar alguns minutos)." });
    }

    if (path === "/revert") {
      const { id } = body;
      if (!id) return j({ error: "id_required" }, 400);
      const { data: row, error: getErr } = await supabase
        .from("ai_editor_requests").select("*").eq("id", id).single();
      if (getErr || !row) return j({ error: "request_not_found" }, 404);
      if (!row.commit_sha) return j({ error: "not_applied" }, 409);

      const patch: { path: string; old: string; new: string }[] = JSON.parse(row.patch);
      const tree = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/trees/main?recursive=1`, pat);
      const blobs: { path: string; sha: string }[] = tree.tree.filter((f: any) => f.type === "blob");
      const newTree: { path: string; mode: string; type: "blob"; sha: string }[] = blobs.map((f: any) => ({
        path: f.path, mode: (f as any).mode || "100644", type: "blob", sha: f.sha,
      }));

      const failed: string[] = [];
      for (const p of patch) {
        const existing = newTree.find((t) => t.path === p.path);
        if (!existing) continue;
        const blob = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/blobs/${existing.sha}`, pat);
        let content = decodeContent(blob.content);
        // Tenta reverter pelo "new"; fallback tolerante
        let idx = content.indexOf(p.new);
        if (idx === -1) idx = tolerantMatch(content, p.new) ?? -1;
        if (idx === -1) { failed.push(p.path); continue; }
        content = content.slice(0, idx) + p.old + content.slice(idx + p.new.length);
        const blobNew = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/blobs`, pat, "POST", {
          content: encodeBase64(content), encoding: "base64",
        });
        existing.sha = blobNew.sha;
      }

      if (failed.length > 0) {
        return j({ error: "revert_partial", failed_files: failed }, 422);
      }

      const baseSha = await gh(`/repos/${GH_OWNER}/${GH_REPO}/commits/main`, pat);
      const treeData = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/trees`, pat, "POST", { tree: newTree });
      const commit = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/commits`, pat, "POST", {
        message: `Editor IA: reverter pedido ${row.id} — ${row.request.slice(0, 60)}`,
        tree: treeData.sha,
        parents: [baseSha.sha],
      });
      await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/refs/heads/main`, pat, "PATCH", { sha: commit.sha });

      await supabase
        .from("ai_editor_requests")
        .update({ status: "reverted", reverted_at: new Date().toISOString() })
        .eq("id", id);

      return j({ ok: true, id, commit_sha: commit.sha, reverted: true });
    }

    return j({ error: "unknown_path" }, 404);
  } catch (e: any) {
    console.error("[ai-code-editor] erro:", e);
    return j({ error: String(e?.message || e) }, 500);
  }
});

/**
 * Força local: encontra o maior bloco contíguo de linhas do "old" que existe
 * no arquivo (comparação com espaços normalizados) e devolve o offset e o trecho
 * real casado. Exige pelo menos 60% de cobertura do bloco original — abaixo disso
 * o hunk é provavelmente outra coisa e retorna null (segurança).
 */
function forceApplyLocal(content: string, old: string): { offset: number; matched: string } | null {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const oldLines = old.split("\n").map(norm);
  const nonEmptyIdxs = oldLines.map((l, i) => ({ l, i })).filter((x) => x.l.length > 0);
  const contLines = content.split("\n");
  const contNorm = contLines.map(norm);
  if (nonEmptyIdxs.length === 0) return null;

  // Match de SUBSEQUÊNCIA (ordem preservada, tolera linhas alteradas depois):
  // cada linha não-vazia do old é procurada no arquivo a partir da última posição;
  // linhas que não existem mais são puladas (máx 40% de falha), o resto continua.
  const matched: { oldIdx: number; contIdx: number }[] = [];
  let searchFrom = 0;
  for (const { l, i } of nonEmptyIdxs) {
    let found = -1;
    for (let ci = searchFrom; ci < contNorm.length; ci += 1) {
      if (contNorm[ci] === l) { found = ci; break; }
    }
    if (found === -1) continue; // pula linha alterada/deletada depois da geração
    if (found < searchFrom && matched.length > 0) continue;
    matched.push({ oldIdx: i, contIdx: found });
    searchFrom = found + 1;
  }

  const nonEmpty = nonEmptyIdxs.length;
  // cobre pelo menos 60% das linhas não-vazias do old e tem 2+ linhas
  if (matched.length < 2 || matched.length < nonEmpty * 0.6) return null;
  // segurança: a distância média entre matches no content não pode ser gigante
  let totalGap = 0;
  for (let i = 1; i < matched.length; i += 1) totalGap += matched[i].contIdx - matched[i - 1].contIdx;
  if (totalGap > nonEmpty * 40) return null;

  const startLine = matched[0].contIdx;
  const endLine = matched[matched.length - 1].contIdx;

  let offset = 0;
  for (let n = 0; n < startLine; n += 1) offset += contLines[n].length + 1;
  let endOffset = offset;
  for (let n = startLine; n <= endLine; n += 1) endOffset += contLines[n].length + 1;
  return { offset, matched: content.slice(offset, endOffset) };
}

/**
 * Rebase via IA: a IA recebe o hunk original (old/new), o conteúdo ATUAL do
 * arquivo no GitHub e o pedido original; regenera o diff já adaptado ao código
 * vigente (2 tentativas). Retorna { old, new } ou null.
 */
async function aiRebaseHunk(
  authHeader: string,
  bridgeToken: string,
  hunk: { path: string; old: string; new: string },
  currentContent: string,
  request: string,
): Promise<{ old: string; new: string } | null> {
  if (!currentContent) return null;
  const systemPrompt = `Você é engenheiro sênior. Recebeu um patch (old → new) que NÃO casou com o arquivo atual porque o código foi alterado depois da geração. Sua tarefa: REGENERAR o "old" e o "new" para que o "old" exista LITERALMENTE no conteúdo atual do arquivo e o "new" aplique a mesma intenção da mudança original.
Responda APENAS JSON: {"old": "trecho exato atual do arquivo", "new": "trecho novo"}.
Regras: "old" deve ser copiado literalmente do conteúdo atual (3-8 linhas, único ponto de ocorrência); "new" mantém a intenção da mudança original; português brasileiro nos textos visíveis.`;
  const userPrompt = `PEDIDO ORIGINAL DO USUÁRIO:
${request}

=== ARQUIVO ATUAL (${hunk.path}) ===
${currentContent}

=== HUNK ORIGINAL (GERADO CONTRA VERSÃO ANTIGA — NÃO EXISTE MAIS NO ARQUIVO) ===
old:
${hunk.old}

new:
${hunk.new}

Regenere o hunk adaptado ao conteúdo atual.`;
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/public-workers-bridge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bridge-token": bridgeToken,
      Authorization: authHeader,
    },
    body: JSON.stringify({ mode: "json", systemPrompt, userPrompt }),
  });
  if (!res.ok) throw new Error(`ai_rebase_failed: ${res.status}`);
  const raw = await res.json();
  let data: any = raw.data ?? raw;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { throw new Error("ai_rebase_invalid_json"); }
  }
  const old = typeof data?.old === "string" ? data.old : "";
  const newStr = typeof data?.new === "string" ? data.new : "";
  if (!old || !newStr || !currentContent.includes(old)) {
    throw new Error("ai_rebase_no_literal_match");
  }
  return { old, new: newStr };
}

/**
 * Diff tolerante: acha o intervalo no arquivo que começa com o primeiro
 * trecho de "old" e termina com o último trecho, casando as linhas-âncora
 * (primeira e última linha do old, com espaços normalizados).
 * Retorna o índice de início do trecho substituído ou null.
 */
function tolerantMatch(content: string, old: string): number | null {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const lines = old.split("\n").map(norm).filter((l) => l.length > 0);
  if (lines.length < 2) return null;
  const head = lines[0];
  const tail = lines[lines.length - 1];
  const contentNorm = content.split("\n").map(norm);

  for (let i = 0; i < contentNorm.length; i += 1) {
    if (contentNorm[i] !== head) continue;
    for (let k = contentNorm.length - 1; k > i + 1; k -= 1) {
      if (contentNorm[k] !== tail) continue;
      // Verifica que as âncoras intermediárias também aparecem na ordem
      let ok = true;
      let lastSeen = i;
      for (const anchor of lines.slice(1, -1)) {
        let found = -1;
        for (let m = lastSeen + 1; m < k; m += 1) {
          if (contentNorm[m] === anchor) { found = m; break; }
        }
        if (found === -1) { ok = false; break; }
        lastSeen = found;
      }
      if (ok) {
        // Calcula o byte offset do início da linha i no conteúdo original
        let offset = 0;
        for (let n = 0; n < i; n += 1) offset += content.split("\n")[n].length + 1;
        // Fim: fim da linha k
        let endOffset = offset;
        const origLines = content.split("\n");
        for (let n = i; n <= k; n += 1) endOffset += origLines[n].length + 1;
        return endOffset; // usaremos slice(0, offset) + new + slice(endOffset) — ajuste fora
      }
    }
  }
  return null;
}
