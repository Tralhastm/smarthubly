// _shared/router.ts — utilitário de roteamento por rota (path) para Edge Functions unificadas.
//
// Uso:
//   import { route } from "../_shared/router.ts";
//   Deno.serve(async (req) => route(req, {
//     "/chat": chatHandler,
//     "/": defaultHandler,
//   }));
//
// - Roteia por req.url pathname (match prefixo, strip query).
// - Aplica CORS comum em OPTIONS.
// - Se a rota não existe, retorna 404 { error: "route_not_found", available: [...] }.

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-route, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export type Handler = (req: Request, body: any) => Promise<Response>;

function normalizePath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
}

// Remove o primeiro segmento do pathname (o slug da Edge Function) para que o
// path entregue pelo Supabase (ex.: /<slug>/parse-txt) case com handlers
// definidos como /parse-txt. Não remove se o path tem só 1 segmento.
function stripSlug(path: string): string {
  const parts = path.split("/").filter((p) => p.length > 0);
  // As Edge Functions do Supabase geralmente têm o formato /functions/v1/<slug>/<sub-rota>
  // ou apenas /<slug>/<sub-rota> dependendo do ambiente.
  // Vamos procurar pelo slug "ai-chat-unified" e pegar o que vem depois.
  const slug = "ai-chat-unified";
  const idx = parts.indexOf(slug);
  if (idx !== -1) {
    const subPath = "/" + parts.slice(idx + 1).join("/");
    return subPath.replace(/\/+$/, "") || "/";
  }
  // Fallback para comportamento anterior se não achar o slug
  if (parts.length <= 1) return "/";
  return "/" + parts.slice(1).join("/");
}

export async function route(req: Request, handlers: Record<string, Handler>): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // Prioridade: header x-route (independe do formato da URL), senão o pathname
  // com o slug removido (o Supabase envia a URL completa /<slug>/<rota>).
  const hdr = (req.headers.get("x-route") || "").trim();
  const path = hdr ? (hdr.startsWith("/") ? hdr : "/" + hdr) : stripSlug(normalizePath(req.url));
  let h: Handler | undefined = handlers[path];
  if (!h) {
    // fallback: prefixo (ex.: /cindy-actions/anything)
    for (const k of Object.keys(handlers)) {
      if (path.startsWith(k + "/")) { h = handlers[k]; break; }
    }
  }
  if (!h) {
    return json({ error: "route_not_found", available: Object.keys(handlers) }, 404);
  }
  let body: any = {};
  // Bufferiza o corpo UMA vez como texto e reconstrói o Request para que o
  // handler (código original) possa reler req.json()/req.formData() sem erro.
  let bodyText = "";
  try {
    bodyText = await req.text();
  } catch { bodyText = ""; }
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json") && bodyText) body = JSON.parse(bodyText);
    else if (ct.includes("multipart") && bodyText) {
      // boundary; cair para leitura direta abaixo se falhar
      try {
        const blob = new Blob([bodyText], { type: ct });
        const fd = await new Response(blob).formData();
        body = fd;
      } catch { body = {}; }
    }
  } catch { body = {}; }
  try {
    const opts: RequestInit = { method: req.method, headers: req.headers };
    if (["POST", "PUT", "PATCH"].includes(req.method) && bodyText) opts.body = bodyText;
    return await h(new Request(req.url, opts), body);
  } catch (e: any) {
    console.error(`[router] erro na rota ${path}:`, e);
    return json({ error: String(e?.message || e) }, 500);
  }
}
