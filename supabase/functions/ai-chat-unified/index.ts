// ai-chat-unified — Edge Function unificada (6 rotas).
// Roteamento por path: /cindy, /cindy-actions, /sofia-agent, /store, /financial, /clara.
import { route } from "../_shared/router.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createHmac, randomUUID } from "node:crypto";


import { cindy } from "./_routes/cindy/index.ts";
import { cindy_actions } from "./_routes/cindy-actions/index.ts";
import { sofia_agent } from "./_routes/sofia-agent/index.ts";
import { store } from "./_routes/store/index.ts";
import { financial } from "./_routes/financial/index.ts";
import { clara } from "./_routes/clara/index.ts";

const handlers: Record<string, (req: Request, body?: unknown) => Promise<Response>> = {
  "/cindy": cindy,
  "/cindy-actions": cindy_actions,
  "/sofia-agent": sofia_agent,
  "/store": store,
  "/financial": financial,
  "/clara": clara,
  "/": (req) => Promise.resolve(new Response(JSON.stringify({ error: "route_required", available: ["cindy", "cindy-actions", "sofia-agent", "store", "financial", "clara"] }), { status: 400, headers: { "Content-Type": "application/json" } })),
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const res = await route(req, handlers);
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "*");
  return res;
});
