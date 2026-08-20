// Edge function: emite NFC-e via gateway fiscal (WebmaniaBR por padrão).
// Genérica o suficiente pra trocar de provider depois.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getAuthUser, isTenantAdmin } from "../../../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface EmitRequest {
  orderId: string;
  tenantId: string;
}

export async function emit(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { orderId, tenantId } = (await req.json()) as EmitRequest;
    if (!orderId || !tenantId) {
      return json({ ok: false, error: "orderId e tenantId são obrigatórios" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 🔐 Auth: tenant admin required
    const user = await getAuthUser(req);
    if (!user) return json({ ok: false, error: "Não autenticado" }, 401);
    if (!(await isTenantAdmin(supabase, user.id, tenantId))) {
      return json({ ok: false, error: "Sem permissão" }, 403);
    }

    // 🔒 Advisory lock: impede emissão simultânea pro mesmo pedido (retry/double-click)
    const { data: gotLock } = await supabase.rpc("acquire_nfce_lock", { _order_id: orderId });
    if (gotLock === false) {
      return json({ ok: false, error: "Emissão já em andamento para este pedido. Aguarde alguns segundos." }, 409);
    }


    // 1) Busca configuração fiscal
    const { data: settings, error: sErr } = await supabase
      .from("fiscal_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (sErr || !settings) {
      return json({ ok: false, error: "Configuração fiscal não encontrada. Configure na aba Fiscal." }, 400);
    }
    if (!settings.enabled) {
      return json({ ok: false, error: "Emissão fiscal desativada para esta loja." }, 400);
    }

    // 2) Busca pedido + itens
    const { data: order, error: oErr } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (oErr || !order) return json({ ok: false, error: "Pedido não encontrado" }, 404);

    // 3) Já emitida?
    const { data: existing } = await supabase
      .from("fiscal_invoices")
      .select("id, status, chave_acesso, pdf_url")
      .eq("order_id", orderId)
      .in("status", ["authorized", "processing"])
      .maybeSingle();

    if (existing) {
      return json({ ok: true, alreadyEmitted: true, invoice: existing });
    }

    // 4) Cria registro pendente
    const { data: invoice, error: invErr } = await supabase
      .from("fiscal_invoices")
      .insert({
        tenant_id: tenantId,
        order_id: orderId,
        provider: settings.provider,
        environment: settings.environment,
        tipo: "nfce",
        status: "processing",
        total: order.total,
      })
      .select("id")
      .single();

    if (invErr) throw invErr;

    // 5) Chama o provider
    let providerResult: any;
    try {
      if (settings.provider === "webmania") {
        providerResult = await emitViaWebmania(settings, order);
      } else if (settings.provider === "plugnotas") {
        providerResult = await emitViaPlugNotas(settings, order);
      } else if (settings.provider === "focusnfe") {
        providerResult = await emitViaFocusNFe(settings, order);
      } else if (settings.provider === "nfeio") {
        providerResult = await emitViaNfeIO(settings, order);
      } else {
        throw new Error(`Provider não suportado: ${settings.provider}`);
      }
    } catch (e: any) {
      await supabase
        .from("fiscal_invoices")
        .update({
          status: "rejected",
          error_message: e.message || String(e),
          provider_response: { error: e.message || String(e) },
        })
        .eq("id", invoice.id);
      return json({ ok: false, error: e.message || "Erro no provider", invoiceId: invoice.id }, 500);
    }

    // 6) Atualiza com retorno
    await supabase
      .from("fiscal_invoices")
      .update({
        status: providerResult.status,
        numero: providerResult.numero,
        serie: providerResult.serie,
        chave_acesso: providerResult.chave_acesso,
        protocolo: providerResult.protocolo,
        xml_url: providerResult.xml_url,
        pdf_url: providerResult.pdf_url,
        qr_code: providerResult.qr_code,
        emitted_at: new Date().toISOString(),
        provider_response: providerResult.raw,
        error_message: providerResult.error,
      })
      .eq("id", invoice.id);

    return json({ ok: true, invoiceId: invoice.id, ...providerResult });
  } catch (e: any) {
    console.error("emit-nfce error", e);
    return json({ ok: false, error: e.message || "Erro interno" }, 500);
  }

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
async function emitViaWebmania(settings: any, order: any) {
  const base = settings.environment === "production"
    ? "https://api.webmaniabr.com/2/nfce"
    : "https://homologacao.webmaniabr.com/2/nfce"; // WebmaniaBR usa mesma URL com flag ambiente

  const items = (order.order_items || []).map((it: any, i: number) => ({
    nome: it.product_name,
    codigo: String(i + 1),
    ncm: settings.ncm_padrao || "22030000",
    cfop: settings.cfop_padrao || "5102",
    unidade_comercial: settings.unidade_padrao || "UN",
    quantidade_comercial: it.quantity,
    valor_unitario_comercial: Number(it.product_price),
    unidade_tributavel: settings.unidade_padrao || "UN",
    quantidade_tributavel: it.quantity,
    valor_unitario_tributavel: Number(it.product_price),
    origem: Number(settings.origem_padrao || 0),
    icms_situacao_tributaria: settings.csosn_padrao || "102",
  }));

  const payload = {
    ID: order.id,
    operacao: 1,
    natureza_operacao: "Venda ao consumidor",
    modelo: 1, // 1 = NFC-e
    finalidade: 1,
    ambiente: settings.environment === "production" ? 1 : 2,
    presenca: 1,
    cliente: {
      nome_completo: order.customer_name || "Consumidor",
      cpf: order.customer_cpf || undefined,
    },
    produtos: items,
    pedido: {
      pagamento: 0, // 0 = à vista
      forma_pagamento: mapPaymentWebmania(order.payment_method),
      modalidade_frete: 9,
      valor_total: Number(order.total),
      valor_produtos: Number(order.total),
    },
  };

  const r = await fetch(`${base}/emissao`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Consumer-Key": settings.consumer_key,
      "X-Consumer-Secret": settings.consumer_secret,
      "X-Access-Token": settings.access_token,
      "X-Access-Token-Secret": settings.access_token_secret,
    },
    body: JSON.stringify(payload),
  });
  const raw = await r.json();

  if (!r.ok || raw.error) {
    return {
      status: "rejected",
      error: raw.error?.[0]?.error || raw.error || `HTTP ${r.status}`,
      raw,
    };
  }

  return {
    status: "authorized",
    numero: raw.nfe ? parseInt(String(raw.nfe).slice(-9), 10) : null,
    serie: 1,
    chave_acesso: raw.chave || raw.nfe,
    protocolo: raw.protocolo,
    xml_url: raw.xml,
    pdf_url: raw.danfe,
    qr_code: raw.qrcode_url || raw.qrcode,
    raw,
  };
}
function mapPaymentWebmania(method: string) {
  const m = (method || "").toLowerCase();
  if (m === "pix") return "17";
  if (m === "dinheiro") return "01";
  if (m === "credit_card") return "03";
  if (m === "debit_card") return "04";
  if (m === "fiado") return "05";
  return "99"; // outros
}
async function emitViaPlugNotas(_settings: any, _order: any) {
  throw new Error("Provider PlugNotas: implementação futura. Use WebmaniaBR por enquanto.");
}
async function emitViaFocusNFe(settings: any, order: any) {
  // Focus NFe usa Basic Auth: token como username, senha vazia.
  // Token fica salvo em settings.access_token (reaproveitando coluna existente).
  const token = settings.access_token;
  if (!token) throw new Error("Token Focus NFe não configurado (campo Access Token).");

  const base = settings.environment === "production"
    ? "https://api.focusnfe.com.br/v2/nfce"
    : "https://homologacao.focusnfe.com.br/v2/nfce";

  const ref = `order-${order.id}`;
  const auth = "Basic " + btoa(`${token}:`);

  // Mapeia itens
  const items = (order.order_items || []).map((it: any, i: number) => ({
    numero_item: i + 1,
    codigo_produto: String(i + 1),
    descricao: it.product_name,
    cfop: settings.cfop_padrao || "5102",
    unidade_comercial: settings.unidade_padrao || "UN",
    quantidade_comercial: Number(it.quantity),
    valor_unitario_comercial: Number(it.product_price).toFixed(2),
    valor_bruto: (Number(it.quantity) * Number(it.product_price)).toFixed(2),
    unidade_tributavel: settings.unidade_padrao || "UN",
    quantidade_tributavel: Number(it.quantity),
    valor_unitario_tributavel: Number(it.product_price).toFixed(2),
    origem: Number(settings.origem_padrao || 0),
    icms_situacao_tributaria: settings.csosn_padrao || "102",
    ncm: settings.ncm_padrao || "22030000",
    icms_origem: Number(settings.origem_padrao || 0),
    pis_situacao_tributaria: "49",
    cofins_situacao_tributaria: "49",
  }));

  // Mapeia método de pagamento Focus NFe (códigos SEFAZ)
  const formaPagamento = mapPaymentFocus(order.payment_method);

  const payload: any = {
    natureza_operacao: "Venda ao consumidor",
    data_emissao: new Date().toISOString(),
    tipo_documento: 1, // saída
    presenca_comprador: 1, // presencial
    consumidor_final: 1,
    modalidade_frete: 9, // sem frete
    local_destino: 1,
    cnpj_emitente: (settings.cnpj || "").replace(/\D/g, ""),
    items,
    formas_pagamento: [{
      forma_pagamento: formaPagamento,
      valor_pagamento: Number(order.total).toFixed(2),
    }],
  };

  if (order.customer_cpf) {
    payload.cpf_destinatario = String(order.customer_cpf).replace(/\D/g, "");
    payload.nome_destinatario = order.customer_name || "Consumidor";
  }

  const r = await fetch(`${base}?ref=${encodeURIComponent(ref)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify(payload),
  });

  const raw = await r.json().catch(() => ({}));

  // Focus retorna 202 (processando) ou 200 (autorizada na hora). Erros em 4xx.
  if (!r.ok && r.status !== 202) {
    const msg = raw?.mensagem || raw?.erros?.[0]?.mensagem || `HTTP ${r.status}`;
    return { status: "rejected", error: msg, raw };
  }

  // Se ainda processando, consulta o status (tentativa única — botão pode reemitir)
  let statusData = raw;
  if (raw.status === "processando_autorizacao" || r.status === 202) {
    await new Promise((res) => setTimeout(res, 1500));
    const q = await fetch(`${base}?ref=${encodeURIComponent(ref)}`, {
      headers: { Authorization: auth },
    });
    statusData = await q.json().catch(() => raw);
  }

  if (statusData.status === "autorizado") {
    return {
      status: "authorized",
      numero: statusData.numero ? Number(statusData.numero) : null,
      serie: statusData.serie ? Number(statusData.serie) : (settings.serie_nfce || 1),
      chave_acesso: statusData.chave_nfe,
      protocolo: statusData.protocolo,
      xml_url: statusData.caminho_xml_nota_fiscal ? `https://focusnfe.com.br${statusData.caminho_xml_nota_fiscal}` : null,
      pdf_url: statusData.caminho_danfe ? `https://focusnfe.com.br${statusData.caminho_danfe}` : null,
      qr_code: statusData.qrcode_url || null,
      raw: statusData,
    };
  }

  return {
    status: statusData.status === "processando_autorizacao" ? "processing" : "rejected",
    error: statusData.mensagem_sefaz || statusData.mensagem || "Status: " + (statusData.status || "desconhecido"),
    raw: statusData,
  };
}
function mapPaymentFocus(method: string) {
  const m = (method || "").toLowerCase();
  if (m === "dinheiro") return "01";
  if (m === "credit_card" || m === "cartao_credito") return "03";
  if (m === "debit_card" || m === "cartao_debito") return "04";
  if (m === "fiado") return "05";
  if (m === "pix") return "17";
  return "99";
}
async function emitViaNfeIO(settings: any, order: any) {
  const apiKey = settings.access_token;
  const companyId = settings.nfeio_company_id;
  if (!apiKey) throw new Error("API Key NFE.io não configurada (campo Access Token).");
  if (!companyId) throw new Error("Company ID NFE.io não configurado.");

  const url = `https://api.nfe.io/v2/companies/${companyId}/consumerinvoices`;

  const items = (order.order_items || []).map((it: any, i: number) => ({
    code: String(i + 1),
    description: it.product_name,
    ncmCode: settings.ncm_padrao || "22030000",
    cfop: settings.cfop_padrao || "5102",
    quantity: Number(it.quantity),
    unitaryValue: Number(it.product_price),
    grossValue: Number(it.quantity) * Number(it.product_price),
    unitOfMeasurement: settings.unidade_padrao || "UN",
    federalTaxes: {
      origin: Number(settings.origem_padrao || 0),
      icmsCsosn: settings.csosn_padrao || "102",
    },
  }));

  const payload: any = {
    operationOn: new Date().toISOString(),
    items,
    payments: [{
      paymentMethod: mapPaymentNfeIO(order.payment_method),
      amount: Number(order.total),
    }],
  };

  if (order.customer_cpf) {
    payload.customer = {
      federalTaxNumber: String(order.customer_cpf).replace(/\D/g, ""),
      name: order.customer_name || "Consumidor",
    };
  }

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify(payload),
  });

  const raw = await r.json().catch(() => ({}));

  if (!r.ok) {
    const msg = raw?.message || raw?.error?.message || raw?.errors?.[0]?.message || `HTTP ${r.status}`;
    return { status: "rejected", error: msg, raw };
  }

  const inv = raw?.consumerInvoice || raw;
  const flowStatus = (inv?.flowStatus || "").toLowerCase();
  const authorized = flowStatus.includes("issued") || flowStatus === "authorized" || flowStatus === "registered";

  return {
    status: authorized ? "authorized" : "processing",
    numero: inv?.number ? Number(inv.number) : null,
    serie: inv?.series ? Number(inv.series) : (settings.serie_nfce || 1),
    chave_acesso: inv?.accessKey || inv?.id,
    protocolo: inv?.protocol || null,
    xml_url: inv?.xmlDownloadUri || null,
    pdf_url: inv?.pdfDownloadUri || null,
    qr_code: inv?.qrCode || null,
    raw,
  };
}
function mapPaymentNfeIO(method: string) {
  const m = (method || "").toLowerCase();
  if (m === "dinheiro") return "Cash";
  if (m === "credit_card" || m === "cartao_credito") return "CreditCard";
  if (m === "debit_card" || m === "cartao_debito") return "DebitCard";
  if (m === "pix") return "BankTransfer";
  if (m === "fiado") return "StoreCredit";
  return "Other";
}

  } catch (e) {
    console.error("[unified:emit] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
