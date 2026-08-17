// Editor IA do código — Super Admin
//
// Autenticação: JWT da sessão do Supabase + plataforma_roles = 'super_admin'
//
// POST /invoke   -> pede uma edição à IA, gera o patch e aplica no repo GitHub
//   body: { request: string, context_files?: string[] }
//   resp: { ok: boolean, id: string, patch: { path, old/new content }[], commit_sha?: string, applied: boolean, pending_apply?: boolean, error? }
//
// POST /apply    -> aplica um patch pendente (grava no GitHub como commit)
//   body: { id: string }
//
// GET  /history  -> lista pedidos recentes
//
// POST /revert   -> reverte um pedido aplicado (commit de reversão no GitHub)
//   body: { id: string }
//
// O deploy para o Cloudflare Pages continua automatizado pelo pipeline
// (o agente aplica build + deploy a partir do branch gerado).

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

// Decodifica o conteúdo de um blob do GitHub (base64) em texto UTF-8 correto.
// atob() puro gera string de bytes que quebra indexOf/replace com caracteres multibyte.
function decodeContent(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

const GH_OWNER = "Tralhastm";
const GH_REPO = "smarthubly";
const BRANCH_PREFIX = "ai/edit-";

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
    throw new Error(`github_api_error: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const pat = Deno.env.get("GITHUB_PAT");
  if (!pat) return j({ error: "github_pat_missing" }, 500);

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

  const url = new URL(req.url);
  let path = url.pathname.replace("/functions/v1/ai-code-editor", "").replace("/ai-code-editor", "").replace(/\/$/, "") || "/invoke";
  if (path.startsWith("/")) path = path;
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
      const { request, context_files = [] } = body;
      if (!request || typeof request !== "string") {
        return j({ error: "request_required" }, 400);
      }
      if (request.length > 4000) return j({ error: "request_too_long" }, 400);

      // Lê os arquivos de contexto do repo (main) para dar contexto à IA
      const tree = await gh(
        `/repos/${GH_OWNER}/${GH_REPO}/git/trees/main?recursive=1`,
        pat,
      );
      const allFiles: { path: string; sha: string; size?: number }[] = (tree?.tree || [])
        .filter((f: any) => f.type === "blob" && f.path.startsWith("src/"))
        .map((f: any) => ({ path: f.path, sha: f.sha, size: f.size }));

      // Carrega até 8 arquivos de contexto (<=120KB cada)
      const ctx: { path: string; content: string }[] = [];
      for (const p of context_files.slice(0, 8)) {
        const match = allFiles.find((f) => f.path === p);
        if (!match) continue;
        try {
          const blob = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/blobs/${match.sha}`, pat);
          const content = decodeContent(blob.content);
          if (content.length <= 120 * 1024) ctx.push({ path: p, content });
        } catch { /* ignora arquivo ilegível */ }
      }

      const systemPrompt = `Você é um engenheiro senior que edita o código-fonte do projeto SmartHubly (React + Vite + TypeScript + Tailwind + Supabase, deploy no Cloudflare Pages).
Regras:
- Responda SEMPRE em JSON: {"files": [{"path": "src/...", "old": "...", "new": "..."}], "explanation": "..."}
- Cada item de files é uma SUBSTITUIÇÃO: "old" é o trecho exato atual do arquivo, "new" é o trecho novo. Faça o menor diff possível por arquivo, com contexto suficiente para localizar.
- Nunca invente arquivos que não existem no contexto; cite apenas caminhos do contexto ou páginas conhecidas (src/pages/SuperAdmin.tsx, src/pages/WaiterPanel.tsx, src/pages/Kds.tsx, src/pages/TenantAdmin.tsx, src/pages/TableSession.tsx, src/pages/TenantStore.tsx, src/hooks/useOrders.ts, src/integrations/supabase/client.ts, src/components/shared/*).
- Mudanças em banco de dados devem ser enviadas como patch SQL em src/migrations/YYYYMMDDHHMMSS__descricao.sql (cabeçalho do arquivo SQL).
- Não use emojis. Idioma: português brasileiro.`;

      const userPrompt = `PEDIDO DO USUÁRIO (super admin):\n${request}\n\nCONTEXTO (conteúdo atual dos arquivos):\n${
        ctx.map((c) => `=== ARQUIVO: ${c.path} ===\n${c.content}`).join("\n\n") || "(nenhum arquivo de contexto fornecido)"
      }`;

      // Chama a ponte interna de IA (mesma cadeia de fallback do projeto)
      const bridgeToken = Deno.env.get("WORKERS_BRIDGE_TOKEN") || "";
      const aiRes = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/public-workers-bridge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-token": bridgeToken,
          Authorization: authHeader!,
        },
        body: JSON.stringify({ mode: "json", systemPrompt, userPrompt }),
      });
      let aiData: any;
      if (!aiRes.ok) {
        return j({ error: `ai_bridge_failed: ${aiRes.status}` }, 502);
      }
      const aiJson = await aiRes.json();
      aiData = aiJson.data ?? aiJson;
      if (typeof aiData === "string") {
        try { aiData = JSON.parse(aiData); } catch { return j({ error: "ai_invalid_json" }, 502); }
      }

      const files = Array.isArray(aiData?.files) ? aiData.files : [];
      if (files.length === 0) return j({ error: "ai_no_patch", explanation: aiData?.explanation });

      // Valida que os arquivos existem no repo
      for (const f of files) {
        if (!f.path?.startsWith("src/") && !f.path?.startsWith("supabase/migrations")) {
          return j({ error: `path_not_allowed: ${f.path}` }, 400);
        }
        if (!f.old || !f.new || typeof f.old !== "string" || typeof f.new !== "string") {
          return j({ error: "patch_malformed" }, 400);
        }
      }

      // Salva o pedido
      const { data: row, error } = await supabase
        .from("ai_editor_requests")
        .insert({
          user_id: userId,
          request,
          patch: JSON.stringify(files),
          explanation: aiData?.explanation || null,
          status: "pending_apply",
        })
        .select()
        .single();
      if (error) throw error;

      return j({
        ok: true,
        id: row.id,
        patch: files,
        explanation: aiData?.explanation,
        applied: false,
        pending_apply: true,
      });
    }

    if (path === "/apply") {
      const { id } = body;
      if (!id) return j({ error: "id_required" }, 400);
      const { data: row, error: getErr } = await supabase
        .from("ai_editor_requests").select("*").eq("id", id).single();
      if (getErr || !row) return j({ error: "request_not_found" }, 404);
      if (row.status === "applied") return j({ ok: true, already: true, commit_sha: row.commit_sha });
      if (row.status !== "pending_apply") return j({ error: `invalid_status: ${row.status}` }, 409);

      const patch: { path: string; old: string; new: string }[] = JSON.parse(row.patch);

      // Baixa a tree do main e aplica o patch
      const tree = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/trees/main?recursive=1`, pat);
      const blobs: { path: string; sha: string }[] = tree.tree.filter((f: any) => f.type === "blob");

      const newTree: { path: string; mode: string; type: "blob"; sha: string }[] = [];
      for (const f of blobs) {
        newTree.push({ path: f.path, mode: (f as any).mode || "100644", type: "blob", sha: f.sha });
      }

      for (const p of patch) {
        let existing = newTree.find((t) => t.path === p.path);
        let content = "";
        if (existing) {
          const blob = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/blobs/${existing.sha}`, pat);
          content = decodeContent(blob.content);
        }
        // Aplica substituição
        const idx = content.indexOf(p.old);
        if (idx === -1) {
          return j({ error: `old_not_found_in: ${p.path}` }, 422);
        }
        content = content.slice(0, idx) + p.new + content.slice(idx + p.old.length);

        const blob = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/blobs`, pat, "POST", {
          content,
          encoding: "utf-8",
        });
        if (existing) {
          existing.sha = blob.sha;
        } else {
          newTree.push({ path: p.path, mode: "100644", type: "blob", sha: blob.sha });
        }
      }

      // Commit
      const baseSha = await gh(`/repos/${GH_OWNER}/${GH_REPO}/commits/main`, pat);
      const treeData = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/trees`, pat, "POST", {
        tree: newTree,
      });
      const commit = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/commits`, pat, "POST", {
        message: `Editor IA: ${row.request.slice(0, 80)} (pedido ${row.id})`,
        tree: treeData.sha,
        parents: [baseSha.sha],
      });

      // Atualiza o branch principal
      await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/refs/heads/main`, pat, "PATCH", { sha: commit.sha });

      await supabase
        .from("ai_editor_requests")
        .update({ status: "applied", commit_sha: commit.sha, applied_at: new Date().toISOString() })
        .eq("id", id);

      return j({ ok: true, id, commit_sha: commit.sha, applied: true });
    }

    if (path === "/revert") {
      const { id } = body;
      if (!id) return j({ error: "id_required" }, 400);
      const { data: row, error: getErr } = await supabase
        .from("ai_editor_requests").select("*").eq("id", id).single();
      if (getErr || !row) return j({ error: "request_not_found" }, 404);
      if (!row.commit_sha) return j({ error: "not_applied" }, 409);

      // Reverte com git revert via patches: re-aplica o old no lugar do new (invertido)
      const patch: { path: string; old: string; new: string }[] = JSON.parse(row.patch);
      const tree = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/trees/main?recursive=1`, pat);
      const blobs: { path: string; sha: string }[] = tree.tree.filter((f: any) => f.type === "blob");
      const newTree: { path: string; mode: string; type: "blob"; sha: string }[] = blobs.map((f: any) => ({
        path: f.path, mode: f.mode || "100644", type: "blob", sha: f.sha,
      }));

      for (const p of patch) {
        const existing = newTree.find((t) => t.path === p.path);
        if (!existing) continue;
        const blob = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/blobs/${existing.sha}`, pat);
        let content = decodeContent(blob.content);
        const idx = content.indexOf(p.new);
        if (idx === -1) return j({ error: `revert_failed: ${p.path}` }, 422);
        content = content.slice(0, idx) + p.old + content.slice(idx + p.new.length);
        const blobNew = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/blobs`, pat, "POST", { content, encoding: "utf-8" });
        existing.sha = blobNew.sha;
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
