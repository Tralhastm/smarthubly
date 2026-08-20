// _shared/router.ts — utilitário de roteamento por rota (path) para Edge Functions unificadas.
//
// Uso:
//   import { route } from "./_shared/router.ts";
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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

export async function route(req: Request, handlers: Record<string, Handler>): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const path = normalizePath(req.url);
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
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) body = await req.json();
    else if (ct.includes("multipart")) body = await req.formData();
  } catch { body = {}; }
  try {
    return await h(req, body);
  } catch (e: any) {
    console.error(`[router] erro na rota ${path}:`, e);
    return json({ error: String(e?.message || e) }, 500);
  }
}
