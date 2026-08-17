// Helpers compartilhados para Uber Direct
// Docs: https://developer.uber.com/docs/deliveries

export const UBER_OAUTH_URL = "https://auth.uber.com/oauth/v2/token";

export const uberApiHost = (sandbox: boolean) =>
  sandbox ? "https://sandbox-api.uber.com" : "https://api.uber.com";

export type UberCreds = {
  customerId: string;
  clientId: string;
  clientSecret: string;
  sandbox: boolean;
};

export async function getUberToken(creds: UberCreds): Promise<string> {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: "client_credentials",
    scope: "eats.deliveries",
  });
  const res = await fetch(UBER_OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok || !data?.access_token) {
    throw new Error(`Uber OAuth: ${JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

export async function quoteUberDirect(creds: UberCreds, params: {
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat?: number; pickupLng?: number;
  dropoffLat?: number; dropoffLng?: number;
}): Promise<{ price: number; quoteId: string; currency: string; etaMin?: number } | { error: string }> {
  try {
    const token = await getUberToken(creds);
    const url = `${uberApiHost(creds.sandbox)}/v1/customers/${creds.customerId}/delivery_quotes`;
    const payload: any = {
      pickup_address: JSON.stringify({ street_address: [params.pickupAddress], country: "BR" }),
      dropoff_address: JSON.stringify({ street_address: [params.dropoffAddress], country: "BR" }),
    };
    if (params.pickupLat && params.pickupLng) {
      payload.pickup_latitude = params.pickupLat;
      payload.pickup_longitude = params.pickupLng;
    }
    if (params.dropoffLat && params.dropoffLng) {
      payload.dropoff_latitude = params.dropoffLat;
      payload.dropoff_longitude = params.dropoffLng;
    }
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data?.message || data?.code || `HTTP ${res.status}` };
    const feeCents = Number(data?.fee);
    if (!Number.isFinite(feeCents) || feeCents < 0) return { error: "Cotação inválida" };
    return {
      price: Math.round(feeCents) / 100,
      quoteId: String(data.id || ""),
      currency: String(data.currency || "BRL"),
      etaMin: data?.duration ? Math.round(Number(data.duration)) : undefined,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha cotar Uber" };
  }
}
