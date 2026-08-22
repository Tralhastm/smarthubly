// ai-chat-unified — Edge Function unificada (6 rotas).
// Roteamento por path: /cindy, /cindy-actions, /sofia-agent, /store, /financial, /clara.
import { route } from "../_shared/router.ts";
import { cindy } from "./_routes/cindy/index.ts";
import { cindy_actions } from "./_routes/cindy-actions/index.ts";
import { sofia_agent } from "./_routes/sofia-agent/index.ts";
import { store } from "./_routes/store/index.ts";
import { financial } from "./_routes/financial/index.ts";
import { clara } from "./_routes/clara/index.ts";
const handlers = {
  "/cindy": cindy,
  "/cindy-actions": cindy_actions,
  "/sofia-agent": sofia_agent,
  "/store": store,
  "/financial": financial,
  "/clara": clara,
  "/": (req)=>Promise.resolve(new Response(JSON.stringify({
      error: "route_required",
      available: [
        "cindy",
        "cindy-actions",
        "sofia-agent",
        "store",
        "financial",
        "clara"
      ]
    }), {
      status: 400,
      headers: {
        "Content-Type": "application/json"
      }
    }))
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400"
      }
    });
  }
  try {
    const res = await route(req, handlers);
    const newHeaders = new Headers(res.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    newHeaders.set("Access-Control-Allow-Headers", "*");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: String(err)
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*"
      }
    });
  }
});
