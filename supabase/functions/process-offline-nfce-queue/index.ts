// Processa fila offline de NFC-e: tenta emitir cada item pendente via emit-nfce.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { tenantId } = await req.json();
    if (!tenantId) return json({ ok: false, error: 'tenantId obrigatório' }, 400);

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: queued } = await supa
      .from('fiscal_offline_queue')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'queued')
      .order('enqueued_at', { ascending: true })
      .limit(50);

    const results: any[] = [];
    for (const item of queued || []) {
      await supa.from('fiscal_offline_queue').update({ status: 'processing', attempts: (item.attempts || 0) + 1 }).eq('id', item.id);
      try {
        if (!item.order_id) throw new Error('order_id ausente');
        const { data: emit, error: emitErr } = await supa.functions.invoke('emit-nfce', {
          body: { orderId: item.order_id, tenantId },
        });
        if (emitErr || !emit?.ok) throw new Error(emitErr?.message || emit?.error || 'falha emissão');
        await supa.from('fiscal_offline_queue').update({
          status: 'emitted', processed_at: new Date().toISOString(),
          emitted_invoice_id: emit.invoiceId ?? null, last_error: null,
        }).eq('id', item.id);
        results.push({ id: item.id, ok: true });
      } catch (e: any) {
        await supa.from('fiscal_offline_queue').update({
          status: 'failed', last_error: String(e?.message || e),
        }).eq('id', item.id);
        results.push({ id: item.id, ok: false, error: String(e?.message || e) });
      }
    }
    return json({ ok: true, processed: results.length, results });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
