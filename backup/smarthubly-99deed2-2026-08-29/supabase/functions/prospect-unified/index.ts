// prospect-unified — Edge Function unificada (10 rotas).
// Roteamento por path: /search, /enrich, /message, /learn, /reviews, /maps, /google, /site, /street-analyze, /street-message.
import { route } from "../_shared/router.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createHmac, randomUUID } from "node:crypto";


import { search_route } from "./_routes/search/index.ts";
import { enrich } from "./_routes/enrich/index.ts";
import { message } from "./_routes/message/index.ts";
import { learn } from "./_routes/learn/index.ts";
import { reviews } from "./_routes/reviews/index.ts";
import { maps } from "./_routes/maps/index.ts";
import { google } from "./_routes/google/index.ts";
import { site } from "./_routes/site/index.ts";
import { street_analyze } from "./_routes/street-analyze/index.ts";
import { street_message } from "./_routes/street-message/index.ts";

const handlers: Record<string, (req: Request, body?: unknown) => Promise<Response>> = {
  "/search": search_route,
  "/enrich": enrich,
  "/message": message,
  "/learn": learn,
  "/reviews": reviews,
  "/maps": maps,
  "/google": google,
  "/site": site,
  "/street-analyze": street_analyze,
  "/street-message": street_message,
  "/": (req) => Promise.resolve(new Response(JSON.stringify({ error: "route_required", available: ["search", "enrich", "message", "learn", "reviews", "maps", "google", "site", "street-analyze", "street-message"] }), { status: 400, headers: { "Content-Type": "application/json" } })),
};

Deno.serve(async (req: Request) => route(req, handlers));
