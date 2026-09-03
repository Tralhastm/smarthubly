import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ApiKeyEntry { id: string; api_key: string; }
interface AiWorker { id: string; name: string; base_url: string; }

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function getGoogleKeys(supabase: any) {
  const { data } = await supabase.from("api_keys").select("id, api_key")
    .eq("provider", "google_ai").eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  return (data || []) as ApiKeyEntry[];
}

async function getAiWorkers(supabase: any) {
  const { data } = await supabase.from("ai_workers").select("id, name, base_url")
    .eq("is_active", true).eq("is_exhausted", false)
    .eq("worker_type", "image")
    .order("last_used_at", { ascending: true, nullsFirst: true });
  return (data || []) as AiWorker[];
}

async function uploadImage(supabase: any, base64: string, mimeType: string, tenantId: string): Promise<string> {
  const ext = mimeType.includes("jpeg") ? "jpg" : "png";
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const path = `${tenantId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("product-images").upload(path, bytes, { contentType: mimeType, upsert: true });
  if (error) throw error;
  const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
  // Marca como gerada por IA via query string (independente da extensão)
  return `${urlData.publicUrl}?ai=1`;
}

// Prompt padrão (produto físico para a maioria das lojas)
const DEFAULT_IMAGE_PROMPT = (productName: string, category: string) =>
  `Ultra-realistic editorial product photography of "${productName}" (category: ${category || 'general'}). Shot on a Canon EOS R5 with 85mm lens, shallow depth of field, cinematic lighting with soft shadows. Place the product on a natural surface like dark wood, marble, or rustic table with subtle lifestyle props. Warm ambient lighting, rich colors, slightly moody atmosphere. The image should look like a premium brand campaign or high-end magazine ad. No text, no labels, no watermarks. Photorealistic, 8K quality.`;

// Prompt para PESSOA — RETRATO fashion editorial (Vogue / Harper's Bazaar style)
// Linguagem mainstream pra evitar autocensura do Gemini. Foco: MULHER REAL, ROSTO, RETRATO.
const PERSON_GLAMOUR_PROMPT = (productName: string, category: string) => {
  const cat = (category || '').toLowerCase();
  const name = productName.replace(/^nome:\s*/i, '').split('—')[0].trim();

  let vibe = 'sophisticated upscale cocktail lounge with warm amber bokeh lights in the background, polished marble bar with crystal glassware, deep wood and gold accents, cinematic warm tungsten lighting';
  let outfit = 'an elegant fitted satin cocktail dress in deep emerald green with thin straps and a refined V-neckline, delicate gold necklace, small gold hoop earrings, gold wristwatch';
  let hair = 'styled wavy shoulder-length hair, polished glamour makeup with rose lipstick';

  if (cat.includes('bdsm') || cat.includes('domme') || cat.includes('domina')) {
    vibe = 'moody contemporary art gallery at night, dramatic single overhead light, polished concrete floor, deep red abstract painting in the background';
    outfit = 'a sharply tailored black leather midi dress with a high collar and long sleeves, knee-high polished black boots, statement silver jewelry';
    hair = 'sleek straight dark hair, bold red lipstick, defined eye makeup';
  } else if (cat.includes('festa') || cat.includes('disco') || cat.includes('club')) {
    vibe = 'glamorous upscale nightclub VIP lounge, soft magenta and amber bokeh lights, mirror accents, champagne glasses on a marble table';
    outfit = 'a chic shimmering silver sequin midi cocktail dress with long sleeves, crystal drop earrings, elegant strappy heels';
    hair = 'voluminous blow-out hair, glamorous evening makeup with shimmer';
  } else if (cat.includes('exótica') || cat.includes('exotica') || cat.includes('tokyo') || cat.includes('asian')) {
    vibe = 'stylish modern Tokyo rooftop bar at night, soft pink and cyan neon bokeh in the distance, wet city lights reflecting, contemporary luxury vibe';
    outfit = 'a refined modern silk wrap dress in deep crimson with subtle gold embroidery at the collar, delicate gold pendant necklace';
    hair = 'sleek straight long black hair with side parting, red lipstick, soft elegant makeup';
  } else if (cat.includes('premium') || cat.includes('vip') || cat.includes('madame') || cat.includes('luxo')) {
    vibe = 'luxury penthouse cocktail lounge overlooking a glittering city skyline at night, marble bar, gold accents, champagne, warm amber lights';
    outfit = 'a sophisticated tailored black silk evening dress with elegant draping and a refined neckline, layered fine gold necklaces, diamond stud earrings, gold bracelet';
    hair = 'elegant updo or polished waves, refined evening makeup, glossy nude-pink lips';
  } else if (cat.includes('cabaret') || cat.includes('burlesque')) {
    vibe = 'vintage art-deco theatre lobby, red velvet curtains, gold leaf details, warm spotlight, soft haze for atmosphere';
    outfit = 'a vintage 1940s style red satin evening gown with elegant draping and matching long opera gloves, pearl necklace, vintage rhinestone earrings';
    hair = 'classic Hollywood waves hairstyle, bold red lipstick, winged eyeliner';
  } else if (cat.includes('praia') || cat.includes('beach') || cat.includes('piscina') || cat.includes('pool')) {
    vibe = 'sunlit beach club terrace at golden hour, palm leaves, turquoise pool reflections, white linen umbrellas, Saint-Tropez summer vibe';
    outfit = 'a chic flowy white linen summer maxi dress with thin straps, delicate gold layered necklaces, oversized designer sunglasses pushed up onto her head';
    hair = 'sun-kissed beachy waves, fresh natural makeup with glowing skin and peach lipstick';
  } else if (cat.includes('fitness') || cat.includes('gym') || cat.includes('personal')) {
    vibe = 'modern luxury fitness studio at sunrise with floor-to-ceiling windows and golden light, polished concrete floor, minimalist mirrors';
    outfit = 'a stylish matching activewear set — a fitted long-sleeve athletic crop top and high-waisted leggings in soft beige, white sneakers, smartwatch on wrist';
    hair = 'high ponytail, fresh natural makeup, dewy glowing skin';
  } else if (cat.includes('cosplay') || cat.includes('geek') || cat.includes('anime')) {
    vibe = 'stylish colorful anime convention hall in the background with soft neon bokeh of stage lights and crowd';
    outfit = 'a tasteful elegant high-fashion cosplay-inspired outfit — a structured fitted bodysuit with a cape and stylish thigh-high boots, decorative arm bracers, refined runway interpretation';
    hair = 'styled colorful wig fitting the character, dramatic editorial makeup';
  } else if (cat.includes('girlfriend') || cat.includes('universitária') || cat.includes('universitaria') || cat.includes('namorada')) {
    vibe = 'cozy sunlit modern coffee shop in the late afternoon golden hour, warm window light, blurred bookshelves and plants in the background, latte and an open notebook on the table';
    outfit = 'a cute casual chic outfit — an oversized cream cable-knit sweater paired with a pleated mini skirt, delicate gold necklace, small gold hoop earrings';
    hair = 'natural tousled wavy hair, fresh dewy minimal makeup with rosy cheeks and glossy lips';
  } else if (cat.includes('mistico') || cat.includes('místico') || cat.includes('cigana') || cat.includes('tarot')) {
    vibe = 'candle-lit bohemian salon with deep burgundy and gold tapestries, tarot cards arranged on an antique wooden table, soft candlelight, incense smoke';
    outfit = 'a flowing burgundy velvet long-sleeve maxi dress with intricate gold embroidery at the collar, layered gold coin necklaces, delicate gold forehead chain, ornate rings';
    hair = 'long dark wavy hair with soft curls, defined smoky eye makeup, deep berry lipstick';
  } else {
    const seed = name.charCodeAt(0) || 65;
    const dressColors = ['deep emerald green', 'rich sapphire blue', 'classic burgundy', 'midnight black', 'champagne gold', 'soft blush pink', 'royal purple'];
    const hairStyles = [
      'long wavy auburn red hair, polished glamour makeup with rose lipstick',
      'long straight chocolate brown hair, soft glam makeup with nude lipstick',
      'shoulder-length wavy honey blonde hair, fresh glowing makeup with peach lipstick',
      'long voluminous black hair with soft curls, defined eye makeup with red lipstick',
      'sleek bob platinum blonde hair, modern minimalist makeup with glossy nude lips',
    ];
    const dress = dressColors[seed % dressColors.length];
    hair = hairStyles[seed % hairStyles.length];
    outfit = `an elegant fitted satin cocktail dress in ${dress} with thin straps and a refined V-neckline, delicate gold necklace, small gold hoop earrings, gold wristwatch`;
  }

  const isDuo = cat.includes('duo') || /\bduo\b|\bdupla\b/i.test(productName);
  const isTrio = cat.includes('trio') || /\btrio\b/i.test(productName);
  const subject = isTrio
    ? `High-end fashion editorial PORTRAIT PHOTOGRAPH of three elegant adult women (in their late 20s) posing together with confident friendly chemistry`
    : isDuo
    ? `High-end fashion editorial PORTRAIT PHOTOGRAPH of two elegant adult women (in their late 20s) posing side by side with confident friendly chemistry`
    : `High-end fashion editorial PORTRAIT PHOTOGRAPH of one elegant adult woman (in her late 20s) sitting confidently at the bar, leaning slightly forward, looking directly at the camera with a soft confident smile, hands relaxed on the bar`;

  return `${subject}. Style reference: Vogue magazine portrait, Harper's Bazaar editorial, high-end hospitality brand campaign. The woman wears ${outfit}. Hair and makeup: ${hair}. Setting: ${vibe}. CRITICAL: the woman MUST be clearly visible from the waist up, face sharp and centered in the composition, occupying the main focus of the frame — this is a PORTRAIT of a person, NOT a still life of objects. Shot on a Canon EOS R5 with 85mm f/1.4 lens, professional editorial portrait lighting with warm key light and soft rim light, shallow depth of field with creamy background bokeh, razor-sharp focus on the eyes, ultra-detailed realistic skin texture with natural pores and highlights, photorealistic 8K editorial print quality, vertical 3:4 magazine portrait composition. Tasteful, elegant, sophisticated, classy. ABSOLUTELY NO text, NO logos, NO watermarks, NO captions, NO names written anywhere in the image. Do NOT include any tablets, laptops, books, mugs, signs or other objects with text on them.`;
};

// Palavras que indicam PRODUTO FÍSICO mesmo dentro de uma loja adulta
const PRODUCT_KEYWORDS = [
  'champagne', 'champanhe', 'whisky', 'vinho', 'drink', 'bebida', 'cerveja',
  'kit', 'combo', 'pacote', 'caixa', 'box',
  'perfume', 'oleo', 'óleo', 'vela', 'incenso', 'sabonete',
  'brinquedo', 'acessorio', 'acessório', 'fantasia',
  'hora extra', 'taxa', 'serviço extra', 'adicional',
];

function looksLikePhysicalProduct(productName: string, category: string): boolean {
  const text = `${productName} ${category}`.toLowerCase();
  return PRODUCT_KEYWORDS.some(kw => text.includes(kw));
}

// Nichos onde o "produto" geralmente é uma PESSOA (modelo/acompanhante)
const PERSON_NICHE_KEYWORDS = [
  'acompanhante', 'companion', 'escort', 'lounge', 'adult',
  'serviços de luxo', 'servicos de luxo', 'agendamento', 'massagem', 'massage',
  'cabaret', 'burlesque', 'striptease',
];

function isPersonNiche(tenantNiche: string, tenantSlug: string): boolean {
  const text = `${tenantNiche} ${tenantSlug}`.toLowerCase();
  if (text.includes('luxuria')) return true;
  return PERSON_NICHE_KEYWORDS.some(kw => text.includes(kw));
}

async function getTenantInfo(supabase: any, tenantId: string): Promise<{ slug: string; niche: string }> {
  try {
    const { data } = await supabase.from('tenants').select('slug, niche').eq('id', tenantId).maybeSingle();
    return { slug: (data?.slug || '').toLowerCase(), niche: (data?.niche || '').toLowerCase() };
  } catch { return { slug: '', niche: '' }; }
}

const buildPrompt = (productName: string, category: string, tenantSlug: string, tenantNiche: string) => {
  // Tenant de pessoa (acompanhante/lounge) E produto não parece item físico → prompt de pessoa sensual
  if (isPersonNiche(tenantNiche, tenantSlug) && !looksLikePhysicalProduct(productName, category)) {
    return PERSON_GLAMOUR_PROMPT(productName, category);
  }
  return DEFAULT_IMAGE_PROMPT(productName, category);
};

// Compat alias for older call sites
const IMAGE_PROMPT = DEFAULT_IMAGE_PROMPT;

// Reason codes propagated to batch-generate-images so it can react intelligently:
// - 'no_provider'     : sem chaves/workers disponíveis
// - 'google_quota'    : todas as keys Google retornaram 429/403
// - 'lovable_credit'  : Lovable AI sem crédito (402)
// - 'lovable_rate'    : Lovable AI rate-limit (429)
// - 'workers_exhausted': todos os workers retornaram 402/429/503
// - 'workers_error'   : workers responderam erros 4xx/5xx genéricos
// - 'all_failed'      : combinação dos acima
type TryResult = { url: string | null; reason: string };

async function tryGoogle(prompt: string, keys: ApiKeyEntry[], supabase: any, tenantId: string): Promise<TryResult> {
  const allKeys = keys.length > 0 ? keys
    : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : [];

  if (allKeys.length === 0) return { url: null, reason: 'no_provider' };

  let allQuotaExhausted = true;
  for (const keyEntry of allKeys) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${keyEntry.api_key}`,
        {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }),
        }
      );
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        console.error(`Google image API ${response.status} for key ${keyEntry.id}:`, errText.slice(0, 200));
      }
      if (response.status === 429 || response.status === 403) {
        // Marcar como exausto SOMENTE para erros definitivos (401/403 = chave inválida).
        // 429 é quota temporária (renova ~1h) — não marcar, a função inteira falha de todo jeito.
        if (keyEntry.id !== "__env__" && (response.status === 401 || response.status === 403)) {
          await supabase.from("api_keys").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", keyEntry.id);
        }
        continue;
      }
      if (!response.ok) { allQuotaExhausted = false; continue; }
      if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyEntry.id);
      const data = await response.json();
      const imagePart = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
      if (!imagePart?.inlineData?.data) { allQuotaExhausted = false; continue; }
      const url = await uploadImage(supabase, imagePart.inlineData.data, imagePart.inlineData.mimeType || "image/png", tenantId);
      return { url, reason: 'ok' };
    } catch (e) { console.error("Google image failed:", e); allQuotaExhausted = false; continue; }
  }
  return { url: null, reason: allQuotaExhausted ? 'google_quota' : 'google_error' };
}

async function tryLovable(prompt: string, supabase: any, tenantId: string): Promise<TryResult> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) { console.log("LOVABLE_API_KEY not set"); return { url: null, reason: 'no_provider' }; }
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-image", messages: [{ role: "user", content: prompt }], modalities: ["image", "text"] }),
    });
    if (response.status === 402) {
      const errText = await response.text().catch(() => "");
      console.error(`Lovable AI 402:`, errText.slice(0, 200));
      return { url: null, reason: 'lovable_credit' };
    }
    if (response.status === 429) {
      return { url: null, reason: 'lovable_rate' };
    }
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(`Lovable AI ${response.status}:`, errText.slice(0, 300));
      return { url: null, reason: 'lovable_error' };
    }
    const data = await response.json();
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl || !imageUrl.startsWith("data:image")) {
      console.error("Lovable AI: no image in response", JSON.stringify(data).slice(0, 200));
      return { url: null, reason: 'lovable_error' };
    }
    const match = imageUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!match) return { url: null, reason: 'lovable_error' };
    const url = await uploadImage(supabase, match[2], `image/${match[1]}`, tenantId);
    return { url, reason: 'ok' };
  } catch (e) { console.error("Lovable AI exception:", e); return { url: null, reason: 'lovable_error' }; }
}

async function tryWorker(productName: string, category: string, tenantId: string, workers: AiWorker[], supabase: any, prompt: string): Promise<TryResult> {
  if (workers.length === 0) return { url: null, reason: 'no_provider' };
  let allExhausted = true;
  for (const worker of workers) {
    try {
      const url = worker.base_url;
      console.log(`Trying worker: ${worker.name} -> ${url}`);
      // 25s timeout per worker so we don't waste 60s on a hanging one
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25_000);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName, category, tenantId, prompt }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        console.warn(`Worker ${worker.name} exhausted (${response.status})`);
        await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
        continue;
      }
      if (!response.ok) {
        console.warn(`Worker ${worker.name} returned ${response.status}`);
        // Fallback: o Gemini por trás dos workers rejeita prompts longos com 400/500
        // aleatórios (safety). Tentar de novo com prompt MÍNIMO (sem detalhes longos).
        if ((response.status === 400 || response.status === 500) && prompt.length > 120) {
          console.log(`[gen] worker ${worker.name}: retry com prompt mínimo...`);
          const shortPrompt = `${productName} (category: ${category || 'general'})`;
          const ctrl2 = new AbortController();
          const timer2 = setTimeout(() => ctrl2.abort(), 25_000);
          const response2 = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productName, category, tenantId, prompt: shortPrompt }),
            signal: ctrl2.signal,
          }).finally(() => clearTimeout(timer2));
          if (response2.ok) {
            const data2 = await response2.json().catch(() => null);
            if (data2?.imageUrl || data2?.image) {
              const candidate = (typeof data2.imageUrl === "string" && data2.imageUrl.startsWith("data:image")) ? data2.imageUrl : (typeof data2.image === "string" && data2.image.startsWith("data:image") ? data2.image : null);
              if (candidate) {
                const match2 = candidate.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
                if (match2) {
                  const imageUrl2 = await uploadImage(supabase, match2[2], `image/${match2[1]}`, tenantId);
                  await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", worker.id);
                  return { url: imageUrl2, reason: 'ok' };
                }
              }
              if (typeof data2.imageUrl === "string" && /^https?:\/\//i.test(data2.imageUrl)) {
                await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", worker.id);
                return { url: data2.imageUrl, reason: 'ok' };
              }
            }
          }
          console.warn(`Worker ${worker.name}: retry mínimo também falhou (${response2.status})`);
        }
        allExhausted = false;
        continue;
      }
      const ct = response.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        console.warn(`Worker ${worker.name} returned non-JSON (${ct}) — disabling`);
        await supabase.from("ai_workers").update({ is_active: false }).eq("id", worker.id);
        allExhausted = false;
        continue;
      }
      const data = await response.json();
      let imageUrl: string | null = null;

      // Caso 1: worker já retornou URL pública (http/https)
      if (typeof data.imageUrl === "string" && /^https?:\/\//i.test(data.imageUrl)) {
        imageUrl = data.imageUrl;
      }
      // Caso 2: worker retornou data URI em imageUrl OU image — precisa subir pro Storage
      const candidateDataUri = (typeof data.imageUrl === "string" && data.imageUrl.startsWith("data:image"))
        ? data.imageUrl
        : (typeof data.image === "string" && data.image.startsWith("data:image") ? data.image : null);
      if (!imageUrl && candidateDataUri) {
        const match = candidateDataUri.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
        if (match) {
          imageUrl = await uploadImage(supabase, match[2], `image/${match[1]}`, tenantId);
        }
      }
      if (imageUrl) {
        await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", worker.id);
        return { url: imageUrl, reason: 'ok' };
      }
      console.warn(`Worker ${worker.name} returned no image`);
      allExhausted = false;
    } catch (e) {
      console.warn(`Worker ${worker.name} threw:`, e instanceof Error ? e.message : e);
      allExhausted = false;
      continue;
    }
  }
  return { url: null, reason: allExhausted ? 'workers_exhausted' : 'workers_error' };
}

// Busca uma referência visual no Google e devolve { mimeType, base64 } ou null.
async function fetchVisualReference(productName: string, category: string): Promise<{ mimeType: string; base64: string } | null> {
  try {
    const url = `${Deno.env.get("SUPABASE_URL")!}/functions/v1/search-google-images`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 35_000);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
      body: JSON.stringify({
        query: category && category !== "Geral" ? `${productName} ${category}` : productName,
        max: 6, curate: true, returnBuffer: true,
        // não precisa salvar no bucket — é só referência pra IA
      }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.imageBase64) return null;
    return { mimeType: data.mimeType || "image/jpeg", base64: data.imageBase64 };
  } catch (e) {
    console.warn("[gen] visual ref failed:", (e as Error).message);
    return null;
  }
}

// Variante do tryLovable que usa imagem de referência (Nano Banana edit)
async function tryLovableWithReference(prompt: string, ref: { mimeType: string; base64: string }, supabase: any, tenantId: string): Promise<TryResult> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return { url: null, reason: 'no_provider' };
  try {
    const refPrompt = `Use the provided photo ONLY as a visual reference for the actual product (its real shape, colors, packaging, label design, brand identity). Re-create the product in the following style: ${prompt}. CRITICAL: do NOT copy the background or composition of the reference — only respect the product's true appearance. Output a fresh editorial photograph, NOT a redraw of the reference.`;
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: refPrompt },
            { type: "image_url", image_url: { url: `data:${ref.mimeType};base64,${ref.base64}` } },
          ],
        }],
        modalities: ["image", "text"],
      }),
    });
    if (response.status === 402) return { url: null, reason: 'lovable_credit' };
    if (response.status === 429) return { url: null, reason: 'lovable_rate' };
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(`Lovable AI ref ${response.status}:`, errText.slice(0, 300));
      return { url: null, reason: 'lovable_error' };
    }
    const data = await response.json();
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl || !imageUrl.startsWith("data:image")) return { url: null, reason: 'lovable_error' };
    const match = imageUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!match) return { url: null, reason: 'lovable_error' };
    const url = await uploadImage(supabase, match[2], `image/${match[1]}`, tenantId);
    return { url, reason: 'ok' };
  } catch (e) { console.error("Lovable AI ref exception:", e); return { url: null, reason: 'lovable_error' }; }
}

export async function generate(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { productName, category, tenantId, useReference } = await req.json();
    if (!productName || !tenantId) {
      return new Response(JSON.stringify({ error: "productName and tenantId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = getSupabaseAdmin();
    const [keys, workers, tenantInfo] = await Promise.all([
      getGoogleKeys(supabase),
      getAiWorkers(supabase),
      getTenantInfo(supabase, tenantId),
    ]);
    const prompt = buildPrompt(productName, category, tenantInfo.slug, tenantInfo.niche);
    const isPersonPrompt = isPersonNiche(tenantInfo.niche, tenantInfo.slug) && !looksLikePhysicalProduct(productName, category);
    const promptType = isPersonPrompt ? 'PERSON' : 'PRODUCT';
    console.log(`Generating ${promptType} image for tenant=${tenantInfo.slug || tenantId} product="${productName}" category="${category || ''}"`);

    // Para PRODUTOS físicos, busca referência visual no Google e usa como base.
    // Para PESSOAS (lounges/acompanhantes), NÃO usa referência (é fictício, não pode replicar pessoa real).
    const wantsReference = useReference !== false && !isPersonPrompt;
    if (wantsReference) {
      const ref = await fetchVisualReference(productName, category || "");
      if (ref) {
        console.log(`[gen] using visual reference (${ref.base64.length} b64 chars)`);
        const rRef = await tryLovableWithReference(prompt, ref, supabase, tenantId);
        if (rRef.url) return new Response(JSON.stringify({ imageUrl: rRef.url, withReference: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        console.log(`Reference-based gen failed (${rRef.reason}), falling back to standard pipeline...`);
      } else {
        console.log(`[gen] no visual reference found, using standard pipeline`);
      }
    }

    const r1 = await tryGoogle(prompt, keys, supabase, tenantId);
    if (r1.url) return new Response(JSON.stringify({ imageUrl: r1.url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (r1.reason === 'google_quota' && keys.length > 0) {
      // Quota gratuita do Gemini renova lentamente; a espera longa de 60s consome o
      // orçamento de tempo da Edge Function (150s). Estratégia: espera curta (15s) e
      // tentativa rápida única — se renovou, ganha de graça; senão, segue adiante.
      console.log(`[gen] google em quota, esperando 15s para renovação rápida...`);
      await new Promise((res) => setTimeout(res, 15_000));
      const r1q = await tryGoogle(prompt, keys, supabase, tenantId);
      if (r1q.url) return new Response(JSON.stringify({ imageUrl: r1q.url, quickRetry: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`Google failed (${r1.reason}), trying Lovable AI...`);
    const r2 = await tryLovable(prompt, supabase, tenantId);
    if (r2.url) return new Response(JSON.stringify({ imageUrl: r2.url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    console.log(`Lovable failed (${r2.reason}), trying workers...`);
    const r3 = await tryWorker(productName, category, tenantId, workers, supabase, prompt);
    if (r3.url) return new Response(JSON.stringify({ imageUrl: r3.url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const reasons = [r1.reason, r2.reason, r3.reason];
    const allQuota = reasons.every(r => ['google_quota','lovable_credit','lovable_rate','workers_exhausted','no_provider'].includes(r));
    const aggregateReason = allQuota ? 'all_quota_exhausted' : 'all_failed';
    return new Response(
      JSON.stringify({ error: "Todos os provedores de geração de imagem falharam.", reason: aggregateReason, details: reasons }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  } catch (e) {
    console.error("[unified:generate] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
