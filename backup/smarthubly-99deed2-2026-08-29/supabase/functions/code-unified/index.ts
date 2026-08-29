// code-unified — Edge Function unificada (2 rotas).
// Roteamento por path: /editor, /index.
import { route } from "../_shared/router.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createHmac, randomUUID } from "node:crypto";


import { editor } from "./_routes/editor/index.ts";
import { index_route } from "./_routes/index/index.ts";

const handlers: Record<string, (req: Request, body?: unknown) => Promise<Response>> = {
  "/editor": editor,
  "/index": index_route,
  "/": (req) => Promise.resolve(new Response(JSON.stringify({ error: "route_required", available: ["editor", "index"] }), { status: 400, headers: { "Content-Type": "application/json" } })),
};

Deno.serve(async (req: Request) => route(req, handlers));
