// Edge function: consulta status de uma corrida Lalamove e atualiza no banco
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
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { orderId } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'orderId required' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (!order || !(order as any).lalamove_order_id) throw new Error('Pedido sem corrida Lalamove');

    const { data: tenant } = await supabase.from('tenants').select('*').eq('id', order.tenant_id).single();
    if (!tenant) throw new Error('Tenant não encontrado');

    const lOrderId = (order as any).lalamove_order_id;

    // 1) Detalhes do pedido
    const orderPath = `/v3/orders/${lOrderId}`;
    const orderHeaders = sign(tenant.lalamove_api_key, tenant.lalamove_api_secret, 'GET', orderPath, '');
    orderHeaders['Market'] = tenant.lalamove_market || 'BR_SAO';
    const oRes = await fetch(`${HOST(tenant.lalamove_sandbox)}${orderPath}`, { headers: orderHeaders });
    const oData = await oRes.json();
    if (!oRes.ok) throw new Error(`Lalamove get order: ${JSON.stringify(oData)}`);

    const status = oData.data?.status;
    const driverId = oData.data?.driverId;
    const shareLink = oData.data?.shareLink;

    let driverName = (order as any).lalamove_driver_name;
    let driverPhone = (order as any).lalamove_driver_phone;
    let driverPlate = (order as any).lalamove_driver_plate;

    // 2) Se tem motorista, busca info dele
    if (driverId) {
      const driverPath = `/v3/orders/${lOrderId}/drivers/${driverId}`;
      const dHeaders = sign(tenant.lalamove_api_key, tenant.lalamove_api_secret, 'GET', driverPath, '');
      dHeaders['Market'] = tenant.lalamove_market || 'BR_SAO';
      const dRes = await fetch(`${HOST(tenant.lalamove_sandbox)}${driverPath}`, { headers: dHeaders });
      const dData = await dRes.json();
      if (dRes.ok) {
        driverName = dData.data?.name || driverName;
        driverPhone = dData.data?.phone || driverPhone;
        driverPlate = dData.data?.plateNumber || driverPlate;
      }
    }

    // Update banco
    const updates: any = { lalamove_status: status, lalamove_share_link: shareLink || (order as any).lalamove_share_link };
    if (driverName) updates.lalamove_driver_name = driverName;
    if (driverPhone) updates.lalamove_driver_phone = driverPhone;
    if (driverPlate) updates.lalamove_driver_plate = driverPlate;
    if (status === 'COMPLETED') updates.status = 'delivered';

    await supabase.from('orders').update(updates).eq('id', orderId);

    return new Response(JSON.stringify({ success: true, status, shareLink, driverName, driverPhone, driverPlate }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('Lalamove status error:', e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
