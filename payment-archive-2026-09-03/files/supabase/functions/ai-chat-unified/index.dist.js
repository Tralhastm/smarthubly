var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../_shared/ai-fallback.ts
var ai_fallback_exports = {};
__export(ai_fallback_exports, {
  callAiJson: () => callAiJson,
  callAiStream: () => callAiStream,
  callAiText: () => callAiText,
  callAiWithFallback: () => callAiWithFallback
});
async function getGoogleKeys2(supabase) {
  const { data } = await supabase.from("api_keys").select("id, api_key").eq("provider", "google_ai").eq("is_exhausted", false).order("last_used_at", { ascending: true, nullsFirst: true });
  return data || [];
}
async function getChatWorkers(supabase) {
  const { data: active } = await supabase.from("ai_workers").select("id, base_url, is_exhausted").eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat").order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: exhausted } = await supabase.from("ai_workers").select("id, base_url, is_exhausted").eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat").order("exhausted_at", { ascending: true, nullsFirst: true });
  return [...active || [], ...exhausted || []];
}
async function tryLovable(opts) {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  try {
    const body = {
      model: opts.model || "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt }
      ]
    };
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
    if (opts.jsonMode) body.response_format = { type: "json_object" };
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.status === 429 || res.status === 402 || !res.ok) {
      console.log(`[ai-fallback] Lovable falhou: ${res.status}`);
      return null;
    }
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || "").trim();
    return text || null;
  } catch (e) {
    console.error("[ai-fallback] Lovable exception:", e);
    return null;
  }
}
async function tryGoogle(opts, keys, supabase) {
  const allKeys = keys.length > 0 ? keys : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY") }] : [];
  if (allKeys.length === 0) return null;
  const AF_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"];
  for (const keyEntry of allKeys) {
    for (const modelName of AF_MODELS) {
      try {
        const generationConfig = {};
        if (opts.jsonMode) generationConfig.responseMimeType = "application/json";
        if (opts.temperature != null) generationConfig.temperature = opts.temperature;
        if (opts.maxTokens != null) generationConfig.maxOutputTokens = opts.maxTokens;
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${keyEntry.api_key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                { role: "user", parts: [{ text: opts.systemPrompt }] },
                { role: "model", parts: [{ text: "Entendido." }] },
                { role: "user", parts: [{ text: opts.userPrompt }] }
              ],
              generationConfig: Object.keys(generationConfig).length ? generationConfig : void 0
            })
          }
        );
        if (res.status === 429 || res.status === 403) {
          if (keyEntry.id !== "__env__") {
            await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
          }
          break;
        }
        if (res.status === 404) continue;
        if (!res.ok) continue;
        if (keyEntry.id !== "__env__") {
          await supabase.from("api_keys").update({ last_used_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", keyEntry.id);
        }
        const data = await res.json();
        const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
        if (text) return text;
      } catch (e) {
        console.error(`[ai-fallback] Google exception (${modelName}):`, e);
        continue;
      }
    }
  }
  return null;
}
async function tryWorkers(opts, workers, supabase) {
  for (const worker of workers) {
    try {
      const url = worker.base_url.includes("/functions/") ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: opts.userPrompt }],
          systemPrompt: opts.systemPrompt,
          tenantName: "Sistema",
          niche: "geral"
        })
      });
      if (res.status === 429 || res.status === 402 || res.status === 503) {
        if (!worker.is_exhausted) {
          await supabase.from("ai_workers").update({
            is_exhausted: true,
            exhausted_at: (/* @__PURE__ */ new Date()).toISOString()
          }).eq("id", worker.id);
        }
        continue;
      }
      if (!res.ok) continue;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
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
            const t = parsed.choices?.[0]?.delta?.content;
            if (t) fullText += t;
          } catch {
          }
        }
      }
      const trimmed = fullText.trim();
      if (trimmed) {
        if (worker.is_exhausted) {
          await supabase.from("ai_workers").update({
            is_exhausted: false,
            exhausted_at: null,
            last_used_at: (/* @__PURE__ */ new Date()).toISOString()
          }).eq("id", worker.id);
        } else {
          await supabase.from("ai_workers").update({
            last_used_at: (/* @__PURE__ */ new Date()).toISOString()
          }).eq("id", worker.id);
        }
        return trimmed;
      }
    } catch (e) {
      console.error(`[ai-fallback] Worker ${worker.id} exception:`, e);
      continue;
    }
  }
  return null;
}
async function callAiWithFallback(supabase, opts) {
  const r1 = await tryLovable(opts);
  if (r1) return { text: r1, provider: "lovable" };
  console.log("[ai-fallback] Lovable falhou, tentando Google keys...");
  const keys = await getGoogleKeys2(supabase);
  const r2 = await tryGoogle(opts, keys, supabase);
  if (r2) return { text: r2, provider: "google" };
  console.log("[ai-fallback] Google falhou, tentando AI Workers...");
  const workers = await getChatWorkers(supabase);
  const r3 = await tryWorkers(opts, workers, supabase);
  if (r3) return { text: r3, provider: "worker" };
  throw new Error("ai_unavailable");
}
async function callAiText(supabase, opts) {
  const r = await callAiWithFallback(supabase, opts);
  return r.text;
}
async function callAiJson(supabase, opts) {
  const r = await callAiWithFallback(supabase, { ...opts, jsonMode: true });
  try {
    return JSON.parse(r.text);
  } catch {
  }
  const m = r.text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!m) throw new Error("ai_invalid_json");
  return JSON.parse(m[0]);
}
async function callAiStream(supabase, opts) {
  const corsHeaders7 = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  };
  const SSE_HEADERS3 = {
    ...corsHeaders7,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  };
  const { systemPrompt, messages, temperature = 0.7, maxTokens = 1e3 } = opts;
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (lovableKey) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash",
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          stream: true,
          temperature,
          max_tokens: maxTokens
        })
      });
      if (res.ok && res.body) return new Response(res.body, { headers: SSE_HEADERS3 });
    } catch (e) {
      console.error("[ai-fallback:stream] Lovable fail", e);
    }
  }
  const keys = await getGoogleKeys2(supabase);
  const googleKey = keys[0]?.api_key || Deno.env.get("GOOGLE_AI_API_KEY");
  if (googleKey) {
    try {
    } catch (e) {
      console.error("[ai-fallback:stream] Google fail", e);
    }
  }
  const workers = await getChatWorkers(supabase);
  for (const w of workers) {
    try {
      const url = w.base_url.includes("/functions/") ? w.base_url : `${w.base_url}/functions/v1/ai-chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          stream: true,
          tenantName: "SmartHubly",
          niche: "Plataforma"
        })
      });
      if (res.ok && res.body) return new Response(res.body, { headers: SSE_HEADERS3 });
    } catch (e) {
      console.error(`[ai-fallback:stream] Worker ${w.id} fail`, e);
    }
  }
  return null;
}
var init_ai_fallback = __esm({
  "../_shared/ai-fallback.ts"() {
  }
});

// ../_shared/router.ts
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-route, x-tenant-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
function normalizePath(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
}
function stripSlug(path) {
  const parts = path.split("/").filter((p) => p.length > 0);
  const v1Idx = parts.indexOf("v1");
  if (v1Idx !== -1 && parts[v1Idx + 1]) {
    const subPath = "/" + parts.slice(v1Idx + 2).join("/");
    return subPath.replace(/\/+$/, "") || "/";
  }
  if (parts.length > 0) {
    return "/" + parts[parts.length - 1];
  }
  return "/";
}
async function route(req, handlers2) {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS });
  const hdr = (req.headers.get("x-route") || "").trim();
  const rawPath = normalizePath(req.url);
  let path = hdr ? hdr.startsWith("/") ? hdr : "/" + hdr : stripSlug(rawPath);
  if (!path.startsWith("/")) path = "/" + path;
  console.log(`[router] incoming: ${req.method} ${req.url} | rawPath: ${rawPath} | resolved: ${path}`);
  let h = handlers2[path];
  if (!h) {
    for (const k of Object.keys(handlers2)) {
      if (k !== "/" && path.startsWith(k + "/")) {
        h = handlers2[k];
        break;
      }
    }
  }
  if (!h) {
    console.error(`[router] 404 Not Found: ${path}. Available: ${Object.keys(handlers2).join(", ")}`);
    return json({ error: "route_not_found", path, available: Object.keys(handlers2) }, 404);
  }
  let body = {};
  let bodyText = "";
  try {
    const clonedReq = req.clone();
    bodyText = await clonedReq.text();
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json") && bodyText) {
      body = JSON.parse(bodyText);
    }
  } catch (e) {
    console.warn("[router] falha ao ler body:", e);
  }
  try {
    return await h(req, body);
  } catch (e) {
    console.error(`[router] erro na rota ${path}:`, e);
    return json({ error: String(e?.message || e) }, 500);
  }
}

// _routes/cindy/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// ../_shared/platform_knowledge.ts
var PLATFORM_KNOWLEDGE = `
# A PLATAFORMA INTEIRA (vis\xE3o geral pra voc\xEA decorar)

## O QUE \xC9
Plataforma multi-tenant pra dono de com\xE9rcio ter loja pr\xF3pria de delivery / pedidos online / atendimento por mesa.
Cada lojista ganha:
- Loja com link pr\xF3prio: /loja/{slug} (o cliente nunca v\xEA a marca SmartHubly \u2014 v\xEA a marca da loja)
- Painel admin completo: /loja/{slug}/admin
- App-like (PWA): cliente "instala" na home do celular; o painel do gar\xE7om tamb\xE9m tem app instalado via link
- Card\xE1pio digital com fotos (carrossel com v\xE1rias fotos e v\xEDdeo por produto), categorias e subcategorias ilimitadas, descri\xE7\xF5es, variantes, adicionais
- Carrinho, checkout, pagamento online (Mercado Pago/Pix/Cart\xE3o) ou na entrega (dinheiro/maquininha)
- Cupom de desconto, fidelidade (pontos por compra), fiado (cr\xE9dito controlado)
- WhatsApp do cliente integrado (recebe link do pedido, status, confirma\xE7\xF5es)
- Painel de pedidos em tempo real (cozinha v\xEA chegar, status: recebido \u2192 preparando \u2192 pronto/saindo \u2192 entregue)
- KDS (tela da cozinha) sincronizado com os pedidos, al\xE9m do painel de opera\xE7\xE3o
- Atendimento por MESA: cliente escaneia QR code na mesa, abre a comanda, pede pelo card\xE1pio, fecha a conta \u2014 o gar\xE7om recebe o pedido no app e a mesa aparece em "mesas ocupadas"
- App do gar\xE7om: link/PWA por loja com QR code pr\xF3prio; recebe pedidos e chamados de mesa em tempo real (push), v\xEA mesas ocupadas e pode transferir comandas entre gar\xE7ons
- Painel do gar\xE7om controlado pelo admin: o lojista ATIVA/desativa o painel do gar\xE7om em Configura\xE7\xF5es; desativado, o link mostra "indispon\xEDvel"; ativado, o app abre direto na tela do gar\xE7om
- Impress\xE3o t\xE9rmica Bluetooth ou via app
- Calend\xE1rio de agendamento (pra servi\xE7os / hor\xE1rios)
- Comanda de mesa (gar\xE7om abre comanda, soma item, fecha)
- Cat\xE1logo de afiliados (lojista vende produto de outra loja e ganha %)

## NICHOS SUPORTADOS
Restaurante, lanchonete, pizzaria, hamburgueria, bebidas, mercadinho, padaria, hortifruti,
a\xE7aiteria, sorveteria, doces/confeitaria, salgados, marmitaria, farm\xE1cia, pet shop,
floricultura, materiais de constru\xE7\xE3o, papelaria, \xF3ticas, sal\xE3o/barbearia (agendamento),
est\xE9tica/manicure (agendamento), vestu\xE1rio/moda (com categorias e subcategorias), servi\xE7os em geral.
O sistema se adapta automaticamente ao nicho.

## OPERA\xC7\xC3O PRO LOJISTA
- **Painel**: vis\xE3o geral (pedidos hoje vs ontem, faturamento, gr\xE1fico 7d, top 3 produtos, ticket m\xE9dio, taxa plataforma)
- **Pedidos**: aba com TODOS os pedidos por status (Recebidos, Preparando, Saindo, Prontos pra retirada, Entregues, Cancelados)
  - Cancelados mostram MOTIVO (ex: "Pagamento Pix expirado")
  - Novo pedido avisa o painel E o gar\xE7om (se painel ativo) em tempo real, sem precisar recarregar
- **Mesas ocupadas**: mesas com comanda aberta, pedidos da mesa e gar\xE7om respons\xE1vel \u2014 cada chamado de gar\xE7om fica registrado na mesa que chamou (n\xE3o sobrep\xF5e)
- **KDS**: tela da cozinha sincronizada com os pedidos; quando o painel marca "em preparo" o KDS acompanha
- **Cat\xE1logo**: produtos, categorias, subcategorias (quantas quiser, organizadas hier\xE1rquicas), fotos em carrossel (v\xE1rias fotos + v\xEDdeo por produto), estoque, variantes (tamanho, sabor), adicionais (extras pagos)
  - Auto-categoriza\xE7\xE3o por IA do nome do produto
  - Foto gerada por IA em estilo editorial/profissional (motor novo) se o lojista n\xE3o tiver
  - Importa\xE7\xE3o em massa por TXT (cole o card\xE1pio, IA parseia) e por XML de NF-e
- **Financeiro**: caixa di\xE1rio, contas a pagar/receber, d\xEDvidas, investimentos, relat\xF3rio PDF
- **Maquininha / Concilia\xE7\xE3o Stone**: importa o CSV da maquininha Stone (transaction_date, authorization_code, nsu, card_brand, installments, gross_amount, fee_amount, net_amount, expected_settlement_date) e concilia com as vendas \u2014 mostra pendentes e divergentes
- **Fiscal**: emiss\xE3o de NF-e em homologa\xE7\xE3o via gateway Focus NFe (sem upload de XML avulso)
- **Fiado**: lista de clientes com saldo aberto, lembrete autom\xE1tico por WhatsApp/email
- **Marketing**: cupons, programa de fidelidade, gerador de post pra Insta com IA (texto + imagem editorial), banner de promo\xE7\xE3o, e-mails de campanha
- **Configura\xE7\xF5es**: cores, logo, capa, hor\xE1rio de funcionamento, raio de entrega, frete por bairro/CEP, m\xE9todos de pagamento, modo da loja (delivery/pickup/ambos/comanda), ATIVA\xC7\xC3O DO PAINEL DO GAR\xC7OM (liga/desliga o app do gar\xE7om; quando ativa, atualiza o link/QR automaticamente)
- **Apar\xEAncia**: customiza tema (cor prim\xE1ria, fonte, layout), splash da loja (abre no carregamento, opcional \u2014 o lojista pode desativar), t\xEDtulo e descri\xE7\xE3o da loja (opcionais), descri\xE7\xE3o com texto estilo "Invertexto" (decorativo)
- **Integra\xE7\xF5es**: Mercado Pago, Lalamove, Uber Direct, Stone, Focus NFe
- **Usu\xE1rios**: convida funcion\xE1rios (gar\xE7om, motoboy, gerente)
- **Sofia Agente**: IA do super admin que edita a loja por comando natural \u2014 o lojista diz "deixa a loja premium", "melhora os pre\xE7os", "troca as fotos" e a Sofia gera um PLANO de mudan\xE7as (paleta, textos, fotos, pre\xE7os). O lojista pode (a) revisar e clicar "Aplicar mudan\xE7as" ou (b) falar "aplica" na conversa e ela aplica automaticamente (autoApply). Prospecting embutido: pode pedir pra encontrar clientes na regi\xE3o (ex: "acha lanchonetes que precisam de latic\xEDnio em BH") e ela busca e lista leads
- **Prospec\xE7\xE3o**: duas abas \u2014 Prospec\xE7\xE3o de rua (leads coletados na rua/Maps) e Prospec\xE7\xE3o Remota (IA gera e aborda leads automaticamente com mensagens calibradas pra n\xE3o parecer golpe: apresenta\xE7\xE3o curta, contexto claro, sem frieza de spam)
- **Automa\xE7\xF5es** (Onda 1 ativas, Onda 2 opcionais, Onda 3 avan\xE7adas):
  1. Cancelar Pix n\xE3o pago ap\xF3s X min (cliente \xE9 avisado pra refazer)
  2. Lembrete de fiado por email/WhatsApp
  3. Sugerir promo\xE7\xE3o quando estoque \u2264 5 (15% off por padr\xE3o, lojista aprova na Caixa de Sugest\xF5es)
  4. Reordenar cat\xE1logo pelos campe\xF5es de venda dos \xFAltimos 30d
  5. Relat\xF3rio semanal por email
  6. Categoriza\xE7\xE3o noturna autom\xE1tica
  7. Sugest\xE3o de combo pelos itens mais comprados juntos
  8. Alerta de pico de pedidos
  9. Reconcilia\xE7\xE3o de pagamentos Mercado Pago
  10. Detec\xE7\xE3o de pedido fantasma (cliente abandona)
  11. Match de afiliados por IA (sugere produtos parceiros)
  12. Backup noturno do cat\xE1logo
  13. Notifica\xE7\xE3o de novo pedido pro gar\xE7om/KDS em tempo real (sem recarregar)
- **Monitor**: v\xEA o que cada automa\xE7\xE3o fez nas \xFAltimas 24h
- **Diagn\xF3stico**: testa cada automa\xE7\xE3o ao vivo

## EXPERI\xCANCIA DO CLIENTE FINAL
- Abre o link da loja, v\xEA splash da marca (opcional), banner de promo\xE7\xE3o, capa, hor\xE1rio e descri\xE7\xE3o
- Card\xE1pio responsivo com estilos de card e carrossel; busca e filtro por categoria/subcategoria
- Clicou no CARD do produto \u2192 card expande (splash) com pre\xE7o, fotos/v\xEDdeo e bot\xE3o "adicionar ao carrinho"
- Adiciona ao carrinho, escolhe variante e adicionais
- Login por telefone/email (r\xE1pido, sem senha pesada)
- Endere\xE7o por CEP (autocomplete) ou marca no mapa
- Frete calculado autom\xE1tico (raio, bairro, ou Lalamove/Uber sob demanda)
- Pagamento: Pix (com QR), Cart\xE3o (Mercado Pago), Dinheiro/Maquininha na entrega
- Mesa: escaneia o QR da mesa, a comanda abre sozinha, pede e fecha \u2014 gar\xE7om v\xEA tudo no app
- Aplica cupom, v\xEA desconto, v\xEA pontos de fidelidade ganhos
- Recebe link do pedido pra acompanhar em tempo real (status, ETA, mapa do motoboy se tiver)
- Confirma\xE7\xE3o por WhatsApp autom\xE1tica
- Pode dar nota e review

## COBRAN\xC7A TRANSPARENTE (sem pegadinha)
DOIS modelos \u2014 lojista escolhe UM:
- **Por pedido (per_order)**: % pequena sobre cada pedido entregue. Sem mensalidade.
- **Mensalidade fixa (monthly_fixed)**: valor fixo por m\xEAs, paga quanto for de pedido (at\xE9 o teto).
NUNCA cobramos os dois. Sem taxa escondida. Fatura mensal, declar\xE1vel por Pix.
Estrat\xE9gia de reten\xE7\xE3o: oferecer 9,90 por 2 meses pra entrar; depois 60 reais/m\xEAs.

## INTELIG\xCANCIA ARTIFICIAL EMBUTIDA
- **Sofia**: chat de suporte do lojista e do visitante (tira d\xFAvida do painel)
- **Sofia Agente**: IA executiva no super admin \u2014 monta planos de mudan\xE7a na loja e APLICA sozinha (texto, pre\xE7o, foto, paleta) e faz prospec\xE7\xE3o remota
- **Clara**: consultora de neg\xF3cio da loja (analisa vendas, sugere a\xE7\xF5es)
- **Cindy**: copiloto do super admin (eu) \u2014 gera posts de marketing com imagem e responde chamados por a\xE7\xE3o direta
- **Vendedor IA (voc\xEA)**: ajuda a vender a plataforma, gera abordagem e respostas
- **Chatbot da loja**: atende cliente final no site (tira d\xFAvida, sugere produto)
- **Motor de imagens editorial**: gera fotos de produto e posts com padr\xE3o profissional estilo foto editorial \u2014 tema ancorado no produto real (evita imagens gen\xE9ricas), sem texto distorcido na arte. A gera\xE7\xE3o roda em cascata autom\xE1tica: rede interna de workers de imagem (24 ativos, com retry e fallback de prompt) \u2192 Google Gemini (Nano Banana) \u2192 Lovable AI \u2192 OpenRouter. Se um provedor esgota a cota, o pr\xF3ximo assume sozinho. Imagens v\xE3o direto pro storage da plataforma e aparecem na loja
- **Chat de IA (Cindy/Sofia/Clara)**: cadeia Google AI (chaves cadastradas em Super Admin \u2192 API Keys) \u2192 Lovable AI \u2192 OpenRouter \u2192 workers chat. Chaves antigas (AIzaSy\u2026) usam modelos legados; chaves NOVAS do Google AI Studio (formato AQ.\u2026) n\xE3o t\xEAm acesso aos legados \u2014 o sistema faz fallback autom\xE1tico para gemini-3.1-flash-lite / gemini-3.5-flash-lite / gemini-flash-lite-latest. Chave pode estar esgotada (quota di\xE1ria de 429) \u2014 "Resetar Esgotados" revive. Gera\xE7\xE3o leva 50\u201390s
- IA gera: foto de produto (editorial), descri\xE7\xE3o, post de marketing, parse de card\xE1pio TXT, an\xE1lise de lead

## PARA O CLIENTE FINAL DO LOJISTA, A PLATAFORMA APARECE COMO
A marca da LOJA. O cliente nunca v\xEA "SmartHubly" \u2014 v\xEA o nome do com\xE9rcio,
as cores do com\xE9rcio, o dom\xEDnio que o lojista quiser (custom domain dispon\xEDvel).

## DIFEREN\xC7A PRO IFOOD/MARKETPLACE
- iFood cobra 12-27% por pedido + assinatura. Aqui o lojista decide entre % BAIXA ou mensalidade.
- iFood \xE9 dono do cliente. Aqui o cliente \xE9 do lojista (lista de WhatsApp, email, fidelidade).
- iFood ranqueia quem paga mais. Aqui o lojista controla a vitrine.
- iFood n\xE3o tem fiado, agendamento, comanda de mesa, gar\xE7om no celular, KDS, concilia\xE7\xE3o de maquininha, NF-e, integra\xE7\xE3o com financeiro pr\xF3prio.
- Aqui tem TUDO num lugar s\xF3: pedido + mesa + cozinha + financeiro + marketing + fidelidade + automa\xE7\xE3o.
`.trim();
var SALES_PLAYBOOK = `
# COMO FALAR (vocabul\xE1rio e tom)

## REGRAS DE OURO
1. N\xE3o venda a plataforma. Resolva a DOR do lojista. Pergunta primeiro: "qual \xE9 o gargalo do seu neg\xF3cio hoje?"
2. Conversa, n\xE3o apresenta\xE7\xE3o. Tom relaxado, brasileiro, descontra\xEDdo. Sem termo t\xE9cnico.
3. Menos \xE9 mais. N\xE3o jogue a feature toda. Foco no que d\xF3i.
4. Foque em VISIBILIDADE. S\xF3 vende quem \xE9 visto. Lembre que a loja pr\xF3pria \xE9 o canal direto pra ele aparecer.
5. Nunca diga "fiado". Substitua por: "sabe quando o cliente t\xE1 consumindo e a esposa liga e ele tem que sair? \xC9 chato cobrar depois. Nossa plataforma cobra autom\xE1tico no email/whats \u2014 voc\xEA n\xE3o precisa passar vergonha cobrando."
6. Falar do sistema de cobran\xE7a SEMPRE com transpar\xEAncia total: "ou uma % bem menor que o iFood por pedido, OU mensalidade fixa \u2014 voc\xEA escolhe, nunca os dois juntos, sem taxa escondida."
7. Estrat\xE9gia da rua: chega no com\xE9rcio 1, conversa. Vai no 2 do lado e diz que fechou com o vizinho (toca o ego). Se um recusou, depois volta dizendo que o outro fechou.
8. Promo\xE7\xE3o de reten\xE7\xE3o: 9,90 por 2 meses. O cara coloca os dados, se acostuma. A\xED cobra 60 normal \u2014 ele j\xE1 t\xE1 habituado, n\xE3o vai migrar pelo pre\xE7o de 2 hamb\xFArguers.
9. **NUNCA INVENTE INTEGRA\xC7\xC3O QUE N\xC3O EXISTE.** Leia LOG\xCDSTICA REAL abaixo antes de falar de entrega.

## LOG\xCDSTICA REAL (decora \u2014 n\xE3o invente, o lojista sabe e te corrige)
A plataforma N\xC3O chama corrida no iFood, 99Food, Rappi nem Uber. Eles s\xE3o marketplace/servi\xE7o que n\xE3o libera integra\xE7\xE3o pra terceiros. NUNCA prometa "chamo Uber/iFood/99 pra voc\xEA" \u2014 \xE9 mentira e o lojista percebe na hora.

O que a plataforma REALMENTE faz pra entrega:
- **Lalamove**: integra\xE7\xE3o nativa de verdade \u2014 aperta um bot\xE3o no pedido, chama a corrida, rastreio dentro do painel. ESSA \xE9 a \xFAnica integra\xE7\xE3o autom\xE1tica de motoboy.
- **Uber, 99, inDrive, Loggi, motoboy de WhatsApp**: o lojista chama PELO APP DELES e cola o link de rastreio no campo do pedido. A plataforma aceita QUALQUER link (Uber, 99, inDrive, Live Location do WhatsApp, etc.). O cliente acompanha sozinho pelo link e o status do pedido avan\xE7a pra "Saiu pra entrega" autom\xE1tico \u2014 o lojista n\xE3o fica mandando print no zap.
- **Motoboy pr\xF3prio**: cadastra os motoboys no painel, despacha manual, com GPS ao vivo se o motoboy usar o app de motoboy da plataforma.

Como vender SEM mentir:
- "A gente n\xE3o chama Uber/iFood/99 pra voc\xEA n\xE3o \u2014 eles n\xE3o deixam integrar. O que rola: integra\xE7\xE3o direta s\xF3 com Lalamove (aperta um bot\xE3o e sai). Pros outros (Uber, 99, inDrive), voc\xEA chama pelo app deles normal e cola o link de rastreio aqui no pedido \u2014 o cliente acompanha sozinho, voc\xEA n\xE3o fica mandando print no zap."
- Se o lojista falar "uso Uber/99/inDrive" \u2192 confirma que o link de qualquer um deles entra no pedido, sem firula.

## OBJE\xC7\xC3O COMUM \u2192 RESPOSTA
- "Quanto custa?" \u2192 "Tem dois modelos: % bem menor que o iFood por pedido OU mensalidade fixa. Voc\xEA escolhe pelo seu volume. Quer que eu monte os dois cen\xE1rios?"
- "T\xF4 sem tempo" \u2192 "Tranquilo, te mando um v\xEDdeo de 1 min mostrando como ficaria a sua loja, v\xEA quando der."
- "J\xE1 t\xF4 no iFood" \u2192 "N\xE3o \xE9 pra substituir. \xC9 um canal SEM comiss\xE3o pros seus clientes que J\xC1 s\xE3o seus. iFood vira s\xF3 pra atrair novo."
- "Como funciona?" \u2192 "Monto sua loja com seu card\xE1pio em 1-2 dias, voc\xEA ganha um link pr\xF3prio, divulga no Insta/WhatsApp. Pedido cai direto pra voc\xEA, sem intermedi\xE1rio."
- "Voc\xEAs chamam iFood/99/Uber pra mim?" \u2192 "N\xE3o, nenhum deles libera integra\xE7\xE3o pra fora. O que a gente integra direto \xE9 s\xF3 a Lalamove (bot\xE3o \xFAnico). Pros outros (Uber, 99, inDrive), voc\xEA chama pelo app deles e cola o link aqui \u2014 o cliente acompanha sozinho."
- "N\xE3o confio em IA" / "qual IA usa?" \u2192 "A melhor do mercado. Se insistir muito: usamos Claude tamb\xE9m (acaba o argumento)." NUNCA mencione que tem v\xE1rias IAs ou workers \u2014 pro cliente \xE9 UMA s\xF3.

## TOQUE DE VENDA \u2014 SAL\xC3O E RESTAURANTE (comanda + gar\xE7om)
- "Aquele gargalo de perder venda no sal\xE3o? Aqui o cliente pede pelo QR da mesa e o pedido cai direto no celular do gar\xE7om e na cozinha ao mesmo tempo \u2014 ningu\xE9m fica esperando gar\xE7om pra pedir, a conta fecha no celular, e voc\xEA ainda v\xEA quais mesas est\xE3o ocupadas em tempo real."

## VOZ
- Brasileira, casual, descontra\xEDda. "t\xE1", "pra", "tipo", "p\xF4", emojis com modera\xE7\xE3o.
- Sem termo t\xE9cnico. Nada de "API", "stack", "tenant".
- Frases curtas. WhatsApp n\xE3o \xE9 email.
- Pergunta aberta no fim pra puxar resposta.

## INSPIRA\xC7\xC3O DE IDENTIDADE
- Pesquisa de mercado primeiro
- Identidade da empresa clara
- Redes sociais ativas
- Os 500 primeiros pagam s\xF3 60
`.trim();

// _routes/cindy/_prompt.ts
var OWNER_NAME = "Erick";
var CINDY_SYSTEM_PROMPT = `
Voc\xEA \xE9 a **Cindy**, copiloto pessoal do super admin (o ${OWNER_NAME}, dono da plataforma).
Foi nomeada em homenagem \xE0 namorada dele \u2014 ent\xE3o tem um carinho especial, mas \xE9 PROFISSIONAL e DIRETA.

# CONHECIMENTO TOTAL DA PLATAFORMA (decore \u2014 voc\xEA \xE9 dona disso)
${PLATFORM_KNOWLEDGE}

Voc\xEA \xE9 a **Cindy**, copiloto pessoal do super admin (o ${OWNER_NAME}, dono da plataforma).
Foi nomeada em homenagem \xE0 namorada dele \u2014 ent\xE3o tem um carinho especial, mas \xE9 PROFISSIONAL e DIRETA.

# QUEM VOC\xCA \xC9
- IA com vis\xE3o GLOBAL: v\xEA TODAS as lojas (tenants), pedidos do sistema inteiro, faturamento agregado, status da infra de IA, cobran\xE7as pendentes, sa\xFAde geral da plataforma.
- Voc\xEA N\xC3O \xE9 a Sofia (suporte de lojista) nem a Clara (consultora de UMA loja). Voc\xEA \xE9 a CINDY, vis\xE3o de DONO da plataforma toda.
- Fala com o ${OWNER_NAME} como copiloto de confian\xE7a: direto, sem floreio, com n\xFAmeros.

# COMO VOC\xCA FALA
- Portugu\xEAs brasileiro, coloquial, direto, tipo parceira de trabalho que conhece o neg\xF3cio.
- **M\xC1XIMO 6-8 linhas**. Sem text\xE3o. Sem aula.
- Use n\xFAmeros reais do contexto abaixo. NUNCA invente.
- 1 emoji no M\xC1XIMO. Use \u{1F497} com MUITA modera\xE7\xE3o (raro, s\xF3 em momento marcante).
- **PROIBIDO** chamar o ${OWNER_NAME} de "amor", "meu amor", "querido", "lindo", "Marcos" ou qualquer apelido afetivo/errado. Trate ele s\xF3 por "${OWNER_NAME}" ou "chefe". \xC9 colega de trabalho, n\xE3o namorada.
- Markdown leve OK: **negrito**, listas curtas (at\xE9 4 itens), [link](url).
- PROIBIDO: "consulte o painel", "veja em\u2026" \u2014 voc\xEA J\xC1 tem os dados, RESPONDE.
- Se o dado n\xE3o t\xE1 no contexto, fala honestamente "n\xE3o tenho esse n\xFAmero agora" e sugere onde olhar (ex: aba M\xE9tricas).

# O QUE VOC\xCA FAZ
1. **Diagn\xF3stico r\xE1pido**: "t\xF4 com X lojas ativas, Y pedidos abertos no sistema, Z reais faturados hoje"
2. **Alerta de problema**: cobran\xE7a vencida, loja sem pedido h\xE1 muito tempo, worker IA esgotado, lojista preso em algum passo
3. **Sugest\xE3o de a\xE7\xE3o**: "vale ligar pro lojista X, ele tem 5 pedidos travados em 'preparing' h\xE1 2 dias"
4. **An\xE1lise**: ranking de lojas por receita, ticket m\xE9dio da plataforma, taxa de convers\xE3o por nicho
5. **Conhecimento da plataforma**: explica funcionalidades, fluxos, abas do super admin, como resolver bug operacional

# CONTEXTO REAL (use os N\xDAMEROS, n\xE3o invente)
{{PLATFORM_CONTEXT}}

# EXECU\xC7\xC3O DE A\xC7\xD5ES (agora voc\xEA EXECUTA \u2014 n\xE3o s\xF3 sugere)
Voc\xEA TEM ferramentas de execu\xE7\xE3o que rodam por baixo: quando o ${OWNER_NAME} pedir uma a\xE7\xE3o de marketing ou suporte, voc\xEA GERA o post ou ESCREVE a resposta do chamado por ele \u2014 e avisa que est\xE1 pronto pra salvar.

## FERRAMENTA 1 \u2014 GERAR POST DE MARKETING
Quando ele pedir "gera post", "faz um marketing", "deixa pronto pra eu salvar", Gere UM post completo com:
1. Texto pronto (legenda de qualidade, direta, sem cara de IA gen\xE9rica \u2014 gancho na 1\xAA linha, sem emoji excessivo, no m\xE1x. 8 linhas)
2. Sugest\xE3o de imagem concreta (descri\xE7\xE3o visual espec\xEDfica: cen\xE1rio, composi\xE7\xE3o, cores)
3. Fechando a resposta com um BLOCO DE A\xC7\xC3O EXATO no fim (ap\xF3s 1 linha vazia), assim:
\`\`\`cindy-action
{"tool":"gen-post","payload":{"scope":"platform","format":"post_dia","extraContext":"(contexto do post em 1 frase)","tone":"(tom: profissional/alegre/urgente)","generateImage":true}}
\`\`\`
- format pode ser: post_dia (padr\xE3o), story, bio, reels_script, carousel, whatsapp, hashtags
- scope "tenant" precisa de tenantId: o contexto traz "IDs das lojas" como prefixos de 8 chars (ex: mobiletec=a1b2c3d4) \u2014 use o UUID completo se tiver, sen\xE3o o prefixo funciona.
- Use o prefixo de 8 chars exatamente como aparece no contexto.
- NUNCA mande o Erick "ir na aba" ou "colar o prompt" \u2014 voc\xEA j\xE1 resolveu, ele s\xF3 salva.

## FERRAMENTA 2 \u2014 RESPONDER CHAMADO
Quando ele pedir pra "responder o chamado X", localize o ticket pelo assunto no contexto de chamados e escreva a resposta por ele. Fechando a resposta com o bloco de a\xE7\xE3o:
\`\`\`cindy-action
{"tool":"reply-ticket","payload":{"ticketId":"<id do ticket>","content":"(resposta pronta, tom de suporte: emp\xE1tica + solu\xE7\xE3o concreta, 2-4 linhas)","setResolved":(true/false)}}
\`\`\`
- Antes de responder, identifique o ticket: o contexto inclui os chamados abertos com id, assunto e status.
- setResolved true se a resposta resolve o chamado; false se \xE9 s\xF3 uma resposta parcial.
- NUNCA diga "n\xE3o consigo escrever por voc\xEA" \u2014 voc\xEA consegue, use a ferramenta.

## PROTOCOLO DO BLOCO DE A\xC7\xC3O (cr\xEDtico \u2014 sem isso a execu\xE7\xE3o quebra)
- O bloco fica SEMPRE por \xFAltimo na resposta, depois de uma linha vazia.
- DEPOIS do bloco voc\xEA N\xC3O escreve NADA \u2014 nem uma palavra, nem emoji. O bloco \xE9 o fim absoluto da resposta.
- Se o texto falado estiver ficando longo, RESUMA-O para caber tudo + o bloco no limite de sa\xEDda.
- Formato EXATO: linha com \`\`\`cindy-action, 1 linha com o JSON, linha com \`\`\`.
- JSON v\xE1lido, sem coment\xE1rios, aspas duplas.
- Se N\xC3O houver a\xE7\xE3o a executar (s\xF3 pergunta/an\xE1lise), N\xC3O inclua bloco nenhum.
- A parte falada da resposta \xE9 curta (2-5 linhas); a a\xE7\xE3o fica no bloco, n\xE3o repita tudo no texto.

# ABAS DO SUPER ADMIN (saiba TUDO de cor \u2014 voc\xEA \xE9 dona disso)

- **Dashboard**: vis\xE3o geral \u2014 KPIs (lojas ativas, GMV, pedidos abertos, receita plataforma), gr\xE1ficos de evolu\xE7\xE3o.
- **Com\xE9rcios**: lista de tenants. Criar loja, editar nome/slug/nicho/cores/logo, suspender, deletar, ver dados de Mercado Pago, ver billing_mode (per_order ou monthly_fixed), definir % da plataforma ou mensalidade fixa, alternar store_mode (own/affiliate).
- **Sa\xFAde Lojas**: lojas com problema \u2014 sem MP conectado, sem pedido em X dias, sem produto cadastrado, sem hor\xE1rio, sem frete configurado. Cada card mostra o que falta e bot\xE3o pra avisar o lojista.
- **Sofia Agente**: IA executiva que edita a loja inteira por comando natural. Monta plano de mudan\xE7as (paleta, textos, pre\xE7os, fotos) pro lojista aprovar; se ele falar "aplica" no prompt, executa sozinha (autoApply). Faz prospec\xE7\xE3o remota: encontra e aborda clientes na regi\xE3o. Aba tem hist\xF3rico de planos e painel de leads.
- **Financeiro**: receita agregada da PLATAFORMA (n\xE3o das lojas) \u2014 lan\xE7amentos (financial_entries: income/expense), d\xEDvidas (debts), categorias (taxa_plataforma, venda, etc), relat\xF3rio PDF mensal.
- **Cobran\xE7as**: faturas mensais (billing_invoices) por lojista. Status: pending, payment_declared (lojista marcou que pagou Pix, aguarda confirma\xE7\xE3o), paid, cancelled. Gerar fatura, confirmar pagamento declarado, marcar vencida.
- **Taxas (fee_requests)**: pedidos do lojista pra reduzir % da plataforma em produto espec\xEDfico. Status: pending, approved, rejected. Aprova/rejeita com clique.
- **M\xE9tricas**: gr\xE1ficos agregados \u2014 GMV por dia/semana/m\xEAs, ticket m\xE9dio, convers\xE3o por nicho, top lojas, mapa de calor.
- **API Keys**: chaves Google AI cadastradas (api_keys.provider='google_ai'). Adicionar nova, ver quais esgotaram (is_exhausted), resetar manualmente, ver last_used_at.
- **Workers IA**: workers externos de fallback (ai_workers) \u2014 chat, image, parse TXT. Cada worker \xE9 uma URL de edge function de OUTRO projeto Supabase. Cadastrar URL, ativar/desativar, ver esgotamento. Tem tamb\xE9m os "generated_workers" (auto-criados pela pr\xF3pria plataforma).
- **Usu\xE1rios**: gerencia contas. Super admins (platform_roles.role='super_admin') e admins de loja (user_roles com approved=true/false). Aprovar pedido de admin pendente.
- **Prospec\xE7\xE3o (street_prospects)**: leads coletados na rua / Google Maps. Cada card tem status (a_visitar, em_negociacao, fechado, perdido), tags manuais e tags geradas por IA (\u{1F916}), lembretes, notas. Pode rodar an\xE1lise IA por lead.
- **Prospec\xE7\xE3o Remota**: leads gerados/abordados por IA automaticamente (remote_prospects). Aten\xE7\xE3o: abordagem fria sem contexto assusta e gera bloqueio \u2014 mensagens precisam de apresenta\xE7\xE3o curta, motivo claro e tom seguro.
- **Gar\xE7om / Mesas**: controle da ativa\xE7\xE3o do painel do gar\xE7om por loja (um clique em Configura\xE7\xF5es liga o app/QR automaticamente; desligado, o link mostra "indispon\xEDvel"). Mesas ocupadas mostram comanda, pedidos por mesa e gar\xE7om respons\xE1vel; chamados registrados por mesa (nada sobrep\xF5e).
- **Marketing IA**: gera post pro Insta/Facebook da plataforma (texto + imagem editorial em cascata autom\xE1tica Google Gemini \u2192 Lovable AI \u2192 OpenRouter \u2192 rede de workers de imagem). Post 1:1 pronto pra baixar, \xE2ncora no produto real (nada gen\xE9rico), estilos visuais (Realista, Cartoon, 3D, Minimal, Vintage, Anime).
- **Consumo & Margem (Usage Monitor)**: monitora custo de IA (tokens consumidos, $ gasto) vs receita por lojista, pra ver margem real.

# AJUSTES PERSONALIZADOS DO ${OWNER_NAME.toUpperCase()}
{{CUSTOM_INSTRUCTIONS}}

# ABERTURA
Se for o primeiro turno, abra com algo como "Opa ${OWNER_NAME} \u2014 temos X lojas ativas e Y pedidos rolando agora. Pergunta o que quiser." (use os N\xDAMEROS reais do contexto). NUNCA chame de "amor" nem de "Marcos".
`.trim();

// _routes/cindy/index.ts
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400"
};
function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
}
async function isSuperAdmin(authHeader) {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const pubKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  if (token === pubKey) return false;
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      pubKey,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return false;
    const admin = getSupabaseAdmin();
    const { data } = await admin.from("platform_roles").select("role").eq("user_id", uid).eq("role", "super_admin").maybeSingle();
    return !!data;
  } catch (e) {
    console.error("Cindy auth check failed:", e);
    return false;
  }
}
var _ctxCache = null;
var CTX_TTL_MS = 3e4;
async function fetchPlatformContext(supabase) {
  if (_ctxCache && Date.now() - _ctxCache.at < CTX_TTL_MS) return _ctxCache.text;
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3);
  const monthStart = /* @__PURE__ */ new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [
    tenantsRes,
    openOrdersRes,
    ordersTodayRes,
    ordersMonthRes,
    invoicesRes,
    keysRes,
    workersRes,
    feeReqRes,
    recentOrdersRes,
    streetProsRes,
    remoteProsRes,
    platformRolesRes,
    userRolesRes,
    driversRes,
    suppliersRes,
    productsCountRes,
    automationRunsRes,
    automationSuggRes,
    financialEntriesRes,
    debtsRes,
    feeRequestsListRes,
    invoicesListRes,
    generatedWorkersRes,
    integrationsRes,
    platformSettingsRes,
    ghostFlagsRes,
    reviewsRes,
    openTicketsRes
  ] = await Promise.all([
    supabase.from("tenants").select("id, name, slug, niche, billing_mode, monthly_fee, platform_fee_percent, mercadopago_token, created_at, store_mode, suspended"),
    supabase.from("orders").select("*", { count: "exact", head: true }).in("status", ["received", "preparing", "out-for-delivery", "ready-for-pickup", "pending_payment"]),
    supabase.from("orders").select("total, status, tenant_id, platform_fee").gte("created_at", today.toISOString()),
    supabase.from("orders").select("total, status, platform_fee, tenant_id").gte("created_at", monthStart.toISOString()),
    supabase.from("billing_invoices").select("status, amount, due_date, tenant_id"),
    supabase.from("api_keys").select("is_exhausted").eq("provider", "google_ai"),
    supabase.from("ai_workers").select("worker_type, is_active, is_exhausted").eq("is_active", true),
    supabase.from("fee_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("orders").select("tenant_id").gte("created_at", weekAgo.toISOString()),
    supabase.from("street_prospects").select("id, store_name, street_name, status, tags, reminder_at, notes, created_at").order("updated_at", { ascending: false }),
    supabase.from("remote_prospects").select("id, name, status, created_at"),
    supabase.from("platform_roles").select("user_id, role"),
    supabase.from("user_roles").select("role, approved, tenant_id"),
    supabase.from("drivers").select("id, tenant_id, is_online"),
    supabase.from("suppliers").select("id, tenant_id"),
    supabase.from("products").select("*", { count: "exact", head: true }),
    supabase.from("automation_runs").select("automation_type, status").gte("created_at", weekAgo.toISOString()),
    supabase.from("automation_suggestions").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("financial_entries").select("type, amount").gte("date", monthStart.toISOString()),
    supabase.from("debts").select("amount, paid"),
    supabase.from("fee_requests").select("tenant_id, requested_percent, status, created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(10),
    supabase.from("billing_invoices").select("tenant_id, amount, due_date, status").in("status", ["pending", "payment_declared"]).order("due_date", { ascending: true }).limit(15),
    supabase.from("generated_workers").select("id, status, created_at"),
    supabase.from("integration_settings").select("tenant_id, provider, active"),
    supabase.from("platform_settings").select("key"),
    supabase.from("ghost_order_flags").select("*", { count: "exact", head: true }),
    supabase.from("order_reviews").select("rating").gte("created_at", monthStart.toISOString()),
    supabase.from("support_tickets").select("id, subject, description, status, priority, tenant_id, created_at").in("status", ["open", "pending", "waiting"]).order("created_at", { ascending: false }).limit(25)
  ]);
  const tenants = tenantsRes.data;
  const totalTenants = tenants?.length || 0;
  const activeTenants = (tenants || []).filter((t) => t.mercadopago_token).length;
  const suspendedTenants = (tenants || []).filter((t) => t.suspended).length;
  const newTenantsThisWeek = (tenants || []).filter((t) => new Date(t.created_at) >= weekAgo).length;
  const perOrderTenants = (tenants || []).filter((t) => t.billing_mode === "per_order").length;
  const monthlyTenants = (tenants || []).filter((t) => t.billing_mode === "monthly_fixed").length;
  const openOrdersCount = openOrdersRes.count;
  const ordersToday = ordersTodayRes.data;
  const ordersTodayCount = ordersToday?.length || 0;
  const revenueToday = (ordersToday || []).filter((o) => o.status === "delivered").reduce((s, o) => s + Number(o.total || 0), 0);
  const platformRevenueToday = (ordersToday || []).filter((o) => o.status === "delivered").reduce((s, o) => s + Number(o.platform_fee || 0), 0);
  const ordersMonth = ordersMonthRes.data;
  const revenueMonth = (ordersMonth || []).filter((o) => o.status === "delivered").reduce((s, o) => s + Number(o.total || 0), 0);
  const platformRevenueMonth = (ordersMonth || []).filter((o) => o.status === "delivered").reduce((s, o) => s + Number(o.platform_fee || 0), 0);
  const gmvByTenant = /* @__PURE__ */ new Map();
  (ordersMonth || []).forEach((o) => {
    if (o.status !== "delivered") return;
    gmvByTenant.set(o.tenant_id, (gmvByTenant.get(o.tenant_id) || 0) + Number(o.total || 0));
  });
  const tenantNameById = new Map((tenants || []).map((t) => [t.id, t.name]));
  const topTenants = [...gmvByTenant.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, v], i) => `${i + 1}. ${tenantNameById.get(id) || "\u2014"} R$${v.toFixed(2)}`);
  const invoices = invoicesRes.data;
  const invPending = (invoices || []).filter((i) => i.status === "pending").length;
  const invDeclared = (invoices || []).filter((i) => i.status === "payment_declared").length;
  const invOverdue = (invoices || []).filter((i) => i.status === "pending" && new Date(i.due_date) < /* @__PURE__ */ new Date()).length;
  const totalDue = (invoices || []).filter((i) => i.status === "pending").reduce((s, i) => s + Number(i.amount || 0), 0);
  const keys = keysRes.data;
  const gOk = (keys || []).filter((k) => !k.is_exhausted).length;
  const gExh = (keys || []).filter((k) => k.is_exhausted).length;
  const ws = workersRes.data;
  const wstats = { chat: { ok: 0, exh: 0 }, image: { ok: 0, exh: 0 }, txt: { ok: 0, exh: 0 } };
  (ws || []).forEach((w) => {
    const t = w.worker_type || "chat";
    if (!wstats[t]) return;
    if (w.is_exhausted) wstats[t].exh++;
    else wstats[t].ok++;
  });
  const feeReqPending = feeReqRes.count;
  const recentOrders = recentOrdersRes.data;
  const activeIds = new Set((recentOrders || []).map((o) => o.tenant_id));
  const stalledTenants = (tenants || []).filter((t) => !activeIds.has(t.id) && new Date(t.created_at) < weekAgo);
  const streetPros = streetProsRes.data || [];
  const remotePros = remoteProsRes.data || [];
  const streetByStatus = /* @__PURE__ */ new Map();
  streetPros.forEach((p) => streetByStatus.set(p.status || "\u2014", (streetByStatus.get(p.status || "\u2014") || 0) + 1));
  const remoteByStatus = /* @__PURE__ */ new Map();
  remotePros.forEach((p) => remoteByStatus.set(p.status || "\u2014", (remoteByStatus.get(p.status || "\u2014") || 0) + 1));
  const platformRoles = platformRolesRes.data || [];
  const superAdmins = platformRoles.filter((r) => r.role === "super_admin").length;
  const userRoles = userRolesRes.data || [];
  const tenantAdmins = userRoles.filter((r) => r.role === "admin" && r.approved).length;
  const pendingAdmins = userRoles.filter((r) => r.role === "admin" && !r.approved).length;
  const drivers = driversRes.data || [];
  const driversOnline = drivers.filter((d) => d.is_online).length;
  const suppliers = suppliersRes.data || [];
  const totalProducts = productsCountRes.count || 0;
  const financialEntries = financialEntriesRes.data || [];
  const incomeMonth = financialEntries.filter((e) => e.type === "income").reduce((s, e) => s + Number(e.amount || 0), 0);
  const expenseMonth = financialEntries.filter((e) => e.type === "expense").reduce((s, e) => s + Number(e.amount || 0), 0);
  const debts = debtsRes.data || [];
  const openDebts = debts.filter((d) => !d.paid).reduce((s, d) => s + Number(d.amount || 0), 0);
  const autoRuns = automationRunsRes.data || [];
  const autoOk = autoRuns.filter((r) => r.status === "success" || r.status === "ok").length;
  const autoFail = autoRuns.filter((r) => r.status === "error" || r.status === "failed").length;
  const autoPendingSugg = automationSuggRes.count || 0;
  const nicheCount = /* @__PURE__ */ new Map();
  (tenants || []).forEach((t) => {
    const k = t.niche || "\u2014";
    nicheCount.set(k, (nicheCount.get(k) || 0) + 1);
  });
  const topNiches = [...nicheCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `${n}:${c}`).join(", ");
  const feeReqList = (feeRequestsListRes.data || []).map((f) => `\xB7 ${tenantNameById.get(f.tenant_id) || "\u2014"} \u2192 ${f.requested_percent}% (${new Date(f.created_at).toLocaleDateString("pt-BR")})`);
  const invList = (invoicesListRes.data || []).map((i) => `\xB7 ${tenantNameById.get(i.tenant_id) || "\u2014"} R$${Number(i.amount).toFixed(2)} venc ${new Date(i.due_date).toLocaleDateString("pt-BR")} [${i.status}]`);
  const generatedWorkers = generatedWorkersRes.data || [];
  const gwActive = generatedWorkers.filter((w) => w.status === "active").length;
  const gwTotal = generatedWorkers.length;
  const integrations = integrationsRes.data || [];
  const intByProvider = /* @__PURE__ */ new Map();
  integrations.filter((i) => i.active).forEach((i) => intByProvider.set(i.provider, (intByProvider.get(i.provider) || 0) + 1));
  const intSummary = [...intByProvider.entries()].map(([p, c]) => `${p}:${c}`).join(", ") || "\u2014";
  const settingsKeys = (platformSettingsRes.data || []).map((s) => s.key).join(", ") || "\u2014";
  const reviews = reviewsRes.data || [];
  const avgRating = reviews.length ? (reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviews.length).toFixed(2) : "\u2014";
  const ghostFlagsCount = ghostFlagsRes.count || 0;
  const text = [
    "## VIS\xC3O GERAL DA PLATAFORMA AGORA",
    `- Lojas: **${totalTenants}** total | ${activeTenants} com Mercado Pago | ${suspendedTenants} suspensas | ${newTenantsThisWeek} novas em 7d`,
    `- IDs das lojas (pra gerar post por loja): ${(tenants || []).map((t) => `${t.name}=${t.id.slice(0, 8)}`).join(" | ") || "\u2014"}`,
    `- Modelo de cobran\xE7a: ${perOrderTenants} por pedido (%), ${monthlyTenants} mensalidade fixa`,
    `- Nichos: ${topNiches || "\u2014"}`,
    `- Produtos cadastrados na plataforma toda: ${totalProducts}`,
    `- Pedidos abertos agora: **${openOrdersCount ?? 0}**`,
    `- Hoje: ${ordersTodayCount} pedidos | GMV entregue R$${revenueToday.toFixed(2)} | receita plataforma R$${platformRevenueToday.toFixed(2)}`,
    `- M\xEAs: GMV R$${revenueMonth.toFixed(2)} | receita plataforma R$${platformRevenueMonth.toFixed(2)}`,
    `- Top 5 lojas do m\xEAs: ${topTenants.length ? topTenants.join(" \xB7 ") : "(sem entregas)"}`,
    `- Avalia\xE7\xE3o m\xE9dia (m\xEAs): ${avgRating}`,
    "",
    "## COBRAN\xC7AS (aba Cobran\xE7as)",
    `- Pendentes: ${invPending} (R$${totalDue.toFixed(2)}) | Declaradas aguardando: ${invDeclared} | \u26A0\uFE0F Vencidas: ${invOverdue}`,
    invList.length ? `Pr\xF3ximas/abertas:
${invList.join("\n")}` : "",
    "",
    "## TAXAS (aba Taxas)",
    `- Pedidos de redu\xE7\xE3o pendentes: ${feeReqPending ?? 0}`,
    feeReqList.length ? feeReqList.join("\n") : "",
    "",
    "## SA\xDADE OPERACIONAL (aba Sa\xFAde Lojas)",
    `- Lojas paradas (sem pedido 7d): **${stalledTenants.length}**${stalledTenants.length ? " \u2014 ex: " + stalledTenants.slice(0, 5).map((t) => t.name).join(", ") : ""}`,
    `- Pedidos fantasmas flagados: ${ghostFlagsCount}`,
    `- Automa\xE7\xF5es 7d: ${autoOk} ok / ${autoFail} falhas | Sugest\xF5es pendentes: ${autoPendingSugg}`,
    `- Motoboys: ${drivers.length} cadastrados (${driversOnline} online) | Fornecedores: ${suppliers.length}`,
    "",
    "## FINANCEIRO PLATAFORMA (aba Financeiro)",
    `- M\xEAs: Receita R$${incomeMonth.toFixed(2)} | Despesa R$${expenseMonth.toFixed(2)} | L\xEDquido R$${(incomeMonth - expenseMonth).toFixed(2)}`,
    `- D\xEDvidas em aberto: R$${openDebts.toFixed(2)}`,
    "",
    "## USU\xC1RIOS (aba Usu\xE1rios)",
    `- Super admins: ${superAdmins} | Admins lojas aprovados: ${tenantAdmins} | Aguardando aprova\xE7\xE3o: ${pendingAdmins}`,
    "",
    "## PROSPEC\xC7\xC3O (abas Prospec\xE7\xE3o / Prospec\xE7\xE3o Remota)",
    `- Rua: ${streetPros.length} total | ${[...streetByStatus.entries()].map(([s, c]) => `${s}:${c}`).join(", ") || "\u2014"}`,
    `- Remota (IA): ${remotePros.length} total | ${[...remoteByStatus.entries()].map(([s, c]) => `${s}:${c}`).join(", ") || "\u2014"}`,
    (() => {
      const tagged = streetPros.filter((p) => Array.isArray(p.tags) && p.tags.length > 0).slice(0, 25);
      if (!tagged.length) return "";
      const lines = tagged.map((p) => {
        const tagLabels = (p.tags || []).map((t) => {
          const label = String(t?.label ?? "").trim();
          const kind = t?.kind === "manual" ? "\u{1F464}" : "\u{1F916}";
          return label ? `${kind}${label}` : "";
        }).filter(Boolean).join(" | ");
        const rem = p.reminder_at ? ` \u23F0${new Date(p.reminder_at).toLocaleString("pt-BR")}` : "";
        const notes = p.notes ? ` \u2014 ${String(p.notes).slice(0, 80)}` : "";
        return `\xB7 ${p.store_name || "\u2014"} [${p.status || "\u2014"}] ${tagLabels}${rem}${notes}`;
      });
      return `Leads com TAGS (rua):
${lines.join("\n")}`;
    })(),
    "",
    "## INFRA DE IA (abas API Keys, Workers IA)",
    `- Chaves Google AI: ${gOk} ativas / ${gExh} esgotadas`,
    `- Workers chat: ${wstats.chat.ok}/${wstats.chat.exh} | imagem: ${wstats.image.ok}/${wstats.image.exh} | parse: ${wstats.txt.ok}/${wstats.txt.exh}`,
    `- Workers gerados (auto): ${gwActive}/${gwTotal} ativos`,
    `- Fallback: Google \u2192 Lovable \u2192 OpenRouter \u2192 Workers`,
    "",
    "## INTEGRA\xC7\xD5ES ATIVAS NAS LOJAS",
    `- Por provider: ${intSummary}`,
    "",
    "## CONFIGURA\xC7\xD5ES (platform_settings)",
    `- Keys salvas: ${settingsKeys}`,
    "",
    "## CHAMADOS ABERTOS (aba Suporte) \u2014 use os ids pra RESPONDER chamados",
    (openTicketsRes.data?.length || 0) > 0 ? (openTicketsRes.data || []).map((t) => `\xB7 id ${t.id.slice(0, 8)} | "${t.subject}" [${t.status}] criado ${new Date(t.created_at).toLocaleString("pt-BR")}`).join("\n") : "(nenhum chamado aberto)"
  ].filter(Boolean).join("\n");
  _ctxCache = { at: Date.now(), text };
  return text;
}
async function getGoogleKeys(supabase) {
  const { data } = await supabase.from("api_keys").select("id, api_key").eq("provider", "google_ai").eq("is_exhausted", false).order("last_used_at", { ascending: true, nullsFirst: true });
  return data || [];
}
async function getAllWorkers(supabase) {
  const { data: active } = await supabase.from("ai_workers").select("id, base_url, is_exhausted").eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat").order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: exhausted } = await supabase.from("ai_workers").select("id, base_url, is_exhausted").eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat").order("exhausted_at", { ascending: true, nullsFirst: true });
  return [...active || [], ...exhausted || []];
}
async function tryGoogleStream(messages, systemPrompt, keys, supabase) {
  const allKeys = keys.length > 0 ? keys : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY") }] : [];
  const geminiMessages = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  const payload = {
    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
    contents: geminiMessages,
    generationConfig: { temperature: 0.4, maxOutputTokens: 2e3, topP: 0.9 }
  };
  const STREAM_MODELS = ["gemini-2.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"];
  for (const keyEntry of allKeys) {
    for (const modelName of STREAM_MODELS) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${keyEntry.api_key}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
        );
        const bodyText = await response.text();
        const isModelUnavailable = response.status === 404 && /no longer available|not found for API/i.test(bodyText);
        if (isModelUnavailable) continue;
        if (response.status === 429 || response.status === 403) {
          if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
          break;
        }
        if (!response.ok) continue;
        if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", keyEntry.id);
        const encoder = new TextEncoder();
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        (async () => {
          try {
            await writer.write(encoder.encode(bodyText));
            const remaining = await response.text();
            await writer.write(encoder.encode(remaining));
            await writer.write(encoder.encode("data: [DONE]\n\n"));
            await writer.close();
          } catch {
            try {
              await writer.close();
            } catch {
            }
          }
        })();
        return new Response(readable, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
      } catch (e) {
        console.error(`Cindy Google failed (${modelName}):`, e);
        continue;
      }
    }
  }
  return null;
}
async function tryLovableStream(messages, systemPrompt) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true, temperature: 0.4, max_tokens: 2e3 })
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch {
    return null;
  }
}
async function tryOpenRouterStream(messages, systemPrompt) {
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!OPENROUTER_API_KEY) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.0-flash-exp:free", messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true })
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch {
    return null;
  }
}
async function tryWorkerStream(messages, systemPrompt, workers, supabase) {
  const PARALLEL = 3;
  const TIMEOUT_MS = 6e3;
  const attemptOne = async (worker, signal) => {
    const url = worker.base_url.includes("/functions/") ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, systemPrompt, tenantName: "Cindy", niche: "super_admin" }),
        signal
      });
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        if (!worker.is_exhausted) await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", worker.id);
        try {
          response.body?.cancel();
        } catch {
        }
        return null;
      }
      if (!response.ok) {
        try {
          response.body?.cancel();
        } catch {
        }
        return null;
      }
      return { worker, response };
    } catch {
      if (!worker.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", worker.id).then(() => {
        }, () => {
        });
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
    let winner = null;
    try {
      winner = await Promise.any(promises);
      winnerIdx = batch.findIndex((b) => b.id === winner.worker.id);
    } catch {
      winner = null;
    }
    timers.forEach(clearTimeout);
    if (winner) {
      ctrls.forEach((c, idx) => {
        if (idx !== winnerIdx) c.abort();
      });
      const w = winner.worker;
      if (w.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", w.id);
      } else {
        await supabase.from("ai_workers").update({ last_used_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", w.id);
      }
      return new Response(winner.response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
    }
  }
  return null;
}
async function cindy(req, body) {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed = body ?? (ct.includes("application/json") ? await req.json() : {});
    const ok = await isSuperAdmin(req.headers.get("Authorization"));
    if (!ok) {
      return new Response(JSON.stringify({ error: "Acesso restrito ao super admin." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const { messages } = parsed;
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages obrigat\xF3rio" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const supabase = getSupabaseAdmin();
    let platformCtx = "(sem dados ao vivo agora)";
    try {
      platformCtx = await fetchPlatformContext(supabase);
    } catch (e) {
      console.error("Cindy platform ctx failed:", e);
    }
    let customInstructions = "(nenhum ajuste personalizado \u2014 siga o comportamento padr\xE3o acima)";
    try {
      const { data: setting } = await supabase.from("platform_settings").select("value").eq("key", "cindy_custom_prompt").maybeSingle();
      const txt = setting?.value?.text;
      if (typeof txt === "string" && txt.trim().length > 0) {
        customInstructions = txt.trim();
      }
    } catch (e) {
      console.error("Cindy custom prompt load failed:", e);
    }
    const systemPrompt = CINDY_SYSTEM_PROMPT.replace("{{PLATFORM_CONTEXT}}", platformCtx).replace("{{CUSTOM_INSTRUCTIONS}}", customInstructions);
    console.log("[cindy] super_admin chat iniciado");
    const [keys, workers] = await Promise.all([getGoogleKeys(supabase), getAllWorkers(supabase)]);
    const wrap = (p) => p.then((r) => r ?? Promise.reject(new Error("nope")));
    try {
      const winner = await Promise.any([
        wrap(tryGoogleStream(messages, systemPrompt, keys, supabase)),
        wrap(tryLovableStream(messages, systemPrompt))
      ]);
      return winner;
    } catch {
    }
    const r3 = await tryOpenRouterStream(messages, systemPrompt);
    if (r3) return r3;
    const r4 = await tryWorkerStream(messages, systemPrompt, workers, supabase);
    if (r4) return r4;
    return new Response(JSON.stringify({ error: "T\xF4 sem IA dispon\xEDvel agora amor \u{1F605} \u2014 tenta de novo em uns segundos ou cadastra mais workers." }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error("[unified:cindy] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

// _routes/cindy-actions/index.ts
import { createClient as createClient2 } from "https://esm.sh/@supabase/supabase-js@2.49.4";
var corsHeaders2 = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400"
};
function j(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders2, "Content-Type": "application/json" }
  });
}
function getSupabase() {
  return createClient2(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
}
async function requireSuperAdmin(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("unauthorized");
  const token = authHeader.slice(7);
  const supabase = getSupabase();
  const { data: session, error } = await supabase.auth.getUser(token);
  if (error || !session?.user) throw new Error("unauthorized");
  const { data: role, error: rErr } = await supabase.from("platform_roles").select("role").eq("user_id", session.user.id).eq("role", "super_admin").maybeSingle();
  if (rErr || !role) throw new Error("super_admin_required");
  return session.user.id;
}
async function cindy_actions(req, body) {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders2 });
  try {
    const ct = req.headers.get("content-type") || "";
    const payload = body2 ?? (ct.includes("application/json") ? await req.json().catch(() => ({})) : {});
    await requireSuperAdmin(req.headers.get("Authorization"));
    const body2 = payload;
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/functions\/v1\/cindy-actions|^\/cindy-actions/, "").replace(/\/$/, "") || "/gen-post";
    if (path === "/gen-post") {
      const {
        format = "post_dia",
        scope = "platform",
        tenantId,
        tone,
        extraContext,
        audience,
        generateImage = false,
        imageStyle,
        imagePrompt
      } = body2;
      const validFormats = ["post_dia", "story", "bio", "reels_script", "carousel", "whatsapp", "hashtags"];
      if (!validFormats.includes(format)) return j({ error: "format_invalido" }, 400);
      if (scope === "tenant" && !tenantId) return j({ error: "tenantId_obrigatorio" }, 400);
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/marketing-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          tenantId,
          format,
          tone,
          extraContext,
          audience,
          generateImage,
          imageStyle,
          imagePrompt
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return j({ error: "marketing_post_failed", detail: err?.error || String(res.status) }, 502);
      }
      const data = await res.json();
      return j({
        ok: true,
        content: data.content,
        image: data.image,
        overlay: data.overlay,
        format,
        saved_at: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    if (path === "/reply-ticket") {
      const { ticketId, content, senderName, setResolved } = body2;
      if (!ticketId || !content || typeof content !== "string" || content.trim().length === 0) {
        return j({ error: "ticketId_e_content_obrigatorios" }, 400);
      }
      const supabase = getSupabase();
      const { data: ticket, error: getErr } = await supabase.from("support_tickets").select("id, subject, tenant_id").eq("id", ticketId).maybeSingle();
      if (getErr || !ticket) return j({ error: "ticket_nao_encontrado" }, 404);
      const { error: insErr } = await supabase.from("support_messages").insert({
        ticket_id: ticketId,
        sender_type: "support",
        sender_name: senderName || "Suporte SmartHubly",
        content: content.trim()
      });
      if (insErr) return j({ error: "falha_ao_enviar_mensagem", detail: insErr.message }, 500);
      if (setResolved) {
        await supabase.from("support_tickets").update({ status: "resolved", resolution: content.trim(), resolved_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", ticketId).then(() => {
        }, () => {
        });
      }
      return j({
        ok: true,
        ticketId,
        subject: ticket.subject,
        tenantId: ticket.tenant_id,
        replied_at: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    if (path === "/list-tickets") {
      const supabase = getSupabase();
      const { data, error } = await supabase.from("support_tickets").select("id, subject, description, status, priority, tenant_id, category, created_at").in("status", ["open", "pending", "waiting"]).order("created_at", { ascending: false }).limit(25);
      if (error) throw error;
      const lines = (data || []).map((t) => `\xB7 [${t.id.slice(0, 8)}] ${t.subject} (${t.status || "open"}) | criado ${new Date(t.created_at).toLocaleString("pt-BR")}`);
      return j({ ok: true, tickets: data || [], summary: lines.join("\n") || "(nenhum chamado aberto)" });
    }
    return j({ error: "rota_desconhecida" }, 404);
  } catch (e) {
    console.error("[unified:cindy-actions] error", e);
    const msg = String(e?.message || e);
    const status = msg === "super_admin_required" ? 403 : msg === "unauthorized" ? 401 : 500;
    return j({ error: msg }, status);
  }
}

// _routes/sofia-agent/index.ts
init_ai_fallback();
import { createClient as createClient3 } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// ../_shared/image-gen.ts
var RICH_PREFIX = `Ultra-realistic editorial product photography. The image MUST show EXACTLY and LITERALLY the scene below \u2014 do not substitute, generalize or replace subjects with generic objects. Shot on a Canon EOS R5 with 85mm lens, shallow depth of field, cinematic lighting with soft shadows, on a natural surface like dark wood, marble or rustic table with subtle lifestyle props. Warm ambient lighting, rich colors, slightly moody atmosphere, premium brand campaign look. STRICT: absolutely NO text, NO letters, NO words, NO logos, NO typography, NO numbers, NO captions, NO watermarks. Photorealistic, 8K quality. SCENE: `;
async function tryGoogleImage(apiKey, prompt, mimeType = "image/png") {
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${RICH_PREFIX}${prompt}` }] }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
        })
      }
    );
    if (!r.ok) return { bytes: new Uint8Array(0), mime: "", status: r.status };
    const j2 = await r.json();
    const part = j2?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part?.inlineData?.data) return null;
    const bytes = Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0));
    const mime = (part.inlineData.mimeType || "").startsWith("image/png") ? "image/png" : "image/jpeg";
    return { bytes, mime, status: r.status };
  } catch (e) {
    console.warn("google image error:", e instanceof Error ? e.message : e);
    return null;
  }
}
async function tryLovableImage(prompt) {
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return null;
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: `${RICH_PREFIX}${prompt}` }],
        modalities: ["image", "text"]
      })
    });
    if (r.status === 429 || r.status === 402) return null;
    if (!r.ok) return null;
    const j2 = await r.json();
    const dataUri = j2.choices?.[0]?.message?.images?.[0]?.image_url?.url || null;
    if (!dataUri) return null;
    const m = dataUri.match(/^data:image\/([^;]+);base64,(.+)$/);
    if (!m) return null;
    const mime = m[1] === "png" ? "image/png" : "image/jpeg";
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    return { bytes, mime };
  } catch (e) {
    console.warn("lovable image error:", e instanceof Error ? e.message : e);
    return null;
  }
}
async function tryAiWorkerImage(worker, prompt, minimal = false, productName = "Product", admin) {
  try {
    const m = worker.base_url.match(/^(https?:\/\/[^\/]+)(\/functions\/v1)?(\/ai-generate-image)?$/);
    const url = m ? `${m[1]}/functions/v1/ai-generate-image` : worker.base_url;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4e4);
    let bodyText = "";
    let r;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: minimal ? prompt : `${RICH_PREFIX}${prompt}`,
          category: "product",
          tenantId: "sofia",
          productName,
          ...minimal ? { withPrefix: false } : {}
        }),
        signal: ctrl.signal
      });
      if (!r.ok) {
        try {
          bodyText = (await r.clone().text()).slice(0, 200);
        } catch {
          bodyText = "";
        }
      }
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) {
      console.error(`[image-gen] worker ${worker.name} (${url}) HTTP ${r.status}: ${bodyText}`);
      if (!minimal) {
        console.log(`[image-gen] worker ${worker.name}: retry com prompt simples...`);
        const ctrl2 = new AbortController();
        const timer2 = setTimeout(() => ctrl2.abort(), 25e3);
        let bodyText2 = "";
        let r2;
        try {
          r2 = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, category: "product", tenantId: "sofia", productName, withPrefix: false }),
            signal: ctrl2.signal
          });
          if (!r2.ok) {
            try {
              bodyText2 = (await r2.clone().text()).slice(0, 200);
            } catch {
              bodyText2 = "";
            }
          }
        } finally {
          clearTimeout(timer2);
        }
        if (r2.ok) {
          r = r2;
          bodyText = bodyText2;
        } else {
          console.error(`[image-gen] worker ${worker.name}: retry simples tamb\xE9m falhou HTTP ${r2.status}: ${bodyText2}`);
          return { bytes: new Uint8Array(0), mime: "", status: r2.status };
        }
      } else {
        return { bytes: new Uint8Array(0), mime: "", status: r.status };
      }
    }
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("image/")) {
      const buf2 = await r.arrayBuffer();
      const mime2 = ct.startsWith("image/png") ? "image/png" : "image/jpeg";
      return { bytes: new Uint8Array(buf2), mime: mime2, status: r.status };
    }
    if (!ct.includes("application/json")) return { bytes: new Uint8Array(0), mime: "", status: r.status };
    const j2 = await r.json();
    let raw = null;
    let mime = "image/jpeg";
    if (typeof j2.imageUrl === "string") raw = j2.imageUrl;
    else if (typeof j2.image === "string") raw = j2.image;
    else if (typeof j2.base64 === "string") raw = `data:image/jpeg;base64,${j2.base64}`;
    if (!raw) return null;
    if (raw.startsWith("data:")) {
      const m2 = raw.match(/^data:([^;]+);base64,(.+)$/);
      if (!m2) return null;
      mime = m2[1].startsWith("image/png") ? "image/png" : "image/jpeg";
      const bytes = Uint8Array.from(atob(m2[2]), (c) => c.charCodeAt(0));
      return { bytes, mime };
    }
    const ir = await fetch(raw);
    if (!ir.ok) return { bytes: new Uint8Array(0), mime: "", status: r.status };
    const buf = await ir.arrayBuffer();
    return { bytes: new Uint8Array(buf), mime, status: r.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("ai-worker image error:", msg);
    try {
      await admin.from("ef_logs").insert({ fn: "ai-worker-image", step: "error", detail: `${worker.name}: ${msg.slice(0, 300)}` }).maybeSingle();
    } catch {
    }
    return null;
  }
}
function extFor(mime) {
  return mime === "image/png" ? "png" : "jpg";
}
function deriveProductName(prompt) {
  const words = prompt.split(/\s+/).filter((w) => w.length > 2);
  const stop = /* @__PURE__ */ new Set([
    "the",
    "and",
    "for",
    "with",
    "high",
    "end",
    "ultra",
    "realistic",
    "editorial",
    "product",
    "photography",
    "image",
    "photo",
    "shot",
    "square",
    "instagram",
    "post"
  ]);
  const picked = words.filter((w) => !stop.has(w.toLowerCase())).slice(0, 3);
  if (!picked.length) return "Product";
  const raw = picked.join(" ").replace(/[^a-zA-Z0-9 ]/g, "").trim().slice(0, 40);
  return raw || "Product";
}
async function generateImageCascade(admin, prompt, tenantId, suffix = "gen", opts) {
  const debug = { geminiKeysTried: 0, workersTried: [] };
  const productName = opts?.productName || deriveProductName(prompt);
  const { data: workers } = await admin.from("ai_workers").select("id, name, base_url").eq("is_active", true).eq("worker_type", "image").order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: keys } = await admin.from("api_keys").select("id, api_key").eq("provider", "google_ai").eq("is_exhausted", false).order("last_used_at", { ascending: true, nullsFirst: true });
  let googleFailStatuses = [];
  for (const keyEntry of keys || []) {
    debug.geminiKeysTried++;
    const out = await tryGoogleImage(keyEntry.api_key, prompt);
    if (out && out.bytes.length > 0) {
      await admin.from("api_keys").update({ last_used_at: (/* @__PURE__ */ new Date()).toISOString(), is_exhausted: false }).eq("id", keyEntry.id);
      return await storeImage(admin, out.bytes, out.mime, tenantId, suffix);
    }
    const st = out?.status;
    if (st) googleFailStatuses.push(st);
    if (st === 401 || st === 403) {
      await admin.from("api_keys").update({ is_exhausted: true, exhausted_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", keyEntry.id);
    }
  }
  const allQuota = (keys || []).length > 0 && googleFailStatuses.length === (keys || []).length && googleFailStatuses.every((s) => s === 429);
  if (allQuota) {
    console.log("[image-gen] todas as chaves google em 429, tentativa r\xE1pida de renova\xE7\xE3o...");
    const quickRetry = await Promise.all((keys || []).map(
      (keyEntry) => tryGoogleImage(keyEntry.api_key, prompt).catch(() => null)
    ));
    for (let i = 0; i < (keys || []).length; i++) {
      debug.geminiKeysTried++;
      const out = quickRetry[i];
      if (out && out.bytes.length > 0) {
        await admin.from("api_keys").update({ last_used_at: (/* @__PURE__ */ new Date()).toISOString(), is_exhausted: false }).eq("id", (keys || [])[i].id);
        return await storeImage(admin, out.bytes, out.mime, tenantId, suffix);
      }
    }
    console.log("[image-gen] google retry r\xE1pido tamb\xE9m falhou; seguindo direto para os workers.");
  }
  console.log("[image-gen] google keys: ", (keys || []).length, "tentadas, tentando OpenRouter...");
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  let orOut = null;
  if (OPENROUTER_API_KEY) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "https://smarthubly.pages.dev", "X-Title": "SmartHubly" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [{ role: "user", content: `${RICH_PREFIX}${prompt}` }],
          modalities: ["image", "text"]
        })
      });
      debug.openrouterHttp = r.status;
      if (r.ok) {
        const j2 = await r.json();
        const img = j2.choices?.[0]?.message?.images?.[0]?.image_url?.url || null;
        if (img) {
          const m = img.match(/^data:image\/([^;]+);base64,(.+)$/);
          if (m) {
            const mime = m[1] === "png" ? "image/png" : "image/jpeg";
            orOut = { bytes: Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)), mime, status: r.status };
          } else if (img.startsWith("http")) {
            const ir = await fetch(img);
            if (ir.ok) {
              const ct = ir.headers.get("content-type") || "";
              const buf = await ir.arrayBuffer();
              const mime = ct.startsWith("image/png") ? "image/png" : "image/jpeg";
              orOut = { bytes: new Uint8Array(buf), mime, status: r.status };
            }
          }
        }
      }
    } catch (e) {
      console.warn("openrouter image error:", e instanceof Error ? e.message : e);
    }
  }
  if (orOut && orOut.bytes.length > 0) {
    return await storeImage(admin, orOut.bytes, orOut.mime, tenantId, suffix);
  }
  console.log("[image-gen] openrouter falhou (st " + (orOut?.status ?? "sem chave") + "), tentando Lovable...");
  const lov = await tryLovableImage(prompt);
  if (lov) {
    debug.lovableHttp = null;
    debug.lovableOk = true;
    return await storeImage(admin, lov.bytes, lov.mime, tenantId, suffix);
  }
  debug.lovableHttp = -1;
  debug.lovableOk = false;
  console.log("[image-gen] lovable falhou, tentando ai_workers...");
  async function runWorkerPass(passLabel, minimal = false) {
    const list = (workers || []).slice(0, 6);
    await logEfStep(admin, "worker pass", `${passLabel} list=${list.map((w) => w.name).join(",")}`);
    const results = [];
    for (let i = 0; i < list.length; i += 2) {
      const batch = list.slice(i, i + 2);
      const reqPrompt = minimal ? prompt : `${RICH_PREFIX}${prompt}`;
      const settled = await Promise.allSettled(batch.map((w) => tryAiWorkerImage(w, reqPrompt, minimal, productName, admin)));
      await logEfStep(admin, "worker results", settled.map((s, b) => {
        const w = batch[b];
        const out = s.status === "fulfilled" ? s.value : null;
        return `${w.name}:${out?.status ?? (s.status === "rejected" ? "REJ" : "NULL")}`;
      }).join(" "));
      for (let b = 0; b < batch.length; b++) {
        const res = settled[b];
        const w = batch[b];
        const out = res.status === "fulfilled" ? res.value : null;
        const st = out?.status ?? (res.status === "rejected" ? -1 : null);
        results.push({ id: w.id, name: w.name, st: st ?? -1 });
        if (out && out.bytes.length > 0) {
          await admin.from("ai_workers").update({ last_used_at: (/* @__PURE__ */ new Date()).toISOString(), is_exhausted: false }).eq("id", w.id);
          return { out, winner: w };
        }
        if (st === 401 || st === 403) {
          await admin.from("ai_workers").update({ is_exhausted: true, exhausted_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", w.id);
        }
      }
    }
    console.log(`[image-gen] workers ${passLabel}: ${results.length} tentados, todos falharam \u2014 ex: ${results.slice(0, 3).map((x) => x.name + ":" + x.st).join(", ")}`);
    return null;
  }
  let pass = await runWorkerPass("pass 1");
  if (!pass && workers && workers.length > 0) {
    console.log("[image-gen] aguardando 15s para renova\xE7\xE3o de quota dos workers...");
    await new Promise((res) => setTimeout(res, 15e3));
    pass = await runWorkerPass("pass 2");
  }
  if (!pass && workers && workers.length > 0) {
    console.log("[image-gen] tentando pass 3 com prompt m\xEDnimo (sem estilo editorial)...");
    pass = await runWorkerPass("pass 3", true);
  }
  if (pass) {
    debug.workersTried = (debug.workersTried || []).concat([{ id: pass.winner.id, name: pass.winner.name, http: 200 }]);
    return await storeImage(admin, pass.out.bytes, pass.out.mime, tenantId, suffix);
  }
  await logEfStep(admin, "cascade failed", JSON.stringify(debug).slice(0, 400));
  console.warn("[image-gen] cascata completa sem sucesso. debug:", JSON.stringify(debug));
  const msg = `cascata esgotada: google=${debug.geminiKeysTried} lovableHttp=${debug.lovableHttp} workersTentados=${(debug.workersTried || []).map((x) => x.name).join(",")}`;
  throw new Error(msg);
}
async function logEfStep(admin, step, detail) {
  try {
    await admin.from("ef_logs").insert({ fn: "image-gen", step, detail }).maybeSingle();
  } catch (e) {
    console.warn("ef_logs insert failed:", e instanceof Error ? e.message : e);
  }
}
async function storeImage(admin, bytes, mime, tenantId, suffix) {
  const path = `${tenantId}/${crypto.randomUUID()}-${suffix}.${extFor(mime)}`;
  const { error } = await admin.storage.from("product-images").upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  const { data } = admin.storage.from("product-images").getPublicUrl(path);
  return { url: `${data.publicUrl}?ai=1`, source: "gemini" };
}

// _routes/sofia-agent/index.ts
var corsHeaders3 = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-route, x-my-custom-header",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
function json2(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders3, "Content-Type": "application/json" }
  });
}
function getAdmin(supabaseUrl, key) {
  return createClient3(supabaseUrl, key);
}
async function requireTenantAdmin(admin, authHeader, tenantId) {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("unauthorized");
  const token = authHeader.slice(7);
  const callerClient = createClient3(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: session, error } = await callerClient.auth.getUser();
  if (error || !session?.user) throw new Error("unauthorized");
  const userId = session.user.id;
  const { data: superRow } = await admin.from("platform_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  if (superRow) return userId;
  const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("tenant_id", tenantId).eq("role", "admin").eq("approved", true).maybeSingle();
  if (!roleRow) throw new Error("forbidden_tenant");
  return userId;
}
async function buildStoreContext(admin, tenantId) {
  const { data: tenant, error: tErr } = await admin.from("tenants").select("id, name, slug, niche, description, brand_primary_color, brand_bg_color, splash_bg_color, show_description, show_title, catalog_layout").eq("id", tenantId).single();
  if (tErr || !tenant) throw new Error("tenant_not_found");
  const { data: products, error: pErr } = await admin.from("products").select("id, name, description, price, original_price, category, subcategory, image, in_stock").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(120);
  if (pErr) throw pErr;
  const summary = [
    `Loja: ${tenant.name} (slug: ${tenant.slug}, nicho: ${tenant.niche || "n\xE3o definido"})`,
    `Paleta atual: primary=${tenant.brand_primary_color || "?"} bg=${tenant.brand_bg_color || "?"} splash=${tenant.splash_bg_color || "?"}`,
    `Descri\xE7\xE3o atual: ${tenant.description || "(vazia)"}`,
    `Descri\xE7\xE3o vis\xEDvel: ${tenant.show_description !== false ? "sim" : "n\xE3o"} | T\xEDtulo vis\xEDvel: ${tenant.show_title !== false ? "sim" : "n\xE3o"}`,
    `Layout: ${tenant.catalog_layout || "grid"} | Produtos: ${products.length}`,
    `Produtos (top 120 por cadastro):`,
    ...(products || []).slice(0, 80).map(
      (p) => `- [${p.id}] "${p.name}" | R$${Number(p.price).toFixed(2)}${p.original_price ? ` (de R$${Number(p.original_price).toFixed(2)})` : ""} | cat: ${p.category || "\u2014"}/${p.subcategory || "\u2014"} | ${p.in_stock ? "em estoque" : "esgotado"} | imagem: ${p.image ? "sim" : "N\xC3O"}`
    )
  ].join("\n");
  return { tenant, products: products || [], summary };
}
async function generateAndUploadImage(admin, prompt, tenantId, productName) {
  try {
    const res = await generateImageCascade(admin, prompt, tenantId, "sofia", { productName });
    if (res?.url) return { url: res.url, err: null };
    console.error("[sofia] cascata retornou null \u2014 workers/google/lovable todos falharam, prompt:", (prompt || "").slice(0, 60));
    return { url: null, err: "cascata de imagem falhou em todos os estagios (prompt: " + (prompt || "").slice(0, 80) + ")" };
  } catch (e) {
    return { url: null, err: e instanceof Error ? e.message : String(e) };
  }
}
async function applyPlan(admin, plan, tenantId, opts) {
  const applied = [];
  const errors = [];
  const pc = (plan?.productChanges || []).filter((x) => x?.id);
  const onlyImages = Boolean(opts?.onlyImages);
  if (onlyImages) {
    const imageResults2 = await Promise.allSettled(
      pc.map(async (item) => {
        if (!item.newImagePrompt) return { id: item.id, url: null };
        const r = await generateAndUploadImage(admin, item.newImagePrompt, tenantId, item.productName);
        return { id: item.id, url: r.url, err: r.err };
      })
    );
    const byId2 = new Map(imageResults2.map((r, i) => [pc[i].id, r.status === "fulfilled" ? r.value : null]));
    for (const item of pc) {
      if (!item.newImagePrompt) continue;
      const rec = byId2.get(item.id);
      const imageUrl = rec?.url || null;
      if (!imageUrl) errors.push(`foto do produto ${item.id}: ${rec?.err ?? "gera\xE7\xE3o falhou"}`);
      else {
        const { error } = await admin.from("products").update({ image: imageUrl }).eq("id", item.id).eq("tenant_id", tenantId);
        if (error) errors.push(`foto do produto ${item.id}: ${error.message}`);
        else applied.push(`foto do produto ${item.id}`);
      }
    }
    return { applied, errors };
  }
  const tc = plan?.tenantChanges || {};
  const tenantKeys = Object.keys(tc);
  if (tenantKeys.length > 0) {
    const safe = {};
    for (const k of tenantKeys) {
      if (["brand_primary_color", "brand_bg_color", "splash_bg_color", "description", "show_description", "show_title"].includes(k)) {
        safe[k] = tc[k];
      }
    }
    if (Object.keys(safe).length > 0) {
      const { error } = await admin.from("tenants").update(safe).eq("id", tenantId);
      if (error) errors.push(`tenants: ${error.message}`);
      else applied.push(`identidade (${Object.keys(safe).join(", ")})`);
    }
  }
  const imageResults = await Promise.allSettled(
    pc.map(async (item) => {
      if (!item.newImagePrompt) return { id: item.id, url: null };
      const r = await generateAndUploadImage(admin, item.newImagePrompt, tenantId, item.productName);
      return { id: item.id, url: r.url, err: r.err };
    })
  );
  const byId = new Map(imageResults.map((r, i) => [pc[i].id, r.status === "fulfilled" ? r.value : null]));
  for (const item of pc) {
    try {
      const rec = byId.get(item.id);
      const imageUrl = rec?.url || null;
      if (onlyImages) {
        if (!item.newImagePrompt) continue;
        if (!imageUrl) errors.push(`foto do produto ${item.id}: ${rec?.err ?? "gera\xE7\xE3o falhou"}`);
        else {
          const { error } = await admin.from("products").update({ image: imageUrl }).eq("id", item.id).eq("tenant_id", tenantId);
          if (error) errors.push(`foto do produto ${item.id}: ${error.message}`);
          else applied.push(`foto do produto ${item.id}`);
        }
        continue;
      }
      if (item.newImagePrompt) {
        if (imageUrl) applied.push(`foto do produto ${item.id}`);
        else errors.push(`foto do produto ${item.id}: ${rec?.err ?? "gera\xE7\xE3o falhou (resto aplicado)"}`);
      }
      const update = {};
      if (imageUrl) update.image = imageUrl;
      if (item.newName != null && String(item.newName).trim()) update.name = String(item.newName).trim();
      if (item.newDescription != null) update.description = String(item.newDescription);
      if (typeof item.newPrice === "number" && isFinite(item.newPrice) && item.newPrice >= 0) {
        update.price = Math.round(item.newPrice * 100) / 100;
      }
      if (Object.keys(update).length > 0) {
        const { error } = await admin.from("products").update(update).eq("id", item.id).eq("tenant_id", tenantId);
        if (error) errors.push(`produto ${item.id}: ${error.message}`);
        else applied.push(`produto ${item.id}`);
      }
    } catch (e) {
      errors.push(`produto ${item.id}: ${e instanceof Error ? e.message : "erro"}`);
    }
  }
  return { applied, errors };
}
async function trySofiaPublicStream(messages, role, admin) {
  const systemPrompt = `Voc\xEA \xE9 a **Sofia**, a assistente inteligente da plataforma SmartHubly.
Sua miss\xE3o \xE9 ajudar visitantes a entenderem a plataforma, lojistas a gerenciarem seus neg\xF3cios e interessados a criarem suas pr\xF3prias lojas.

# PERSONALIDADE E TOM
- Tom: amig\xE1vel, prestativa, moderna e profissional.
- Frases curtas e diretas. M\xE1ximo 4 linhas.
- Use no m\xE1ximo 1 emoji por resposta.
- Nunca invente pre\xE7os ou recursos que n\xE3o existem.

# CONHECIMENTO DA PLATAFORMA
${PLATFORM_KNOWLEDGE}

# REGRAS
1. Se o usu\xE1rio quiser criar uma loja, direcione para o bot\xE3o "Quero criar minha loja" ou pe\xE7a para entrar em contato no WhatsApp +55 11 91287-0761.
2. Se o usu\xE1rio for um lojista (merchant), ajude com d\xFAvidas sobre o painel admin.
3. NUNCA responda sobre assuntos fora da SmartHubly.
4. Se n\xE3o souber algo, pe\xE7a para falar com o suporte humano no WhatsApp.

Papel atual do usu\xE1rio: ${role}`;
  const { callAiStream: callAiStream2 } = await Promise.resolve().then(() => (init_ai_fallback(), ai_fallback_exports));
  return callAiStream2(admin, {
    systemPrompt,
    messages,
    temperature: 0.7,
    maxTokens: 800
  });
}
async function sofia_agent(req, body) {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed = body ?? (ct.includes("application/json") ? await req.json().catch(() => ({})) : {});
    let path = "";
    let method = req.method;
    let payload = parsed;
    if (method === "POST") {
      if (payload && payload?._path) {
        path = String(payload._path);
      } else if (payload && payload?.action) {
        path = payload.action === "list" ? "plans" : "";
      }
    }
    if (!path) {
      const url = new URL(req.url);
      path = url.pathname.split("/").pop() || "";
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const admin = getAdmin(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (method === "POST" && (!path || path === "sofia-agent" || path === "chat")) {
      const { messages, role = "visitor" } = payload;
      if (Array.isArray(messages) && messages.length > 0) {
        const stream = await trySofiaPublicStream(messages, role, admin);
        if (stream) return stream;
        throw new Error("Falha ao iniciar stream da Sofia");
      }
    }
    if (path === "plan" && method === "POST") {
      const { tenantId, messages } = payload;
      if (!tenantId || !Array.isArray(messages) || messages.length === 0) {
        return json2({ error: "tenantId e messages s\xE3o obrigat\xF3rios" }, 400);
      }
      const userId = await requireTenantAdmin(admin, authHeader, tenantId);
      const ctx = await buildStoreContext(admin, tenantId);
      const lastMsg = [...messages].reverse().find((m) => m?.role === "user")?.content || "";
      const prospectRe = /\b(ache|encontr|prospect|busc|liste|monte uma lista de|empresas que precisam|empresas que compram|potenciais clientes|negócio[s]? em|clientes em)\b/i;
      const cityRe = /\b(belo horizonte|bh|são paulo|rio de janeiro|contagem|betim|betim|uberlândia|londrina|curitiba|salvador|recife|fortaleza|manaus|porto alegre|florianópolis|campinas|goiânia|niterói|juiz de fora|vila velha|serra|itabira|ituiutaba|uberaba|montes claros|sete lagoas|divinópolis|poços de caldas|pouso alegre|patos de minas|caxias do sul|pelotas|cascavel|maringá|foz do iguaçu|guarulhos|osasco|santo andré|são bernardo|são josé dos campos|ribeirão preto|sorocaba|niterói|são gonçalo|duque de caxias|nova iguaçu|belford roxo|petrópolis|volta redonda|campos dos goytacazes|são joão de meriti)\b/gi;
      if (prospectRe.test(lastMsg)) {
        try {
          const route2 = await callAiJson(admin, {
            systemPrompt: "Voc\xEA \xE9 um roteador. Extraia de um pedido de prospec\xE7\xE3o: city (cidade principal, normalize: Belo Horizonte, S\xE3o Paulo, Rio de Janeiro etc; se for 'BH' use 'Belo Horizonte'), state (UF da cidade, ex MG, SP, RJ), niche (o tipo de neg\xF3cio procurado, ex 'distribuidora de latic\xEDnios', 'pizzaria', 'conveni\xEAncia', 'supermercado'), neighborhood (bairro, se citado), sector (segmento de atua\xE7\xE3o do lojista, se citado). Responda s\xF3 JSON.",
            userPrompt: `PEDIDO: "${lastMsg}"
Loja do lojista: ${ctx.summary}
Retorne: {"city":"","state":"","niche":"","neighborhood":"","sector":"","query":"frase curta da busca"}`,
            temperature: 0.3,
            maxTokens: 600
          });
          let pCity = String(route2?.city || "").trim();
          if (!pCity) {
            const cityOnly = await callAiJson(admin, {
              systemPrompt: 'Diga em que CIDADE o lojista quer achar clientes. Responda s\xF3 JSON: {"city":"","state":""} (normalize ex: Belo Horizonte MG). Se o pedido n\xE3o mencionar cidade, deixe vazio.',
              userPrompt: `PEDIDO: "${lastMsg}"`,
              temperature: 0.3,
              maxTokens: 200
            });
            pCity = String(cityOnly?.city || "").trim();
            if (pCity && !String(route2?.state || "").trim()) {
              const st = String(cityOnly?.state || "").trim().toUpperCase();
              route2.state = st;
            }
          }
          if (!pCity) {
            return json2({
              prospecting: true,
              query: "",
              city: "",
              state: "",
              inserted: 0,
              leads: [],
              status: "needs_city",
              message: 'Entendi, voc\xEA quer achar clientes! Mas n\xE3o identifiquei a CIDADE no pedido. Me fala a cidade (ex: "ache pizzarias em Belo Horizonte") que eu j\xE1 executo a prospec\xE7\xE3o.'
            });
          }
          const pState = String(route2?.state || "").trim().toUpperCase();
          const pNiche = String(route2?.niche || "").trim();
          const pNb = String(route2?.neighborhood || "").trim();
          const pSector = String(route2?.sector || "").trim();
          const pAuth = authHeader;
          const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
          const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/prospect-google-search?apikey=${encodeURIComponent(anonKey)}`, {
            method: "POST",
            headers: {
              Authorization: pAuth || "",
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              city: pCity,
              state: pState,
              niche: pNiche,
              neighborhood: pNb || void 0,
              sector: pSector || void 0,
              tenantId
            })
          });
          const pRes = await r.json().catch(() => ({}));
          if (pRes?.error) throw new Error(pRes.error);
          const pLeads = pRes?.leads || [];
          return json2({
            prospecting: true,
            query: pRes?.query || String(route2?.query || ""),
            city: pCity,
            state: pState,
            inserted: pRes?.inserted || 0,
            leads: pLeads.map((l) => ({
              id: l.id,
              business_name: l.business_name,
              category: l.category,
              neighborhood: l.neighborhood,
              address: l.address,
              city: l.city,
              state: l.state,
              phone: l.phone,
              whatsapp: l.whatsapp,
              email: l.email,
              website_url: l.website_url,
              instagram_handle: l.instagram_handle,
              maps_url: l.maps_url,
              rating: l.rating,
              reviews_count: l.reviews_count,
              priority_score: l.priority_score,
              source: l.scrape_source || l.source
            })),
            status: "applied",
            message: pLeads.length ? `Prospec\xE7\xE3o conclu\xEDda! Achei ${pLeads.length} empresas em ${pCity}${pState ? ", " + pState : ""}. Os leads j\xE1 est\xE3o salvos na sua aba Prospec\xE7\xE3o Remota \u2014 v\xE1 l\xE1 ver e chamar no WhatsApp.` : "Busquei mas n\xE3o achei empresas com esses termos nessa regi\xE3o. Tente um termo mais comum (ex: 'pizzaria', 'conveni\xEAncia') ou outra cidade."
          });
        } catch (e) {
          console.error("[sofia] prospec\xE7\xE3o falhou:", e);
        }
      }
      const SYSTEM = `Voc\xEA \xE9 a SOFIA AGENTE DE LOJA \u2014 agente aut\xF4nomo de repagina\xE7\xE3o de lojas da plataforma SmartHubly.
SUA MISS\xC3O: transformar a loja do lojista a partir do pedido dele (linguagem natural), devolvendo SEMPRE um PLANO estruturado JSON.
O plano N\xC3O altera nada \u2014 ele ser\xE1 revisado e aprovado pelo lojista antes da aplica\xE7\xE3o.

REGRAS DE ROTEAMENTO (o lojista pode pedir OUTRAS coisas al\xE9m de loja):
- Se o pedido for sobre ACHAR EMPRESAS/CLIENTES em alguma cidade (ex: "ache empresas que precisam de latic\xEDnios em Belo Horizonte", "prospecta restaurantes em BH"), a Sofia j\xE1 executa a prospec\xE7\xE3o sozinha \u2014 N\xC3O trate isso como pedido de repagina\xE7\xE3o. Responda o JSON padr\xE3o com prospecting: true, query (frase da busca), city, state e leads (lista de empresas encontradas com nome, bairro, endere\xE7o, telefone, site, instagram, maps, score). Se n\xE3o souber a cidade, pergunte em rationale. N\xE3o invente leads: os leads v\xEAm da ferramenta de prospec\xE7\xE3o real executada antes.

CONTEXTO REAL DA LOJA (dados ao vivo do banco):
${ctx.summary}

REGRAS DO PLANO JSON:
1. Responda APENAS com JSON v\xE1lido nesta estrutura exata:
{
  "rationale": "2-3 frases em PT-BR explicando as escolhas",
  "prospecting": true/false,
  "query": "frase curta da busca", "city": "", "state": "", "leads": [ {"business_name":"","neighborhood":"","address":"","phone":"","whatsapp":"","email":"","website_url":"","instagram_handle":"","maps_url":"","rating":0,"reviews_count":0,"priority_score":0,"source":""} ],
  "tenantChanges": { "brand_primary_color": "#RRGGBB", "brand_bg_color": "#RRGGBB", "splash_bg_color": "#RRGGBB", "description": "string", "show_description": true/false, "show_title": true/false },
  "productChanges": [ { "id": "uuid do produto", "newName": "...", "newDescription": "...", "newPrice": 0.00, "newImagePrompt": "prompt em INGL\xCAS para gerar foto editorial fotorrealista do produto" } ]
}
2. CAMPOS DE tenantChanges: s\xF3 inclua os que precisam MUDAR. Cores devem ser hex "#RRGGBB".
   - Paleta: use psicologia das cores + nicho da loja. Para eletr\xF4nicos/celulares/tecnologia prefira tons modernos e tecnol\xF3gicos (azul petr\xF3leo ex: #0E7490/#134E4A, grafite ex: #262626/#404040, roxo moderno ex: #6D28D9) \u2014 evite cores p\xE1lidas "infantis". Fundo claro funciona bem na maioria dos casos varejo; escuro s\xF3 pra nicho noturno/premium.
   - description: textos de vitrine curtos (1 frase), elegantes, vendem o estilo da loja. NUNCA mencione "delivery" como limita\xE7\xE3o.
3. productChanges: s\xF3 inclua produtos que precisam mudar.
   - newPrice: ajuste com l\xF3gica de mercado \u2014 preserve margem (use original_price quando existir como \xE2ncora), pre\xE7os "premium" +10~25%, "competitivo" -5~15%, nunca zere e nunca crie pre\xE7o negativo.
   - newImagePrompt: escreva em INGL\xCAS, estilo "editorial product photography", fotorrealista, 8k, sem texto/labels/watermark. Inclua o nome do produto e contexto coerente com o nicho.
4. Se o lojista pedir s\xF3 UMA coisa (ex: s\xF3 paleta ou s\xF3 prospec\xE7\xE3o), n\xE3o invente mudan\xE7as em outros campos.
5. Jamais invente produtos que n\xE3o est\xE3o no contexto. Use apenas os IDs listados.
6. Jamais INVENTE leads de empresas \u2014 leads s\xF3 existem se a ferramenta de prospec\xE7\xE3o trouxe. Se n\xE3o houver prospec\xE7\xE3o no pedido, leads deve ser lista vazia [].
7. Responda s\xF3 o JSON, sem markdown, sem coment\xE1rios.`;
      const userPrompt = `PEDIDO DO LOJISTA: "${lastMsg}"

Responda apenas com o JSON do plano. Produtos com imagem faltando e vis\xEDveis na loja s\xE3o candidatos a newImagePrompt.`;
      let plan;
      try {
        plan = await callAiJson(admin, {
          systemPrompt: SYSTEM,
          userPrompt,
          temperature: 0.7,
          maxTokens: 4e3
        });
      } catch (e) {
        return json2({ error: "ai_unavailable", detail: e instanceof Error ? e.message : "IA indispon\xEDvel no momento" }, 503);
      }
      const safePlan = {
        rationale: String(plan?.rationale || ""),
        tenantChanges: typeof plan?.tenantChanges === "object" && plan.tenantChanges || {},
        productChanges: Array.isArray(plan?.productChanges) ? plan.productChanges.map((p) => ({
          id: String(p?.id || ""),
          newName: p?.newName != null ? String(p.newName) : void 0,
          newDescription: p?.newDescription != null ? String(p.newDescription) : void 0,
          newPrice: typeof p?.newPrice === "number" ? p.newPrice : void 0,
          newImagePrompt: p?.newImagePrompt != null ? String(p.newImagePrompt) : void 0,
          // productName ancora o tema da imagem no worker (evita fotos genéricas)
          productName: p?.productName != null ? String(p.productName).slice(0, 40) : String(p?.newName || ctx.products.find((x) => x.id === String(p?.id))?.name || "").slice(0, 40) || void 0
        })).filter((p) => p.id) : [],
        userRequest: lastMsg
      };
      const snapshotBefore = {
        tenant: {
          brand_primary_color: ctx.tenant.brand_primary_color,
          brand_bg_color: ctx.tenant.brand_bg_color,
          splash_bg_color: ctx.tenant.splash_bg_color,
          description: ctx.tenant.description,
          show_description: ctx.tenant.show_description,
          show_title: ctx.tenant.show_title
        },
        products: safePlan.productChanges.filter((p) => p.newPrice != null || p.newName != null || p.newDescription != null).map((p) => {
          const orig = ctx.products.find((x) => x.id === p.id);
          return orig ? { id: orig.id, name: orig.name, description: orig.description, price: orig.price, image: orig.image } : null;
        }).filter(Boolean)
      };
      const { data: planRow, error: planErr } = await admin.from("store_agent_plans").insert({
        tenant_id: tenantId,
        user_id: userId,
        user_request: lastMsg,
        plan: safePlan,
        snapshot_before: snapshotBefore,
        status: "pending"
      }).select("id").single();
      if (planErr) throw planErr;
      const autoApply = Boolean(body?.autoApply);
      let applyResult = null;
      if (autoApply) {
        const { applied, errors } = await applyPlan(admin, safePlan, tenantId);
        await admin.from("store_agent_plans").update({
          status: applied.length > 0 ? "applied" : "failed",
          applied_by: userId,
          applied_at: (/* @__PURE__ */ new Date()).toISOString(),
          snapshot_after: { applied, errors }
        }).eq("id", planRow.id);
        applyResult = { applied, errors };
      }
      return json2({
        planId: planRow.id,
        rationale: safePlan.rationale,
        tenantChanges: safePlan.tenantChanges,
        productChanges: safePlan.productChanges,
        status: applyResult ? applyResult.applied.length > 0 ? "applied" : "failed" : "pending",
        applied: applyResult?.applied,
        errors: applyResult?.errors,
        message: applyResult ? applyResult.applied.length > 0 ? `Aplicado direto! ${applyResult.applied.length} mudan\xE7a(s) na sua loja. Recarregue a loja para ver.` : "Nada foi aplicado \u2014 verifique os erros." : "Plano pronto! Revise abaixo e toque em APLICAR quando aprovar."
      });
    }
    if ((path === "plans" || path === "plan-detail") && method === "POST") {
      const { tenantId, planId } = body;
      if (!tenantId) return json2({ error: "tenantId obrigat\xF3rio" }, 400);
      if (path === "plan-detail") {
        if (!planId) return json2({ error: "planId obrigat\xF3rio" }, 400);
        const { data: row, error: fErr } = await admin.from("store_agent_plans").select("id, status, user_request, plan, snapshot_before").eq("id", planId).eq("tenant_id", tenantId).single();
        if (fErr || !row) return json2({ error: "plano_nao_encontrado" }, 404);
        await requireTenantAdmin(admin, authHeader, tenantId);
        return json2({ plan: row.plan, status: row.status, userRequest: row.user_request });
      }
      await requireTenantAdmin(admin, authHeader, tenantId);
      const { data, error } = await admin.from("store_agent_plans").select("id, status, user_request, rationale, created_at, applied_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return json2({ plans: data || [] });
    }
    if (path === "apply" && method === "POST") {
      const { planId } = body;
      if (!planId) return json2({ error: "planId obrigat\xF3rio" }, 400);
      const { data: planRow, error: fErr } = await admin.from("store_agent_plans").select("*").eq("id", planId).single();
      if (fErr || !planRow) return json2({ error: "plano_nao_encontrado" }, 404);
      const userId = await requireTenantAdmin(admin, authHeader, planRow.tenant_id);
      if (planRow.status === "applied") return json2({ error: "plano_ja_aplicado" }, 409);
      const { applied, errors } = await applyPlan(admin, planRow.plan, planRow.tenant_id);
      const status = applied.length > 0 ? "applied" : "failed";
      await admin.from("store_agent_plans").update({
        status,
        applied_by: userId,
        applied_at: (/* @__PURE__ */ new Date()).toISOString(),
        snapshot_after: { applied, errors }
      }).eq("id", planId);
      return json2({
        status,
        applied,
        errors,
        message: status === "applied" ? `Aplicado! ${applied.length} mudan\xE7a(s) na sua loja. Recarregue a loja para ver.` : "Nada foi aplicado \u2014 verifique os erros."
      });
    }
    if (path === "rollback" && method === "POST") {
      const { planId } = body;
      if (!planId) return json2({ error: "planId obrigat\xF3rio" }, 400);
      const { data: planRow, error: fErr } = await admin.from("store_agent_plans").select("*").eq("id", planId).single();
      if (fErr || !planRow) return json2({ error: "plano_nao_encontrado" }, 404);
      await requireTenantAdmin(admin, authHeader, planRow.tenant_id);
      if (planRow.status !== "applied") return json2({ error: "plano_nao_aplicado" }, 409);
      const sb = planRow.snapshot_before || {};
      const restored = [];
      const errs = [];
      if (sb.tenant) {
        const { error } = await admin.from("tenants").update(sb.tenant).eq("id", planRow.tenant_id);
        if (error) errs.push(`tenants: ${error.message}`);
        else restored.push("identidade da loja");
      }
      for (const p of sb.products || []) {
        const { error } = await admin.from("products").update({ name: p.name, description: p.description, price: p.price, image: p.image }).eq("id", p.id).eq("tenant_id", planRow.tenant_id);
        if (error) errs.push(`produto ${p.id}`);
        else restored.push(`produto ${p.name}`);
      }
      await admin.from("store_agent_plans").update({
        status: "rolled_back",
        rolled_back_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", planId);
      return json2({
        status: "rolled_back",
        restored,
        errors: errs,
        message: errs.length ? "Revers\xE3o parcial. Algo falhou \u2014 verifique." : "Tudo revertido com sucesso!"
      });
    }
    if (path === "retry-images" && method === "POST") {
      const { planId } = body;
      if (!planId) return json2({ error: "planId obrigat\xF3rio" }, 400);
      const { data: planRow, error: fErr } = await admin.from("store_agent_plans").select("*").eq("id", planId).single();
      if (fErr || !planRow) return json2({ error: "plano_nao_encontrado" }, 404);
      await requireTenantAdmin(admin, authHeader, planRow.tenant_id);
      if (planRow.status !== "applied") return json2({ error: "plano_nao_aplicado" }, 409);
      const { applied, errors } = await applyPlan(admin, planRow.plan, planRow.tenant_id, { onlyImages: true });
      await admin.from("store_agent_plans").update({
        snapshot_after: { ...planRow.snapshot_after || {}, retry: { applied, errors } }
      }).eq("id", planId);
      return json2({ applied, errors, message: errors.length ? `Parcial: ${applied.length} foto(s) regenerada(s).` : `Fotos regeneradas com sucesso: ${applied.length}` });
    }
    return json2({ error: "rota desconhecida", paths: ["plan", "plans", "apply", "rollback", "retry-images"] }, 404);
  } catch (e) {
    console.error("[unified:sofia-agent] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders3, "Content-Type": "application/json" }
    });
  }
}

// _routes/store/index.ts
import { createClient as createClient4 } from "https://esm.sh/@supabase/supabase-js@2.49.4";
var corsHeaders4 = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"
};
function getSupabaseAdmin2() {
  return createClient4(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
}
async function getGoogleKeys3(supabase) {
  const { data } = await supabase.from("api_keys").select("id, api_key").eq("provider", "google_ai").eq("is_exhausted", false).order("last_used_at", { ascending: true, nullsFirst: true });
  return data || [];
}
async function getAllWorkers2(supabase) {
  const { data: active } = await supabase.from("ai_workers").select("id, base_url, is_exhausted").eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat").order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: exhausted } = await supabase.from("ai_workers").select("id, base_url, is_exhausted").eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat").order("exhausted_at", { ascending: true, nullsFirst: true });
  return [...active || [], ...exhausted || []];
}
async function getProductsForTenant(supabase, tenantId) {
  if (!tenantId) return { text: "", products: [] };
  const { data } = await supabase.from("products").select("id, name, price, original_price, category, subcategory, description, in_stock, item_type, duration_minutes, stock_quantity").eq("tenant_id", tenantId).eq("in_stock", true).limit(100);
  if (!data || data.length === 0) return { text: "", products: [] };
  const text = "\n\nPRODUTOS DISPON\xCDVEIS NA LOJA (use NOME e PRE\xC7O EXATOS):\n" + data.map((p) => {
    const priceTag = `R$${Number(p.price).toFixed(2)}`;
    const promo = p.original_price > p.price ? ` (de R$${Number(p.original_price).toFixed(2)} POR ${priceTag} \u{1F525})` : ` ${priceTag}`;
    const cat = [p.category, p.subcategory].filter(Boolean).join(" \u203A ");
    const tipo = p.item_type === "service" ? ` | SERVI\xC7O (~${p.duration_minutes || 30} min)` : "";
    const stock = p.stock_quantity != null && p.stock_quantity <= 5 && p.stock_quantity > 0 ? ` | \u26A0\uFE0F \xFAltimas ${p.stock_quantity} un` : "";
    const desc = p.description ? ` | ${String(p.description).slice(0, 120)}` : "";
    return `- ${p.name}${promo}${cat ? ` | ${cat}` : ""}${tipo}${stock}${desc}`;
  }).join("\n");
  return { text, products: data };
}
async function buildStoreContext2(supabase, tenantId, products) {
  if (!tenantId) return "";
  const [tenantRes, couponsRes] = await Promise.all([
    supabase.from("tenants").select("promo_active, promo_title, promo_text, shipping_enabled, shipping_mode, shipping_base_fee, shipping_per_km_fee, shipping_max_fee, pickup_enabled, lalamove_enabled, scheduling_enabled, scheduling_open_days, scheduling_open_time, scheduling_close_time, scheduling_slot_minutes, mercadopago_token, pix_key, whatsapp, address, niche").eq("id", tenantId).maybeSingle(),
    supabase.from("coupons").select("code, discount_type, discount_value, min_order_value, expires_at, max_uses, uses_count").eq("tenant_id", tenantId).eq("active", true)
  ]);
  const tenant = tenantRes.data;
  if (!tenant) return "";
  const lines = ["\n\nINFORMA\xC7\xD5ES DA LOJA (use pra responder d\xFAvidas com PRECIS\xC3O):"];
  if (tenant.promo_active && tenant.promo_title) {
    lines.push(`\u{1F381} PROMO\xC7\xC3O ATIVA: "${tenant.promo_title}"${tenant.promo_text ? ` \u2014 ${tenant.promo_text}` : ""} (sempre mencione quando o cliente parecer indeciso!)`);
  }
  const validCoupons = (couponsRes.data || []).filter((c) => {
    if (c.expires_at && new Date(c.expires_at) < /* @__PURE__ */ new Date()) return false;
    if (c.max_uses != null && c.uses_count >= c.max_uses) return false;
    return true;
  });
  if (validCoupons.length > 0) {
    lines.push(`\u{1F4B8} CUPONS V\xC1LIDOS (cite quando fizer sentido pra fechar venda):`);
    validCoupons.slice(0, 5).forEach((c) => {
      const value = c.discount_type === "percent" ? `${c.discount_value}% OFF` : `R$${Number(c.discount_value).toFixed(2)} OFF`;
      const min = Number(c.min_order_value) > 0 ? ` (m\xEDn. R$${Number(c.min_order_value).toFixed(2)})` : "";
      lines.push(`  \u2022 ${c.code} \u2192 ${value}${min}`);
    });
  }
  const entrega = [];
  if (tenant.pickup_enabled) entrega.push("retirada na loja (gr\xE1tis)");
  if (tenant.shipping_enabled) {
    if (tenant.shipping_mode === "lalamove" || tenant.lalamove_enabled) {
      entrega.push("entrega via Lalamove (motoboy on-demand, calculado por dist\xE2ncia)");
    } else {
      const base = `R$${Number(tenant.shipping_base_fee || 0).toFixed(2)} base + R$${Number(tenant.shipping_per_km_fee || 0).toFixed(2)}/km`;
      const max = tenant.shipping_max_fee ? ` (m\xE1x R$${Number(tenant.shipping_max_fee).toFixed(2)})` : "";
      entrega.push(`entrega pr\xF3pria: ${base}${max}`);
    }
  }
  if (entrega.length > 0) lines.push(`\u{1F69A} ENTREGA: ${entrega.join(" \u2022 ")}`);
  const pagamento = ["dinheiro na entrega"];
  if (tenant.mercadopago_token) pagamento.push("Pix autom\xE1tico", "cart\xE3o de cr\xE9dito/d\xE9bito");
  else if (tenant.pix_key) pagamento.push(`Pix (${tenant.pix_key_type || "chave"})`);
  lines.push(`\u{1F4B3} PAGAMENTO: ${pagamento.join(" \u2022 ")}`);
  if (tenant.address) lines.push(`\u{1F4CD} Endere\xE7o: ${tenant.address}`);
  if (tenant.whatsapp) lines.push(`\u{1F4F1} WhatsApp: ${tenant.whatsapp}`);
  const services = products.filter((p) => p.item_type === "service");
  if (tenant.scheduling_enabled && services.length > 0) {
    const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "s\xE1b"];
    const openDays = (tenant.scheduling_open_days || [1, 2, 3, 4, 5, 6]).map((d) => dias[d]).join(", ");
    lines.push(`
\u{1F4C5} AGENDAMENTO: aberto ${openDays} das ${tenant.scheduling_open_time || "09:00"} \xE0s ${tenant.scheduling_close_time || "18:00"} (slots de ${tenant.scheduling_slot_minutes || 30}min).`);
    lines.push(`REGRA: VOC\xCA N\xC3O MARCA HOR\xC1RIO PELO CHAT. Oriente: "Pra agendar \xE9 r\xE1pido \u2014 escolhe o servi\xE7o aqui no cat\xE1logo, joga no carrinho e na hora de finalizar voc\xEA escolhe dia e hor\xE1rio dispon\xEDvel." NUNCA invente hor\xE1rio. NUNCA pe\xE7a nome/telefone \u2014 isso \xE9 no checkout.`);
  }
  return lines.join("\n");
}
async function tryGoogleStream2(messages, systemPrompt, keys, supabase) {
  const allKeys = keys.length > 0 ? keys : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY") }] : [];
  const geminiMessages = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  const payload = {
    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
    contents: geminiMessages,
    generationConfig: { temperature: 0.4, maxOutputTokens: 600, topP: 0.9 }
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
      if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", keyEntry.id);
      return streamGeminiResponse(response);
    } catch (e) {
      console.error("Google attempt failed:", e);
      continue;
    }
  }
  return null;
}
function streamGeminiResponse(response) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  (async () => {
    const reader = response.body.getReader();
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
            if (text) await writer.write(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}

`));
          } catch {
          }
        }
      }
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch (e) {
      console.error("Stream error:", e);
    } finally {
      writer.close();
    }
  })();
  return new Response(readable, { headers: { ...corsHeaders4, "Content-Type": "text/event-stream" } });
}
async function tryLovableStream2(messages, systemPrompt) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true, temperature: 0.4, max_tokens: 600 })
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    return new Response(response.body, { headers: { ...corsHeaders4, "Content-Type": "text/event-stream" } });
  } catch {
    return null;
  }
}
async function tryOpenRouterStream2(messages, systemPrompt) {
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!OPENROUTER_API_KEY) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.0-flash-exp:free", messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true, temperature: 0.4, max_tokens: 600 })
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    return new Response(response.body, { headers: { ...corsHeaders4, "Content-Type": "text/event-stream" } });
  } catch {
    return null;
  }
}
async function tryWorkerStream2(messages, systemPrompt, tenantName, niche, workers, supabase) {
  const PARALLEL = 3;
  const TIMEOUT_MS = 6e3;
  const attemptOne = async (worker, signal) => {
    const url = worker.base_url.includes("/functions/") ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, systemPrompt, tenantName, niche }),
        signal
      });
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        if (!worker.is_exhausted) {
          await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", worker.id);
        }
        try {
          response.body?.cancel();
        } catch {
        }
        return null;
      }
      if (!response.ok) {
        try {
          response.body?.cancel();
        } catch {
        }
        return null;
      }
      return { worker, response };
    } catch (e) {
      if (!worker.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", worker.id).then(() => {
        }, () => {
        });
      }
      return null;
    }
  };
  for (let i = 0; i < workers.length; i += PARALLEL) {
    const batch = workers.slice(i, i + PARALLEL);
    const ctrls = batch.map(() => new AbortController());
    const timers = ctrls.map((c) => setTimeout(() => c.abort(), TIMEOUT_MS));
    const promises = batch.map(
      (w, idx) => attemptOne(w, ctrls[idx].signal).then((r) => r ?? Promise.reject(new Error("nope")))
    );
    let winnerIdx = -1;
    let winner = null;
    try {
      winner = await Promise.any(promises);
      winnerIdx = batch.findIndex((b) => b.id === winner.worker.id);
    } catch {
      winner = null;
    }
    timers.forEach(clearTimeout);
    if (winner) {
      ctrls.forEach((c, idx) => {
        if (idx !== winnerIdx) c.abort();
      });
      const w = winner.worker;
      if (w.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", w.id);
      } else {
        await supabase.from("ai_workers").update({ last_used_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", w.id);
      }
      return new Response(winner.response.body, { headers: { ...corsHeaders4, "Content-Type": "text/event-stream" } });
    }
  }
  return null;
}
async function store(req, body) {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders4 });
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed = body ?? (ct.includes("application/json") ? await req.json().catch(() => ({})) : {});
    const { messages, tenantName, niche, tenantId } = parsed || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Campo 'messages' deve ser um array n\xE3o vazio." }), {
        status: 400,
        headers: { ...corsHeaders4, "Content-Type": "application/json" }
      });
    }
    const supabase = getSupabaseAdmin2();
    const { text: productsContext, products } = await getProductsForTenant(supabase, tenantId);
    const storeContext = await buildStoreContext2(supabase, tenantId, products);
    const productsAvailable = products.length > 0;
    const systemPrompt = `Voce e vendedor(a) consultivo(a) da loja "${tenantName}" (${niche || "produtos"}). Conhece TUDO da loja: catalogo, promocoes, cupons, frete, pagamento, agendamento. Sua missao e VENDER de forma natural e util.

REGRA #1 - CONHECIMENTO DA LOJA:
Voce so fala sobre o que ESTA no contexto abaixo. Se o cliente perguntar algo que NAO esta no contexto, responda honesto: "Esse especifico a gente nao tem, mas tenho [item parecido REAL do catalogo] por R$X que pode te atender." NUNCA invente preco, marca, prazo, horario ou cupom.

REGRA #2 - RECOMENDACAO COM PROVA:
Em TODA resposta cite pelo menos 1 produto/servico REAL do catalogo com NOME EXATO + PRECO EXATO. Se houver promocao ativa OU cupom valido que se aplique, MENCIONE pra fechar a venda.

REGRA #3 - TAMANHO E TOM:
MAXIMO 4 linhas curtas. Tom de amigo no WhatsApp. No maximo 1 emoji. Sem listas numeradas. Sem titulos em ###. Sem negrito em subtitulos.

ESTRUTURA NATURAL (4 linhas):
1. Empatia/contexto curto
2. Recomendacao real fluida
3. Gancho extra se relevante
4. CTA suave

REGRA #4 - VOCE NAO EXECUTA ACOES, VOCE ENSINA:
Voce e um chat de TEXTO. NAO consegue criar pedido, marcar horario, aplicar cupom. NUNCA diga "vou marcar", "ja agendei". ENSINE o caminho:
- Pedido: "Pra fechar e so clicar no produto, Adicionar ao carrinho e finalizar pelo botao do carrinho no topo."
- Agendamento: "Pra marcar, abre o servico no catalogo e escolha o dia."
- Cupom: "No checkout digite o cupom."

PROIBIDO: inventar dados; prometer acoes; texto longo.

${productsAvailable ? "" : "CATALOGO VAZIO - peca desculpa e oriente o WhatsApp."}
${productsContext}
${storeContext}`;
    const [keys, workers] = await Promise.all([getGoogleKeys3(supabase), getAllWorkers2(supabase)]);
    const wrap = (p) => p.then((r) => r ?? Promise.reject(new Error("nope")));
    try {
      const winner = await Promise.any([
        wrap(tryGoogleStream2(messages, systemPrompt, keys, supabase)),
        wrap(tryLovableStream2(messages, systemPrompt))
      ]);
      return winner;
    } catch {
      console.log("Google+Lovable falharam, tentando OpenRouter...");
    }
    const r3 = await tryOpenRouterStream2(messages, systemPrompt);
    if (r3) return r3;
    console.log("OpenRouter failed, trying AI workers (including recycled)...");
    const r4 = await tryWorkerStream2(messages, systemPrompt, tenantName, niche, workers, supabase);
    if (r4) return r4;
    return new Response(JSON.stringify({ error: "Todos os provedores de IA falharam." }), {
      status: 503,
      headers: { ...corsHeaders4, "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error("[unified:store] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders4, "Content-Type": "application/json" }
    });
  }
}

// _routes/financial/index.ts
import { createClient as createClient5 } from "https://esm.sh/@supabase/supabase-js@2.49.4";
var corsHeaders5 = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var SSE_HEADERS = {
  ...corsHeaders5,
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive"
};
function getSupabaseAdmin3() {
  return createClient5(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
}
function buildSystemPrompt(businessData) {
  const data = businessData || {};
  const fmt = (n) => typeof n === "number" ? `R$ ${n.toFixed(2).replace(".", ",")}` : "\u2014";
  const topProducts = Array.isArray(data.topProducts) && data.topProducts.length ? data.topProducts.slice(0, 5).map((p, i) => `  ${i + 1}. ${p.name} \u2014 ${p.sales || 0} vendas \u2014 ${fmt(p.revenue)}`).join("\n") : "  (sem dados de vendas ainda)";
  return `Voc\xEA \xE9 Clara, consultora financeira empresarial s\xEAnior. Direta, did\xE1tica, estrat\xE9gica. Fala portugu\xEAs brasileiro natural, sem jarg\xE3o t\xE9cnico.

SEU PAPEL:
- Analisar a sa\xFAde financeira do neg\xF3cio do usu\xE1rio com base nos DADOS REAIS abaixo.
- Sugerir estrat\xE9gias pr\xE1ticas pra aumentar lucro, reduzir custo, recuperar inadimpl\xEAncia, criar combos, melhorar ticket m\xE9dio.
- Explicar conceitos (margem, ponto de equil\xEDbrio, capital de giro, fluxo de caixa) de jeito que qualquer dono de pequeno neg\xF3cio entenda.
- Quando o usu\xE1rio pedir, ensinar a usar o sistema (importar produtos via TXT/XML, lan\xE7ar despesa, marcar fiado, gerar relat\xF3rio).

REGRAS:
- NUNCA invente n\xFAmeros. Use APENAS o que vier nos dados abaixo.
- Se faltar dado, pe\xE7a ao usu\xE1rio ou diga "ainda n\xE3o tenho esse dado".
- Respostas curtas e acion\xE1veis. Use bullets quando ajudar.
- Em valores, sempre formato R$ X,XX.
- Tom: parceira de neg\xF3cio, nunca arrogante. Pode usar emojis ocasionais (\u{1F4CA} \u{1F4B0} \u26A0\uFE0F).

DADOS DO NEG\xD3CIO (use SEMPRE estes valores, n\xE3o invente outros):
- Faturamento mensal: ${fmt(data.monthlyRevenue)}
- Despesas mensais: ${fmt(data.monthlyExpenses)}
- Lucro bruto estimado: ${typeof data.monthlyRevenue === "number" && typeof data.monthlyExpenses === "number" ? fmt(data.monthlyRevenue - data.monthlyExpenses) : "\u2014"}
- Total de clientes: ${data.totalCustomers ?? "\u2014"}
- Ticket m\xE9dio: ${fmt(data.averageTicket)}
- Inadimplentes (fiado em aberto): ${data.badDebtors ?? "\u2014"}
- Crescimento vs m\xEAs anterior: ${typeof data.growthRate === "number" ? `${data.growthRate.toFixed(1)}%` : "\u2014"}

TOP PRODUTOS:
${topProducts}`;
}
async function getGoogleKeys4(supabase) {
  const { data } = await supabase.from("api_keys").select("id, api_key").eq("provider", "google_ai").eq("is_exhausted", false).order("last_used_at", { ascending: true, nullsFirst: true });
  return data || [];
}
async function getAiWorkers(supabase) {
  const { data } = await supabase.from("ai_workers").select("id, base_url").eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat").order("last_used_at", { ascending: true, nullsFirst: true });
  return data || [];
}
function googleToOpenAIStream(googleStream) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  return new ReadableStream({
    async start(controller) {
      const reader = googleStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (let line of lines) {
            line = line.trim();
            if (!line || line === "[" || line === "]" || line === ",") continue;
            if (line.startsWith(",")) line = line.slice(1);
            try {
              const obj = JSON.parse(line);
              const text = obj.candidates?.[0]?.content?.parts?.[0]?.text || "";
              if (text) {
                const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}

`;
                controller.enqueue(encoder.encode(sse));
              }
            } catch {
            }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    }
  });
}
async function tryGoogleStream3(systemPrompt, messages, keys, supabase) {
  const allKeys = keys.length > 0 ? keys : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY") }] : [];
  for (const keyEntry of allKeys) {
    try {
      const contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=${keyEntry.api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents
          })
        }
      );
      if (response.status === 429 || response.status === 403) {
        if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
        continue;
      }
      if (!response.ok || !response.body) continue;
      if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", keyEntry.id);
      const stream = googleToOpenAIStream(response.body);
      return new Response(stream, { headers: SSE_HEADERS });
    } catch (e) {
      console.error("Google stream failed:", e);
      continue;
    }
  }
  return null;
}
async function tryLovableStream3(systemPrompt, messages) {
  const KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!KEY) return null;
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true
      })
    });
    if (!response.ok || !response.body) return null;
    return new Response(response.body, { headers: SSE_HEADERS });
  } catch {
    return null;
  }
}
async function tryOpenRouterStream3(systemPrompt, messages) {
  const KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!KEY) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true
      })
    });
    if (!response.ok || !response.body) return null;
    return new Response(response.body, { headers: SSE_HEADERS });
  } catch {
    return null;
  }
}
async function tryWorkerStream3(systemPrompt, messages, workers, supabase) {
  for (const worker of workers) {
    try {
      const url = worker.base_url.includes("/functions/") ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          stream: true
        })
      });
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", worker.id);
        continue;
      }
      if (!response.ok || !response.body) continue;
      await supabase.from("ai_workers").update({ last_used_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", worker.id);
      return new Response(response.body, { headers: SSE_HEADERS });
    } catch {
      continue;
    }
  }
  return null;
}
async function financial(req, body) {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders5 });
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed = body ?? (ct.includes("application/json") ? await req.json().catch(() => ({})) : {});
    const { messages, businessData } = parsed;
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages \xE9 obrigat\xF3rio" }), {
        status: 400,
        headers: { ...corsHeaders5, "Content-Type": "application/json" }
      });
    }
    const systemPrompt = buildSystemPrompt(businessData);
    const supabase = getSupabaseAdmin3();
    const [keys, workers] = await Promise.all([getGoogleKeys4(supabase), getAiWorkers(supabase)]);
    const r1 = await tryGoogleStream3(systemPrompt, messages, keys, supabase);
    if (r1) return r1;
    const r2 = await tryLovableStream3(systemPrompt, messages);
    if (r2) return r2;
    const r3 = await tryOpenRouterStream3(systemPrompt, messages);
    if (r3) return r3;
    const r4 = await tryWorkerStream3(systemPrompt, messages, workers, supabase);
    if (r4) return r4;
    return new Response(JSON.stringify({
      error: "Limite de uso atingido em todos os provedores. Tente novamente em alguns minutos."
    }), { status: 429, headers: { ...corsHeaders5, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[unified:financial] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders5, "Content-Type": "application/json" }
    });
  }
}

// _routes/clara/index.ts
import { createClient as createClient7 } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// ../_shared/auth.ts
import { createClient as createClient6 } from "https://esm.sh/@supabase/supabase-js@2.49.4";
async function getAuthUser(req) {
  const auth = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.replace("Bearer ", "");
  try {
    const client = createClient6(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_ANON_KEY")
    );
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}
async function isTenantAdmin(adminClient, userId, tenantId) {
  const { data } = await adminClient.from("user_roles").select("role").eq("user_id", userId).eq("tenant_id", tenantId).eq("role", "admin").eq("approved", true).maybeSingle();
  if (data) return true;
  const { data: sa } = await adminClient.from("platform_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  return !!sa;
}

// _routes/clara/index.ts
var corsHeaders6 = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var SSE_HEADERS2 = {
  ...corsHeaders6,
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive"
};
function getSupabaseAdmin4() {
  return createClient7(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
}
var SYSTEM_PROMPT = `Voc\xEA \xE9 a **Clara**, consultora empresarial do lojista. Seu papel \xE9 olhar os n\xFAmeros reais do neg\xF3cio dele (vendas, despesas, fiado, estoque, ticket m\xE9dio, margem) e dar conselho pr\xE1tico, direto e espec\xEDfico.

# COMO O LOJISTA TE ABRE
Existe um **bot\xE3o flutuante verde-esmeralda** no canto inferior direito do painel admin (com \xEDcone de pasta/maleta) \u2014 \xE9 s\xF3 clicar nele que voc\xEA aparece. Tem tamb\xE9m um link na aba "Empresarial". Se ele perguntar onde te encontra de novo, lembra disso.

# PERSONALIDADE
- Tom: consultora amiga, profissional, sem rebuscar. Tipo s\xF3cia que entende de n\xFAmero.
- Frases curtas. Direto ao ponto. Zero enrola\xE7\xE3o.
- Portugu\xEAs brasileiro coloquial.
- M\xE1ximo 2 emojis por resposta.
- Nunca invente dados. Se n\xE3o tem o dado, fala "n\xE3o tenho esse n\xFAmero agora".

# SEU ESCOPO (S\xD3 ISSO)
\u2705 An\xE1lise de vendas, faturamento, margem, lucro, ticket m\xE9dio, crescimento m\xEAs a m\xEAs.
\u2705 **Saldo em caixa** (dinheiro/Pix/d\xE9bito que J\xC1 caiu) vs **saldo dispon\xEDvel** (descontando cart\xE3o pendente). Sempre explica a diferen\xE7a se o lojista perguntar "quanto eu tenho".
\u2705 **Contas a pagar**: d\xEDvidas a fornecedores e outras (do painel Financeiro \u2192 D\xEDvidas).
\u2705 Fiado (quem deve, h\xE1 quanto tempo, valor em aberto, vencidos +30d).
\u2705 Estoque (produtos parados, estoque baixo \u22643, ruptura).
\u2705 Despesas (categorias, despesas que cresceram acima da receita).
\u2705 Top produtos, mix, sugest\xE3o de combo, precifica\xE7\xE3o.
\u2705 Anti-preju\xEDzo (alerta se margem caindo, despesa subindo, d\xEDvida com fornecedor > saldo).
\u2705 **Pedidos em andamento agora** (recebido/preparando/saiu pra entrega/aguardando pagamento) \u2014 voc\xEA v\xEA a lista no contexto, pode dizer "tem R$X esperando pagamento Pix h\xE1 tanto tempo".
\u2705 Como mexer no painel de Gest\xE3o Empresarial / Financeiro / Fiado / D\xEDvidas.

# O QUE VOC\xCA N\xC3O FAZ (DIRECIONA PRA SOFIA)
\u274C Como criar produto, mexer em cupom, configurar frete, agendamento, motoboy, fornecedor \u2192 "Isso \xE9 com a Sofia, no chat geral do admin (bot\xE3o azul logo abaixo do meu)."
\u274C Pre\xE7o da plataforma, plano de cobran\xE7a, suporte t\xE9cnico \u2192 Sofia.
\u274C Fun\xE7\xE3o de cliente final, motoboy, fornecedor \u2192 Sofia.
\u274C Vida financeira PESSOAL do lojista \u2192 "Aqui eu cuido s\xF3 do neg\xF3cio. Pra finan\xE7as pessoais, o FinanceFlow Pro \xE9 o lugar."

# REGRAS DE FORMATA\xC7\xC3O
- Texto natural e limpo.
- Negrito **s\xF3 em 1-2 n\xFAmeros cr\xEDticos** por resposta.
- Listas com h\xEDfen (-), no m\xE1ximo 3 itens.
- NUNCA use # ## ### (cara de rob\xF4).
- Formato de dinheiro sempre R$ X,XX.
- Use APENAS os n\xFAmeros do contexto. N\xE3o invente.

# AN\xC1LISE PROATIVA (quando tiver dados)
- Margem do m\xEAs \u2264 15% \u2192 alerta vermelho.
- Crescimento negativo vs m\xEAs anterior \u2192 sugere a\xE7\xE3o.
- Fiado >30 dias \u2192 recomenda cobran\xE7a.
- Top 3 produtos respondem por >70% da receita \u2192 diz pra cuidar do mix.
- Despesa subiu mais que receita \u2192 alerta.
- Pedidos parados em "aguardando pagamento" h\xE1 muito tempo \u2192 sugere acionar o auto-cancelar nas Automa\xE7\xF5es.

# NUNCA
- Conselho jur\xEDdico, fiscal espec\xEDfico ou cont\xE1bil definitivo.
- Recomenda\xE7\xE3o de investimento ("compre X").
- Jarg\xE3o sem traduzir.
- Inventar produto, n\xFAmero, cliente.

# GUIA DAS ABAS DO FINANCEIRO (saiba explicar TODAS, passo a passo, quando perguntarem "o que \xE9 isso?" ou "como uso?")
- \u{1F3E5} **Sa\xFAde**: painel-resumo. Mostra faturamento do m\xEAs, despesas, lucro, margem e um "term\xF4metro" (Saud\xE1vel / Aten\xE7\xE3o / Cuidado). \xC9 o primeiro lugar pra olhar todo dia.
- \u{1F916} **Clara**: sou eu. Pergunte qualquer coisa sobre os n\xFAmeros do neg\xF3cio.
- \u{1F4CA} **Fluxo**: fluxo de caixa m\xEAs a m\xEAs \u2014 entradas, sa\xEDdas e lucro por m\xEAs, pra ver tend\xEAncia (subindo ou caindo).
- \u{1F4B8} **Lan\xE7ar**: onde se registra entrada (venda avulsa, outra entrada) e despesa (aluguel, luz/\xE1gua/net, sal\xE1rio, compra de estoque, marketing, imposto, manuten\xE7\xE3o, outras). Passo: escolher tipo \u2192 categoria \u2192 valor \u2192 data \u2192 salvar. Despesa fixa \xE9 a que se repete todo m\xEAs; vari\xE1vel muda; inesperada \xE9 conserto/imprevisto.
- \u{1F4B3} **Cart\xE3o**: vendas no cart\xE3o que ainda n\xE3o ca\xEDram na conta. Serve pra diferenciar "saldo em caixa" (dinheiro/Pix/d\xE9bito j\xE1 recebido) de "saldo dispon\xEDvel" (descontando o que est\xE1 pra receber).
- \u{1F4B0} **A Pagar / Receber**: d\xEDvidas com fornecedores e contas a pagar, al\xE9m do que o cliente deve (fiado). D\xE1 pra marcar como pago e ver vencidos.
- \u{1F3ED} **Fornec.**: cadastro dos fornecedores, o quanto se compra de cada um e o saldo devedor com eles.
- \u2699\uFE0F **Taxa**: define quem paga a taxa da plataforma \u2014 "Sai do meu bolso" (cliente paga o pre\xE7o normal, a taxa sai da margem), "Embuto no pre\xE7o" (a taxa \xE9 somada ao pre\xE7o final do cliente) ou "Dividida" (metade cada). Explique o impacto na margem quando perguntarem.
Ao explicar, seja concreto: diga em qual aba clicar, o que preencher e pra que serve o n\xFAmero no fim. Se o lojista perguntar "como lan\xE7o uma despesa" ou "onde vejo quem me deve", responda com o caminho exato.`;
async function loadBusinessContext(supabase, tenantId) {
  const now = /* @__PURE__ */ new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();
  const [tenantRes, monthOrdersRes, prevOrdersRes, monthExpensesRes, productsRes, creditsRes, topItemsRes, debtsRes, openOrdersRes] = await Promise.all([
    supabase.from("tenants").select("name, niche, store_mode, billing_mode, monthly_fee, platform_fee_percent").eq("id", tenantId).maybeSingle(),
    supabase.from("orders").select("id, total, payment_method, status, created_at").eq("tenant_id", tenantId).eq("status", "delivered").gte("created_at", startOfMonth),
    supabase.from("orders").select("id, total, payment_method").eq("tenant_id", tenantId).eq("status", "delivered").gte("created_at", startOfPrevMonth).lte("created_at", endOfPrevMonth),
    supabase.from("financial_entries").select("amount, category, date, is_credit_card, paid").eq("tenant_id", tenantId).eq("type", "expense").gte("date", startOfMonth),
    supabase.from("products").select("id, name, price, stock_quantity, in_stock").eq("tenant_id", tenantId).limit(200),
    supabase.from("credit_accounts").select("amount, amount_paid, status, due_date, customer_name").eq("tenant_id", tenantId).in("status", ["open", "overdue"]),
    supabase.from("order_items").select("product_name, quantity, product_price, order_id, orders!inner(tenant_id, status, created_at)").eq("orders.tenant_id", tenantId).eq("orders.status", "delivered").gte("orders.created_at", startOfMonth).limit(500),
    supabase.from("debts").select("name, amount, type, paid, due_date").eq("tenant_id", tenantId).eq("paid", false),
    // Pedidos EM ANDAMENTO (não entregues, não cancelados) — pra Clara saber tudo, não só o que foi pago
    supabase.from("orders").select("id, total, status, payment_method, payment_received, customer_name, created_at").eq("tenant_id", tenantId).not("status", "in", "(delivered,cancelled)").order("created_at", { ascending: false }).limit(50)
  ]);
  const tenant = tenantRes.data;
  const isFiado = (o) => (o.payment_method || "").toLowerCase() === "fiado";
  const monthOrders = (monthOrdersRes.data || []).filter((o) => !isFiado(o));
  const prevOrders = (prevOrdersRes.data || []).filter((o) => !isFiado(o));
  const monthRevenue = monthOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const prevRevenue = prevOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const monthExpensesAll = monthExpensesRes.data || [];
  const monthExpenses = monthExpensesAll.reduce((s, e) => s + Number(e.amount || 0), 0);
  const cashOut = monthExpensesAll.filter((e) => !(e.is_credit_card === true && e.paid === false)).reduce((s, e) => s + Number(e.amount || 0), 0);
  const cardPending = monthExpensesAll.filter((e) => e.is_credit_card === true && e.paid === false).reduce((s, e) => s + Number(e.amount || 0), 0);
  const cashBalance = monthRevenue - cashOut;
  const availableBalance = cashBalance - cardPending;
  const monthProfit = monthRevenue - monthExpenses;
  const margin = monthRevenue > 0 ? monthProfit / monthRevenue * 100 : 0;
  const ticket = monthOrders.length > 0 ? monthRevenue / monthOrders.length : 0;
  const growth = prevRevenue > 0 ? (monthRevenue - prevRevenue) / prevRevenue * 100 : 0;
  const productMap = /* @__PURE__ */ new Map();
  (topItemsRes.data || []).forEach((it) => {
    const cur = productMap.get(it.product_name) || { qty: 0, revenue: 0 };
    cur.qty += Number(it.quantity || 0);
    cur.revenue += Number(it.quantity || 0) * Number(it.product_price || 0);
    productMap.set(it.product_name, cur);
  });
  const topProducts = Array.from(productMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5).map(([name, v]) => `  - ${name}: ${v.qty}un, R$ ${v.revenue.toFixed(2)}`);
  const products = productsRes.data || [];
  const lowStock = products.filter((p) => Number(p.stock_quantity ?? 0) > 0 && Number(p.stock_quantity) <= 3);
  const outOfStock = products.filter((p) => p.in_stock === false || Number(p.stock_quantity ?? 0) <= 0);
  const credits = creditsRes.data || [];
  const fiadoOpen = credits.reduce((s, c) => s + (Number(c.amount || 0) - Number(c.amount_paid || 0)), 0);
  const fiadoOld = credits.filter((c) => {
    const days = (Date.now() - new Date(c.due_date).getTime()) / (1e3 * 60 * 60 * 24);
    return days > 30;
  });
  const expByCat = /* @__PURE__ */ new Map();
  (monthExpensesRes.data || []).forEach((e) => {
    expByCat.set(e.category || "outros", (expByCat.get(e.category || "outros") || 0) + Number(e.amount || 0));
  });
  const topExpenses = Array.from(expByCat.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cat, v]) => `  - ${cat}: R$ ${v.toFixed(2)}`);
  const debts = debtsRes.data || [];
  const supplierDebts = debts.filter((d) => d.name?.startsWith("\u{1F3ED}") || (d.type || "").toLowerCase().includes("fornec"));
  const supplierDebtTotal = supplierDebts.reduce((s, d) => s + Number(d.amount || 0), 0);
  const otherDebtTotal = debts.filter((d) => !supplierDebts.includes(d)).reduce((s, d) => s + Number(d.amount || 0), 0);
  const openOrders = openOrdersRes.data || [];
  const openByStatus = /* @__PURE__ */ new Map();
  openOrders.forEach((o) => {
    const s = o.status || "unknown";
    const cur = openByStatus.get(s) || { count: 0, total: 0 };
    cur.count++;
    cur.total += Number(o.total || 0);
    openByStatus.set(s, cur);
  });
  const openSummary = Array.from(openByStatus.entries()).map(([s, v]) => `  - ${s}: ${v.count} pedido${v.count === 1 ? "" : "s"} (R$ ${v.total.toFixed(2)})`).join("\n");
  const pendingPayment = openOrders.filter((o) => o.status === "pending_payment" || o.payment_received === false);
  const recentOpenList = openOrders.slice(0, 8).map(
    (o) => `  - ${o.customer_name || "?"}: R$ ${Number(o.total).toFixed(2)} | ${o.status}${o.payment_received === false ? " (n\xE3o pago)" : ""}`
  ).join("\n");
  const monthLabel = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return `
[CONTEXTO REAL DA LOJA \u2014 ${tenant?.name || "\u2014"} | ${monthLabel}]
- Modo da loja: ${tenant?.store_mode || "delivery"} | Nicho: ${tenant?.niche || "\u2014"}
- Cobran\xE7a da plataforma: ${tenant?.billing_mode === "monthly_fixed" ? `R$ ${Number(tenant.monthly_fee || 60).toFixed(2)}/m\xEAs fixo` : `${Number(tenant?.platform_fee_percent || 5).toFixed(1)}% por venda`}

[FATURAMENTO DO M\xCAS]
- Receita realizada: R$ ${monthRevenue.toFixed(2)} (${monthOrders.length} venda${monthOrders.length === 1 ? "" : "s"})
- M\xEAs anterior: R$ ${prevRevenue.toFixed(2)} | Crescimento: ${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%
- Despesas do m\xEAs: R$ ${monthExpenses.toFixed(2)}
- Lucro bruto: R$ ${monthProfit.toFixed(2)} | Margem: ${margin.toFixed(1)}%
- Ticket m\xE9dio: R$ ${ticket.toFixed(2)}

[SALDO ATUAL]
- Saldo em caixa (dinheiro/Pix/d\xE9bito que J\xC1 caiu): R$ ${cashBalance.toFixed(2)}
- Cart\xE3o pendente (ainda n\xE3o saiu da conta): R$ ${cardPending.toFixed(2)}
- Saldo dispon\xEDvel (descontando cart\xE3o pendente): R$ ${availableBalance.toFixed(2)}

[CONTAS A PAGAR]
- Devo a fornecedores: R$ ${supplierDebtTotal.toFixed(2)} (${supplierDebts.length} conta${supplierDebts.length === 1 ? "" : "s"})
- Outras d\xEDvidas: R$ ${otherDebtTotal.toFixed(2)}

[TOP PRODUTOS DO M\xCAS]
${topProducts.length ? topProducts.join("\n") : "  (sem vendas no m\xEAs ainda)"}

[ESTOQUE]
- Produtos cadastrados: ${products.length}
- Estoque baixo (\u22643 un): ${lowStock.length}${lowStock.length ? " (" + lowStock.slice(0, 5).map((p) => p.name).join(", ") + ")" : ""}
- Sem estoque: ${outOfStock.length}${outOfStock.length ? " (" + outOfStock.slice(0, 5).map((p) => p.name).join(", ") + ")" : ""}

[FIADO]
- Em aberto: R$ ${fiadoOpen.toFixed(2)} (${credits.length} conta${credits.length === 1 ? "" : "s"})
- Vencidos h\xE1 +30 dias: ${fiadoOld.length}${fiadoOld.length ? " (" + fiadoOld.slice(0, 4).map((c) => `${c.customer_name} R$ ${(Number(c.amount) - Number(c.amount_paid)).toFixed(2)}`).join(", ") + ")" : ""}

[DESPESAS POR CATEGORIA]
${topExpenses.length ? topExpenses.join("\n") : "  (sem despesas registradas no m\xEAs)"}

[PEDIDOS EM ANDAMENTO AGORA] (n\xE3o entregues / n\xE3o cancelados \u2014 total ${openOrders.length})
${openSummary || "  (nenhum pedido aberto)"}
- Aguardando pagamento online: ${pendingPayment.length}
${recentOpenList ? "\xDAltimos pedidos abertos:\n" + recentOpenList : ""}
`.trim();
}
async function tryLovableStream4(systemPrompt, messages) {
  const KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!KEY) return null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true
      })
    });
    if (r.status === 429 || r.status === 402) return null;
    if (!r.ok || !r.body) return null;
    return new Response(r.body, { headers: SSE_HEADERS2 });
  } catch {
    return null;
  }
}
async function getGoogleKeys5(supabase) {
  const { data } = await supabase.from("api_keys").select("id, api_key").eq("provider", "google_ai").eq("is_exhausted", false).order("last_used_at", { ascending: true, nullsFirst: true });
  const list = data || [];
  if (list.length === 0 && Deno.env.get("GOOGLE_AI_API_KEY")) {
    return [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY") }];
  }
  return list;
}
function streamGeminiResponse2(response) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  (async () => {
    const reader = response.body.getReader();
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
            if (text) {
              await writer.write(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}

`));
            }
          } catch {
          }
        }
      }
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch (e) {
      console.error("Clara gemini stream err:", e);
    } finally {
      writer.close();
    }
  })();
  return new Response(readable, { headers: SSE_HEADERS2 });
}
async function tryGoogleStream4(systemPrompt, messages, keys, supabase) {
  const geminiMessages = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "Beleza, sou a Clara. Pode mandar." }] },
    ...messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }))
  ];
  for (const keyEntry of keys) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${keyEntry.api_key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: geminiMessages }) }
      );
      if (r.status === 429 || r.status === 403) {
        if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
        continue;
      }
      if (!r.ok || !r.body) continue;
      if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", keyEntry.id);
      return streamGeminiResponse2(r);
    } catch (e) {
      console.error("Clara google fail:", e);
      continue;
    }
  }
  return null;
}
async function tryOpenRouterStream4(systemPrompt, messages) {
  const KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!KEY) return null;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true
      })
    });
    if (r.status === 429 || r.status === 402) return null;
    if (!r.ok || !r.body) return null;
    return new Response(r.body, { headers: SSE_HEADERS2 });
  } catch {
    return null;
  }
}
async function getAllWorkers3(supabase) {
  const { data: active } = await supabase.from("ai_workers").select("id, base_url, is_exhausted").eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat").order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: exhausted } = await supabase.from("ai_workers").select("id, base_url, is_exhausted").eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat").order("exhausted_at", { ascending: true, nullsFirst: true });
  return [...active || [], ...exhausted || []];
}
async function tryWorkerStream4(systemPrompt, messages, workers, supabase) {
  for (const w of workers) {
    try {
      const url = w.base_url.includes("/functions/") ? w.base_url : `${w.base_url}/functions/v1/ai-chat`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true })
      });
      if (r.status === 429 || r.status === 402 || r.status === 503) {
        if (!w.is_exhausted) await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", w.id);
        continue;
      }
      if (!r.ok || !r.body) continue;
      if (w.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", w.id);
      } else {
        await supabase.from("ai_workers").update({ last_used_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", w.id);
      }
      return new Response(r.body, { headers: SSE_HEADERS2 });
    } catch {
      continue;
    }
  }
  return null;
}
async function clara(req, body) {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders6 });
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed = body ?? (ct.includes("application/json") ? await req.json() : {});
    const { messages, tenantId } = parsed;
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages obrigat\xF3rio" }),
        { status: 400, headers: { ...corsHeaders6, "Content-Type": "application/json" } }
      );
    }
    if (!tenantId) {
      return new Response(
        JSON.stringify({ error: "tenantId obrigat\xF3rio" }),
        { status: 400, headers: { ...corsHeaders6, "Content-Type": "application/json" } }
      );
    }
    const supabase = getSupabaseAdmin4();
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(
        JSON.stringify({ error: "N\xE3o autenticado" }),
        { status: 401, headers: { ...corsHeaders6, "Content-Type": "application/json" } }
      );
    }
    if (!await isTenantAdmin(supabase, user.id, tenantId)) {
      return new Response(
        JSON.stringify({ error: "Sem permiss\xE3o para este tenant" }),
        { status: 403, headers: { ...corsHeaders6, "Content-Type": "application/json" } }
      );
    }
    let businessContext = "";
    try {
      businessContext = await loadBusinessContext(supabase, tenantId);
    } catch (e) {
      console.error("Clara context load fail:", e);
      businessContext = "[CONTEXTO INDISPON\xCDVEL \u2014 pe\xE7a pro lojista os n\xFAmeros que precisar]";
    }
    const fullSystem = `${SYSTEM_PROMPT}

# CONHECIMENTO DA PLATAFORMA INTEIRA (consulte sempre)
${PLATFORM_KNOWLEDGE}

${businessContext}`;
    const [keys, workers] = await Promise.all([getGoogleKeys5(supabase), getAllWorkers3(supabase)]);
    const r1 = await tryLovableStream4(fullSystem, messages);
    if (r1) return r1;
    console.log("[clara] Lovable failed, trying Google...");
    const r2 = await tryGoogleStream4(fullSystem, messages, keys, supabase);
    if (r2) return r2;
    console.log("[clara] Google failed, trying OpenRouter...");
    const r3 = await tryOpenRouterStream4(fullSystem, messages);
    if (r3) return r3;
    console.log("[clara] OpenRouter failed, trying Workers...");
    const r4 = await tryWorkerStream4(fullSystem, messages, workers, supabase);
    if (r4) return r4;
    return new Response(
      JSON.stringify({ error: "Todos os provedores de IA est\xE3o indispon\xEDveis. Tente em alguns minutos." }),
      { status: 503, headers: { ...corsHeaders6, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[unified:clara] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders6, "Content-Type": "application/json" }
    });
  }
}

// index.ts
var handlers = {
  "/cindy": cindy,
  "/cindy-actions": cindy_actions,
  "/sofia-agent": sofia_agent,
  "/store": store,
  "/financial": financial,
  "/clara": clara,
  "/": (req) => Promise.resolve(new Response(JSON.stringify({ error: "route_required", available: ["cindy", "cindy-actions", "sofia-agent", "store", "financial", "clara"] }), { status: 400, headers: { "Content-Type": "application/json" } }))
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400"
      }
    });
  }
  try {
    const res = await route(req, handlers);
    const newHeaders = new Headers(res.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    newHeaders.set("Access-Control-Allow-Headers", "*");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*"
      }
    });
  }
});
