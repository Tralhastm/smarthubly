// code-index — V3.1 do Editor IA (SmartHubly)
//
// Análise ESTRUTURAL + índice SEMÂNTICO do repositório.
//
// POST /rebuild
//   Analisa o repo no GitHub: para cada arquivo src/**/*.ts|tsx extrai a
//   estrutura (componentes, funções, hooks, tipos, interfaces), imports
//   locais e comentários-doc. Popula code_index / code_deps /
//   code_transitive_deps no Supabase. Cache: só re-analisa arquivos cujo
//   sha mudou desde o último rebuild.
//
// POST /explore
//   Busca semântica + análise de impacto. Recebe { request } e usa o LLM
//   (public-workers-bridge) sobre o índice rico para:
//   1. escolher os arquivos de contexto mais relevantes;
//   2. listar dependências diretas e transitivas de cada um;
//   3. montar um PLANO de edição (arquivos a modificar, componentes a
//      criar, tabelas alteradas, risco e resumo).
//   Retorna { chosen_files, plan, dependencies } em JSON.
//
// GET /status
//   Meta do índice: quantos arquivos, última indexação, sha do HEAD.
//
// Autenticação: só super_admin (mesma regra do ai-code-editor).
// No-verify-jwt é aceito no deploy, mas a função valida o JWT manualmente.

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

const GH_OWNER = "Tralhastm";
const GH_REPO = "smarthubly";

function decodeContent(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function requireSuperAdmin(supabase: any, authHeader: string | null): Promise<string> {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("unauthorized");
  const token = authHeader.slice(7);

  // Chamadas internas entre Edge Functions usam o WORKERS_BRIDGE_TOKEN
  const bridgeToken = Deno.env.get("WORKERS_BRIDGE_TOKEN") || "";
  if (bridgeToken && token === bridgeToken) return "internal";

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

function ghHeaders(pat: string) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "smarthubly-code-index",
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

/* ------------------------------------------------------------------
 * 1. ANÁLISE ESTRUTURAL (mini-AST via padrões estruturais)
 * ------------------------------------------------------------------ */

// Extrai blocos de comentários/docstring que precedem símbolos
function docsAbove(src: string, lineIdx: number): string {
  const lines = src.split("\n");
  const docs: string[] = [];
  for (let i = lineIdx - 1; i >= 0; i -= 1) {
    const t = lines[i].trim();
    if (t === "") continue;
    if (t.startsWith("//")) docs.unshift(t.replace(/^\/\/\s?/, ""));
    else if (t.startsWith("/*")) {
      docs.unshift(t.replace(/^\/\*\s?/, "").replace(/\s?\*\/$/, ""));
      break;
    } else break;
    if (docs.length >= 6) break;
  }
  return docs.join("\n");
}

function firstLineSignature(line: string): string {
  const m = line.match(/\(([^)]*)\)/);
  return m ? `(${m[1].slice(0, 90)})` : "";
}

/** Analisa um arquivo TS/TSX e retorna símbolos estruturais + imports locais. */
function analyzeFile(path: string, src: string): { symbols: { kind: string; name: string; signature: string; doc: string; line: number }[]; importsLocal: string[] } {
  const lines = src.split("\n");
  const symbols: { kind: string; name: string; signature: string; doc: string; line: number }[] = [];
  const importsLocal: string[] = [];

  // --- imports locais (./ ../ @/paths) ---
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i];
    const m = t.match(/import\s+(?:[\s\S]*?)\s+from\s+['"`](\.\.?\/[^'"`]+|@\/[^'"`]+)/);
    if (m) importsLocal.push(m[1]);
    const m2 = t.match(/import\s+['"`](\.\.?\/[^'"`]+|@\/[^'"`]+)/);
    if (m2) importsLocal.push(m2[1]);
  }

  // --- componentes: export default (arrow|function) e export const X = (...) => / export function X ---
  const compRegex =
    /(?:export\s+default\s+)?(?:const\s+([A-Z][A-Za-z0-9_]*)\s*[:=]?\s*(?:\([^)]*\))?[\s=>]*=>|function\s+([A-Z][A-Za-z0-9_]*)\s*\()/g;
  let m: RegExpExecArray | null;
  while ((m = compRegex.exec(src)) !== null) {
    const name = m[1] || m[2];
    if (!name) continue;
    const lineIdx = src.slice(0, m.index).split("\n").length - 1;
    const isDefault = m.index > 0 && src.slice(Math.max(0, m.index - 14), m.index).includes("export default");
    symbols.push({
      kind: "component",
      name,
      signature: isDefault ? "export default" : firstLineSignature(lines[lineIdx] || ""),
      doc: docsAbove(src, lineIdx),
      line: lineIdx + 1,
    });
  }

  // --- funções/hooks: export function X, export const X = ( => ---
  const fnRegex = /export\s+(?:async\s+)?function\s+([a-z$][A-Za-z0-9_$]*)|export\s+const\s+([a-z$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?\(([^)]*)\)/g;
  while ((m = fnRegex.exec(src)) !== null) {
    const name = m[1] || m[2];
    if (!name || /^use[A-Z]/.test(name) === false && name.length < 3) continue;
    const lineIdx = src.slice(0, m.index).split("\n").length - 1;
    symbols.push({
      kind: name.startsWith("use") && name.length >= 4 ? "hook" : "function",
      name,
      signature: firstLineSignature(lines[lineIdx] || ""),
      doc: docsAbove(src, lineIdx),
      line: lineIdx + 1,
    });
  }

  // --- interfaces / types exportados ---
  const typeRegex = /export\s+(?:interface|type)\s+([A-Z][A-Za-z0-9_]*)/g;
  while ((m = typeRegex.exec(src)) !== null) {
    const lineIdx = src.slice(0, m.index).split("\n").length - 1;
    symbols.push({ kind: m[0].includes("interface") ? "interface" : "type", name: m[1], signature: "", doc: docsAbove(src, lineIdx), line: lineIdx + 1 });
  }

  // Remove duplicatas (mesmo nome e linha)
  const seen = new Set<string>();
  return {
    symbols: symbols.filter((s) => {
      const k = `${s.name}:${s.line}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
    importsLocal: [...new Set(importsLocal)],
  };
}

/** Resolve um import local para um caminho de arquivo no repo (best-effort). */
function resolveLocalImport(importPath: string, fromPath: string, allSrcFiles: string[]): string | null {
  if (!importPath.startsWith(".") && !importPath.startsWith("@/")) return null;
  const dir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const candidates: string[] = [];
  if (importPath.startsWith("@/")) {
    const base = importPath.slice(2);
    candidates.push(`src/${base}.ts`, `src/${base}.tsx`, `src/${base}/index.ts`, `src/${base}/index.tsx`);
  } else {
    let abs = importPath;
    if (abs.startsWith("./")) abs = abs.slice(2);
    else if (abs.startsWith("../")) {
      const up = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
      abs = up ? `${up}/${abs.slice(3)}` : abs.slice(3);
    }
    candidates.push(`src/${abs}.ts`, `src/${abs}.tsx`, `src/${abs}/index.ts`, `src/${abs}/index.tsx`);
  }
  for (const c of candidates) {
    if (allSrcFiles.includes(c)) return c;
  }
  return null;
}

/* ------------------------------------------------------------------
 * 2. ENDPOINTS
 * ------------------------------------------------------------------ */

async function rebuildIndex(supabase: any, pat: string, bridgeToken: string, authHeader: string): Promise<object> {
  const tree = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/trees/main?recursive=1`, pat);
  const blobs: { path: string; sha: string; size?: number }[] = (tree?.tree || [])
    .filter((f: any) => f.type === "blob" && f.path.startsWith("src/") && /\.(ts|tsx)$/.test(f.path) && (f.size ?? 0) < 200 * 1024)
    .map((f: any) => ({ path: f.path, sha: f.sha, size: f.size }));

  const allPaths = blobs.map((b) => b.path);

  // Só re-analisa arquivos com sha diferente do último rebuild
  const { data: existing, error: selErr } = await supabase
    .from("code_index")
    .select("path, sha")
    .in("path", allPaths);
  if (selErr) throw selErr;
  const shaMap = new Map((existing || []).map((e: any) => [e.path, e.sha]));
  const stale = blobs.filter((b) => b.sha !== shaMap.get(b.path));
  const stalePaths = new Set(stale.map((b) => b.path));

  // Remove símbolos de arquivos que mudaram (serão reinseridos) e arquivos que sumiram
  await supabase.from("code_index").delete().eq("path", blobs.map((b) => b.path).filter((p) => stalePaths.has(p)));
  const gonePaths = allPaths.length > 0 ? null : null;
  if (existing && existing.length > allPaths.length) {
    const gone = existing.filter((e: any) => !allPaths.includes(e.path)).map((e: any) => e.path);
    if (gone.length > 0) {
      await supabase.from("code_index").delete().in("path", gone);
      await supabase.from("code_deps").delete().in("from_path", gone);
      await supabase.from("code_transitive_deps").delete().in("from_path", gone);
    }
  }

  // Baixa e analisa os arquivos stale (máx 250 por chamada, em lotes de 25)
  const staleList = stale.slice(0, 250);
  let analyzed = 0;
  for (let i = 0; i < staleList.length; i += 25) {
    const batch = staleList.slice(i, i + 25);
    const rows: { path: string; sha: string; kind: string; name: string | null; signature: string; doc: string; imports_local: string[] }[] = [];
    const deps: { from_path: string; to_path: string }[] = [];
    for (const b of batch) {
      try {
        const blob = await gh(`/repos/${GH_OWNER}/${GH_REPO}/git/blobs/${b.sha}`, pat);
        const content = decodeContent(blob.content);
        const { symbols, importsLocal } = analyzeFile(b.path, content);
        if (symbols.length === 0 && importsLocal.length === 0) {
          rows.push({ path: b.path, sha: b.sha, kind: "file", name: null, signature: "", doc: "", imports_local: importsLocal });
        } else {
          for (const s of symbols) {
            rows.push({
              path: b.path, sha: b.sha, kind: s.kind, name: s.name,
              signature: s.signature, doc: s.doc.slice(0, 400), imports_local: importsLocal,
            });
          }
        }
        for (const imp of importsLocal) {
          const resolved = resolveLocalImport(imp, b.path, allPaths);
          if (resolved && resolved !== b.path) deps.push({ from_path: b.path, to_path: resolved });
        }
        analyzed += 1;
      } catch (e) { /* arquivo ilegível — pula */ }
    }
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("code_index").upsert(rows);
      if (insErr) console.warn("[code-index] upsert falhou:", insErr.message);
    }
    if (deps.length > 0) {
      const { error: depErr } = await supabase.from("code_deps").upsert(deps);
      if (depErr) console.warn("[code-index] deps falhou:", depErr.message);
    }
  }

  // --- dependências transitivas (BFS a partir do mapa direto) ---
  const direct = new Map<string, string[]>();
  const { data: depRows } = await supabase.from("code_deps").select("from_path, to_path");
  for (const d of depRows || []) direct.set(d.from_path, [...(direct.get(d.from_path) || []), d.to_path]);

  const transRows: { from_path: string; to_path: string; depth: number }[] = [];
  for (const root of allPaths) {
    const queue: [string, number][] = (direct.get(root) || []).map((t) => [t, 1]);
    const visited = new Set<string>();
    while (queue.length > 0) {
      const [cur, depth] = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      transRows.push({ from_path: root, to_path: cur, depth });
      if (depth < 6) {
        for (const next of direct.get(cur) || []) {
          if (!visited.has(next)) queue.push([next, depth + 1]);
        }
      }
    }
  }
  if (transRows.length > 0) {
    const { error: tErr } = await supabase.from("code_transitive_deps").upsert(transRows);
    if (tErr) console.warn("[code-index] transitive falhou:", tErr.message);
  }

  const { data: meta } = await supabase.from("code_index").select("path", { count: "exact", head: true });
  const { data: headData } = await gh(`/repos/${GH_OWNER}/${GH_REPO}/commits/main`, pat).catch(() => [null]);
  return {
    ok: true,
    files_indexed: (meta as any)?.count ?? 0,
    files_analyzed_now: analyzed,
    head_sha: headData?.sha || null,
    transitive_pairs: transRows.length,
  };
}

async function callBridgeLLM(bridgeToken: string, authHeader: string, systemPrompt: string, userPrompt: string, maxRetries = 2): Promise<any> {
  let lastErr = "";
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/public-workers-bridge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bridge-token": bridgeToken, Authorization: authHeader },
        body: JSON.stringify({ mode: "json", systemPrompt: attempt > 0 ? `${systemPrompt}\nATENÇÃO: resposta anterior falhou (${lastErr}). Responda apenas com JSON válido.` : systemPrompt, userPrompt }),
      });
      if (!res.ok) { lastErr = `bridge_http_${res.status}`; continue; }
      const raw = await res.json();
      let data: any = raw.data ?? raw;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch { lastErr = "bridge_invalid_json"; continue; } }
      if (!data || typeof data !== "object") { lastErr = "bridge_invalid_json"; continue; }
      return data;
    } catch (e: any) { lastErr = String(e?.message || e); }
  }
  throw new Error(`bridge_failed: ${lastErr}`);
}

/** Busca semântica + plano de edição sobre o índice rico. */
async function exploreRequest(supabase: any, bridgeToken: string, authHeader: string, request: string): Promise<object> {
  // 1. Monta o índice textual rico (símbolos + docs + imports) — leve
  const { data: indexRows, error: idxErr } = await supabase
    .from("code_index")
    .select("path, kind, name, signature, doc, imports_local");
  if (idxErr || !indexRows) throw new Error("index_not_ready: rebuild primeiro");

  const { data: headData } = await gh(`/repos/${GH_OWNER}/${GH_REPO}/commits/main`, Deno.env.get("GITHUB_PAT")!).catch(() => [null]);

  // Compacta: por arquivo, lista "símbolos: doc" + imports
  const perFile = new Map<string, { syms: string[]; imports: string[] }>();
  for (const r of indexRows) {
    const e = perFile.get(r.path) || { syms: [], imports: [] };
    if (r.name) e.syms.push(`${r.kind} ${r.name} ${r.signature || ""}`.trim() + (r.doc ? ` — ${r.doc.slice(0, 120)}` : ""));
    e.imports.push(...(Array.isArray(r.imports_local) ? r.imports_local : []));
    perFile.set(r.path, e);
  }
  const indexText = [...perFile.entries()]
    .map(([path, e]) => `- ${path}\n    símbolos: ${[...new Set(e.syms)].join(" | ") || "(nada exportado)"}\n    importa: ${[...new Set(e.imports)].slice(0, 15).join(", ")}`)
    .join("\n");

  // 2. LLM escolhe arquivos + monta plano
  const data = await callBridgeLLM(bridgeToken, authHeader,
    `Você é um engenheiro sênior que analisa o índice estrutural do projeto SmartHubly (React + Vite + TypeScript + Supabase) para planejar edições com PREVISÃO DE IMPACTO.
Retorne APENAS JSON válido:
{"chosen_files": ["src/...", "..."], "plan": {"files_to_modify": ["src/..."], "components_to_create": [], "tables_changed": [], "risks": ["..."], "risk_level": "baixo|medio|alto", "summary": "..."}, "reasoning": "por que estes arquivos"}
Regras: chosen_files no máximo 12; prefira os arquivos diretamente relacionados ao pedido E seus pais/consumidores quando a mudança afeta contratos (props, funções, tipos); risks só se houver risco real (ex.: mexe em checkout/pagamento = alto).`,
    `PEDIDO: ${request}

ÍNDICE ESTRUTURAL DO REPO (HEAD ${headData?.sha?.slice(0, 7) ?? "?"}):
${indexText.slice(0, 18000)}`,
  );

  const chosen: string[] = Array.isArray(data?.chosen_files)
    ? data.chosen_files.filter((p: any) => typeof p === "string")
    : [];

  // 3. Dependências (diretas + transitivas) dos escolhidos
  const { data: depRows } = await supabase
    .from("code_transitive_deps")
    .select("from_path, to_path, depth")
    .in("from_path", chosen);
  const depsByFile = new Map<string, { direct: string[]; transitive: string[] }>();
  const { data: directRows } = await supabase
    .from("code_deps")
    .select("from_path, to_path")
    .in("from_path", chosen);
  for (const d of directRows || []) {
    const e = depsByFile.get(d.from_path) || { direct: [], transitive: [] };
    if (!e.direct.includes(d.to_path)) e.direct.push(d.to_path);
    depsByFile.set(d.from_path, e);
  }
  for (const d of depRows || []) {
    const e = depsByFile.get(d.from_path) || { direct: [], transitive: [] };
    if (!e.direct.includes(d.to_path) && !e.transitive.includes(d.to_path)) e.transitive.push(d.to_path);
    depsByFile.set(d.from_path, e);
  }

  const dependencies: { path: string; direct: string[]; transitive: string[] }[] = chosen.map((p) => ({
    path: p,
    direct: depsByFile.get(p)?.direct ?? [],
    transitive: depsByFile.get(p)?.transitive ?? [],
  }));

  return {
    ok: true,
    chosen_files: chosen,
    plan: data?.plan || { files_to_modify: [], components_to_create: [], tables_changed: [], risks: [], risk_level: "baixo", summary: "" },
    reasoning: typeof data?.reasoning === "string" ? data.reasoning : "",
    dependencies,
    head_sha: headData?.sha || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const pat = Deno.env.get("GITHUB_PAT");
  if (!pat) return j({ error: "github_pat_missing" }, 500);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("FUNCTION_SERVICE_ROLE_KEY")!);

  const authHeader = req.headers.get("authorization");
  let userId: string;
  try {
    userId = await requireSuperAdmin(supabase, authHeader);
  } catch (e: any) {
    return j({ error: e.message }, e.message === "super_admin_required" ? 403 : 401);
  }

  const url = new URL(req.url);
  let path = url.pathname.replace(/^\/functions\/v1\/code-index|^\/code-index/, "").replace(/\/$/, "") || "/status";
  if (!path.startsWith("/")) path = "/" + path;

  try {
    if (path === "/status" || path === "/") {
      const { data: meta, error: mErr } = await supabase.from("code_index").select("sha", { count: "exact", head: true });
      if (mErr) throw mErr;
      const { data: headData } = await gh(`/repos/${GH_OWNER}/${GH_REPO}/commits/main`, pat).catch(() => [null]);
      const { data: lastRow } = await supabase.from("code_index").select("indexed_at").order("indexed_at", { ascending: false }).limit(1);
      return j({
        files_indexed: (meta as any)?.count ?? 0,
        head_sha: headData?.sha || null,
        last_indexed_at: lastRow?.[0]?.indexed_at || null,
      });
    }

    if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);
    const body = await req.json().catch(() => ({}));
    const bridgeToken = Deno.env.get("WORKERS_BRIDGE_TOKEN") || "";

    if (path === "/rebuild") {
      const result = await rebuildIndex(supabase, pat, bridgeToken, authHeader!);
      return j(result);
    }

    if (path === "/explore") {
      const { request } = body;
      if (!request || typeof request !== "string") return j({ error: "request_required" }, 400);
      if (request.length > 4000) return j({ error: "request_too_long" }, 400);
      // Rebuild parcial se o índice estiver vazio
      const { data: meta, error: mErr } = await supabase.from("code_index").select("path", { count: "exact", head: true });
      if (mErr) throw mErr;
      if ((meta as any)?.count === 0) {
        await rebuildIndex(supabase, pat, bridgeToken, authHeader!);
      }
      const result = await exploreRequest(supabase, bridgeToken, authHeader!, request);
      return j(result);
    }

    return j({ error: "unknown_path" }, 404);
  } catch (e: any) {
    console.error("[code-index] erro:", e);
    return j({ error: String(e?.message || e) }, 500);
  }
});
