// delivery-unified — Edge Function unificada (11 rotas).
// Roteamento por path: /quote, /distance, /route-eta, /lalamove-request, /lalamove-cancel, /lalamove-status, /driver-online, /driver-location, /driver-manifest, /uber-request, /uber-quote.
import { route } from "../_shared/router.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createHmac, randomUUID } from "node:crypto";


import { quote } from "./_routes/quote/index.ts";
import { distance } from "./_routes/distance/index.ts";
import { route_eta } from "./_routes/route-eta/index.ts";
import { lalamove_request } from "./_routes/lalamove-request/index.ts";
import { lalamove_cancel } from "./_routes/lalamove-cancel/index.ts";
import { lalamove_status } from "./_routes/lalamove-status/index.ts";
import { driver_online } from "./_routes/driver-online/index.ts";
import { driver_location } from "./_routes/driver-location/index.ts";
import { driver_manifest } from "./_routes/driver-manifest/index.ts";
import { uber_request } from "./_routes/uber-request/index.ts";
import { uber_quote } from "./_routes/uber-quote/index.ts";

const handlers: Record<string, (req: Request, body?: unknown) => Promise<Response>> = {
  "/quote": quote,
  "/distance": distance,
  "/route-eta": route_eta,
  "/lalamove-request": lalamove_request,
  "/lalamove-cancel": lalamove_cancel,
  "/lalamove-status": lalamove_status,
  "/driver-online": driver_online,
  "/driver-location": driver_location,
  "/driver-manifest": driver_manifest,
  "/uber-request": uber_request,
  "/uber-quote": uber_quote,
  "/": (req) => Promise.resolve(new Response(JSON.stringify({ error: "route_required", available: ["quote", "distance", "route-eta", "lalamove-request", "lalamove-cancel", "lalamove-status", "driver-online", "driver-location", "driver-manifest", "uber-request", "uber-quote"] }), { status: 400, headers: { "Content-Type": "application/json" } })),
};

Deno.serve(async (req: Request) => route(req, handlers));
