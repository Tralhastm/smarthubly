import { cindy } from "./_routes/cindy/index.ts";
import { cindy_actions } from "./_routes/cindy-actions/index.ts";
import { sofia_agent } from "./_routes/sofia-agent/index.ts";
import { store } from "./_routes/store/index.ts";
import { financial } from "./_routes/financial/index.ts";
import { clara } from "./_routes/clara/index.ts";
import { whatsapp_bot } from "./_routes/whatsapp-bot/index.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  
  const url = new URL(req.url);
  const path = url.pathname.split("/").pop() || "";
  const route = req.headers.get("x-route")?.replace("/", "") || path;
  
  console.log("[ai-chat-unified] route:", route);
  
  let handler;
  switch (route) {
    case "cindy": handler = cindy; break;
    case "cindy-actions": handler = cindy_actions; break;
    case "sofia-agent": handler = sofia_agent; break;
    case "store": handler = store; break;
    case "financial": handler = financial; break;
    case "clara": handler = clara; break;
    case "whatsapp-bot": handler = whatsapp_bot; break;
  }
  
  if (!handler) {
    return new Response(JSON.stringify({ error: "not_found", route }), { 
      status: 404, 
      headers: { ...CORS, "Content-Type": "application/json" } 
    });
  }
  
  try {
    const body = await req.json().catch(() => ({}));
    const res = await handler(req, body);
    const newHeaders = new Headers(res.headers);
    Object.entries(CORS).forEach(([k, v]) => newHeaders.set(k, v));
    return new Response(res.body, { status: res.status, headers: newHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { 
      status: 500, 
      headers: { ...CORS, "Content-Type": "application/json" } 
    });
  }
});
