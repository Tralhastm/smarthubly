import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { decode as decodePng, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STYLES: Record<string, string> = {
  studio:
    "clean professional e-commerce product photo on a seamless neutral studio background, soft even lighting, subtle natural shadow under the product, perfectly centered",
  lifestyle:
    "premium lifestyle product photography on a natural surface (wood/marble) with tasteful props, warm cinematic lighting, shallow depth of field",
  white:
    "pure white background catalog photo (marketplace standard), bright even lighting, no shadows on the background, product perfectly isolated and centered",
  food:
    "appetizing food photography, fresh look, warm natural light, styled plating, slight steam and texture detail, restaurant menu quality",
};

function buildPrompt(style: string, productName?: string) {
  const s = STYLES[style] || STYLES.studio;
  return [
    `Retouch and enhance this photo into a ${s}.`,
    productName ? `The subject is: "${productName}".` : "",
    "KEEP THE EXACT SAME PRODUCT/SUBJECT: same shape, same colors, same brand, same label and same text on the packaging. Do not invent, replace or restyle the product itself.",
    "Improve only: lighting, white balance, sharpness, noise, contrast, background cleanliness and framing. Remove distracting clutter, dirt, reflections and messy background.",
    "No added text, no watermarks, no logos, no borders. Photorealistic, high resolution, square framing.",
  ].filter(Boolean).join(" ");
}

async function toDataUrl(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Não consegui baixar a imagem (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > 12 * 1024 * 1024) throw new Error("Imagem muito grande (máx 12MB)");
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  let bin = "";
  for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(bin)}`;
}

// PNG do modelo -> JPEG (evita que o app marque a foto como "IA" pela extensão)
async function pngToJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const img = (await decodePng(bytes)) as Image;
    return await img.encodeJPEG(90);
  } catch {
    return bytes;
  }
}

export async function enhance(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageUrl, tenantId, productName, style = "studio", aiTag = true } = await req.json();
    if (!imageUrl || !tenantId) {
      return new Response(JSON.stringify({ error: "imageUrl e tenantId são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const dataUrl = await toDataUrl(imageUrl);
    const [, mimeType = "image/jpeg", rawB64 = ""] = dataUrl.match(/^data:([^;]+);base64,(.*)$/) || [];
    const prompt = buildPrompt(style, productName);

    let b64: string | null = null;
    let lastErr = "";

    // 0) AI Workers (infra própria) — prioridade máxima, não gasta crédito da plataforma
    const { data: workers } = await supabase.from("ai_workers")
      .select("id, name, base_url")
      .eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "image")
      .order("last_used_at", { ascending: true, nullsFirst: true });

    for (const w of workers || []) {
      try {
        const r = await fetch(w.base_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "edit",
            prompt,
            productName: productName || "produto",
            category: style,
            tenantId,
            imageUrl,
            imageBase64: rawB64,
            mimeType,
          }),
        });
        if (r.status === 429 || r.status === 402 || r.status === 503) {
          await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", w.id);
          lastErr = "workers sem cota"; continue;
        }
        if (!r.ok) { lastErr = `worker ${w.name}: ${r.status}`; continue; }
        const j = await r.json().catch(() => null);
        const cand = (typeof j?.imageUrl === "string" && j.imageUrl) || (typeof j?.image === "string" && j.image) || "";
        const m = cand.match(/^data:image\/[a-z+]+;base64,(.+)$/i);
        if (m) { b64 = m[1]; }
        else if (/^https?:\/\//i.test(cand)) {
          const du = await toDataUrl(cand);
          b64 = du.split(",")[1] || null;
        }
        if (b64) {
          await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", w.id);
          break;
        }
        lastErr = `worker ${w.name} não devolveu imagem`;
      } catch (e) { lastErr = (e as Error).message; console.error("worker exception", w.name, lastErr); }
    }


    // 1) Chaves próprias do Google (api_keys) — evita gastar créditos da plataforma
    const { data: keys } = await supabase.from("api_keys").select("id, api_key")
      .eq("provider", "google_ai").eq("is_exhausted", false)
      .order("last_used_at", { ascending: true, nullsFirst: true });
    const allKeys = [...(keys || [])];
    const envKey = Deno.env.get("GOOGLE_AI_API_KEY");
    if (envKey) allKeys.push({ id: "__env__", api_key: envKey });

    for (const k of (b64 ? [] : allKeys)) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${k.api_key}`,
          {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: rawB64 } }] }],
              generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
            }),
          },
        );
        if (r.status === 429 || r.status === 403) {
          if (k.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", k.id);
          console.error("google key exhausted", k.id, r.status, (await r.text().catch(()=>"")).slice(0,200));
          lastErr = "quota"; continue;
        }
        if (!r.ok) { lastErr = (await r.text().catch(() => "")).slice(0, 150); console.error("google error", r.status, lastErr); continue; }
        const j = await r.json();
        const part = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
        if (part?.inlineData?.data) {
          if (k.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id);
          b64 = part.inlineData.data; break;
        }
        lastErr = "sem imagem";
      } catch (e) { lastErr = (e as Error).message; console.error("google exception", lastErr); }
    }

    // 2) Fallback: AI Gateway da plataforma
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!b64 && apiKey) {
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3.1-flash-image",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          }],
          modalities: ["image", "text"],
        }),
      });
      if (aiRes.ok) {
        const json = await aiRes.json();
        b64 = json?.data?.[0]?.b64_json || null;
        if (!b64) lastErr = "a IA não devolveu imagem";
      } else {
        const txt = await aiRes.text().catch(() => "");
        lastErr = aiRes.status === 429 ? "limite de uso da IA atingido"
          : /credit|402/.test(String(aiRes.status) + txt) ? "créditos de IA esgotados"
          : txt.slice(0, 150);
      }
    }

    if (!b64) {
      return new Response(JSON.stringify({ error: `Não consegui tratar a imagem (${lastErr || "IA indisponível"})` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const jpeg = await pngToJpeg(raw);

    const path = `${tenantId}/enh-${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await supabase.storage.from("product-images")
      .upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw upErr;

    const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
    const finalUrl = aiTag ? `${urlData.publicUrl}?ai=1` : urlData.publicUrl;

    return new Response(JSON.stringify({ imageUrl: finalUrl, aiTag: !!aiTag }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message || "Erro inesperado" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  } catch (e) {
    console.error("[unified:enhance] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
