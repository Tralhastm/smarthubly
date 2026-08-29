// Edge function: solicita entrega via Lalamove API v3
// Docs: https://developers.lalamove.com/
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createHmac } from "node:crypto";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LALAMOVE_API_HOST = (sandbox: boolean) =>
  sandbox ? 'https://rest.sandbox.lalamove.com' : 'https://rest.lalamove.com';

function signLalamove(apiKey: string, secret: string, method: string, path: string, body: string) {
  const timestamp = Date.now().toString();
  const rawSignature = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`;
  const signature = createHmac('sha256', secret).update(rawSignature).digest('hex');
  return {
    Authorization: `hmac ${apiKey}:${timestamp}:${signature}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function extractCep(address: string): string | null {
  if (!address) return null;
  const m = address.match(/(\d{5})-?(\d{3})/);
  return m ? `${m[1]}${m[2]}` : null;
}

function toE164BR(raw: string): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return null;
  const ddd = parseInt(digits.slice(0, 2), 10);
  if (ddd < 11 || ddd > 99) return null;
  return `+55${digits}`;
}

async function geocodePhoton(query: string): Promise<{ lat: string; lng: string } | null> {
  if (!query) return null;
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`;
    const r = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'LovableDelivery/1.0' },
    });
    if (!r.ok) { console.error('photon non-200', r.status); return null; }
    const data = await r.json();
    const feat = data?.features?.[0];
    if (!feat?.geometry?.coordinates) return null;
    const [lng, lat] = feat.geometry.coordinates;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { lat: String(lat), lng: String(lng) };
  } catch (e) { console.error('photon failed', e); return null; }
}

async function geocodeViaBrasilApi(cep: string): Promise<{ lat: string; lng: string } | null> {
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const data = await r.json();
    const coords = data?.location?.coordinates;
    if (coords?.latitude && coords?.longitude) return { lat: String(coords.latitude), lng: String(coords.longitude) };
    const fullAddr = `${data.street || ''}, ${data.neighborhood || ''}, ${data.city || ''}, ${data.state || ''}, Brasil`.trim();
    return await geocodePhoton(fullAddr);
  } catch (e) { console.error('brasilapi failed', e); return null; }
}

async function geocode(address: string): Promise<{ lat: string; lng: string } | null> {
  if (!address) return null;
  const direct = await geocodePhoton(address);
  if (direct) return direct;
  const cep = extractCep(address);
  if (cep) {
    const viaCep = await geocodeViaBrasilApi(cep);
    if (viaCep) return viaCep;
  }
  return null;
}

export async function lalamove_request(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { orderId, supplierId, calledBy } = await req.json();
    // calledBy: 'admin' | 'supplier' | undefined
    // - 'admin' => sempre tenta API da loja, ignora supplier
    // - 'supplier' => usa supplierId passado obrigatoriamente
    // - undefined (legado) => infere por supplierId no body ou supplier_id do pedido
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'orderId required' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: order, error: orderErr } = await supabase
      .from('orders').select('*').eq('id', orderId).single();
    if (orderErr || !order) throw new Error('Order not found');

    const { data: tenant } = await supabase
      .from('tenants').select('*').eq('id', order.tenant_id).single();
    if (!tenant) throw new Error('Tenant not found');

    // Resolve credenciais Lalamove: prioridade = API do fornecedor (se passado supplierId e ele tiver),
    // senão API da loja (se aprovado ou se chamada veio do admin sem supplier).
    let apiKey: string | null = null;
    let apiSecret: string | null = null;
    let market: string = tenant.lalamove_market || 'BR_SAO';
    let sandbox: boolean = !!tenant.lalamove_sandbox;
    let payerValue: 'store' | 'supplier' = 'store';
    let credentialOrigin: 'supplier' | 'store' = 'store';
    let supplier: any = null;

    // Admin da loja: força usar API da loja, mesmo que o pedido tenha supplier_id
    const isAdminCall = calledBy === 'admin';
    const effectiveSupplierId = isAdminCall ? null : (supplierId || order.supplier_id);
    if (effectiveSupplierId) {
      const { data: sup } = await supabase.from('suppliers').select('*').eq('id', effectiveSupplierId).single();
      supplier = sup;
    }

    // Se fornecedor tem API própria, usa
    if (supplier?.lalamove_api_key && supplier?.lalamove_api_secret) {
      apiKey = supplier.lalamove_api_key;
      apiSecret = supplier.lalamove_api_secret;
      market = supplier.lalamove_market || market;
      sandbox = !!supplier.lalamove_sandbox;
      payerValue = 'supplier';
      credentialOrigin = 'supplier';
    } else if (supplier && supplier.lalamove_use_store_api === 'approved') {
      // Fornecedor autorizado a usar API da loja
      if (!tenant.lalamove_enabled) throw new Error('Lalamove não habilitado nesta loja');
      if (!tenant.lalamove_api_key || !tenant.lalamove_api_secret) throw new Error('Credenciais Lalamove da loja não configuradas');
      apiKey = tenant.lalamove_api_key;
      apiSecret = tenant.lalamove_api_secret;
      payerValue = 'store';
      credentialOrigin = 'store';
    } else if (!supplier) {
      // Chamada da loja (admin) sem fornecedor associado
      if (!tenant.lalamove_enabled) throw new Error('Lalamove não habilitado nesta loja');
      if (!tenant.lalamove_api_key || !tenant.lalamove_api_secret) throw new Error('Credenciais Lalamove da loja não configuradas');
      apiKey = tenant.lalamove_api_key;
      apiSecret = tenant.lalamove_api_secret;
      payerValue = 'store';
      credentialOrigin = 'store';
    } else {
      // Fornecedor sem API própria e sem aprovação da loja
      const status = supplier.lalamove_use_store_api;
      if (status === 'pending') throw new Error('Solicitação de uso da API Lalamove da loja ainda está pendente. Aguarde aprovação.');
      if (status === 'revoked') throw new Error('A loja revogou seu acesso à API Lalamove. Cadastre uma API própria ou solicite novamente.');
      throw new Error('Você precisa cadastrar uma API Lalamove própria ou solicitar acesso à API da loja.');
    }

    const pickupAddr = tenant.shipping_origin_address || tenant.address;
    const dropoffAddr = order.customer_address;
    if (!pickupAddr || !dropoffAddr) throw new Error('Endereço de origem ou destino vazio');

    const [pickup, dropoff] = await Promise.all([geocode(pickupAddr), geocode(dropoffAddr)]);
    if (!pickup) throw new Error(`Falha ao localizar endereço da loja: "${pickupAddr}".`);
    if (!dropoff) throw new Error(`Falha ao localizar endereço do cliente: "${dropoffAddr}".`);

    const stops = [
      { coordinates: pickup, address: pickupAddr },
      { coordinates: dropoff, address: dropoffAddr },
    ];

    const quotationBody = JSON.stringify({
      data: {
        serviceType: 'LALAGO',
        language: 'pt_BR',
        stops,
        item: { quantity: '1', weight: 'LESS_THAN_3KG', categories: ['FOOD_DELIVERY'], handlingInstructions: ['KEEP_UPRIGHT'] },
      },
    });

    const quotationPath = '/v3/quotations';
    const quotationHeaders = signLalamove(apiKey!, apiSecret!, 'POST', quotationPath, quotationBody);
    quotationHeaders['Market'] = market;

    const qRes = await fetch(`${LALAMOVE_API_HOST(sandbox)}${quotationPath}`, {
      method: 'POST', headers: quotationHeaders, body: quotationBody,
    });
    const qData = await qRes.json();
    if (!qRes.ok) throw new Error(`Lalamove quotation: ${JSON.stringify(qData)}`);

    const quotationId = qData.data?.quotationId;
    const stopIds = qData.data?.stops?.map((s: any) => s.stopId) || [];
    const priceTotal = qData.data?.priceBreakdown?.total;
    if (!quotationId || stopIds.length < 2) throw new Error('Cotação inválida');

    const senderPhone = toE164BR(supplier?.phone || tenant.phone || tenant.whatsapp || '');
    const recipientPhone = toE164BR(order.customer_phone || '');
    if (!senderPhone) throw new Error('Telefone do remetente inválido (configure em Configurações da loja ou no fornecedor).');
    if (!recipientPhone) throw new Error(`Telefone do cliente inválido: "${order.customer_phone}". Precisa ter DDD + 9 dígitos.`);

    const senderName = supplier?.name || tenant.name;

    const placeBody = JSON.stringify({
      data: {
        quotationId,
        sender: { stopId: stopIds[0], name: senderName, phone: senderPhone },
        recipients: [{ stopId: stopIds[1], name: order.customer_name, phone: recipientPhone, remarks: `Pedido #${order.id.slice(0, 6)}` }],
      },
    });
    const placePath = '/v3/orders';
    const placeHeaders = signLalamove(apiKey!, apiSecret!, 'POST', placePath, placeBody);
    placeHeaders['Market'] = market;

    const pRes = await fetch(`${LALAMOVE_API_HOST(sandbox)}${placePath}`, {
      method: 'POST', headers: placeHeaders, body: placeBody,
    });
    const pData = await pRes.json();
    if (!pRes.ok) {
      const firstErr = pData?.errors?.[0];
      if (firstErr?.id === 'ERR_INSUFFICIENT_CREDIT') {
        const wallet = credentialOrigin === 'supplier' ? 'sua carteira Lalamove' : 'a carteira Lalamove da loja';
        throw new Error(`Saldo insuficiente em ${wallet}. Adicione crédito no painel Lalamove para acionar entregas.`);
      }
      throw new Error(`Lalamove: ${firstErr?.message || JSON.stringify(pData)}`);
    }

    const lOrderId = pData.data?.orderId;
    const shareLink = pData.data?.shareLink;

    await supabase.from('orders').update({
      lalamove_order_id: lOrderId,
      lalamove_status: pData.data?.status || 'ASSIGNING_DRIVER',
      lalamove_share_link: shareLink,
      lalamove_price: priceTotal ? parseFloat(priceTotal) : null,
      lalamove_payer: payerValue,
    } as any).eq('id', orderId);

    await supabase.from('order_events').insert({
      order_id: orderId,
      tenant_id: order.tenant_id,
      event_type: 'lalamove_dispatched',
      to_status: 'out-for-delivery',
      actor: credentialOrigin === 'supplier' ? 'supplier' : 'system',
      description: `Lalamove acionada via API ${credentialOrigin === 'supplier' ? 'do fornecedor' : 'da loja'} — preço R$${priceTotal || '?'} (paga: ${payerValue === 'supplier' ? 'fornecedor' : 'loja'}), link: ${shareLink || 'n/a'}`,
      metadata: { lalamove_order_id: lOrderId, share_link: shareLink, price: priceTotal, payer: payerValue, credential_origin: credentialOrigin },
    } as any);

    return new Response(JSON.stringify({
      success: true, lalamoveOrderId: lOrderId, shareLink, price: priceTotal, payer: payerValue, credentialOrigin,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e: any) {
    console.error('Lalamove error:', e);
    // Retorna 200 com { error } para que o client consiga ler a mensagem específica
    // (com status 500, supabase-js descarta o body e mostra "Edge Function returned a non-2xx status code")
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  } catch (e) {
    console.error("[unified:lalamove-request] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
