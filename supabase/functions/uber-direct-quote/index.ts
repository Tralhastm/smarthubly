// Edge function: cota uma entrega via Uber Direct (teste manual / debug)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { quoteUberDirect } from "../_shared/uber-direct.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { tenantId, pickupAddress, dropoffAddress } = await req.json();
    if (!tenantId || !pickupAddress || !dropoffAddress) {
      return new Response(JSON.stringify({ error: "tenantId, pickupAddress, dropoffAddress obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: tenant } = await supabase
      .from("tenants")
      .select("uber_direct_enabled, uber_direct_customer_id, uber_direct_client_id, uber_direct_client_secret, uber_direct_sandbox, uber_direct_use_platform_keys")
      .eq("id", tenantId).maybeSingle();

    // Se o super-admin ativou DEMO, força chaves globais sandbox mesmo se a loja tiver chaves próprias salvas.
    const usePlatform = !!tenant?.uber_direct_use_platform_keys;
    const hasOwnKeys = !usePlatform && !!(tenant?.uber_direct_customer_id && tenant?.uber_direct_client_id && tenant?.uber_direct_client_secret);
    const customerId = usePlatform ? Deno.env.get("UBER_CUSTOMER_ID") || "" : (hasOwnKeys ? tenant!.uber_direct_customer_id : "");
    const clientId = usePlatform ? Deno.env.get("UBER_CLIENT_ID") || "" : (hasOwnKeys ? tenant!.uber_direct_client_id : "");
    const clientSecret = usePlatform ? Deno.env.get("UBER_CLIENT_SECRET") || "" : (hasOwnKeys ? tenant!.uber_direct_client_secret : "");
    const sandbox = usePlatform ? true : !!tenant!.uber_direct_sandbox; // chaves da plataforma sempre sandbox

    if (!customerId || !clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: "Uber Direct não configurado nesta loja" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = await quoteUberDirect(
      { customerId, clientId, clientSecret, sandbox },
      { pickupAddress, dropoffAddress }
    );
    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
