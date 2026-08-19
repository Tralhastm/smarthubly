// ============ GERAÇÃO DE IMAGENS — CASCATA PROFISSIONAL ============
// Política da plataforma (exigência do dono):
// - Pollinations.ai NUNCA é usada (qualidade ruim, sem controle).
// - Ordens da cascata:
//   1. Google Gemini 2.5 Flash Image (api_keys.provider = "google_ai") — melhor qualidade
//   2. Lovable AI (google/gemini-2.5-flash-image) — fallback 1
//   3. ai_workers tipo "image" (ai-generate-image) — fallback 2
// - Prompt editorial rico (padrão do generate-product-image): o worker só responde bem
//   a prompts completos de fotografia; prompts genéricos geram alucinações.
// - A imagem gerada é sempre subida para o bucket "product-images" (prefixo de tenant)
//   e retornada como URL pública com ?ai=1.

export interface ImageGenResult {
  url: string; // URL pública do storage (product-images)
  source: "gemini" | "lovable" | "workers";
}

export interface ImageGenDebug {
  geminiKeysTried: number;
  lovableHttp: number | null;
  lovableOk: boolean;
  workersTried: { id: string; name: string; http: number | null }[];
}

// Prompt editorial rico: força fotografia real da cena descrita e proíbe texto/logos.
// "scene" descreve o objeto/cena principal; a moldura fotográfica garante fidelidade.
const RICH_PREFIX = `Ultra-realistic editorial product photography. The image MUST show EXACTLY and LITERALLY the scene below \u2014 do not substitute, generalize or replace subjects with generic objects. Shot on a Canon EOS R5 with 85mm lens, shallow depth of field, cinematic lighting with soft shadows, on a natural surface like dark wood, marble or rustic table with subtle lifestyle props. Warm ambient lighting, rich colors, slightly moody atmosphere, premium brand campaign look. STRICT: absolutely NO text, NO letters, NO words, NO logos, NO typography, NO numbers, NO captions, NO watermarks. Photorealistic, 8K quality. SCENE: `;

async function tryGoogleImage(apiKey: string, prompt: string, mimeType = "image/png"): Promise<{ bytes: Uint8Array; mime: string; status?: number } | null> {
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${RICH_PREFIX}${prompt}` }] }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
        }),
      },
    );
    if (!r.ok) return { bytes: new Uint8Array(0), mime: "", status: r.status };
    const j = await r.json();
    const part = j?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (!part?.inlineData?.data) return null;
    const bytes = Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0));
    const mime = (part.inlineData.mimeType || "").startsWith("image/png") ? "image/png" : "image/jpeg";
    return { bytes, mime, status: r.status };
  } catch (e) {
    console.warn("google image error:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function tryLovableImage(prompt: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return null;
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: `${RICH_PREFIX}${prompt}` }],
        modalities: ["image", "text"],
      }),
    });
    if (r.status === 429 || r.status === 402) return null;
    if (!r.ok) return null;
    const j = await r.json();
    const dataUri: string | null = j.choices?.[0]?.message?.images?.[0]?.image_url?.url || null;
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

async function tryAiWorkerImage(worker: { id: string; name: string; base_url: string }, prompt: string, raw = false): Promise<{ bytes: Uint8Array; mime: string; status?: number } | null> {
  try {
    // O endpoint real do worker é SEMPRE /functions/v1/ai-generate-image;
    // os base_url registrados no banco apontam para /functions/v1/ai-gen (path parcial) e precisam ser normalizados.
    const m = worker.base_url.match(/^(https?:\/\/[^\/]+)(\/functions\/v1)?(\/ai-generate-image)?$/);
    const url = m ? `${m[1]}/functions/v1/ai-generate-image` : worker.base_url;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    // productName é obrigatório pelo worker (validação no início da EF);
    // o prompt rico já embute as restrições de composição — productName serve
    // apenas como etiqueta do arquivo/capa, não é impresso na imagem pelo fluxo
    // de cascata (o worker antigo imprimia; a versão atual não imprime productName).
    let bodyText = "";
    let r: Response;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: raw ? prompt : `${RICH_PREFIX}${prompt}`,
          category: "product",
          tenantId: "sofia",
          productName,
          ...(raw ? { withPrefix: false } : {}),
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        try { bodyText = (await r.clone().text()).slice(0, 200); } catch { bodyText = ""; }
      }
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) {
      console.error(`[image-gen] worker ${worker.name} (${url}) HTTP ${r.status}: ${bodyText}`);
      // Fallback: o worker pode rejeitar o prompt rico (400 "AI error") mas aceitar
      // o prompt simples — testado empiricamente (D direto = 200; RICH = 400).
      if (!raw && (r.status === 400 || r.status === 500)) {
        console.log(`[image-gen] worker ${worker.name}: retry com prompt simples...`);
        const ctrl2 = new AbortController();
        const timer2 = setTimeout(() => ctrl2.abort(), 90_000);
        let bodyText2 = "";
        let r2: Response;
        try {
          r2 = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, category: "product", tenantId: "sofia", productName, withPrefix: false }),
            signal: ctrl2.signal,
          });
          if (!r2.ok) {
            try { bodyText2 = (await r2.clone().text()).slice(0, 200); } catch { bodyText2 = ""; }
          }
        } finally {
          clearTimeout(timer2);
        }
        if (r2.ok) {
          r = r2;
          bodyText = bodyText2;
        } else {
          console.error(`[image-gen] worker ${worker.name}: retry simples também falhou HTTP ${r2.status}: ${bodyText2}`);
          return { bytes: new Uint8Array(0), mime: "", status: r2.status };
        }
      } else {
        return { bytes: new Uint8Array(0), mime: "", status: r.status };
      }
    }
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("image/")) {
      const buf = await r.arrayBuffer();
      const mime = ct.startsWith("image/png") ? "image/png" : "image/jpeg";
      return { bytes: new Uint8Array(buf), mime, status: r.status };
    }
    if (!ct.includes("application/json")) return { bytes: new Uint8Array(0), mime: "", status: r.status };
    const j = await r.json();
    let raw: string | null = null;
    let mime = "image/jpeg";
    if (typeof j.imageUrl === "string") raw = j.imageUrl;
    else if (typeof j.image === "string") raw = j.image;
    else if (typeof j.base64 === "string") raw = `data:image/jpeg;base64,${j.base64}`;
    if (!raw) return null;
    if (raw.startsWith("data:")) {
      const m = raw.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return null;
      mime = m[1].startsWith("image/png") ? "image/png" : "image/jpeg";
      const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      return { bytes, mime };
    }
    const ir = await fetch(raw);
    if (!ir.ok) return { bytes: new Uint8Array(0), mime: "", status: r.status };
    const buf = await ir.arrayBuffer();
    return { bytes: new Uint8Array(buf), mime, status: r.status };
  } catch (e) {
    console.warn("ai-worker image error:", e instanceof Error ? e.message : e);
    return null;
  }
}

function extFor(mime: string): string {
  return mime === "image/png" ? "png" : "jpg";
}

// Deriva o productName (âncora temática usada pelo worker ai-generate-image)
// do prompt da cena: pega substantivos-chave das primeiras palavras do prompt.
// Ex: "Editorial food photography of a gourmet cheeseburger..." -> "Gourmet Cheeseburger"
function deriveProductName(prompt: string): string {
  const words = prompt.split(/\s+/).filter((w) => w.length > 2);
  const stop = new Set(["the", "and", "for", "with", "high", "end", "ultra", "realistic", "editorial",
    "product", "photography", "image", "photo", "shot", "square", "instagram", "post"]);
  const picked = words.filter((w) => !stop.has(w.toLowerCase())).slice(0, 3);
  if (!picked.length) return "Product";
  const raw = picked.join(" ").replace(/[^a-zA-Z0-9 ]/g, "").trim().slice(0, 40);
  return raw || "Product";
}

/**
 * Gera imagem pela cascata profissional e sobe para o bucket product-images.
 * @param admin Supabase client com service_role (acesso ao storage e api_keys/ai_workers)
 * @param prompt cena a fotografar (inglês recomendado, literal, sem restrições de "sem texto" — o prefixo rico já aplica)
 * @param tenantId tenant da loja (prefixo no bucket)
 * @param suffix sufixo do nome do arquivo
 */
export async function generateImageCascade(
  admin: any,
  prompt: string,
  tenantId: string,
  suffix = "gen",
  opts?: { productName?: string },
): Promise<ImageGenResult | null> {
  const debug: ImageGenDebug = { geminiKeysTried: 0, workersTried: [] };
  const productName = opts?.productName || deriveProductName(prompt);
  // 1. Google Gemini 2.5 Flash Image (chaves do projeto, rotacionadas)
  const { data: keys } = await admin
    .from("api_keys")
    .select("id, api_key")
    .eq("provider", "google_ai")
    .eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  let googleFailStatuses: number[] = [];
  for (const keyEntry of keys || []) {
    debug.geminiKeysTried++;
    const out = await tryGoogleImage(keyEntry.api_key, prompt);
    if (out && out.bytes.length > 0) {
      await admin.from("api_keys").update({ last_used_at: new Date().toISOString(), is_exhausted: false }).eq("id", keyEntry.id);
      return await storeImage(admin, out.bytes, out.mime, tenantId, suffix);
    }
    // Marcar exausto SOMENTE para erros definitivos (401/403 = chave inválida).
    // 429 (quota temporária), 400, 500, 503 podem recuperar sozinhos — não marcar.
    const st = out?.status;
    if (st) googleFailStatuses.push(st);
    if (st === 401 || st === 403) {
      await admin.from("api_keys").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", keyEntry.id);
    }
  }
  const allQuota = (keys || []).length > 0 && googleFailStatuses.length === (keys || []).length && googleFailStatuses.every((s) => s === 429);
  if (allQuota) {
    // Quota gratuita do Gemini renova lentamente; a espera longa de 60s quase sempre
    // consome o orçamento de tempo da Edge Function (150s) antes dos workers rodarem.
    // Estratégia: tentativa rápida única (15s) — se a quota já renovou, ganha de graça;
    // se não, segue imediatamente para os demais provedores.
    console.log("[image-gen] todas as chaves google em 429, tentativa rápida de renovação...");
    const quickRetry = await Promise.all((keys || []).map((keyEntry) =>
      tryGoogleImage(keyEntry.api_key, prompt).catch(() => null),
    ));
    for (let i = 0; i < (keys || []).length; i++) {
      debug.geminiKeysTried++;
      const out = quickRetry[i];
      if (out && out.bytes.length > 0) {
        await admin.from("api_keys").update({ last_used_at: new Date().toISOString(), is_exhausted: false }).eq("id", (keys || [])[i].id);
        return await storeImage(admin, out.bytes, out.mime, tenantId, suffix);
      }
    }
    console.log("[image-gen] google retry rápido também falhou; seguindo para os demais provedores.");
  }
  console.log("[image-gen] google keys: ", (keys || []).length, "tentadas, tentando OpenRouter...");

  // 2. OpenRouter (gemini-2.5-flash-image / fal.11-pro — geração de imagem)
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  let orOut: { bytes: Uint8Array; mime: string; status?: number } | null = null;
  if (OPENROUTER_API_KEY) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "https://smarthubly.pages.dev", "X-Title": "SmartHubly" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [{ role: "user", content: `${RICH_PREFIX}${prompt}` }],
          modalities: ["image", "text"],
        }),
      });
      debug.openrouterHttp = r.status;
      if (r.ok) {
        const j = await r.json();
        const img = j.choices?.[0]?.message?.images?.[0]?.image_url?.url || null;
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

  // 3. Lovable AI (gemini-2.5-flash-image)
  const lov = await tryLovableImage(prompt);
  if (lov) {
    debug.lovableHttp = null; // sucesso (o helper retorna antes de expor o status)
    debug.lovableOk = true;
    return await storeImage(admin, lov.bytes, lov.mime, tenantId, suffix);
  }
  debug.lovableHttp = -1;
  debug.lovableOk = false;
  console.log("[image-gen] lovable falhou, tentando ai_workers...");

  // 4. ai_workers tipo image — paralelizados em lotes de 2 para respeitar o rate limit
  // dos modelos por destino (~1-2 req/min); cada lote leva ~8-10s.
  const { data: workers } = await admin
    .from("ai_workers")
    .select("id, name, base_url")
    .eq("is_active", true)
    .eq("worker_type", "image")
    .order("last_used_at", { ascending: true, nullsFirst: true });

  async function runWorkerPass(passLabel: string, minimal = false): Promise<{ out: { bytes: Uint8Array; mime: string } | null; winner: any } | null> {
    // Limita a rodada aos 6 workers menos usados: suficiente para um sucesso e
    // evita estourar o limite de 150s da Edge Function quando várias imagens
    // rodam em paralelo (applyPlan faz Promise.allSettled por produto).
    const list = (workers || []).slice(0, 6);
    const results: { id: string; name: string; st: number | null }[] = [];
    for (let i = 0; i < list.length; i += 2) {
      const batch = list.slice(i, i + 2);
      const reqPrompt = minimal ? prompt : `${RICH_PREFIX}${prompt}`;
      const settled = await Promise.allSettled(batch.map((w) => tryAiWorkerImage(w, reqPrompt, minimal)));
      for (let b = 0; b < batch.length; b++) {
        const res = settled[b];
        const w = batch[b];
        const out = res.status === "fulfilled" ? res.value : null;
        const st = out?.status ?? (res.status === "rejected" ? -1 : null);
        results.push({ id: w.id, name: w.name, st: st ?? -1 });
        if (out && out.bytes.length > 0) {
          await admin.from("ai_workers").update({ last_used_at: new Date().toISOString(), is_exhausted: false }).eq("id", w.id);
          return { out, winner: w };
        }
        if (st === 401 || st === 403) {
          await admin.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", w.id);
        }
      }
    }
    console.log(`[image-gen] workers ${passLabel}: ${results.length} tentados, todos falharam — ex: ${results.slice(0, 3).map((x) => x.name + ":" + x.st).join(", ")}`);
    return null;
  }

  let pass = await runWorkerPass("pass 1");
  if (!pass && workers && workers.length > 0) {
    // Quota do Gemini nos workers renova a cada ~60s — aguardar e repetir uma vez.
    console.log("[image-gen] aguardando 15s para renovação de quota dos workers...");
    await new Promise((res) => setTimeout(res, 15_000));
    pass = await runWorkerPass("pass 2");
  }
  if (!pass && workers && workers.length > 0) {
    // 3ª chance: prompt MÍNIMO (sem o prefixo editorial), que costuma escapar do
    // filtro de safety do Gemini que rejeita prompts longos aleatoriamente.
    console.log("[image-gen] tentando pass 3 com prompt mínimo (sem estilo editorial)...");
    pass = await runWorkerPass("pass 3", true);
  }
  if (pass) {
    debug.workersTried = (debug.workersTried || []).concat([{ id: pass.winner.id, name: pass.winner.name, http: 200 }]);
    return await storeImage(admin, pass.out.bytes, pass.out.mime, tenantId, suffix);
  }
  console.warn("[image-gen] cascata completa sem sucesso. debug:", JSON.stringify(debug));
  const msg = `cascata esgotada: google=${debug.geminiKeysTried} lovableHttp=${debug.lovableHttp} workersTentados=${(debug.workersTried || []).map((x: any) => x.name).join(",")}`;
  throw new Error(msg);
}

async function storeImage(admin: any, bytes: Uint8Array, mime: string, tenantId: string, suffix: string): Promise<ImageGenResult> {
  const path = `${tenantId}/${crypto.randomUUID()}-${suffix}.${extFor(mime)}`;
  const { error } = await admin.storage.from("product-images").upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  const { data } = admin.storage.from("product-images").getPublicUrl(path);
  return { url: `${data.publicUrl}?ai=1`, source: "gemini" };
}
