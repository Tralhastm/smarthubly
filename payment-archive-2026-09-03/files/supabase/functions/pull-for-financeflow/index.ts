// Endpoint público pro Send My File / FinanceFlow puxar dados desta loja.
// Auth: header X-Store-Api-Key (igual ao integration_settings.api_key do tenant).
// GET ?since=ISO_DATE → devolve { tenant, products, sales, stock_changes }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-store-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = req.headers.get("x-store-api-key") || req.headers.get("X-Store-Api-Key");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "X-Store-Api-Key header obrigatório" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Acha tenant pela api_key
    const { data: settings, error: sErr } = await supabase
      .from("integration_settings")
      .select("tenant_id, enabled, sync_orders, sync_products, sync_stock")
      .eq("api_key", apiKey)
      .maybeSingle();

    if (sErr || !settings) {
      return new Response(JSON.stringify({ error: "API key inválida" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (!settings.enabled) {
      return new Response(JSON.stringify({ error: "Integração desabilitada para esta loja" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const url = new URL(req.url);
    const since = url.searchParams.get("since"); // ISO date opcional

    const { data: tenant } = await supabase
      .from("tenants").select("id, name, slug, niche").eq("id", settings.tenant_id).maybeSingle();

    // Produtos
    let products: any[] = [];
    if (settings.sync_products) {
      const q = supabase.from("products")
        .select("id,name,price,original_price,category,subcategory,description,image,in_stock,stock_quantity,item_type,updated_at")
        .eq("tenant_id", settings.tenant_id);
      const { data } = since ? await q.gte("updated_at", since) : await q;
      products = data || [];
    }

    // Vendas (só entregues)
    let sales: any[] = [];
    if (settings.sync_orders) {
      const q = supabase.from("orders")
        .select("id,total,delivery_fee,discount_amount,payment_method,customer_name,customer_phone,delivery_type,status,created_at,updated_at,coupon_code")
        .eq("tenant_id", settings.tenant_id)
        .eq("status", "delivered");
      const { data } = since ? await q.gte("updated_at", since) : await q;
      sales = data || [];

      // Itens das vendas (uma chamada só)
      if (sales.length > 0) {
        const { data: items } = await supabase.from("order_items")
          .select("order_id,product_name,product_price,quantity,variant_name,addons,notes")
          .in("order_id", sales.map(s => s.id));
        const byOrder: Record<string, any[]> = {};
        (items || []).forEach((it: any) => {
          (byOrder[it.order_id] ||= []).push(it);
        });
        sales = sales.map(s => ({ ...s, items: byOrder[s.id] || [] }));
      }
    }

    // Stock changes = snapshot atual (FinanceFlow decide diff)
    const stock = settings.sync_stock
      ? products.map((p: any) => ({ id: p.id, name: p.name, stock_quantity: p.stock_quantity, in_stock: p.in_stock }))
      : [];

    // Financeiro completo (entradas manuais, previsões, formas de pagto)
    let financialEntriesQ = supabase.from("financial_entries")
      .select("id,type,category,description,amount,date,payment_method,is_forecast,forecast_date,received_at,created_at")
      .eq("tenant_id", settings.tenant_id);
    if (since) financialEntriesQ = financialEntriesQ.gte("created_at", since);
    const { data: financial_entries } = await financialEntriesQ;

    // Investimentos
    let investmentsQ = supabase.from("investments")
      .select("id,name,kind,amount,yield_rate,started_at,matures_at,liquidated_at,notes,created_at,updated_at")
      .eq("tenant_id", settings.tenant_id);
    if (since) investmentsQ = investmentsQ.gte("updated_at", since);
    const { data: investments } = await investmentsQ;

    // Dívidas (a pagar e a receber)
    let debtsQ = supabase.from("debts")
      .select("id,name,amount,due_date,paid,type,created_at,updated_at")
      .eq("tenant_id", settings.tenant_id);
    if (since) debtsQ = debtsQ.gte("updated_at", since);
    const { data: debts } = await debtsQ;

    // Fiados (credit_accounts)
    let creditsQ = supabase.from("credit_accounts")
      .select("id,customer_name,customer_phone,amount,amount_paid,description,due_date,paid_at,status,reminders_sent,last_reminder_at,created_at,updated_at")
      .eq("tenant_id", settings.tenant_id);
    if (since) creditsQ = creditsQ.gte("updated_at", since);
    const { data: credit_accounts } = await creditsQ;

    // Marca último sync
    await supabase.from("integration_settings").update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: "success_pull",
      last_sync_error: "",
    }).eq("tenant_id", settings.tenant_id);

    return new Response(JSON.stringify({
      tenant: { id: tenant?.id, name: tenant?.name, slug: tenant?.slug, niche: tenant?.niche },
      products, sales, stock,
      financial_entries: financial_entries || [],
      investments: investments || [],
      debts: debts || [],
      credit_accounts: credit_accounts || [],
      generated_at: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("pull-for-financeflow error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
