// _shared/router.ts — utilitário de roteamento por rota (path) para Edge Functions unificadas.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-route, x-my-custom-header",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json"
    }
  });
}
function normalizePath(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/+$/, "") || "/";
  } catch  {
    return "/";
  }
}
function stripSlug(path) {
  const parts = path.split("/").filter((p)=>p.length > 0);
  // No Supabase, o path é /functions/v1/<slug>/<subpath>
  // O slug da função é a 3ª parte (ex: ["functions", "v1", "ai-media-unified", "parse-txt"])
  const v1Idx = parts.indexOf("v1");
  if (v1Idx !== -1 && parts.length > v1Idx + 2) {
    const subPath = "/" + parts.slice(v1Idx + 2).join("/");
    return subPath.replace(/\/+$/, "") || "/";
  }
  
  // Se for chamado via CNAME ou direto na raiz da função
  if (parts.length > 0) {
    return "/" + parts[parts.length - 1];
  }
  return "/";
}
export async function route(req, handlers) {
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: CORS
  });
  const hdr = (req.headers.get("x-route") || "").trim();
  const rawPath = normalizePath(req.url);
  // Prioridade 1: Header x-route
  // Prioridade 2: Path da URL após o slug
  let path = hdr ? hdr.startsWith("/") ? hdr : "/" + hdr : stripSlug(rawPath);
  // Normalização final para garantir match com as chaves do handlers
  if (!path.startsWith("/")) path = "/" + path;
  console.log(`[router] incoming: ${req.method} ${req.url} | rawPath: ${rawPath} | resolved: ${path}`);
  let h = handlers[path];
  // Fallback: se não achar match exato, tenta prefixo
  if (!h) {
    for (const k of Object.keys(handlers)){
      if (k !== "/" && path.startsWith(k + "/")) {
        h = handlers[k];
        break;
      }
    }
  }
  if (!h) {
    console.error(`[router] 404 Not Found: ${path}. Available: ${Object.keys(handlers).join(", ")}`);
    return json({
      error: "route_not_found",
      path,
      available: Object.keys(handlers)
    }, 404);
  }
  let body = {};
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
  } catch (e) {
    console.error(`[router] erro na rota ${path}:`, e);
    return json({
      error: String(e?.message || e)
    }, 500);
  }
}
