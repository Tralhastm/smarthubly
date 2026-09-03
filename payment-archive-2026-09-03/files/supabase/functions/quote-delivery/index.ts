import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createHmac } from "node:crypto";
import { quoteUberDirect } from "../_shared/uber-direct.ts";
import { geocodeBr, haversineKm, deliveryDistanceKm } from "../_shared/geocode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Coords = { lat: number; lng: number; source: string; query: string; city?: string; state?: string };
type DeliveryMethod = "lalamove" | "uber_direct" | "driver" | "pickup";
type DeliveryOrigin = "store" | "supplier";
type QuoteOption = {
  method: DeliveryMethod;
  fee: number;
  available: boolean;
  label: string;
  eta?: string;
  reason?: string;
  origin?: DeliveryOrigin;
  distance_km?: number;
  pickup_address?: string;
};

type TenantRow = {
  id: string;
  address: string | null;
  shipping_origin_address: string | null;
  shipping_enabled: boolean | null;
  shipping_base_fee: number | string | null;
  shipping_base_radius_km: number | string | null;
  shipping_per_km_fee: number | string | null;
  shipping_max_fee: number | string | null;
  shipping_lalamove_margin_percent: number | string | null;
  shipping_lalamove_apply_cap: boolean | null;
  lalamove_enabled: boolean | null;
  lalamove_api_key: string | null;
  lalamove_api_secret: string | null;
  lalamove_market: string | null;
  lalamove_sandbox: boolean | null;
  delivery_responsible: string | null;
  shipping_mode: string | null;
  uber_direct_enabled: boolean | null;
  uber_direct_customer_id: string | null;
  uber_direct_client_id: string | null;
  uber_direct_client_secret: string | null;
  uber_direct_sandbox: boolean | null;
  uber_direct_use_platform_keys: boolean | null;
};

type SupplierRow = {
  id: string;
  address: string | null;
  responsible_for_delivery: boolean | null;
  shipping_base_fee: number | string | null;
  shipping_base_radius_km: number | string | null;
  shipping_per_km_fee: number | string | null;
  shipping_max_fee: number | string | null;
  lalamove_api_key: string | null;
  lalamove_api_secret: string | null;
  lalamove_market: string | null;
  lalamove_sandbox: boolean | null;
  shipping_mode: string | null;
};

const LALAMOVE_API_HOST = (sandbox: boolean) =>
  sandbox ? "https://rest.sandbox.lalamove.com" : "https://rest.lalamove.com";

const geocodeAddress = (raw: string, hint?: { city?: string; state?: string }) =>
  geocodeBr(raw, hint) as Promise<Coords | null>;


function toNumber(value: number | string | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function calculateTableFee(distanceKm: number, baseFee: number, baseRadiusKm: number, perKmFee: number) {
  if (distanceKm <= 0) return Math.round(baseFee * 100) / 100;
  const extraDistance = Math.max(0, distanceKm - baseRadiusKm);
  return Math.round((baseFee + extraDistance * perKmFee) * 100) / 100;
}

function shouldUseUberSandboxFallback(error: string, sandbox: boolean) {
  if (!sandbox) return false;
  const normalized = error.toLowerCase();
  return normalized.includes("invalid_scope")
    || normalized.includes("deliverable area")
    || normalized.includes("not in a deliverable")
    || normalized.includes("not available")
    || normalized.includes("sandbox");
}

function calculateUberSandboxFee(distanceKm: number | null, tableFee: number) {
  const distance = Math.max(1, distanceKm || 1);
  const estimated = 7.9 + distance * 1.85;
  return Math.round(Math.max(estimated, tableFee, 9.9) * 100) / 100;
}

function resolvePickupContext(tenant: TenantRow, suppliers: SupplierRow[]) {
  const responsibleSuppliers = suppliers.filter((supplier) => supplier.responsible_for_delivery && supplier.address);
  const selectedSupplier = responsibleSuppliers[0] || null;
  const pickupAddress = selectedSupplier?.address || tenant.shipping_origin_address || tenant.address || "";
  const origin: DeliveryOrigin = selectedSupplier ? "supplier" : "store";
  const feeConfig = selectedSupplier
    ? {
        baseFee: toNumber(selectedSupplier.shipping_base_fee, toNumber(tenant.shipping_base_fee, 0)),
        baseRadiusKm: toNumber(selectedSupplier.shipping_base_radius_km, toNumber(tenant.shipping_base_radius_km, 5)),
        perKmFee: toNumber(selectedSupplier.shipping_per_km_fee, toNumber(tenant.shipping_per_km_fee, 0)),
      }
    : {
        baseFee: toNumber(tenant.shipping_base_fee, 0),
        baseRadiusKm: toNumber(tenant.shipping_base_radius_km, 5),
        perKmFee: toNumber(tenant.shipping_per_km_fee, 0),
      };

  return {
    pickupAddress,
    origin,
    feeConfig,
    selectedSupplier,
  };
}

function signLalamove(apiKey: string, secret: string, method: string, path: string, body: string) {
  const timestamp = Date.now().toString();
  const rawSignature = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`;
  const signature = createHmac("sha256", secret).update(rawSignature).digest("hex");
  return {
    Authorization: `hmac ${apiKey}:${timestamp}:${signature}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function quoteLalamove(params: {
  apiKey: string;
  apiSecret: string;
  market: string;
  sandbox: boolean;
  pickup: Coords;
  dropoff: Coords;
  pickupAddress: string;
  dropoffAddress: string;
}): Promise<{ price: number } | { error: string }> {
  try {
    const body = JSON.stringify({
      data: {
        serviceType: "LALAGO",
        language: "pt_BR",
        stops: [
          { coordinates: { lat: String(params.pickup.lat), lng: String(params.pickup.lng) }, address: params.pickupAddress },
          { coordinates: { lat: String(params.dropoff.lat), lng: String(params.dropoff.lng) }, address: params.dropoffAddress },
        ],
        item: {
          quantity: "1",
          weight: "LESS_THAN_3KG",
          categories: ["FOOD_DELIVERY"],
          handlingInstructions: ["KEEP_UPRIGHT"],
        },
      },
    });
    const path = "/v3/quotations";
    const headers = signLalamove(params.apiKey, params.apiSecret, "POST", path, body) as Record<string, string>;
    headers.Market = params.market;

    const response = await fetch(`${LALAMOVE_API_HOST(params.sandbox)}${path}`, {
      method: "POST",
      headers,
      body,
    });
    const data = await response.json();
    if (!response.ok) {
      const firstError = data?.errors?.[0]?.message;
      return { error: firstError || `HTTP ${response.status}` };
    }
    const price = Number(data?.data?.priceBreakdown?.total);
    if (!Number.isFinite(price) || price <= 0) return { error: "Cotação inválida" };
    return { price: Math.round(price * 100) / 100 };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao cotar Lalamove" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const tenantId = String(body?.tenantId || "").trim();
    const customerAddress = String(body?.customerAddress || "").trim();
    const supplierIds = Array.isArray(body?.supplierIds)
      ? body.supplierIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];

    if (!tenantId || !customerAddress) {
      return new Response(JSON.stringify({ error: "tenantId e customerAddress obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const tenantResponse = await supabase
      .from("tenants")
      .select("id, address, shipping_origin_address, shipping_enabled, shipping_base_fee, shipping_base_radius_km, shipping_per_km_fee, shipping_max_fee, shipping_lalamove_margin_percent, shipping_lalamove_apply_cap, lalamove_enabled, lalamove_api_key, lalamove_api_secret, lalamove_market, lalamove_sandbox, delivery_responsible, shipping_mode, uber_direct_enabled, uber_direct_customer_id, uber_direct_client_id, uber_direct_client_secret, uber_direct_sandbox, uber_direct_use_platform_keys")
      .eq("id", tenantId)
      .maybeSingle();

    if (!tenantResponse.data) {
      return new Response(JSON.stringify({ error: "Loja não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tenant = tenantResponse.data as TenantRow;
    const supplierResponse = supplierIds.length > 0
      ? await supabase
          .from("suppliers")
          .select("id, address, responsible_for_delivery, shipping_base_fee, shipping_base_radius_km, shipping_per_km_fee, shipping_max_fee, lalamove_api_key, lalamove_api_secret, lalamove_market, lalamove_sandbox, shipping_mode")
          .in("id", supplierIds)
      : { data: [] as SupplierRow[] | null };

    const suppliers = (supplierResponse.data || []) as SupplierRow[];
    const { pickupAddress, origin, feeConfig, selectedSupplier } = resolvePickupContext(tenant, suppliers);

    if (!pickupAddress) {
      return new Response(JSON.stringify({ error: "Endereço de origem não configurado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Considera "online de verdade" só motoboys com heartbeat dos últimos 15 minutos.
    // (janela larga porque navegadores móveis estrangulam timers em segundo plano)
    // Sem isso, um motoboy que matou o app fica eternamente "online" e
    // bagunça a cotação (não cota Lalamove achando que tem alguém).
    const heartbeatCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    // Best-effort: marca offline quem ficou sem heartbeat (não bloqueia se falhar)
    supabase.rpc('cleanup_stale_drivers').then(() => {}, () => {});

    const [pickupCoordsRaw, customerCoords, driverResult] = await Promise.all([
      geocodeAddress(pickupAddress),
      geocodeAddress(customerAddress),
      supabase
        .from("drivers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .eq("is_online", true)
        .gte("last_online_at", heartbeatCutoff),
    ]);

    // Guard anti-"2000 km": endereços de loja cadastrados sem cidade/CEP
    // (ex.: "avenida tal, 105") caem numa rua homônima em outro estado.
    // Se deu absurdo, refaz a geocodificação da origem na cidade do cliente.
    let pickupCoords = pickupCoordsRaw;
    if (pickupCoords && customerCoords && customerCoords.city) {
      const preliminary = deliveryDistanceKm(pickupCoords, customerCoords);
      const originHasCity = !!pickupCoords.city;
      if (preliminary.km > 60 && (!originHasCity || pickupCoords.city !== customerCoords.city)) {
        const retry = await geocodeAddress(pickupAddress, {
          city: customerCoords.city,
          state: customerCoords.state,
        });
        if (retry && deliveryDistanceKm(retry, customerCoords).km < preliminary.km) {
          pickupCoords = retry;
        }
      }
    }

    const onlineDrivers = driverResult.count || 0;
    const shippingEnabled = !!tenant.shipping_enabled;
    const hasPickupGeocode = !!pickupCoords;
    const hasCustomerGeocode = !!customerCoords;
    const distanceKm = pickupCoords && customerCoords ? deliveryDistanceKm(pickupCoords, customerCoords).km : null;


    console.log("[quote-delivery:v2]", JSON.stringify({
      tenantId,
      supplierIds,
      pickupAddress,
      customerAddress,
      origin,
      pickup_geocoded: hasPickupGeocode,
      customer_geocoded: hasCustomerGeocode,
      onlineDrivers,
      distanceKm,
    }));

    const options: QuoteOption[] = [];

    // Resolver quem decide a base de frete
    // - Se a loja delegou ao fornecedor (delivery_responsible='supplier') E há fornecedor responsável → usa shipping_mode do fornecedor
    // - Caso contrário → usa shipping_mode da loja
    const tenantDelegatesToSupplier = (tenant.delivery_responsible || "store") === "supplier";
    const decisionMaker: "tenant" | "supplier" = tenantDelegatesToSupplier && selectedSupplier ? "supplier" : "tenant";
    const shippingMode = (decisionMaker === "supplier"
      ? (selectedSupplier?.shipping_mode || "own")
      : (tenant.shipping_mode || "own")
    ).toLowerCase();
    const useLalamove = shippingMode === "lalamove";
    const useOwnTable = shippingMode === "own";

    console.log("[quote-delivery:v2:mode]", JSON.stringify({ decisionMaker, shippingMode, tenantDelegatesToSupplier }));

    let lalamoveFailed = false;
    const lalamoveAttempts = [] as Array<{ apiKey: string; apiSecret: string; market: string; sandbox: boolean; origin: DeliveryOrigin }>;

    // PREFERÊNCIA: motoboy próprio da loja sempre que houver algum ONLINE.
    // Só cota Lalamove se NÃO houver motoboy online OU se a loja explicitamente
    // optou por sempre usar Lalamove (shipping_mode='lalamove') E não tem motoboy.
    // Regra do dono: "a preferência é dos motoboys da loja".
    const shouldQuoteLalamove = useLalamove && onlineDrivers <= 0;

    if (shouldQuoteLalamove && pickupCoords && customerCoords) {
      if (decisionMaker === "supplier" && selectedSupplier?.lalamove_api_key && selectedSupplier?.lalamove_api_secret) {
        lalamoveAttempts.push({
          apiKey: selectedSupplier.lalamove_api_key,
          apiSecret: selectedSupplier.lalamove_api_secret,
          market: selectedSupplier.lalamove_market || "BR_SAO",
          sandbox: !!selectedSupplier.lalamove_sandbox,
          origin: "supplier",
        });
      } else if (decisionMaker === "tenant" && tenant.lalamove_enabled && tenant.lalamove_api_key && tenant.lalamove_api_secret) {
        lalamoveAttempts.push({
          apiKey: tenant.lalamove_api_key,
          apiSecret: tenant.lalamove_api_secret,
          market: tenant.lalamove_market || "BR_SAO",
          sandbox: !!tenant.lalamove_sandbox,
          origin,
        });
      }
    }

    // Se modo é "lalamove" mas não conseguimos montar nenhuma tentativa
    // (sem credenciais), marca como falha para o fallback da tabela própria entrar.
    if (shouldQuoteLalamove && lalamoveAttempts.length === 0) {
      lalamoveFailed = true;
      console.log("[quote-delivery:v2:lalamove-no-credentials]", JSON.stringify({ decisionMaker }));
    }

    console.log("[quote-delivery:v2:driver-priority]", JSON.stringify({ onlineDrivers, useLalamove, shouldQuoteLalamove }));

    // Teto de frete (cap): fornecedor tem prioridade, senão usa o da loja. Aplica em Lalamove E driver próprio.
    const supMaxRaw = selectedSupplier ? Number(selectedSupplier.shipping_max_fee ?? NaN) : NaN;
    const tenMaxRaw = Number(tenant.shipping_max_fee ?? NaN);
    const feeCap = Number.isFinite(supMaxRaw) && supMaxRaw > 0
      ? supMaxRaw
      : (Number.isFinite(tenMaxRaw) && tenMaxRaw > 0 ? tenMaxRaw : null);

    // Margem aplicada SOBRE o preço cotado pelo Lalamove (decisão da loja)
    const lalamoveMarginPercent = Math.max(0, toNumber(tenant.shipping_lalamove_margin_percent, 0));

    for (const attempt of lalamoveAttempts) {
      const result = await quoteLalamove({
        apiKey: attempt.apiKey,
        apiSecret: attempt.apiSecret,
        market: attempt.market,
        sandbox: attempt.sandbox,
        pickup: pickupCoords!,
        dropoff: customerCoords!,
        pickupAddress,
        dropoffAddress: customerAddress,
      });
      if ("price" in result) {
        const basePrice = result.price;
        const withMargin = lalamoveMarginPercent > 0
          ? Math.round(basePrice * (1 + lalamoveMarginPercent / 100) * 100) / 100
          : basePrice;
        const marginLabel = lalamoveMarginPercent > 0 ? ` (+${lalamoveMarginPercent}%)` : "";
        // Aplica teto opcional ao Lalamove se a loja escolheu (shipping_lalamove_apply_cap)
        const applyCapToLalamove = !!tenant.shipping_lalamove_apply_cap;
        let finalFee = withMargin;
        let cappedLabel = "";
        if (applyCapToLalamove && feeCap != null && finalFee > feeCap) {
          finalFee = Math.round(feeCap * 100) / 100;
          cappedLabel = ` (limitado a R$ ${finalFee.toFixed(2)})`;
        }
        options.push({
          method: "lalamove",
          fee: finalFee,
          available: true,
          label: `Entrega via Lalamove${marginLabel}${cappedLabel}`,
          eta: "20-40 min",
          origin: attempt.origin,
          distance_km: distanceKm || undefined,
          pickup_address: pickupAddress,
        });
        break;
      }
      lalamoveFailed = true;
      console.log("[quote-delivery:v2:lalamove-failed]", JSON.stringify({ origin: attempt.origin, reason: result.error }));
    }

    // Uber Direct — cota junto com Lalamove (mesma condição: só quando motoboy próprio offline OU modo permite multi-provider)
    const usePlatformUberKeys = !!tenant.uber_direct_use_platform_keys;
    const hasOwnUberKeys = !usePlatformUberKeys && !!(tenant.uber_direct_customer_id && tenant.uber_direct_client_id && tenant.uber_direct_client_secret);
    const uberCustomerId = usePlatformUberKeys ? Deno.env.get("UBER_CUSTOMER_ID") || "" : (hasOwnUberKeys ? tenant.uber_direct_customer_id : "");
    const uberClientId = usePlatformUberKeys ? Deno.env.get("UBER_CLIENT_ID") || "" : (hasOwnUberKeys ? tenant.uber_direct_client_id : "");
    const uberClientSecret = usePlatformUberKeys ? Deno.env.get("UBER_CLIENT_SECRET") || "" : (hasOwnUberKeys ? tenant.uber_direct_client_secret : "");
    const uberSandbox = usePlatformUberKeys ? true : !!tenant.uber_direct_sandbox;
    const shouldQuoteUber = onlineDrivers <= 0
      && !!tenant.uber_direct_enabled
      && !!uberCustomerId
      && !!uberClientId
      && !!uberClientSecret;

    if (shouldQuoteUber) {
      const uRes = await quoteUberDirect({
        customerId: uberCustomerId!,
        clientId: uberClientId!,
        clientSecret: uberClientSecret!,
        sandbox: uberSandbox,
      }, {
        pickupAddress,
        dropoffAddress: customerAddress,
        pickupLat: pickupCoords?.lat, pickupLng: pickupCoords?.lng,
        dropoffLat: customerCoords?.lat, dropoffLng: customerCoords?.lng,
      });
      if ("price" in uRes) {
        const basePrice = uRes.price;
        const withMargin = lalamoveMarginPercent > 0
          ? Math.round(basePrice * (1 + lalamoveMarginPercent / 100) * 100) / 100
          : basePrice;
        const marginLabel = lalamoveMarginPercent > 0 ? ` (+${lalamoveMarginPercent}%)` : "";
        const applyCap = !!tenant.shipping_lalamove_apply_cap;
        let finalFee = withMargin;
        let cappedLabel = "";
        if (applyCap && feeCap != null && finalFee > feeCap) {
          finalFee = Math.round(feeCap * 100) / 100;
          cappedLabel = ` (limitado a R$ ${finalFee.toFixed(2)})`;
        }
        const eta = uRes.etaMin ? `~${uRes.etaMin} min` : "20-40 min";
        options.push({
          method: "uber_direct",
          fee: finalFee,
          available: true,
          label: `Entrega via Uber Direct${marginLabel}${cappedLabel}`,
          eta,
          origin,
          distance_km: distanceKm || undefined,
          pickup_address: pickupAddress,
        });
      } else {
        if (shouldUseUberSandboxFallback(uRes.error, uberSandbox)) {
          const tableFee = distanceKm == null ? 0 : calculateTableFee(distanceKm, feeConfig.baseFee, feeConfig.baseRadiusKm, feeConfig.perKmFee);
          const fallbackFee = calculateUberSandboxFee(distanceKm, tableFee);
          options.push({
            method: "uber_direct",
            fee: fallbackFee,
            available: true,
            label: "Entrega via Uber Direct (sandbox)",
            eta: "20-40 min",
            origin,
            distance_km: distanceKm || undefined,
            pickup_address: pickupAddress,
          });
          console.log("[quote-delivery:v2:uber-sandbox-fallback]", uRes.error);
        } else {
          console.log("[quote-delivery:v2:uber-failed]", uRes.error);
        }
      }
    }

    // "Mais barata vence": se temos Lalamove + Uber Direct, mantém só a mais barata
    const lala = options.find(o => o.method === "lalamove" && o.available);
    const uber = options.find(o => o.method === "uber_direct" && o.available);
    if (lala && uber) {
      const loser = lala.fee <= uber.fee ? "uber_direct" : "lalamove";
      const idx = options.findIndex(o => o.method === loser);
      if (idx >= 0) options.splice(idx, 1);
    }

    // Tabela própria (driver) — calcula sempre que frete está habilitado.
    // Regra do dono: motoboy próprio é prioridade. Se há motoboy online, mostra.
    // Se modo é "lalamove" mas não há motoboy online, ainda mostra Lalamove (cotado acima).
    // Se modo é "own", sempre mostra a tabela própria (com aviso se motoboy offline).
    // Se a loja tem motoboy online, entrega própria é ofertada mesmo que o
    // switch de frete esteja desligado — ter motoboy trabalhando já é a intenção.
    const shouldShowOwnTable = (shippingEnabled || onlineDrivers > 0) && (useOwnTable || onlineDrivers > 0 || lalamoveFailed);
    if (shouldShowOwnTable) {
      if (onlineDrivers <= 0) {
        options.push({
          method: "driver",
          fee: 0,
          available: false,
          label: "Entrega por motoboy da loja",
          eta: "30-60 min",
          origin,
          reason: "Nenhum motoboy online no momento",
          pickup_address: pickupAddress,
        });
      } else if (!pickupCoords || !customerCoords || distanceKm == null) {
        options.push({
          method: "driver",
          fee: 0,
          available: false,
          label: "Entrega por motoboy da loja",
          eta: "30-60 min",
          origin,
          reason: !pickupCoords
            ? "Não foi possível localizar o endereço de origem"
            : "Não foi possível localizar o endereço de entrega",
          pickup_address: pickupAddress,
        });
      } else {
        let driverFee = calculateTableFee(distanceKm, feeConfig.baseFee, feeConfig.baseRadiusKm, feeConfig.perKmFee);
        if (feeCap != null && driverFee > feeCap) driverFee = Math.round(feeCap * 100) / 100;
        options.push({
          method: "driver",
          fee: driverFee,
          available: true,
          label: "Entrega por motoboy da loja",
          eta: "30-60 min",
          origin,
          distance_km: distanceKm,
          pickup_address: pickupAddress,
        });
      }
    }

    options.push({
      method: "pickup",
      fee: 0,
      available: true,
      label: "Retirar na loja",
      eta: "Pronto em 15-30 min",
      pickup_address: pickupAddress,
    });

    const hasDelivery = options.some((option) => (option.method === "lalamove" || option.method === "uber_direct" || option.method === "driver") && option.available);
    const driverOption = options.find((option) => option.method === "driver");

    return new Response(JSON.stringify({
      options,
      has_delivery: hasDelivery,
      pickup_address: pickupAddress,
      driver_offline: onlineDrivers <= 0,
      lalamove_failed: lalamoveFailed,
      distance_km: distanceKm,
      geocoded_pickup: hasPickupGeocode,
      geocoded_customer: hasCustomerGeocode,
      selected_origin: origin,
      driver_reason: driverOption?.reason || null,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("quote-delivery:v2 error", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
