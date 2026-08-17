// Sofia — IA com identidade FIXA por painel + contexto REAL do estado da loja/fornecedor/motoboy.
// Multi-provider: Google → Lovable → OpenRouter → Workers externos.
// v2: oferece FinanceFlow STM como produto irmão quando a dor é financeira.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildSofiaPrompt, OWNER_WA_LINK, type SofiaRole, type PromptVars } from "./_prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ApiKeyEntry { id: string; api_key: string; }
interface AiWorker { id: string; base_url: string; is_exhausted: boolean; }

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// ============================================================
// CONTEXTO REAL — busca dados ao vivo conforme o painel
// ============================================================

async function fetchMerchantContext(supabase: any, tenantId: string): Promise<{ name: string; slug: string; ctx: string } | null> {
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, slug, niche, scheduling_enabled, quotes_enabled, shipping_enabled, lalamove_enabled, mercadopago_token, store_mode")
    .eq("id", tenantId).maybeSingle();
  if (!tenant) return null;

  // Pedidos pendentes (received + preparing + out-for-delivery + ready-for-pickup)
  // Nota: status reais usam HÍFEN, não underscore.
  const { data: openOrders } = await supabase
    .from("orders").select("status")
    .eq("tenant_id", tenantId)
    .in("status", ["received", "preparing", "out-for-delivery", "ready-for-pickup"]);

  const counts = { received: 0, preparing: 0, out: 0, ready: 0 };
  (openOrders || []).forEach((o: any) => {
    if (o.status === "received") counts.received++;
    else if (o.status === "preparing") counts.preparing++;
    else if (o.status === "out-for-delivery") counts.out++;
    else if (o.status === "ready-for-pickup") counts.ready++;
  });

  const { count: productCount } = await supabase
    .from("products").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId);

  const features: string[] = [];
  if (tenant.scheduling_enabled) features.push("agendamento ATIVO");
  if (tenant.quotes_enabled) features.push("calculadora de orçamento ATIVA");
  if (tenant.shipping_enabled) features.push("frete ATIVO");
  if (tenant.lalamove_enabled) features.push("Lalamove configurado");
  if (tenant.mercadopago_token) features.push("Mercado Pago conectado");
  else features.push("⚠️ Mercado Pago NÃO conectado (Pix automático desligado)");

  const ctx = [
    `- Loja: **${tenant.name}** (modo: ${tenant.store_mode || "delivery"}, nicho: ${tenant.niche || "não definido"})`,
    `- Produtos cadastrados: ${productCount ?? 0}`,
    `- Pedidos abertos agora: ${counts.received} recebidos, ${counts.preparing} em preparo, ${counts.out} a caminho, ${counts.ready} prontos p/ retirada`,
    `- Configurações: ${features.join(", ")}`,
  ].join("\n");

  return { name: tenant.name, slug: tenant.slug, ctx };
}

function sseText(text: string): Response {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
    { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } },
  );
}

function extractOrderCode(text: string): string | null {
  const normalized = text.toLowerCase();
  if (!/(pedido|status|entrega|cliente|cobrando|código|codigo|#)/i.test(normalized)) return null;
  const explicit = normalized.match(/(?:pedido|status|c[oó]digo|#)\s*[:#-]?\s*([a-f0-9]{5,8})\b/i);
  if (explicit?.[1]) return explicit[1];
  const anyHex = normalized.match(/\b([a-f0-9]{6})\b/i);
  return anyHex?.[1] || null;
}

const statusLabels: Record<string, string> = {
  pending_payment: "aguardando pagamento",
  pending_review: "aguardando conferência",
  received: "recebido",
  preparing: "em preparo",
  "out-for-delivery": "saiu para entrega",
  "ready-for-pickup": "pronto para retirada",
  delivered: "entregue/finalizado",
  cancelled: "cancelado",
};

async function answerOrderStatusIfAsked(supabase: any, tenantId: string | undefined, text: string): Promise<Response | null> {
  if (!tenantId) return null;
  const code = extractOrderCode(text);
  if (!code) return null;

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status, customer_name, customer_phone, total, payment_method, delivery_type, created_at, updated_at, cancel_reason, auto_cancelled, order_items(product_name, quantity, product_price, variant_name)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;

  const matches = (orders || []).filter((o: any) => String(o.id).toLowerCase().startsWith(code.toLowerCase())).slice(0, 3);

  if (matches.length === 0) {
    return sseText(`Não achei pedido começando com **${code}** nessa loja. Confere se o código tem os 6 primeiros caracteres do pedido.`);
  }
  if (matches.length > 1) {
    const list = matches.map((o: any) => `#${String(o.id).slice(0, 6)} — ${statusLabels[o.status] || o.status} — ${o.customer_name || "cliente sem nome"}`).join("\n");
    return sseText(`Achei mais de um pedido com **${code}**:\n${list}\nMe manda o código com mais caracteres pra eu cravar.`);
  }

  const order = matches[0] as any;
  const { data: events } = await supabase
    .from("order_events")
    .select("event_type, from_status, to_status, actor, description, created_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });

  const items = (order.order_items || [])
    .map((item: any) => `${item.quantity}x ${item.product_name}${item.variant_name ? ` (${item.variant_name})` : ""}`)
    .join(", ") || "itens não carregados";
  const lastEvent = (events || []).at(-1);
  const action = order.status === "preparing"
    ? "Cliente tá cobrando: o pedido ainda está **em preparo**. Se já saiu da cozinha, abre o pedido e marca **Saiu para entrega**."
    : order.status === "received"
      ? "Cliente tá cobrando: ele ainda aparece como **recebido**. Se a cozinha já começou, marca **Em preparo** agora."
      : order.status === "out-for-delivery"
        ? "Cliente tá cobrando: ele já aparece como **saiu para entrega**. Confere com o motoboy/rota e responde com previsão."
        : order.status === "ready-for-pickup"
          ? "Cliente tá cobrando: está **pronto para retirada**. Avisa ele que já pode retirar."
          : order.status === "delivered"
            ? "Cliente tá cobrando, mas o sistema mostra **entregue/finalizado**. Confere se foi marcado certo antes de responder."
            : order.status === "cancelled"
              ? `Cliente tá cobrando: o pedido está **cancelado**${order.cancel_reason ? ` (${order.cancel_reason})` : ""}.`
              : "Cliente tá cobrando: confere o pedido na aba **Pedidos** pra avançar o próximo status correto.";

  const updated = order.updated_at ? new Date(order.updated_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
  return sseText(
    `Pedido **#${String(order.id).slice(0, 6)}** está **${statusLabels[order.status] || order.status}**.\n` +
    `Cliente: **${order.customer_name || "sem nome"}** · Total: **R$ ${Number(order.total || 0).toFixed(2).replace(".", ",")}** · Pagamento: **${order.payment_method || "não informado"}**.\n` +
    `Itens: ${items}.\n` +
    `Última atualização: ${updated}${lastEvent?.description ? ` — ${lastEvent.description}` : ""}.\n` +
    action,
  );
}

async function fetchSupplierContext(supabase: any, supplierId: string): Promise<{ name: string; tenantName: string; ctx: string } | null> {
  const { data: supplier } = await supabase
    .from("suppliers")
    .select("name, active, responsible_for_delivery, shipping_mode, lalamove_use_store_api, tenant_id, tenants(name)")
    .eq("id", supplierId).maybeSingle();
  if (!supplier) return null;

  const { data: openOrders } = await supabase
    .from("orders").select("status")
    .eq("supplier_id", supplierId)
    .in("status", ["received", "preparing", "out-for-delivery", "ready-for-pickup"]);

  const { count: productCount } = await supabase
    .from("products").select("*", { count: "exact", head: true }).eq("supplier_id", supplierId);

  const flags: string[] = [];
  flags.push(supplier.active ? "Status: ATIVO" : "⚠️ Status: PAUSADO (clientes não veem produtos)");
  flags.push(`Responsável pela entrega: ${supplier.responsible_for_delivery ? "SIM" : "NÃO (loja entrega)"}`);
  flags.push(`Frete: ${supplier.shipping_mode === "lalamove" ? "Lalamove" : "próprio (km)"}`);
  if (supplier.lalamove_use_store_api === "approved") flags.push("Loja LIBEROU uso da API Lalamove dela");
  else if (supplier.lalamove_use_store_api === "requested") flags.push("⏳ Aguardando loja aprovar uso da API Lalamove");

  const ctx = [
    `- Fornecedor: **${supplier.name}** da loja "${supplier.tenants?.name || "—"}"`,
    `- Produtos seus: ${productCount ?? 0}`,
    `- Pedidos abertos agora: ${openOrders?.length || 0}`,
    `- ${flags.join(" | ")}`,
  ].join("\n");

  return { name: supplier.name, tenantName: supplier.tenants?.name || "—", ctx };
}

async function fetchDriverContext(supabase: any, driverId: string): Promise<{ name: string; tenantName: string; ctx: string } | null> {
  const { data: driver } = await supabase
    .from("drivers")
    .select("name, active, is_online, tenant_id, tenants(name)")
    .eq("id", driverId).maybeSingle();
  if (!driver) return null;

  const { data: assigned } = await supabase
    .from("orders").select("status")
    .eq("driver_id", driverId)
    .in("status", ["out-for-delivery", "preparing"]);

  const ctx = [
    `- Motoboy: **${driver.name}** da loja "${driver.tenants?.name || "—"}"`,
    `- ${driver.is_online ? "🟢 Status: ONLINE (recebendo entregas)" : "⚫ Status: OFFLINE (não vai receber entrega — precisa ligar o toggle no topo)"}`,
    `- Entregas em aberto agora: ${assigned?.length || 0}`,
    `- ${driver.active ? "Conta ativa" : "⚠️ Conta inativa pelo lojista"}`,
  ].join("\n");

  return { name: driver.name, tenantName: driver.tenants?.name || "—", ctx };
}

// ============================================================
// PROVIDERS DE STREAMING (mesma lógica de fallback)
// ============================================================

async function getGoogleKeys(supabase: any) {
  const { data } = await supabase
    .from("api_keys").select("id, api_key")
    .eq("provider", "google_ai").eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  return (data || []) as ApiKeyEntry[];
}

async function getAllWorkers(supabase: any) {
  const { data: active } = await supabase
    .from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat")
    .order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: exhausted } = await supabase
    .from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat")
    .order("exhausted_at", { ascending: true, nullsFirst: true });
  return [...(active || []), ...(exhausted || [])] as AiWorker[];
}

async function tryGoogleStream(messages: any[], systemPrompt: string, keys: ApiKeyEntry[], supabase: any): Promise<Response | null> {
  const allKeys = keys.length > 0 ? keys
    : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : [];

  const geminiMessages = messages.map((m: any) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const payload = {
    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
    contents: geminiMessages,
    generationConfig: { temperature: 0.4, maxOutputTokens: 700, topP: 0.9 },
  };

  for (const keyEntry of allKeys) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:streamGenerateContent?alt=sse&key=${keyEntry.api_key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      if (response.status === 429 || response.status === 403) {
        if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
        continue;
      }
      if (!response.ok) continue;
      if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyEntry.id);
      return streamGeminiResponse(response);
    } catch (e) { console.error("Sofia Google failed:", e); continue; }
  }
  return null;
}

function streamGeminiResponse(response: Response): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  (async () => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) await writer.write(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
          } catch {}
        }
      }
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch (e) { console.error("Sofia stream error:", e); }
    finally { writer.close(); }
  })();
  return new Response(readable, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
}

async function tryLovableStream(messages: any[], systemPrompt: string): Promise<Response | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true, temperature: 0.4, max_tokens: 700 }),
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch { return null; }
}

async function tryOpenRouterStream(messages: any[], systemPrompt: string): Promise<Response | null> {
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!OPENROUTER_API_KEY) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.0-flash-exp:free", messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true, max_tokens: 700 }),
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch { return null; }
}

async function tryWorkerStream(messages: any[], systemPrompt: string, workers: AiWorker[], supabase: any): Promise<Response | null> {
  const PARALLEL = 3;
  const TIMEOUT_MS = 6000;

  const attemptOne = async (worker: AiWorker, signal: AbortSignal): Promise<{ worker: AiWorker; response: Response } | null> => {
    const url = worker.base_url.includes('/functions/') ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, systemPrompt, tenantName: "Sofia", niche: "plataforma" }),
        signal,
      });
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        if (!worker.is_exhausted) await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
        try { response.body?.cancel(); } catch {}
        return null;
      }
      if (!response.ok) { try { response.body?.cancel(); } catch {} return null; }
      return { worker, response };
    } catch {
      if (!worker.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id).then(() => {}, () => {});
      }
      return null;
    }
  };

  for (let i = 0; i < workers.length; i += PARALLEL) {
    const batch = workers.slice(i, i + PARALLEL);
    const ctrls = batch.map(() => new AbortController());
    const timers = ctrls.map((c) => setTimeout(() => c.abort(), TIMEOUT_MS));
    const promises = batch.map((w, idx) => attemptOne(w, ctrls[idx].signal).then((r) => r ?? Promise.reject(new Error("nope"))));
    let winnerIdx = -1;
    let winner: { worker: AiWorker; response: Response } | null = null;
    try {
      winner = await Promise.any(promises);
      winnerIdx = batch.findIndex((b) => b.id === winner!.worker.id);
    } catch { winner = null; }
    timers.forEach(clearTimeout);
    if (winner) {
      ctrls.forEach((c, idx) => { if (idx !== winnerIdx) c.abort(); });
      const w = winner.worker;
      if (w.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: new Date().toISOString() }).eq("id", w.id);
      } else {
        await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", w.id);
      }
      return new Response(winner.response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
    }
  }
  return null;
}

// ============================================================
// HANDLER
// ============================================================

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { messages, role, tenantId, supplierId, driverId } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normaliza role (default: visitor)
    const sofiaRole: SofiaRole = ["visitor", "merchant", "supplier", "driver"].includes(role) ? role : "visitor";

    const supabase = getSupabaseAdmin();

    const latestUserText = [...messages].reverse().find((m: any) => m?.role === "user")?.content || "";
    if (sofiaRole === "merchant" && tenantId && typeof latestUserText === "string") {
      const directOrderAnswer = await answerOrderStatusIfAsked(supabase, tenantId, latestUserText);
      if (directOrderAnswer) return directOrderAnswer;
    }

    // Busca contexto real conforme o papel
    const vars: PromptVars = {};
    try {
      if (sofiaRole === "merchant" && tenantId) {
        const ctx = await fetchMerchantContext(supabase, tenantId);
        if (ctx) { vars.tenantName = ctx.name; vars.tenantSlug = ctx.slug; vars.tenantContext = ctx.ctx; }
      } else if (sofiaRole === "supplier" && supplierId) {
        const ctx = await fetchSupplierContext(supabase, supplierId);
        if (ctx) { vars.supplierName = ctx.name; vars.tenantName = ctx.tenantName; vars.supplierContext = ctx.ctx; }
      } else if (sofiaRole === "driver" && driverId) {
        const ctx = await fetchDriverContext(supabase, driverId);
        if (ctx) { vars.driverName = ctx.name; vars.tenantName = ctx.tenantName; vars.driverContext = ctx.ctx; }
      }
    } catch (e) {
      console.error("Sofia context fetch failed:", e);
      // Segue sem contexto — o prompt já tem fallback "(sem dados ao vivo agora)"
    }

    // Status dos AI Workers (para a Sofia saber explicar fallback / problemas de IA)
    let workersInfo = "";
    try {
      const { data: ws } = await supabase
        .from("ai_workers")
        .select("worker_type, is_active, is_exhausted")
        .eq("is_active", true);
      const stats = { chat: { ok: 0, exh: 0 }, image: { ok: 0, exh: 0 }, txt: { ok: 0, exh: 0 } } as any;
      (ws || []).forEach((w: any) => {
        const t = (w.worker_type || "chat") as "chat" | "image" | "txt";
        if (!stats[t]) return;
        if (w.is_exhausted) stats[t].exh++; else stats[t].ok++;
      });
      const { data: keys } = await supabase
        .from("api_keys").select("is_exhausted")
        .eq("provider", "google_ai");
      const gOk = (keys || []).filter((k: any) => !k.is_exhausted).length;
      const gExh = (keys || []).filter((k: any) => k.is_exhausted).length;
      workersInfo = [
        "## Status atual da infraestrutura de IA (você sabe disso e pode explicar pro usuário se ele perguntar)",
        `- Chaves Google AI do super admin: ${gOk} ativas, ${gExh} esgotadas`,
        `- Workers de chat: ${stats.chat.ok} ativos, ${stats.chat.exh} esgotados`,
        `- Workers de imagem: ${stats.image.ok} ativos, ${stats.image.exh} esgotados`,
        `- Workers de parse TXT: ${stats.txt.ok} ativos, ${stats.txt.exh} esgotados`,
        `- Ordem de fallback automática em TODA IA da plataforma: Google keys → Lovable AI → OpenRouter → Workers externos. Se não tem crédito Lovable nem chave Google funcionando, o sistema usa workers automaticamente. Se o usuário reclamar que IA não responde, peça pra ele cadastrar workers em /super-admin → "Workers IA".`,
      ].join("\n");
    } catch (e) {
      console.warn("Sofia workers info failed:", e);
    }

    const baseSystemPrompt = buildSofiaPrompt(sofiaRole, vars);
    const systemPrompt = workersInfo ? `${baseSystemPrompt}\n\n${workersInfo}` : baseSystemPrompt;
    console.log(`[sofia] role=${sofiaRole} tenant=${vars.tenantName || "—"} supplier=${vars.supplierName || "—"} driver=${vars.driverName || "—"}`);

    const [keys, workers] = await Promise.all([getGoogleKeys(supabase), getAllWorkers(supabase)]);

    // 🚀 Race Google vs Lovable em paralelo
    const wrap = (p: Promise<Response | null>) => p.then((r) => r ?? Promise.reject(new Error("nope")));
    try {
      const winner = await Promise.any([
        wrap(tryGoogleStream(messages, systemPrompt, keys, supabase)),
        wrap(tryLovableStream(messages, systemPrompt)),
      ]);
      return winner;
    } catch { console.log("Sofia: Google+Lovable falharam, tentando OpenRouter..."); }
    const r3 = await tryOpenRouterStream(messages, systemPrompt);
    if (r3) return r3;
    console.log("Sofia: OpenRouter failed, trying workers...");
    const r4 = await tryWorkerStream(messages, systemPrompt, workers, supabase);
    if (r4) return r4;

    return new Response(JSON.stringify({
      error: `Tô com instabilidade na IA agora 😅 Fala direto comigo: ${OWNER_WA_LINK}`
    }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat-sofia error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
