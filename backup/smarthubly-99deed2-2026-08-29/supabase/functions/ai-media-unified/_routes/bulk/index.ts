import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// === Tuning ===
const PARALLEL_REQUESTS = 3;       // imagens simultâneas (não saturar Lovable AI)
const MAX_ATTEMPTS = 5;             // tentativas por produto antes de desistir
const BATCH_DELAY_MS = 400;         // pausa entre batches dentro de uma rodada
const COOLDOWN_QUOTA_MS = 5 * 60_000; // 5 min de cooldown se TODOS providers caírem
const COOLDOWN_GENERIC_MS = 30_000;   // 30s entre rodadas de retry "comuns"
const MAX_TOTAL_RUNTIME_MS = 25 * 60_000; // 25 min de teto pra job inteiro

type ProductSummary = { id: string; name: string; category: string | null; image: string | null };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function fetchPendingProducts(supabase: any, productIds: string[]): Promise<ProductSummary[]> {
  if (productIds.length === 0) return [];
  const { data, error } = await supabase
    .from("products")
    .select("id, name, category, image")
    .in("id", productIds);
  if (error) throw error;
  return ((data || []) as ProductSummary[]).filter((p) => !p.image);
}

type GenResult = { ok: boolean; reason: string };

async function generateImageForProduct(
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
  tenantId: string,
  product: ProductSummary,
): Promise<GenResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000); // 90s teto por imagem
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/generate-product-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
      body: JSON.stringify({ productName: product.name, category: product.category, tenantId }),
      signal: ctrl.signal,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const reason = body?.reason || `http_${response.status}`;
      console.warn(`Generate image failed for ${product.id}: ${response.status} reason=${reason}`);
      return { ok: false, reason };
    }
    const data = await response.json();
    if (!data?.imageUrl) return { ok: false, reason: 'no_image_returned' };

    const { error } = await supabase
      .from("products")
      .update({ image: data.imageUrl })
      .eq("id", product.id);
    if (error) {
      console.error(`Failed to save image for ${product.id}:`, error);
      return { ok: false, reason: 'db_error' };
    }
    return { ok: true, reason: 'ok' };
  } catch (e: any) {
    console.warn(`generateImage threw for ${product.id}:`, e?.message || e);
    return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : 'exception' };
  } finally {
    clearTimeout(timer);
  }
}

function describeReason(reason: string): string {
  switch (reason) {
    case 'all_quota_exhausted':
      return 'Todos os provedores estão sem cota. Aguardando reset (5 min)…';
    case 'lovable_credit':
      return 'Lovable AI sem crédito. Adicione em Settings → Workspace → Usage.';
    case 'google_quota':
      return 'Cota das chaves Google esgotada (reseta diariamente).';
    case 'workers_exhausted':
      return 'Todos os workers paralelos exauridos no momento.';
    case 'no_provider':
      return 'Nenhum provedor de IA configurado.';
    case 'timeout':
      return 'Timeout na geração — provedor demorou demais.';
    default:
      return `Falha: ${reason}`;
  }
}

async function updateJob(supabase: any, jobId: string, fields: Record<string, any>) {
  await supabase
    .from('image_generation_jobs')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', jobId);
}

async function isCancelled(supabase: any, jobId: string | undefined): Promise<boolean> {
  if (!jobId) return false;
  const { data } = await supabase
    .from('image_generation_jobs')
    .select('status')
    .eq('id', jobId)
    .maybeSingle();
  return data?.status === 'cancelled';
}

export async function bulk_route(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { productIds, tenantId } = await req.json();
    if (!productIds?.length || !tenantId) {
      return new Response(JSON.stringify({ error: "productIds and tenantId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getSupabaseAdmin();
    const uniqueIds = [...new Set(productIds)] as string[];

    // Cria registro de job
    const { data: jobRow, error: jobErr } = await supabase
      .from('image_generation_jobs')
      .insert({
        tenant_id: tenantId,
        product_ids: uniqueIds,
        total: uniqueIds.length,
        status: 'running',
        message: 'Iniciando…',
      })
      .select('id')
      .single();
    if (jobErr) {
      console.error('Failed to create job row:', jobErr);
    }
    const jobId = jobRow?.id as string | undefined;

    const processImages = async () => {
      const startedAt = Date.now();
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";

      let remainingIds = [...uniqueIds];
      let doneCount = 0;
      let failedCount = 0;

      let cancelled = false;

      for (let attempt = 0; attempt < MAX_ATTEMPTS && remainingIds.length > 0; attempt++) {
        if (Date.now() - startedAt > MAX_TOTAL_RUNTIME_MS) {
          console.warn('Job exceeded max runtime, aborting');
          break;
        }
        if (await isCancelled(supabase, jobId)) { cancelled = true; break; }

        const pending = await fetchPendingProducts(supabase, remainingIds);
        if (pending.length === 0) { remainingIds = []; break; }

        // Atualiza UI: nova rodada
        if (jobId) await updateJob(supabase, jobId, {
          done: doneCount, failed: failedCount,
          status: 'running', reason: '',
          message: `Rodada ${attempt + 1}/${MAX_ATTEMPTS} — ${pending.length} pendentes`,
          cooldown_until: null,
        });

        console.log(`Round ${attempt + 1}: processing ${pending.length} products`);

        const failedThisRound: string[] = [];
        const reasonCounts: Record<string, number> = {};

        for (let i = 0; i < pending.length; i += PARALLEL_REQUESTS) {
          if (await isCancelled(supabase, jobId)) { cancelled = true; break; }
          const slice = pending.slice(i, i + PARALLEL_REQUESTS);
          const results = await Promise.all(
            slice.map((p) => generateImageForProduct(supabase, SUPABASE_URL, SUPABASE_ANON_KEY, tenantId, p)
              .then(r => ({ ...r, productId: p.id }))),
          );
          for (const r of results) {
            if (r.ok) doneCount++;
            else {
              failedThisRound.push(r.productId);
              reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1;
            }
          }
          // Atualiza progresso a cada batch
          if (jobId) await updateJob(supabase, jobId, { done: doneCount, failed: failedThisRound.length });

          if (i + PARALLEL_REQUESTS < pending.length) await wait(BATCH_DELAY_MS);
        }
        if (cancelled) break;

        remainingIds = failedThisRound;
        if (remainingIds.length === 0) break;

        // Detecta "todos os providers caíram" — se >70% das falhas são quota, faz cooldown longo
        const quotaReasons = ['all_quota_exhausted', 'lovable_credit', 'google_quota', 'workers_exhausted', 'no_provider', 'lovable_rate'];
        const quotaFails = quotaReasons.reduce((acc, k) => acc + (reasonCounts[k] || 0), 0);
        const isQuotaWipe = quotaFails / failedThisRound.length >= 0.7;

        const dominantReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

        if (isQuotaWipe && attempt < MAX_ATTEMPTS - 1) {
          const until = new Date(Date.now() + COOLDOWN_QUOTA_MS).toISOString();
          if (jobId) await updateJob(supabase, jobId, {
            status: 'cooling_down',
            reason: dominantReason,
            message: describeReason(dominantReason),
            cooldown_until: until,
            failed: failedThisRound.length,
          });
          console.log(`Quota wipe detected (${dominantReason}). Cooling down ${COOLDOWN_QUOTA_MS}ms.`);
          // Re-habilita workers/keys exhausted para a próxima rodada (talvez já tenha resetado)
          await supabase.from('ai_workers').update({ is_exhausted: false }).eq('is_exhausted', true);
          await supabase.from('api_keys').update({ is_exhausted: false }).eq('is_exhausted', true);
          await wait(COOLDOWN_QUOTA_MS);
        } else if (attempt < MAX_ATTEMPTS - 1) {
          const backoff = COOLDOWN_GENERIC_MS * (attempt + 1); // 30s, 60s, 90s, …
          if (jobId) await updateJob(supabase, jobId, {
            status: 'running',
            reason: dominantReason,
            message: `${failedThisRound.length} falharam (${describeReason(dominantReason)}). Retentando em ${Math.round(backoff/1000)}s…`,
            cooldown_until: new Date(Date.now() + backoff).toISOString(),
          });
          console.log(`Generic retry: waiting ${backoff}ms before round ${attempt + 2}`);
          await wait(backoff);
        }

        failedCount = failedThisRound.length;
      }

      const finalStatus = cancelled ? 'cancelled' : (remainingIds.length === 0 ? 'done' : 'failed');
      if (jobId) await updateJob(supabase, jobId, {
        status: finalStatus,
        done: doneCount,
        failed: remainingIds.length,
        message: cancelled
          ? `Interrompido pelo usuário. ${doneCount} geradas antes de parar.`
          : (finalStatus === 'done'
              ? `Concluído: ${doneCount} imagens geradas.`
              : `Parou com ${remainingIds.length} pendentes após ${MAX_ATTEMPTS} rodadas.`),
        finished_at: new Date().toISOString(),
        cooldown_until: null,
      });

      console.log(`Job ${jobId} finished: done=${doneCount} failed=${remainingIds.length} elapsed=${Date.now() - startedAt}ms`);
    };

    const backgroundTask = processImages().catch((e) => {
      console.error("Background processing error:", e);
      if (jobId) updateJob(supabase, jobId, { status: 'failed', message: `Erro fatal: ${e?.message || e}`, finished_at: new Date().toISOString() });
    });
    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    edgeRuntime?.waitUntil?.(backgroundTask);

    return new Response(
      JSON.stringify({ started: true, jobId, total: uniqueIds.length, parallel: PARALLEL_REQUESTS }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  } catch (e) {
    console.error("[unified:bulk] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
