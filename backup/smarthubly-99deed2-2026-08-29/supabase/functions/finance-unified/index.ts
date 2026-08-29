// finance-unified — Edge Function unificada (6 rotas).
// Roteamento por path: /stats, /sync-financeflow, /pull-financeflow, /estimate-quote, /insights, /auto-categorize.
import { route } from "../_shared/router.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createHmac, randomUUID } from "node:crypto";


import { stats } from "./_routes/stats/index.ts";
import { sync_financeflow } from "./_routes/sync-financeflow/index.ts";
import { pull_financeflow } from "./_routes/pull-financeflow/index.ts";
import { estimate_quote } from "./_routes/estimate-quote/index.ts";
import { insights } from "./_routes/insights/index.ts";
import { auto_categorize } from "./_routes/auto-categorize/index.ts";

const handlers: Record<string, (req: Request, body?: unknown) => Promise<Response>> = {
  "/stats": stats,
  "/sync-financeflow": sync_financeflow,
  "/pull-financeflow": pull_financeflow,
  "/estimate-quote": estimate_quote,
  "/insights": insights,
  "/auto-categorize": auto_categorize,
  "/": (req) => Promise.resolve(new Response(JSON.stringify({ error: "route_required", available: ["stats", "sync-financeflow", "pull-financeflow", "estimate-quote", "insights", "auto-categorize"] }), { status: 400, headers: { "Content-Type": "application/json" } })),
};

Deno.serve(async (req: Request) => route(req, handlers));
