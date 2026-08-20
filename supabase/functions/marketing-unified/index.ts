// marketing-unified — Edge Function unificada (4 rotas).
// Roteamento por path: /post, /campaign, /refine, /review.
import { route } from "../_shared/router.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createHmac, randomUUID } from "node:crypto";


import { post } from "./_routes/post/index.ts";
import { campaign } from "./_routes/campaign/index.ts";
import { refine } from "./_routes/refine/index.ts";
import { review } from "./_routes/review/index.ts";

const handlers: Record<string, (req: Request, body?: unknown) => Promise<Response>> = {
  "/post": post,
  "/campaign": campaign,
  "/refine": refine,
  "/review": review,
  "/": (req) => Promise.resolve(new Response(JSON.stringify({ error: "route_required", available: ["post", "campaign", "refine", "review"] }), { status: 400, headers: { "Content-Type": "application/json" } })),
};

Deno.serve(async (req: Request) => route(req, handlers));
