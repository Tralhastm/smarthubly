// Edge function para validar e testar um generated_worker.
// - Detecta se o link colado é Supabase / Lovable
// - Extrai project_ref
// - Faz um ping real na edge function (ai-chat / ai-parse-txt / ai-generate-image)
// - Mede latência, classifica erro (captcha, quota, invalid, not_supabase...)
// - Atualiza generated_workers + insere em worker_test_logs
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type WorkerType = 'chat' | 'txt' | 'image';

const ENDPOINT_BY_TYPE: Record<WorkerType, string> = {
  chat: '/functions/v1/ai-chat',
  txt: '/functions/v1/ai-parse-txt',
  image: '/functions/v1/ai-generate-image',
};

const SAMPLE_BODY: Record<WorkerType, unknown> = {
  chat: { messages: [{ role: 'user', content: 'ping' }], model: 'google/gemini-2.5-flash' },
  txt: { text: 'teste ping', mode: 'extract' },
  image: { prompt: 'red circle on white', size: '512x512' },
};

function classify(linkRaw: string): { kind: 'supabase' | 'lovable' | 'unknown'; project_ref?: string; base?: string } {
  try {
    const u = new URL(linkRaw.trim());
    const host = u.hostname.toLowerCase();
    // https://<ref>.supabase.co/functions/v1/...
    const supaMatch = host.match(/^([a-z0-9]{20,})\.supabase\.co$/);
    if (supaMatch) {
      return { kind: 'supabase', project_ref: supaMatch[1], base: `https://${host}` };
    }
    // https://<slug>.lovable.app/ — também aceita
    if (host.endsWith('.lovable.app') || host.endsWith('.lovableproject.com')) {
      return { kind: 'lovable', base: `https://${host}` };
    }
    return { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { generated_worker_id } = await req.json();
    if (!generated_worker_id) {
      return new Response(JSON.stringify({ error: 'generated_worker_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(SUPA_URL, SERVICE_KEY);

    const { data: gw, error: gwErr } = await admin
      .from('generated_workers')
      .select('*')
      .eq('id', generated_worker_id)
      .maybeSingle();
    if (gwErr || !gw) {
      return new Response(JSON.stringify({ error: 'worker not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const link = (gw.supabase_project_url || gw.lovable_project_url || gw.base_url || '').trim();
    if (!link) {
      await admin.from('generated_workers').update({
        status: 'error', error_code: 'invalid_link', error_message: 'Nenhum link informado',
      }).eq('id', gw.id);
      return new Response(JSON.stringify({ ok: false, error_code: 'invalid_link' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const c = classify(link);
    if (c.kind === 'unknown') {
      await admin.from('generated_workers').update({
        status: 'error', error_code: 'not_supabase', error_message: 'Link não é Supabase nem Lovable',
      }).eq('id', gw.id);
      await admin.from('worker_test_logs').insert({
        generated_worker_id: gw.id, test_type: 'link_validation', success: false,
        error_message: 'Link inválido (não Supabase/Lovable)',
      });
      return new Response(JSON.stringify({ ok: false, error_code: 'not_supabase' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const type = (gw.worker_type as WorkerType) || 'chat';
    const baseUrl = c.base + ENDPOINT_BY_TYPE[type];

    // Ping real
    const t0 = Date.now();
    let httpStatus = 0;
    let respText = '';
    let success = false;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    try {
      const r = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SAMPLE_BODY[type]),
        signal: AbortSignal.timeout(20000),
      });
      httpStatus = r.status;
      respText = (await r.text()).slice(0, 500);
      if (r.ok) {
        success = true;
      } else if (r.status === 429 || r.status === 402) {
        errorCode = 'quota'; errorMessage = `HTTP ${r.status} — quota esgotada`;
      } else if (r.status === 401 || r.status === 403) {
        errorCode = 'auth'; errorMessage = `HTTP ${r.status} — auth bloqueada`;
      } else if (respText.toLowerCase().includes('captcha')) {
        errorCode = 'captcha'; errorMessage = 'Captcha detectado';
      } else {
        errorCode = 'unknown'; errorMessage = `HTTP ${r.status}: ${respText.slice(0, 120)}`;
      }
    } catch (e: any) {
      errorCode = e?.name === 'TimeoutError' ? 'timeout' : 'unknown';
      errorMessage = e?.message || 'fetch failed';
    }
    const latency = Date.now() - t0;

    await admin.from('worker_test_logs').insert({
      generated_worker_id: gw.id,
      test_type: 'real_call',
      success,
      latency_ms: latency,
      http_status: httpStatus,
      response_sample: respText,
      error_message: errorMessage,
    });

    await admin.from('generated_workers').update({
      base_url: baseUrl,
      status: success ? 'ready' : 'error',
      current_step: success ? 'done' : gw.current_step,
      progress_percent: success ? 100 : Math.max(gw.progress_percent || 0, 80),
      test_passed: success,
      test_latency_ms: latency,
      test_response_sample: respText,
      last_test_at: new Date().toISOString(),
      error_code: success ? null : errorCode,
      error_message: success ? null : errorMessage,
      metadata: { ...(gw.metadata || {}), project_ref: c.project_ref, kind: c.kind },
    }).eq('id', gw.id);

    return new Response(JSON.stringify({
      ok: success, latency_ms: latency, http_status: httpStatus,
      error_code: errorCode, error_message: errorMessage, base_url: baseUrl,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'unknown' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
