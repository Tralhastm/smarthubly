// Cancela uma corrida Lalamove
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createHmac } from "node:crypto";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const HOST = (sandbox: boolean) =>
  sandbox ? 'https://rest.sandbox.lalamove.com' : 'https://rest.lalamove.com';

function sign(apiKey: string, secret: string, method: string, path: string, body: string) {
  const ts = Date.now().toString();
  const raw = `${ts}\r\n${method}\r\n${path}\r\n\r\n${body}`;
  const sig = createHmac('sha256', secret).update(raw).digest('hex');
  return {
    Authorization: `hmac ${apiKey}:${ts}:${sig}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  } as Record<string, string>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { orderId, revertStatus } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'orderId required' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (!order) throw new Error('Pedido não encontrado');
    const lOrderId = (order as any).lalamove_order_id;
    if (!lOrderId) throw new Error('Pedido sem corrida Lalamove');

    // Pega credenciais — tenta supplier primeiro, depois tenant
    let apiKey: string | null = null;
    let apiSecret: string | null = null;
    let sandbox = false;
    let market = 'BR_SAO';

    const supplierId = (order as any).supplier_id;
    if (supplierId) {
      const { data: sup } = await supabase.from('suppliers')
        .select('lalamove_api_key, lalamove_api_secret, lalamove_sandbox, lalamove_market')
        .eq('id', supplierId).single();
      const s = sup as any;
      if (s?.lalamove_api_key && s?.lalamove_api_secret) {
        apiKey = s.lalamove_api_key; apiSecret = s.lalamove_api_secret;
        sandbox = !!s.lalamove_sandbox; market = s.lalamove_market || market;
      }
    }
    if (!apiKey) {
      const { data: tenant } = await supabase.from('tenants')
        .select('lalamove_api_key, lalamove_api_secret, lalamove_sandbox, lalamove_market')
        .eq('id', order.tenant_id).single();
      const t = tenant as any;
      if (!t?.lalamove_api_key) throw new Error('Sem credenciais Lalamove');
      apiKey = t.lalamove_api_key; apiSecret = t.lalamove_api_secret;
      sandbox = !!t.lalamove_sandbox; market = t.lalamove_market || market;
    }

    const path = `/v3/orders/${lOrderId}`;
    const headers = sign(apiKey!, apiSecret!, 'DELETE', path, '');
    headers['Market'] = market;
    const res = await fetch(`${HOST(sandbox)}${path}`, { method: 'DELETE', headers });

    let respBody: any = null;
    try { respBody = await res.json(); } catch { /* DELETE pode retornar vazio */ }

    if (!res.ok && res.status !== 204) {
      throw new Error(`Lalamove cancel ${res.status}: ${JSON.stringify(respBody)}`);
    }

    const updates: any = {
      lalamove_status: 'CANCELED',
    };
    if (revertStatus) updates.status = revertStatus; // ex: 'preparing'

    await supabase.from('orders').update(updates).eq('id', orderId);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('cancel-lalamove error:', e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
