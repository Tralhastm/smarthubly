// notify-unified — Edge Function unificada (11 rotas).
// Roteamento por path: /send-transactional, /send-billing, /send-credit, /preview, /push, /queue, /unsubscribe-public, /suppression, /unsubscribe-handle, /new-order, /customer-message.
import { route } from "../_shared/router.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createHmac, randomUUID } from "node:crypto";


import { send_transactional } from "./_routes/send-transactional/index.ts";
import { send_billing } from "./_routes/send-billing/index.ts";
import { send_credit } from "./_routes/send-credit/index.ts";
import { preview } from "./_routes/preview/index.ts";
import { push } from "./_routes/push/index.ts";
import { queue } from "./_routes/queue/index.ts";
import { unsubscribe_public } from "./_routes/unsubscribe-public/index.ts";
import { suppression } from "./_routes/suppression/index.ts";
import { unsubscribe_handle } from "./_routes/unsubscribe-handle/index.ts";
import { new_order } from "./_routes/new-order/index.ts";
import { customer_message } from "./_routes/customer-message/index.ts";

const handlers: Record<string, (req: Request, body?: unknown) => Promise<Response>> = {
  "/send-transactional": send_transactional,
  "/send-billing": send_billing,
  "/send-credit": send_credit,
  "/preview": preview,
  "/push": push,
  "/queue": queue,
  "/unsubscribe-public": unsubscribe_public,
  "/suppression": suppression,
  "/unsubscribe-handle": unsubscribe_handle,
  "/new-order": new_order,
  "/customer-message": customer_message,
  "/": (req) => Promise.resolve(new Response(JSON.stringify({ error: "route_required", available: ["send-transactional", "send-billing", "send-credit", "preview", "push", "queue", "unsubscribe-public", "suppression", "unsubscribe-handle", "new-order", "customer-message"] }), { status: 400, headers: { "Content-Type": "application/json" } })),
};

Deno.serve(async (req: Request) => route(req, handlers));
