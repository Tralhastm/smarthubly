import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { callAiStream } from "../_shared/ai-fallback.ts";
import { CINDY_SYSTEM_PROMPT } from "./_prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

async function fetchPlatformContext(admin: any) {
  const [tenants, orders, metrics, workers, tickets] = await Promise.all([
    admin.from("tenants").select("id, name, slug, active, blocked").limit(50),
    admin.from("orders").select("id, total, status").not("status", "in", "(delivered,cancelled)").limit(20),
    admin.from("platform_metrics").select("*").order("date", { ascending: false }).limit(1),
    admin.from("ai_workers").select("name, is_exhausted"),
    admin.from("support_tickets").select("id, subject, status").eq("status", "open").limit(5)
  ]);

  return `
[CONTEXTO GLOBAL PLATAFORMA]
- Lojas: ${tenants.data?.length || 0} totais (${tenants.data?.filter((t: any) => t.active && !t.blocked).length} ativas)
- Pedidos em aberto no sistema: ${orders.data?.length || 0}
- Workers esgotados: ${workers.data?.filter((w: any) => w.is_exhausted).map((w: any) => w.name).join(", ") || "nenhum"}
- Chamados abertos: ${tickets.data?.length || 0}
`.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("unauthorized");
    const token = authHeader.slice(7);
    const { data: { user } } = await createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    }).auth.getUser();
    
    if (!user) throw new Error("unauthorized");
    const { data: role } = await admin.from("platform_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
    if (!role) throw new Error("super_admin_required");

    const { messages } = await req.json();
    const platformCtx = await fetchPlatformContext(admin);
    const fullPrompt = `${CINDY_SYSTEM_PROMPT}\n\n${platformCtx}`;

    return await callAiStream(admin, {
      systemPrompt: fullPrompt,
      messages,
      temperature: 0.7,
      maxTokens: 1000
    });

  } catch (e: any) {
    console.error("[cindy-agent] erro:", e);
    return new Response(JSON.stringify({ error: e.message }), { 
      status: e.message === "unauthorized" ? 401 : 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
