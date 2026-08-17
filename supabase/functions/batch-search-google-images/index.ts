// Busca em massa: para cada produto sem imagem, procura no Google Images,
// baixa a primeira foto utilizável e salva no produto.
// Reusa a mesma tabela image_generation_jobs pra acompanhar progresso.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PARALLEL = 3;
const BATCH_DELAY_MS = 600;
const MAX_RUNTIME_MS = 20 * 60_000;

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function updateJob(supabase: any, jobId: string, fields: Record<string, unknown>) {
  await supabase
    .from("image_generation_jobs")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

async function isCancelled(supabase: any, jobId: string | undefined): Promise<boolean> {
  if (!jobId) return false;
  const { data } = await supabase
    .from("image_generation_jobs")
    .select("status")
    .eq("id", jobId)
    .maybeSingle();
  return data?.status === "cancelled";
}

async function searchOne(
  supabaseUrl: string,
  serviceKey: string,
  productName: string,
  category: string | null,
  tenantId: string,
  existingImages: string[] = [],
): Promise<string | null> {
  const query = category && category !== "Geral"
    ? `${productName} ${category}`
    : productName;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/search-google-images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query, tenantId, download: true, max: 8, existingImages }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.imageUrl || null;
  } catch (e) {
    console.warn("[batch-google] search failed", productName, (e as Error).message);
    return null;
  }
}

// Evita custo: manda só as fotos com hash no nome (checagem instantânea) + algumas legadas
function limitExisting(urls: string[]): string[] {
  const hashed = urls.filter((u) => /\/g-[0-9a-f]{32}\./i.test(u));
  const legacy = urls.filter((u) => !/\/g-[0-9a-f]{32}\./i.test(u)).slice(0, 10);
  return [...new Set([...hashed, ...legacy])];
}


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { productIds, tenantId } = await req.json();
    if (!productIds?.length || !tenantId) {
      return new Response(JSON.stringify({ error: "productIds and tenantId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = admin();
    const uniqueIds = [...new Set<string>(productIds)];

    const { data: jobRow } = await supabase
      .from("image_generation_jobs")
      .insert({
        tenant_id: tenantId,
        product_ids: uniqueIds,
        total: uniqueIds.length,
        status: "running",
        message: "Buscando no Google…",
      })
      .select("id")
      .single();
    const jobId = jobRow?.id as string | undefined;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const work = async () => {
      const startedAt = Date.now();
      // Carrega só os que ainda não têm imagem
      const { data: products } = await supabase
        .from("products")
        .select("id, name, category, image")
        .in("id", uniqueIds);
      const pending = (products || []).filter((p: any) => !p.image);

      // Fotos que a loja já usa — nenhuma busca pode repetir nenhuma delas
      const { data: withImages } = await supabase
        .from("products")
        .select("image")
        .eq("tenant_id", tenantId)
        .not("image", "is", null)
        .limit(500);
      const usedImages = new Set<string>(
        (withImages || []).map((p: any) => p.image as string).filter((u) => /^https?:\/\//.test(u)),
      );

      let done = 0;
      let failed = 0;

      let cancelled = false;
      for (let i = 0; i < pending.length; i += PARALLEL) {
        if (Date.now() - startedAt > MAX_RUNTIME_MS) break;
        if (await isCancelled(supabase, jobId)) { cancelled = true; break; }
        const slice = pending.slice(i, i + PARALLEL);
        const results = await Promise.all(
          slice.map(async (p: any) => {
            const url = await searchOne(
              SUPABASE_URL, SERVICE_KEY, p.name, p.category, tenantId,
              limitExisting([...usedImages]),
            );
            if (url) {
              const { error } = await supabase
                .from("products").update({ image: url }).eq("id", p.id);
              if (error) return { ok: false };
              usedImages.add(url);
              return { ok: true };
            }
            return { ok: false };
          }),

        );
        for (const r of results) r.ok ? done++ : failed++;
        if (jobId) await updateJob(supabase, jobId, {
          done, failed,
          message: `Buscando no Google… ${done + failed}/${pending.length}`,
        });
        if (i + PARALLEL < pending.length) await wait(BATCH_DELAY_MS);
      }

      if (cancelled) {
        if (jobId) await updateJob(supabase, jobId, {
          status: "cancelled",
          done, failed,
          message: `Interrompido pelo usuário. ${done} importadas antes de parar.`,
          finished_at: new Date().toISOString(),
          cooldown_until: null,
        });
      } else if (jobId) await updateJob(supabase, jobId, {
        status: failed === 0 ? "done" : (done > 0 ? "done" : "failed"),
        done, failed,
        message: failed === 0
          ? `Concluído: ${done} fotos importadas do Google.`
          : `Importadas ${done}, falharam ${failed}.`,
        finished_at: new Date().toISOString(),
        cooldown_until: null,
      });
    };

    const task = work().catch((e) => {
      console.error("[batch-google] fatal", e);
      if (jobId) updateJob(supabase, jobId, {
        status: "failed",
        message: `Erro: ${(e as Error).message}`,
        finished_at: new Date().toISOString(),
      });
    });
    const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    er?.waitUntil?.(task);

    return new Response(
      JSON.stringify({ started: true, jobId, total: uniqueIds.length }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
