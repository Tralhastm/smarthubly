import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geocodeBr, deliveryDistanceKm } from "../../../_shared/geocode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function calculateDeliveryFee(distanceKm: number) {
  if (distanceKm <= 0) return 0;
  if (distanceKm <= 5) return 5;
  return Math.round((5 + (distanceKm - 5) * 1.5) * 100) / 100;
}

export async function distance(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const address = String(body?.address || "").trim();
    const origin = String(body?.origin || "").trim();
    const destLatInput = body?.dest_lat;
    const destLonInput = body?.dest_lon;

    if (!origin) {
      return new Response(JSON.stringify({ error: "Endereço de origem é obrigatório." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    let destLat: number;
    let destLon: number;
    let destinationAddress = address;
    let destinationSource = "coords";
    let destinationCity: string | undefined;
    let destinationState: string | undefined;

    if (destLatInput != null && destLonInput != null) {
      destLat = Number(destLatInput);
      destLon = Number(destLonInput);
      if (!Number.isFinite(destLat) || !Number.isFinite(destLon)) {
        return new Response(JSON.stringify({ error: "Coordenadas de destino inválidas." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
    } else {
      if (!address) {
        return new Response(JSON.stringify({ error: "Endereço de destino é obrigatório." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
      const destinationCoords = await geocodeBr(address);
      if (!destinationCoords) {
        return new Response(JSON.stringify({ error: "Não foi possível localizar o endereço de destino." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
      destLat = destinationCoords.lat;
      destLon = destinationCoords.lng;
      destinationAddress = destinationCoords.query;
      destinationSource = destinationCoords.source;
      destinationCity = destinationCoords.city;
      destinationState = destinationCoords.state;
    }

    // Resolve a origem usando a cidade/UF confirmada pelo CEP do cliente como
    // contexto. Muitas lojas têm apenas rua e número cadastrados; sem essa dica,
    // geocodificadores podem escolher uma avenida homônima em outro estado.
    let originCoords = await geocodeBr(origin, {
      city: destinationCity,
      state: destinationState,
    });
    if (!originCoords) {
      return new Response(JSON.stringify({ error: "Não foi possível localizar o endereço de origem." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const destinationCoords = {
      lat: destLat,
      lng: destLon,
      source: destinationSource,
      query: destinationAddress,
      city: destinationCity,
      state: destinationState,
    };

    // Proteção adicional para chamadas por coordenadas ou respostas ambíguas:
    // nunca devolve centenas de quilômetros sem tentar novamente com a cidade.
    const preliminary = deliveryDistanceKm(originCoords, destinationCoords);
    if (preliminary.km > 60 && destinationCity) {
      const retry = await geocodeBr(origin, { city: destinationCity, state: destinationState });
      if (retry && deliveryDistanceKm(retry, destinationCoords).km < preliminary.km) {
        originCoords = retry;
      }
    }

    const { km, approximate } = deliveryDistanceKm(originCoords, destinationCoords);
    const deliveryFee = calculateDeliveryFee(km);

    return new Response(JSON.stringify({
      distance_km: km,
      approximate,
      delivery_fee: deliveryFee,
      origin_address: origin,
      destination_address: destinationAddress,
      geocode_source_origin: originCoords.source,
      geocode_source_destination: destinationSource,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Erro interno ao calcular distância.", detail: String(error) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  } catch (e) {
    console.error("[unified:distance] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
