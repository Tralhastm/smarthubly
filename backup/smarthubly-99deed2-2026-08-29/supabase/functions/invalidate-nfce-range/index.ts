// Inutiliza um intervalo de numeração NFC-e (quando há "buracos" na sequência).
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { cancellationId, tenantId } = await req.json();
    if (!cancellationId || !tenantId) return json({ ok: false, error: 'parâmetros faltando' }, 400);

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: row } = await supa.from('fiscal_cancellations').select('*').eq('id', cancellationId).maybeSingle();
    if (!row) return json({ ok: false, error: 'não encontrado' }, 404);

    // Stub: marca como sucesso. Plugar aqui o provedor real (webmania/plugnotas/focusnfe).
    const protocolo = `INUT-${Date.now()}`;
    await supa.from('fiscal_cancellations').update({ status: 'success', protocolo }).eq('id', cancellationId);
    return json({ ok: true, protocolo });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
