// Edge function: marca motoboy online/offline.
// Aceita POST com { token, online }. Usado pelo painel do motoboy via fetch normal
// E TAMBÉM via navigator.sendBeacon no beforeunload (que não suporta custom headers nem
// permite Promises pendentes — sendBeacon garante envio mesmo quando aba fecha).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export async function driver_online(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // sendBeacon envia Blob com type 'application/json' — req.json() funciona.
    // Caso venha como text/plain (alguns browsers) tentamos parse manual.
    let body: any;
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      body = await req.json();
    } else {
      const text = await req.text();
      try { body = JSON.parse(text); } catch { body = {}; }
    }

    const { token, online } = body;
    if (!token || typeof online !== 'boolean') {
      return new Response(JSON.stringify({ error: 'token e online obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: driver, error: dErr } = await supabase
      .from('drivers').select('id, active').eq('access_token', token).maybeSingle();

    if (dErr || !driver || !driver.active) {
      return new Response(JSON.stringify({ error: 'motoboy não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const update: any = { is_online: online };
    if (online) update.last_online_at = new Date().toISOString();

    const { error: upErr } = await supabase.from('drivers').update(update).eq('id', driver.id);
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('set-driver-online error', e);
    return new Response(JSON.stringify({ error: e?.message || 'erro interno' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  } catch (e) {
    console.error("[unified:driver-online] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
