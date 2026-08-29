// fiscal-unified — Edge Function unificada (6 rotas).
// Roteamento por path: /emit, /cancel, /invalidate, /offline-queue, /generate, /scan.
import { route } from "../_shared/router.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createHmac, randomUUID } from "node:crypto";


import { emit } from "./_routes/emit/index.ts";
import { cancel } from "./_routes/cancel/index.ts";
import { invalidate } from "./_routes/invalidate/index.ts";
import { offline_queue } from "./_routes/offline-queue/index.ts";
import { generate } from "./_routes/generate/index.ts";
import { scan } from "./_routes/scan/index.ts";

const handlers: Record<string, (req: Request, body?: unknown) => Promise<Response>> = {
  "/emit": emit,
  "/cancel": cancel,
  "/invalidate": invalidate,
  "/offline-queue": offline_queue,
  "/generate": generate,
  "/scan": scan,
  "/": (req) => Promise.resolve(new Response(JSON.stringify({ error: "route_required", available: ["emit", "cancel", "invalidate", "offline-queue", "generate", "scan"] }), { status: 400, headers: { "Content-Type": "application/json" } })),
};

Deno.serve(async (req: Request) => route(req, handlers));
