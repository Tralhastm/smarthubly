// Re-fetches affiliate products and updates price/image/availability.
// Strategy: try native HTML parsing first (regex on meta tags + JSON-LD).
// Only falls back to AI if native extraction fails — saves worker quota.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

interface RefreshRequest {
  tenant_id?: string;
  limit?: number;
  product_ids?: string[];
  use_ai_fallback?: boolean; // default false — only native parsing
}

type Extracted = { price: number; image: string; available: boolean; source: string };

const decodeHtml = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

const parsePriceBR = (raw: string): number => {
  if (!raw) return 0;
  // Strip currency symbols / letters
  let s = raw.replace(/[^\d,.\-]/g, "").trim();
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // BRL format: 1.299,90
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && lastComma !== -1) {
    // 1,299.90
    s = s.replace(/,/g, "");
  } else {
    // No separator confusion, but treat lone comma as decimal
    if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  }
  const n = Number(s);
  return isFinite(n) && n > 0 ? n : 0;
};

const findMeta = (html: string, names: string[]): string | null => {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*content=["']([^"']+)["']`,
      "i",
    );
    const m = html.match(re) || html.match(new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${name}["']`,
      "i",
    ));
    if (m?.[1]) return decodeHtml(m[1].trim());
  }
  return null;
};

const extractJsonLd = (html: string): any[] => {
  const out: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const txt = m[1].trim();
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return out;
};

const findProductInJsonLd = (nodes: any[]): any | null => {
  for (const n of nodes) {
    if (!n) continue;
    const t = n["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return n;
    if (n["@graph"] && Array.isArray(n["@graph"])) {
      const p = findProductInJsonLd(n["@graph"]);
      if (p) return p;
    }
  }
  return null;
};

const nativeExtract = (html: string, baseUrl: string): Extracted | null => {
  // 1) JSON-LD (most reliable — used by Mercado Livre, Magalu, Amazon, etc.)
  const jsonLd = extractJsonLd(html);
  const product = findProductInJsonLd(jsonLd);
  if (product) {
    let price = 0;
    let image = "";
    let available = true;

    const offers = product.offers;
    if (offers) {
      const offer = Array.isArray(offers) ? offers[0] : offers;
      const p = offer?.price ?? offer?.lowPrice ?? offer?.highPrice;
      if (p) price = parsePriceBR(String(p));
      const avail = (offer?.availability ?? "").toString().toLowerCase();
      if (avail.includes("outofstock") || avail.includes("soldout") || avail.includes("discontinued")) {
        available = false;
      }
    }

    const img = product.image;
    if (img) {
      if (typeof img === "string") image = img;
      else if (Array.isArray(img) && img.length) image = typeof img[0] === "string" ? img[0] : img[0]?.url ?? "";
      else if (typeof img === "object") image = img.url ?? "";
    }

    if (price > 0 || image) {
      return { price, image, available, source: "json-ld" };
    }
  }

  // 2) Open Graph / meta tags
  const ogPrice = findMeta(html, [
    "product:price:amount",
    "og:price:amount",
    "twitter:data1",
    "price",
  ]);
  const ogImage = findMeta(html, ["og:image", "twitter:image", "image"]);
  const ogAvail = findMeta(html, ["product:availability", "og:availability"]);

  const price = ogPrice ? parsePriceBR(ogPrice) : 0;
  const image = ogImage ?? "";
  const available = ogAvail
    ? !/(out\s*of\s*stock|outofstock|sold\s*out|esgotado|indispon)/i.test(ogAvail)
    : true;

  if (price > 0 || image) {
    return { price, image, available, source: "meta" };
  }

  return null;
};

const fetchHtml = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      console.warn("fetch non-ok", url, res.status);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.error("fetch err", url, e);
    return null;
  }
};

const SYSTEM_EXTRACT =
  "Você extrai dados ATUAIS de uma página de produto. Retorne APENAS JSON válido sem markdown com: price (número BRL, ou 0), image (URL absoluta, ou ''), available (boolean).";

function parseExtracted(text: string): Extracted | null {
  const cleaned = (text ?? "").replace(/```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return { price: Number(parsed.price) || 0, image: parsed.image || "", available: !!parsed.available, source: "ai" };
  } catch { return null; }
}

const aiExtract = async (url: string, html: string, supabase: any): Promise<Extracted | null> => {
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? "";
  const compact = (headMatch + "\n" + html.slice(0, 30000)).slice(0, 35000);
  const userMsg = `URL: ${url}\n\nHTML:\n${compact}`;

  // 1. Lovable
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (apiKey) {
    try {
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "system", content: SYSTEM_EXTRACT }, { role: "user", content: userMsg }],
        }),
      });
      if (aiRes.ok) {
        const j = await aiRes.json();
        const result = parseExtracted(j?.choices?.[0]?.message?.content ?? "");
        if (result) return result;
      }
    } catch (e) { console.warn("aiExtract Lovable failed", e); }
  }

  // 2. Google AI direto (api_keys do super admin)
  try {
    const { data: keys } = await supabase
      .from("api_keys").select("id, api_key")
      .eq("provider", "google_ai").eq("is_exhausted", false)
      .order("last_used_at", { ascending: true, nullsFirst: true });
    const allKeys = (keys && keys.length > 0)
      ? keys
      : (Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : []);
    for (const keyEntry of allKeys) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keyEntry.api_key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                { role: "user", parts: [{ text: SYSTEM_EXTRACT }] },
                { role: "model", parts: [{ text: "Entendido." }] },
                { role: "user", parts: [{ text: userMsg }] },
              ],
              generationConfig: { responseMimeType: "application/json" },
            }),
          }
        );
        if (r.status === 429 || r.status === 403) {
          if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
          continue;
        }
        if (!r.ok) continue;
        if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyEntry.id);
        const j = await r.json();
        const result = parseExtracted(j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
        if (result) return result;
      } catch (e) { console.warn("aiExtract Google failed", e); continue; }
    }
  } catch (e) { console.warn("aiExtract Google list failed", e); }

  // 3. OpenRouter
  const orKey = Deno.env.get("OPENROUTER_API_KEY");
  if (orKey) {
    try {
      const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${orKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash-exp:free",
          messages: [{ role: "system", content: SYSTEM_EXTRACT }, { role: "user", content: userMsg }],
        }),
      });
      if (aiRes.ok) {
        const j = await aiRes.json();
        const result = parseExtracted(j?.choices?.[0]?.message?.content ?? "");
        if (result) return result;
      }
    } catch (e) { console.warn("aiExtract OpenRouter failed", e); }
  }

  // 3. Workers externos
  try {
    const { data: active } = await supabase
      .from("ai_workers").select("id, base_url, is_exhausted")
      .eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat")
      .order("last_used_at", { ascending: true, nullsFirst: true });
    const { data: exhausted } = await supabase
      .from("ai_workers").select("id, base_url, is_exhausted")
      .eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat")
      .order("exhausted_at", { ascending: true, nullsFirst: true });
    const workers = [...(active || []), ...(exhausted || [])];

    for (const worker of workers) {
      try {
        const wurl = worker.base_url.includes('/functions/') ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
        const resp = await fetch(wurl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: userMsg }],
            systemPrompt: SYSTEM_EXTRACT,
            tenantName: "extractor",
            niche: "afiliados",
          }),
        });
        if (resp.status === 429 || resp.status === 402 || resp.status === 503) {
          if (!worker.is_exhausted) {
            await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
          }
          continue;
        }
        if (!resp.ok) continue;
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "", full = "";
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
              if (t) full += t;
            } catch {}
          }
        }
        const result = parseExtracted(full);
        if (result) {
          if (worker.is_exhausted) {
            await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: new Date().toISOString() }).eq("id", worker.id);
          } else {
            await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", worker.id);
          }
          return result;
        }
      } catch (e) { console.warn(`aiExtract worker ${worker.id} failed`, e); }
    }
  } catch (e) { console.warn("aiExtract workers list failed", e); }

  return null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as RefreshRequest) : {};
    const useAi = body.use_ai_fallback === true;
    const apiKey = Deno.env.get("LOVABLE_API_KEY");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let q = supabase
      .from("products")
      .select("id, tenant_id, name, price, image, affiliate_url, in_stock")
      .not("affiliate_url", "is", null);
    if (body.tenant_id) q = q.eq("tenant_id", body.tenant_id);
    if (body.product_ids?.length) q = q.in("id", body.product_ids);
    q = q.limit(body.limit ?? 50);

    const { data: products, error } = await q;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let updated = 0, unchanged = 0, failed = 0, soldOut = 0, aiUsed = 0, nativeUsed = 0;
    const results: any[] = [];

    for (const p of products ?? []) {
      const html = await fetchHtml(p.affiliate_url!);
      if (!html) { failed++; results.push({ id: p.id, status: "fetch_failed" }); continue; }

      let data = nativeExtract(html, p.affiliate_url!);
      if (data) nativeUsed++;

      // Optional AI fallback only when native fails (Lovable → OpenRouter → Workers)
      if (!data && useAi) {
        data = await aiExtract(p.affiliate_url!, html, supabase);
        if (data) aiUsed++;
      }

      if (!data) { failed++; results.push({ id: p.id, status: "extract_failed" }); continue; }

      const updates: Record<string, any> = {};
      if (data.price > 0 && Math.abs(data.price - Number(p.price)) > 0.01) updates.price = data.price;
      if (data.image && data.image !== p.image) updates.image = data.image;
      if (data.available !== p.in_stock) updates.in_stock = data.available;
      if (!data.available) soldOut++;

      if (Object.keys(updates).length > 0) {
        const { error: upErr } = await supabase.from("products").update(updates).eq("id", p.id);
        if (upErr) { failed++; results.push({ id: p.id, status: "update_failed", error: upErr.message }); continue; }
        updated++;
        results.push({ id: p.id, status: "updated", source: data.source, changes: updates });
      } else {
        unchanged++;
      }

      // gentle pacing
      await new Promise(r => setTimeout(r, 150));
    }

    console.log(`refresh done — updated:${updated} unchanged:${unchanged} failed:${failed} soldOut:${soldOut} native:${nativeUsed} ai:${aiUsed}`);

    return new Response(
      JSON.stringify({ processed: products?.length ?? 0, updated, unchanged, failed, soldOut, nativeUsed, aiUsed, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("refresh err", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
