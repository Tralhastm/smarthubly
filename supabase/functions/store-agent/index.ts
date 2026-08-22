import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { callAiStream } from "../_shared/ai-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

async function getProductsForTenant(supabase: any, tenantId: string) {
  if (!tenantId) return { text: "", products: [] };
  const { data } = await supabase.from("products").select("id, name, price, original_price, category, subcategory, description, in_stock, item_type, duration_minutes, stock_quantity").eq("tenant_id", tenantId).eq("in_stock", true).limit(100);
  if (!data || data.length === 0) return { text: "", products: [] };
  const text = "\n\nPRODUTOS DISPONÍVEIS NA LOJA (use NOME e PREÇO EXATOS):\n" + data.map((p: any) => {
    const priceTag = `R$${Number(p.price).toFixed(2)}`;
    const promo = p.original_price > p.price ? ` (de R$${Number(p.original_price).toFixed(2)} POR ${priceTag} 🔥)` : ` ${priceTag}`;
    const cat = [p.category, p.subcategory].filter(Boolean).join(' › ');
    const tipo = p.item_type === 'service' ? ` | SERVIÇO (~${p.duration_minutes || 30} min)` : '';
    const stock = p.stock_quantity != null && p.stock_quantity <= 5 && p.stock_quantity > 0 ? ` | ⚠️ últimas ${p.stock_quantity} un` : '';
    const desc = p.description ? ` | ${String(p.description).slice(0, 120)}` : '';
    return `- ${p.name}${promo}${cat ? ` | ${cat}` : ''}${tipo}${stock}${desc}`;
  }).join("\n");
  return { text, products: data };
}

async function buildStoreContext(supabase: any, tenantId: string, products: any[]) {
  if (!tenantId) return "";
  const [tenantRes, couponsRes] = await Promise.all([
    supabase.from("tenants").select("name, niche, store_mode, promo_active, promo_title, promo_text, shipping_enabled, shipping_mode, shipping_base_fee, shipping_per_km_fee, shipping_max_fee, pickup_enabled, lalamove_enabled, scheduling_enabled, scheduling_open_days, scheduling_open_time, scheduling_close_time, scheduling_slot_minutes, mercadopago_token, pix_key, whatsapp, address").eq("id", tenantId).maybeSingle(),
    supabase.from("coupons").select("code, discount_type, discount_value, min_order_value, expires_at, max_uses, uses_count").eq("tenant_id", tenantId).eq("active", true)
  ]);
  const tenant = tenantRes.data;
  if (!tenant) return "";
  const lines = ["\n\nINFORMAÇÕES DA LOJA (use pra responder dúvidas com PRECISÃO):"];
  if (tenant.promo_active && tenant.promo_title) lines.push(`🎁 PROMOÇÃO ATIVA: "${tenant.promo_title}"${tenant.promo_text ? ` — ${tenant.promo_text}` : ''}`);
  const validCoupons = (couponsRes.data || []).filter((c: any) => !(c.expires_at && new Date(c.expires_at) < new Date()) && !(c.max_uses != null && c.uses_count >= c.max_uses));
  if (validCoupons.length > 0) {
    lines.push(`💸 CUPONS VÁLIDOS:`);
    validCoupons.slice(0, 5).forEach((c: any) => lines.push(`  • ${c.code} → ${c.discount_type === 'percent' ? `${c.discount_value}% OFF` : `R$${Number(c.discount_value).toFixed(2)} OFF`}`));
  }
  const entrega = [];
  if (tenant.pickup_enabled) entrega.push("retirada na loja (grátis)");
  if (tenant.shipping_enabled) entrega.push(tenant.shipping_mode === 'lalamove' ? "entrega via Lalamove" : `entrega própria: R$${Number(tenant.shipping_base_fee || 0).toFixed(2)} base`);
  if (entrega.length > 0) lines.push(`🚚 ENTREGA: ${entrega.join(' • ')}`);
  const pagamento = ["dinheiro na entrega"];
  if (tenant.mercadopago_token) pagamento.push("Pix automático", "cartão");
  else if (tenant.pix_key) pagamento.push(`Pix (${tenant.pix_key})`);
  lines.push(`💳 PAGAMENTO: ${pagamento.join(' • ')}`);
  if (tenant.address) lines.push(`📍 Endereço: ${tenant.address}`);
  if (tenant.whatsapp) lines.push(`📱 WhatsApp: ${tenant.whatsapp}`);
  return lines.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { messages, tenantId, tenantName, niche } = await req.json();

    if (!tenantId) return new Response("tenantId required", { status: 400, headers: corsHeaders });

    const { text: productText, products } = await getProductsForTenant(admin, tenantId);
    const storeCtx = await buildStoreContext(admin, tenantId, products);

    const systemPrompt = `Você é o assistente virtual da loja **${tenantName || "nossa loja"}** (${niche || "comércio"}).
Seu objetivo é ajudar o cliente a escolher produtos e tirar dúvidas.
Seja educado, prestativo e use o contexto abaixo para responder.${productText}${storeCtx}`;

    return await callAiStream(admin, {
      systemPrompt,
      messages,
      temperature: 0.7,
      maxTokens: 800
    });
  } catch (e: any) {
    console.error("[store-agent] erro:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
