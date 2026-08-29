import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ApiKeyEntry { id: string; api_key: string; }
interface AiWorker { id: string; base_url: string; is_exhausted: boolean; }

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function getGoogleKeys(supabase: any) {
  const { data } = await supabase
    .from("api_keys").select("id, api_key")
    .eq("provider", "google_ai").eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  return (data || []) as ApiKeyEntry[];
}

// Busca workers do tipo 'chat': ativos primeiro, esgotados por último (ordenados por exhausted_at ASC = mais antigo primeiro, provavelmente já resetou)
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

async function getProductsForTenant(supabase: any, tenantId: string) {
  if (!tenantId) return { text: "", products: [] };
  const { data } = await supabase
    .from("products").select("id, name, price, original_price, category, subcategory, description, in_stock, item_type, duration_minutes, stock_quantity")
    .eq("tenant_id", tenantId).eq("in_stock", true)
    .limit(100);
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

// Contexto rico da loja: promo ativa, cupons válidos, frete, pagamento, agendamento
async function buildStoreContext(supabase: any, tenantId: string, products: any[]): Promise<string> {
  if (!tenantId) return "";
  const [tenantRes, couponsRes] = await Promise.all([
    supabase.from("tenants").select("promo_active, promo_title, promo_text, shipping_enabled, shipping_mode, shipping_base_fee, shipping_per_km_fee, shipping_max_fee, pickup_enabled, lalamove_enabled, scheduling_enabled, scheduling_open_days, scheduling_open_time, scheduling_close_time, scheduling_slot_minutes, mercadopago_token, pix_key, whatsapp, address, niche").eq("id", tenantId).maybeSingle(),
    supabase.from("coupons").select("code, discount_type, discount_value, min_order_value, expires_at, max_uses, uses_count").eq("tenant_id", tenantId).eq("active", true),
  ]);
  const tenant = tenantRes.data;
  if (!tenant) return "";
  const lines: string[] = ["\n\nINFORMAÇÕES DA LOJA (use pra responder dúvidas com PRECISÃO):"];

  // Promo banner
  if (tenant.promo_active && tenant.promo_title) {
    lines.push(`🎁 PROMOÇÃO ATIVA: "${tenant.promo_title}"${tenant.promo_text ? ` — ${tenant.promo_text}` : ''} (sempre mencione quando o cliente parecer indeciso!)`);
  }

  // Cupons
  const validCoupons = (couponsRes.data || []).filter((c: any) => {
    if (c.expires_at && new Date(c.expires_at) < new Date()) return false;
    if (c.max_uses != null && c.uses_count >= c.max_uses) return false;
    return true;
  });
  if (validCoupons.length > 0) {
    lines.push(`💸 CUPONS VÁLIDOS (cite quando fizer sentido pra fechar venda):`);
    validCoupons.slice(0, 5).forEach((c: any) => {
      const value = c.discount_type === 'percent' ? `${c.discount_value}% OFF` : `R$${Number(c.discount_value).toFixed(2)} OFF`;
      const min = Number(c.min_order_value) > 0 ? ` (mín. R$${Number(c.min_order_value).toFixed(2)})` : '';
      lines.push(`  • ${c.code} → ${value}${min}`);
    });
  }

  // Entrega
  const entrega: string[] = [];
  if (tenant.pickup_enabled) entrega.push("retirada na loja (grátis)");
  if (tenant.shipping_enabled) {
    if (tenant.shipping_mode === 'lalamove' || tenant.lalamove_enabled) {
      entrega.push("entrega via Lalamove (motoboy on-demand, calculado por distância)");
    } else {
      const base = `R$${Number(tenant.shipping_base_fee || 0).toFixed(2)} base + R$${Number(tenant.shipping_per_km_fee || 0).toFixed(2)}/km`;
      const max = tenant.shipping_max_fee ? ` (máx R$${Number(tenant.shipping_max_fee).toFixed(2)})` : '';
      entrega.push(`entrega própria: ${base}${max}`);
    }
  }
  if (entrega.length > 0) lines.push(`🚚 ENTREGA: ${entrega.join(' • ')}`);

  // Pagamento
  const pagamento: string[] = ["dinheiro na entrega"];
  if (tenant.mercadopago_token) pagamento.push("Pix automático", "cartão de crédito/débito");
  else if (tenant.pix_key) pagamento.push(`Pix (${tenant.pix_key_type || 'chave'})`);
  lines.push(`💳 PAGAMENTO: ${pagamento.join(' • ')}`);

  // Endereço/contato
  if (tenant.address) lines.push(`📍 Endereço: ${tenant.address}`);
  if (tenant.whatsapp) lines.push(`📱 WhatsApp: ${tenant.whatsapp}`);

  // Agendamento
  const services = products.filter(p => p.item_type === 'service');
  if (tenant.scheduling_enabled && services.length > 0) {
    const dias = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const openDays = (tenant.scheduling_open_days || [1,2,3,4,5,6]).map((d: number) => dias[d]).join(', ');
    lines.push(`\n📅 AGENDAMENTO: aberto ${openDays} das ${tenant.scheduling_open_time || '09:00'} às ${tenant.scheduling_close_time || '18:00'} (slots de ${tenant.scheduling_slot_minutes || 30}min).`);
    lines.push(`REGRA: VOCÊ NÃO MARCA HORÁRIO PELO CHAT. Oriente: "Pra agendar é rápido — escolhe o serviço aqui no catálogo, joga no carrinho e na hora de finalizar você escolhe dia e horário disponível." NUNCA invente horário. NUNCA peça nome/telefone — isso é no checkout.`);
  }

  return lines.join("\n");
}

// Provider 1: Google AI (streaming)
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
    generationConfig: { temperature: 0.4, maxOutputTokens: 600, topP: 0.9 },
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
    } catch (e) { console.error("Google attempt failed:", e); continue; }
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
    } catch (e) { console.error("Stream error:", e); }
    finally { writer.close(); }
  })();

  return new Response(readable, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
}

// Provider 2: Lovable AI Gateway (streaming)
async function tryLovableStream(messages: any[], systemPrompt: string): Promise<Response | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true, temperature: 0.4, max_tokens: 600 }),
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch { return null; }
}

// Provider 3: OpenRouter (streaming)
async function tryOpenRouterStream(messages: any[], systemPrompt: string): Promise<Response | null> {
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!OPENROUTER_API_KEY) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.0-flash-exp:free", messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true, temperature: 0.4, max_tokens: 600 }),
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch { return null; }
}

// Provider 4: External AI Workers (streaming) - com reciclagem automática
// Race em paralelo dos primeiros N workers — vence o que responder primeiro com headers OK,
// os outros são abortados. Workers mortos caem no timeout (6s) e são marcados como exhausted.
async function tryWorkerStream(messages: any[], systemPrompt: string, tenantName: string, niche: string, workers: AiWorker[], supabase: any): Promise<Response | null> {
  const PARALLEL = 3;
  const TIMEOUT_MS = 6000;

  const attemptOne = async (worker: AiWorker, signal: AbortSignal): Promise<{ worker: AiWorker; response: Response } | null> => {
    const url = worker.base_url.includes('/functions/') ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, systemPrompt, tenantName, niche }),
        signal,
      });
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        if (!worker.is_exhausted) {
          await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
        }
        try { response.body?.cancel(); } catch {}
        return null;
      }
      if (!response.ok) { try { response.body?.cancel(); } catch {} return null; }
      return { worker, response };
    } catch (e) {
      // timeout ou rede morta → marca como esgotado pra cair no fim da fila
      if (!worker.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id).then(() => {}, () => {});
      }
      return null;
    }
  };

  // Processa em batches paralelos; primeiro batch que retornar um vencedor encerra
  for (let i = 0; i < workers.length; i += PARALLEL) {
    const batch = workers.slice(i, i + PARALLEL);
    // Um AbortController por worker pra poder abortar os perdedores SEM matar o vencedor
    const ctrls = batch.map(() => new AbortController());
    const timers = ctrls.map((c) => setTimeout(() => c.abort(), TIMEOUT_MS));

    const promises = batch.map((w, idx) =>
      attemptOne(w, ctrls[idx].signal).then((r, ) => r ?? Promise.reject(new Error("nope")))
    );
    let winnerIdx = -1;
    let winner: { worker: AiWorker; response: Response } | null = null;
    try {
      winner = await Promise.any(promises);
      winnerIdx = batch.findIndex((b) => b.id === winner!.worker.id);
    } catch { winner = null; }
    timers.forEach(clearTimeout);

    if (winner) {
      // Aborta APENAS os perdedores
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { messages, tenantName, niche, tenantId } = body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Campo 'messages' deve ser um array não vazio." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getSupabaseAdmin();
    
    // Buscar produtos do tenant para incluir no contexto da IA
    const { text: productsContext, products } = await getProductsForTenant(supabase, tenantId);
    const storeContext = await buildStoreContext(supabase, tenantId, products);

    const productsAvailable = products.length > 0;
    const systemPrompt = `Você é vendedor(a) consultivo(a) da loja "${tenantName}" (${niche || 'produtos'}). Conhece TUDO da loja: catálogo, promoções, cupons, frete, pagamento, agendamento. Sua missão é VENDER de forma natural e útil — não empurrar.

🚨 REGRA #1 — CONHECIMENTO DA LOJA:
Você só fala sobre o que ESTÁ no contexto abaixo (catálogo, promo, cupons, frete, pagamento). Se o cliente perguntar algo que NÃO está no contexto (ex: "vocês vendem X que não tem aqui?"), responda honesto: "Esse específico a gente não tem, mas tenho [item parecido REAL do catálogo] por R$X que pode te atender." NUNCA invente preço, marca, prazo, horário ou cupom.

🚨 REGRA #2 — RECOMENDAÇÃO COM PROVA:
Em TODA resposta cite pelo menos 1 produto/serviço REAL do catálogo com NOME EXATO + PREÇO EXATO. Se houver promoção ativa OU cupom válido que se aplique, MENCIONE pra fechar a venda. Se houver "últimas X un", crie urgência ("ó, só restam X").

🚨 REGRA #3 — TAMANHO E TOM:
MÁXIMO 4 linhas curtas. Tom de amigo no WhatsApp, não vendedor de telemarketing. No máximo 1 emoji. Sem listas numeradas. Sem títulos em ###. Sem **negrito** em subtítulos. Sem "consulte um profissional/especialista" — VOCÊ é o especialista da loja aqui.

ESTRUTURA NATURAL (4 linhas, sem rótulos):
1. Empatia/contexto curto
2. Recomendação real fluida ("Aqui temos [NOME] por R$X, perfeito pra isso")
3. Gancho extra se relevante (cupom, promo, frete grátis em retirada, urgência de estoque)
4. CTA suave ("Quer adicionar no carrinho?" / "Posso te ajudar a finalizar?")

🚨 REGRA #4 — VOCÊ NÃO EXECUTA AÇÕES, VOCÊ ENSINA:
Você é um chat de TEXTO. NÃO consegue criar pedido, marcar/agendar horário, aplicar cupom, dar baixa em estoque, processar pagamento, mandar mensagem ou clicar em nada pelo cliente. NUNCA diga "vou marcar", "já agendei", "tô preparando seu pedido", "vou aplicar o cupom", "já adicionei no carrinho", "tô processando". Em vez disso, ENSINE o caminho:
- Pedido: "Pra fechar é só clicar no produto, **Adicionar ao carrinho** e finalizar pelo botão do carrinho no topo."
- Agendamento: "Pra marcar, abre o serviço no catálogo, joga no carrinho e na hora de finalizar você escolhe o dia e horário disponível."
- Cupom: "No checkout aparece o campo **Cupom** — digita TESTE10 e aplica."
NUNCA pergunte "quer que eu prepare/marque/agende pra você" — quem faz é o cliente, você só guia.

❌ PROIBIDO: inventar produto/preço/cupom/horário; prometer ações que não executa; mandar pra concorrente; "como posso ajudar?" sem recomendar nada; texto longo; markdown pesado.

${productsAvailable ? '' : '⚠️ CATÁLOGO VAZIO — peça desculpa em 2 linhas e oriente o WhatsApp da loja se houver.'}${productsContext}${storeContext}`;

    const [keys, workers] = await Promise.all([getGoogleKeys(supabase), getAllWorkers(supabase)]);

    // 🚀 1+2. Race Google vs Lovable em paralelo
    const wrap = (p: Promise<Response | null>) => p.then((r) => r ?? Promise.reject(new Error("nope")));
    try {
      const winner = await Promise.any([
        wrap(tryGoogleStream(messages, systemPrompt, keys, supabase)),
        wrap(tryLovableStream(messages, systemPrompt)),
      ]);
      return winner;
    } catch { console.log("Google+Lovable falharam, tentando OpenRouter..."); }

    // 3. OpenRouter
    const r3 = await tryOpenRouterStream(messages, systemPrompt);
    if (r3) return r3;

    // 4. External Workers (ativos + esgotados reciclados)
    console.log("OpenRouter failed, trying AI workers (including recycled)...");
    const r4 = await tryWorkerStream(messages, systemPrompt, tenantName, niche, workers, supabase);
    if (r4) return r4;

    return new Response(JSON.stringify({ error: "Todos os provedores de IA falharam." }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("store-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
