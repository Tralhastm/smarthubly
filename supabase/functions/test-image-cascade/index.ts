// EF temporária de diagnóstico: testa CADA estágio da geração de imagem isoladamente
// e reporta exatamente onde falha (google/lovable/workers/storeImage).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { generateImageCascade } from "../_shared/image-gen.ts";

function deriveName(p: string): string { const stop = new Set(["the","and","for","with","high","end","ultra","realistic","editorial","product","photography","image","photo","shot","square","instagram","post"]); const picked = p.split(/\s+/).filter(w => w.length > 2 && !stop.has(w.toLowerCase())).slice(0,3); return picked.length ? picked.map(x => x.charAt(0).toUpperCase()+x.slice(1)).join(" ") : "Product"; }

    const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

let genOut: string | null = null;
let lastErr = "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json() as { prompt?: string; productName?: string; tenantId?: string; retries?: number };
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const log: string[] = [];

    // ---- Estágio A: chaves google_ai ----
    const { data: keys } = await supabase.from("api_keys").select("id, provider, is_exhausted").eq("provider", "google_ai");
    log.push(`A) google_ai keys: ${(keys || []).length}, exaustas: ${(keys || []).filter((k: any) => k.is_exhausted).length}`);

    // ---- Estágio B: workers ----
    const { data: workers } = await supabase.from("ai_workers").select("id, name, base_url, is_exhausted")
      .eq("is_active", true).eq("worker_type", "image");
    log.push(`B) ai_workers image ativos: ${(workers || []).length}, exaustos: ${(workers || []).filter((w: any) => w.is_exhausted).length}`);

    // ---- Estágio C: Lovable diretamente ----
    {
      const key = Deno.env.get("LOVABLE_API_KEY");
      log.push(`C) LOVABLE_API_KEY presente: ${Boolean(key)}, len: ${key?.length ?? 0}`);
      if (key) {
        const t0 = Date.now();
        try {
          const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-image",
              messages: [{ role: "user", content: `Short photo: ${body.prompt || "red apple"}` }],
              modalities: ["image", "text"],
            }),
          });
          log.push(`C) lovable HTTP ${r.status} em ${Date.now() - t0}ms ct=${(r.headers.get("content-type") || "").slice(0, 30)}`);
          if (r.ok) {
            const j = await r.json();
            const img: string = j.choices?.[0]?.message?.images?.[0]?.image_url?.url || "";
            log.push(`C) lovable img len: ${img.length}`);
          } else {
            log.push(`C) lovable body: ${(await r.text()).slice(0, 120)}`);
          }
        } catch (e) {
          log.push(`C) lovable EXC: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // ---- Estágio D: TODOS os workers manualmente (mapeamento de saúde) ----
    for (const w of (workers || []).slice(0, 5)) {
      const url = w.base_url.includes("/functions/") ? w.base_url : `${w.base_url}/functions/v1/ai-generate-image`;
      const t0 = Date.now();
      let respText = "";
      let status = -1;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 20_000);
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: body.prompt || "test", category: "product", tenantId: "diag", productName: body.productName || "X-Salada", withPrefix: false }),
          signal: ctrl.signal,
        }).finally(() => clearTimeout(t));
        status = r.status;
        if (!r.ok) respText = (await r.text()).slice(0, 150);
        else {
          const j = await r.json();
          respText = `img len ${(String(j.imageUrl || j.image || "")).length}`;
        }
      } catch (e) {
        respText = `EXC: ${e instanceof Error ? e.message : String(e)}`;
      }
      log.push(`D) worker ${w.name}: HTTP ${status} em ${Date.now() - t0}ms → ${respText}`);
    }

    // ---- Estágio D2: mesmo worker com o RICH_PREFIX do image-gen (prompt longo) ----
    for (const w of (workers || []).slice(0, 1)) {
      const url = w.base_url.includes("/functions/") ? w.base_url : `${w.base_url}/functions/v1/ai-generate-image`;
      const t0 = Date.now();
      let respText = "";
      let status = -1;
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: `Ultra-realistic editorial product photography. The image MUST show EXACTLY and LITERALLY the scene below \u2014 do not substitute, generalize or replace subjects with generic objects. Shot on a Canon EOS R5 with 85mm lens, shallow depth of field, cinematic lighting with soft shadows, on a natural surface like dark wood, marble or rustic table with subtle lifestyle props. Warm ambient lighting, rich colors, slightly moody atmosphere, premium brand campaign look. STRICT: absolutely NO text, NO letters, NO words, NO logos, NO typography, NO numbers, NO captions, NO watermarks. Photorealistic, 8K quality. SCENE: ${body.prompt || "test scene with a cheeseburger"}`, category: "product", tenantId: "diag", productName: body.productName || "X-Salada" }),
        });
        status = r.status;
        respText = (await r.text()).slice(0, 300);
      } catch (e) {
        respText = `EXC: ${e instanceof Error ? e.message : String(e)}`;
      }
      log.push(`D2) worker ${w.name} com RICH_PREFIX: HTTP ${status} em ${Date.now() - t0}ms → ${respText}`);
    }

    // ---- Estágio E: cascata manual com logging in-band de CADA passo ----
    const RICH = `Ultra-realistic editorial product photography. The image MUST show EXACTLY and LITERALLY the scene below \u2014 do not substitute, generalize or replace subjects with generic objects. Shot on a Canon EOS R5 with 85mm lens, shallow depth of field, cinematic lighting with soft shadows, on a natural surface like dark wood, marble or rustic table with subtle lifestyle props. Warm ambient lighting, rich colors, slightly moody atmosphere, premium brand campaign look. STRICT: absolutely NO text, NO letters, NO words, NO logos, NO typography, NO numbers, NO captions, NO watermarks. Photorealistic, 8K quality. SCENE: ${body.prompt || "test scene"}`;
    const PROMPT = body.prompt || "test prompt";
    {
      // E1: google
      const { data: gkeys } = await supabase.from("api_keys").select("id").eq("provider", "google_ai").eq("is_exhausted", false).order("last_used_at", { ascending: true, nullsFirst: true });
      log.push(`E1) google keys não exaustas: ${(gkeys || []).length}`);
      // E2: lovable (chave ausente → pula)
      const lovKey = Deno.env.get("LOVABLE_API_KEY");
      log.push(`E2) lovable: ${lovKey ? "tem chave" : "sem chave (pula)"}`);
      // E3: workers um a um até sucesso, máximo 3 para não demorar (genOut já declarado no topo)
      let workerIdx = 0;
      for (const w of (workers || []).slice(0, 3)) {
        workerIdx++;
        const t0 = Date.now();
        const url = (() => {
          const mm = w.base_url.match(/^(https?:\/\/[^\/]+)(\/functions\/v1)?(\/ai-generate-image)?$/);
          return mm ? `${mm[1]}/functions/v1/ai-generate-image` : w.base_url;
        })();
        let step = "";
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: RICH, category: "product", tenantId: body.tenantId || "diag", productName: body.productName || deriveName(PROMPT) }),
          });
          const ct = r.headers.get("content-type") || "";
          if (r.ok && ct.includes("application/json")) {
            const j = await r.json();
            const raw = String(j.imageUrl || j.image || "");
            const m = raw.match(/^data:([^;]+);base64,(.+)$/);
            if (m) {
              const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
              const path = `${body.tenantId || "diag"}/${crypto.randomUUID()}-sofia.${m[1].startsWith("image/png") ? "png" : "jpg"}`;
              const { error } = await supabase.storage.from("product-images").upload(path, bytes, { contentType: m[1].startsWith("image/png") ? "image/png" : "image/jpeg", upsert: true });
              if (error) step = `storeImage FALHOU ${error.message}`;
              else {
                genOut = supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
                step = `OK bytes=${bytes.length} → ${genOut.slice(0, 80)}`;
              }
            } else step = "parse data-uri falhou";
          } else step = `HTTP ${r.status}${!r.ok ? " " + (await r.text()).slice(0, 100) : ""}`;
        } catch (e) {
          step = `EXC ${e instanceof Error ? e.message : String(e)}`;
        }
        log.push(`E3.${workerIdx}) worker ${w.name} (${w.base_url.slice(0, 42)}): ${step} (${Date.now() - t0}ms)`);
        if (genOut) break;
      }
      log.push(`E3) cascata manual: ${genOut ? "SUCESSO" : "falhou em todos"}`);
    }

    // ---- Estágio F: storeImage com imagem real decodificada do worker ----
    try {
      const w = (workers || [])[0];
      const url = w.base_url.includes("/functions/") ? w.base_url : `${w.base_url}/functions/v1/ai-generate-image`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: body.prompt || "test", category: "product", tenantId: "diag", productName: "X-Salada" }),
      });
      const ct = r.headers.get("content-type") || "";
      if (r.ok) {
        const j = await r.json();
        const raw = String(j.imageUrl || j.image || "");
        const m = raw.match(/^data:([^;]+);base64,(.+)$/);
        const mime = "image/png";
        if (m) {
          const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
          const path = `diag/${crypto.randomUUID()}-diagf.${mime === "image/png" ? "png" : "jpg"}`;
          const { error } = await supabase.storage.from("product-images").upload(path, bytes, { contentType: mime, upsert: true });
          log.push(`F) storeImage: ${error ? "FALHOU " + error.message : "OK → " + (supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl).slice(0, 100)}`);
        }
      }
    } catch (e) {
      log.push(`F) storeImage EXC: ${e instanceof Error ? e.message : String(e)}`);
    }

    // ---- Estágio G: réplica exata do tryAiWorkerImage da cascata no worker Imagem 25 ----
    {
      const target = (workers || []).find((w: any) => w.name === "Imagem 25") || (workers || [])[0];
      const mm = target.base_url.match(/^(https?:\/\/[^\/]+)(\/functions\/v1)?(\/ai-generate-image)?$/);
      const url = mm ? `${mm[1]}/functions/v1/ai-generate-image` : target.base_url;
      const RICH = `Ultra-realistic editorial product photography. The image MUST show EXACTLY and LITERALLY the scene below \u2014 do not substitute, generalize or replace subjects with generic objects. Shot on a Canon EOS R5 with 85mm lens, shallow depth of field, cinematic lighting with soft shadows, on a natural surface like dark wood, marble or rustic table with subtle lifestyle props. Warm ambient lighting, rich colors, slightly moody atmosphere, premium brand campaign look. STRICT: absolutely NO text, NO letters, NO words, NO logos, NO typography, NO numbers, NO captions, NO watermarks. Photorealistic, 8K quality. SCENE: ${body.prompt || "test scene"}`;
      const ctrl = new AbortController();
      const tmr = setTimeout(() => ctrl.abort(), 90_000);
      let gStep = "";
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: RICH, category: "product", tenantId: "sofia", productName: deriveName(body.prompt || "x-salada gourmet") }),
          signal: ctrl.signal,
        });
        clearTimeout(tmr);
        if (!r.ok) gStep = `HTTP ${r.status} ${body.prompt ? (await r.text()).slice(0, 150) : ""}`;
        else {
          const ct = r.headers.get("content-type") || "";
          if (ct.includes("image/")) gStep = `HTTP ${r.status} image/${ct.includes("png") ? "png" : "jpeg"} ${(await r.arrayBuffer()).byteLength} bytes — sucesso puro`;
          else {
            const j = await r.json();
            const raw = String(j.imageUrl || j.image || "");
            gStep = `HTTP ${r.status} JSON imageUrl len ${raw.length}`;
          }
        }
      } catch (e) {
        clearTimeout(tmr);
        gStep = `EXC ${e instanceof Error ? e.message : String(e)}`;
      }
      log.push(`G) réplica exata (RICH+tenantId so) no ${target.name}: ${gStep}`);
    }

    // ---- Estágio H: cascata REAL do _shared (mesmo código que a Sofia usa) ----
    {
      const t0h = Date.now();
      try {
        const hRes = await generateImageCascade(supabase, body.prompt || "test scene", body.tenantId || "diag", "h", { productName: body.productName || "Cheeseburger" });
        log.push(`H) cascata real do _shared em ${Date.now() - t0h}ms: ${hRes ? "SUCESSO " + hRes.url.slice(0, 80) : "null"}`);
      } catch (e) {
        log.push(`H) cascata real do _shared em ${Date.now() - t0h}ms EXC: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return new Response(JSON.stringify({ ok: Boolean(genOut), url: genOut ?? null, lastErr, log }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
