// _shared/router.ts — utilitário de roteamento por rota (path) para Edge Functions unificadas.
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
    const u = new URL(url);
    return u.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
}

function stripSlug(path: string): string {
  const parts = path.split("/").filter((p) => p.length > 0);
  // No Supabase, o path é /functions/v1/ai-chat-unified/sofia-agent
  const slug = "ai-chat-unified";
  const idx = parts.indexOf(slug);
  if (idx !== -1) {
    const subPath = "/" + parts.slice(idx + 1).join("/");
    return subPath.replace(/\/+$/, "") || "/";
  }
  // Se for chamado via CNAME ou direto na raiz da função
  if (parts.length > 0) {
    return "/" + parts[parts.length - 1];
  }
  return "/";
}

export async function route(req: Request, handlers: Record<string, Handler>): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const hdr = (req.headers.get("x-route") || "").trim();
  const rawPath = normalizePath(req.url);
  
  // Prioridade 1: Header x-route
  // Prioridade 2: Path da URL após o slug
  let path = hdr ? (hdr.startsWith("/") ? hdr : "/" + hdr) : stripSlug(rawPath);
  
  // Normalização final para garantir match com as chaves do handlers
  if (!path.startsWith("/")) path = "/" + path;
  
  console.log(`[router] incoming: ${req.method} ${req.url} | rawPath: ${rawPath} | resolved: ${path}`);

  let h: Handler | undefined = handlers[path];
  
  // Fallback: se não achar match exato, tenta prefixo
  if (!h) {
    for (const k of Object.keys(handlers)) {
      if (k !== "/" && path.startsWith(k + "/")) {
        h = handlers[k];
        break;
      }
    }
  }

  if (!h) {
    console.error(`[router] 404 Not Found: ${path}. Available: ${Object.keys(handlers).join(", ")}`);
    return json({ error: "route_not_found", path, available: Object.keys(handlers) }, 404);
  }

  let body: any = {};
  let bodyText = "";
  try {
    // Clona o request para poder ler o body e ainda passar o request original se necessário
    const clonedReq = req.clone();
    bodyText = await clonedReq.text();
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json") && bodyText) {
      body = JSON.parse(bodyText);
    }
  } catch (e) {
    console.warn("[router] falha ao ler body:", e);
  }

  try {
    // Passamos o body já parseado como segundo argumento para o handler
    return await h(req, body);
  } catch (e: any) {
    console.error(`[router] erro na rota ${path}:`, e);
    return json({ error: String(e?.message || e) }, 500);
  }
}
