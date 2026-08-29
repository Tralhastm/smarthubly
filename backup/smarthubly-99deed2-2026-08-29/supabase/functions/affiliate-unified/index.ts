// affiliate-unified — Edge Function unificada (3 rotas).
// Roteamento por path: /match, /import, /refresh.
import { route } from "../_shared/router.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createHmac, randomUUID } from "node:crypto";


import { match } from "./_routes/match/index.ts";
import { import_route } from "./_routes/import/index.ts";
import { refresh } from "./_routes/refresh/index.ts";

const handlers: Record<string, (req: Request, body?: unknown) => Promise<Response>> = {
  "/match": match,
  "/import": import_route,
  "/refresh": refresh,
  "/": (req) => Promise.resolve(new Response(JSON.stringify({ error: "route_required", available: ["match", "import", "refresh"] }), { status: 400, headers: { "Content-Type": "application/json" } })),
};

Deno.serve(async (req: Request) => route(req, handlers));
