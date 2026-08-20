// fiscal-unified — Edge Function unificada (2 rotas).
// Roteamento por path: /generate, /scan.
import { route } from "../_shared/router.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createHmac, randomUUID } from "node:crypto";


import { generate } from "./_routes/generate/index.ts";
import { scan } from "./_routes/scan/index.ts";

const handlers: Record<string, (req: Request, body?: unknown) => Promise<Response>> = {
  "/generate": generate,
  "/scan": scan,
  "/": (req) => Promise.resolve(new Response(JSON.stringify({ error: "route_required", available: ["generate", "scan"] }), { status: 400, headers: { "Content-Type": "application/json" } })),
};

Deno.serve(async (req: Request) => route(req, handlers));
