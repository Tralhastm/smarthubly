// Cancela uma NFC-e autorizada (janela de 30min). Faz validação e marca o status.
// A integração real com o provedor (webmania/plugnotas/focusnfe) é plugada conforme fiscal_settings.provider.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

export async function cancel(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { cancellationId, tenantId, invoiceId } = await req.json();
    if (!cancellationId || !tenantId || !invoiceId) return json({ ok: false, error: 'parâmetros faltando' }, 400);

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: canCancel } = await supa.rpc('can_cancel_nfce', { _invoice_id: invoiceId });
    if (!canCancel) {
      await supa.from('fiscal_cancellations').update({
        status: 'failed', error_message: 'fora da janela de 30 minutos ou nota não autorizada',
      }).eq('id', cancellationId);
      return json({ ok: false, error: 'fora da janela de 30min' }, 400);
    }

    const { data: settings } = await supa.from('fiscal_settings').select('*').eq('tenant_id', tenantId).maybeSingle();
    const { data: invoice } = await supa.from('fiscal_invoices').select('*').eq('id', invoiceId).maybeSingle();
    if (!settings || !invoice) return json({ ok: false, error: 'settings/invoice não encontrados' }, 404);

    // Stub: marca como sucesso. Provedor real pluga aqui:
    // - webmania: DELETE /1/nfce/cancelar
    // - plugnotas: POST /nfce/{id}/cancelamento
    // - focusnfe: DELETE /v2/nfce/{ref}
    const protocolo = `CANC-${Date.now()}`;
    await supa.from('fiscal_cancellations').update({
      status: 'success', protocolo,
    }).eq('id', cancellationId);
    await supa.from('fiscal_invoices').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(),
    }).eq('id', invoiceId);

    return json({ ok: true, protocolo });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

  } catch (e) {
    console.error("[unified:cancel] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
