// ai-media-unified — Edge Function unificada (9 rotas).
// Roteamento por path: /parse-txt, /import, /catalog, /generate, /search, /bulk, /enhance, /delete, /describe.
import { route } from "../_shared/router.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createHmac, randomUUID } from "node:crypto";


import { parse_txt } from "./_routes/parse-txt/index.ts";
import { import_route } from "./_routes/import/index.ts";
import { catalog } from "./_routes/catalog/index.ts";
import { generate } from "./_routes/generate/index.ts";
import { search_route } from "./_routes/search/index.ts";
import { bulk_route } from "./_routes/bulk/index.ts";
import { enhance } from "./_routes/enhance/index.ts";
import { delete_route } from "./_routes/delete/index.ts";
import { describe_route } from "./_routes/describe/index.ts";

const handlers: Record<string, (req: Request, body?: unknown) => Promise<Response>> = {
  "/parse-txt": parse_txt,
  "/import": import_route,
  "/catalog": catalog,
  "/generate": generate,
  "/search": search_route,
  "/bulk": bulk_route,
  "/enhance": enhance,
  "/delete": delete_route,
  "/describe": describe_route,
  "/": (req) => Promise.resolve(new Response(JSON.stringify({ error: "route_required", available: ["parse-txt", "import", "catalog", "generate", "search", "bulk", "enhance", "delete", "describe"] }), { status: 400, headers: { "Content-Type": "application/json" } })),
};

Deno.serve(async (req: Request) => route(req, handlers));
