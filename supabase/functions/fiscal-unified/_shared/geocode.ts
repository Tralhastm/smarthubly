/**
 * Geocodificação BR com validação de sanidade.
 *
 * Motivo: buscas soltas no Photon/Nominatim retornavam ruas homônimas em
 * outros estados (ou fora do Brasil), gerando distâncias absurdas (ex.: 2000 km
 * para uma entrega de 12 km). Aqui filtramos por país/UF/cidade esperados
 * (vindos do CEP) e aplicamos um guard final quando origem e destino são da
 * mesma cidade.
 */

export type GeoCoords = {
  lat: number;
  lng: number;
  source: string;
  query: string;
  city?: string;
  state?: string;
  /** Rótulo do resultado (rua/bairro/cidade) usado para checar relevância. */
  label?: string;
};

const STOP_TOKENS = new Set([
  "brasil", "rua", "avenida", "av", "alameda", "travessa", "rodovia", "estrada",
  "praca", "praça", "bairro", "numero", "num", "casa", "apto", "apartamento", "bloco",
]);

const tokenize = (value: string) =>
  normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && /[a-z]/.test(t) && !/^\d+$/.test(t) && !STOP_TOKENS.has(t));

/**
 * Evita que geocoders "chutem" um ponto qualquer para textos sem sentido:
 * exige que ao menos um token relevante da busca apareça no rótulo do resultado.
 */
export function isRelevantMatch(query: string, candidate: GeoCoords) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return true;
  const labelTokens = new Set(
    tokenize([candidate.label, candidate.city, candidate.state].filter(Boolean).join(" ")),
  );
  if (labelTokens.size === 0) return false;
  return queryTokens.some((t) => labelTokens.has(t));
}

const BR_BBOX = { minLat: -34.5, maxLat: 6.5, minLng: -74.5, maxLng: -33.0 };

export const inBrazil = (lat: number, lng: number) =>
  lat >= BR_BBOX.minLat && lat <= BR_BBOX.maxLat && lng >= BR_BBOX.minLng && lng <= BR_BBOX.maxLng;

export const normalizeText = (value: string) =>
  (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const key = (value?: string | null) => normalizeText(value || "").toLowerCase();

export function stripNoise(value: string) {
  return normalizeText(value)
    .replace(/CEP\s*\d{5}-?\d{3}/gi, "")
    .replace(/Ref\.?\s*:[^-]*/gi, "")
    .replace(/\s+-\s+/g, ", ")
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^,|,$/g, "")
    .trim();
}

export function extractCep(value: string): string | null {
  const match = (value || "").match(/(\d{5})-?(\d{3})/);
  return match ? `${match[1]}${match[2]}` : null;
}

const removeParenthetical = (value: string) =>
  value.replace(/\(([^)]*)\)/g, " $1 ").replace(/\s+/g, " ").trim();

const uniqueQueries = (queries: Array<string | null | undefined>) =>
  Array.from(new Set(queries.map((item) => stripNoise(item || "")).filter((item) => item.length >= 3)));

type CepInfo = { street: string; neighborhood: string; city: string; state: string; coords: GeoCoords | null };

async function viaCep(cep: string): Promise<CepInfo | null> {
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.erro) return null;
    return {
      street: data.logradouro || "",
      neighborhood: data.bairro || "",
      city: data.localidade || "",
      state: data.uf || "",
      coords: null,
    };
  } catch {
    return null;
  }
}

async function brasilApiCep(cep: string): Promise<CepInfo | null> {
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const data = await response.json();
    const lat = Number(data?.location?.coordinates?.latitude);
    const lng = Number(data?.location?.coordinates?.longitude);
    const city = data.city || "";
    const state = data.state || "";
    return {
      street: data.street || "",
      neighborhood: data.neighborhood || "",
      city,
      state,
      coords: Number.isFinite(lat) && Number.isFinite(lng) && inBrazil(lat, lng)
        ? { lat, lng, source: "brasilapi", query: cep, city, state }
        : null,
    };
  } catch {
    return null;
  }
}

type Expected = { city?: string; state?: string };

const UF_NAMES: Record<string, string> = {
  ac: "acre", al: "alagoas", am: "amazonas", ap: "amapa", ba: "bahia", ce: "ceara",
  df: "distrito federal", es: "espirito santo", go: "goias", ma: "maranhao", mg: "minas gerais",
  ms: "mato grosso do sul", mt: "mato grosso", pa: "para", pb: "paraiba", pe: "pernambuco",
  pi: "piaui", pr: "parana", rj: "rio de janeiro", rn: "rio grande do norte", ro: "rondonia",
  rr: "roraima", rs: "rio grande do sul", sc: "santa catarina", se: "sergipe", sp: "sao paulo",
  to: "tocantins",
};

/** Normaliza "PA" e "Pará" para a mesma chave. */
const stateKey = (value?: string | null) => {
  const k = key(value);
  if (!k) return "";
  return UF_NAMES[k] || k;
};

function matchesExpected(candidate: GeoCoords, expected: Expected) {
  if (expected.state && candidate.state && stateKey(candidate.state) !== stateKey(expected.state)) return false;
  if (expected.city && candidate.city && key(candidate.city) !== key(expected.city)) return false;
  return true;
}

async function photonSearch(query: string, expected: Expected): Promise<GeoCoords | null> {
  try {
    const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`, {
      headers: { Accept: "application/json", "User-Agent": "LovableDelivery/3.0" },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    let fallback: GeoCoords | null = null;
    for (const feature of features) {
      const coordinates = feature?.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
      const [lng, lat] = coordinates.map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const props = feature.properties || {};
      if (props.countrycode && String(props.countrycode).toUpperCase() !== "BR") continue;
      if (!inBrazil(lat, lng)) continue;
      const candidate: GeoCoords = {
        lat,
        lng,
        source: "photon",
        query,
        city: props.city || props.county || props.district || undefined,
        state: props.state || undefined,
        label: [props.name, props.street, props.district, props.city, props.state].filter(Boolean).join(", "),
      };
      if (!isRelevantMatch(query, candidate)) continue;
      if (matchesExpected(candidate, expected)) return candidate;
      fallback = fallback || candidate;
    }
    // Só aceita fallback quando não havia expectativa de cidade/UF
    return expected.city || expected.state ? null : fallback;
  } catch {
    return null;
  }
}

async function nominatimSearch(query: string, expected: Expected): Promise<GeoCoords | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=br&q=${encodeURIComponent(query)}`,
      { headers: { Accept: "application/json", "User-Agent": "LovableDelivery/3.0" } },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const list = Array.isArray(data) ? data : [];
    let fallback: GeoCoords | null = null;
    for (const item of list) {
      const lat = Number(item?.lat);
      const lng = Number(item?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inBrazil(lat, lng)) continue;
      const addr = item.address || {};
      const candidate: GeoCoords = {
        lat,
        lng,
        source: "nominatim",
        query,
        city: addr.city || addr.town || addr.village || addr.municipality || undefined,
        state: addr.state || undefined,
        label: String(item.display_name || item.name || ""),
      };
      if (!isRelevantMatch(query, candidate)) continue;
      if (matchesExpected(candidate, expected)) return candidate;
      fallback = fallback || candidate;
    }
    return expected.city || expected.state ? null : fallback;
  } catch {
    return null;
  }
}

/** Geocodifica um endereço brasileiro, validando UF/cidade quando o CEP é conhecido. */
export async function geocodeBr(rawAddress: string, hint?: Expected): Promise<GeoCoords | null> {
  const cleaned = stripNoise(rawAddress || "");
  if (!cleaned) return null;

  const cep = extractCep(rawAddress);
  const queries: string[] = [];
  // Dica de cidade/UF (ex.: cidade do cliente) usada quando o endereço da loja
  // foi cadastrado sem cidade nem CEP — evita casar com rua homônima em outro estado.
  let expected: Expected = { city: hint?.city, state: hint?.state };
  let cepFallback: GeoCoords | null = null;

  if (cep) {
    const [brasil, via] = await Promise.all([brasilApiCep(cep), viaCep(cep)]);
    const base = brasil || via;
    if (base) {
      expected = { city: base.city || undefined, state: base.state || undefined };
      cepFallback = brasil?.coords || null;
      const plainNeighborhood = removeParenthetical(base.neighborhood || "");
      queries.push(...uniqueQueries([
        `${base.street}, ${base.neighborhood}, ${base.city}, ${base.state}, Brasil`,
        `${base.street}, ${plainNeighborhood}, ${base.city}, ${base.state}, Brasil`,
        `${base.street}, ${base.city}, ${base.state}, Brasil`,
        `${base.neighborhood}, ${base.city}, ${base.state}, Brasil`,
        `${plainNeighborhood}, ${base.city}, ${base.state}, Brasil`,
      ]));
    }
  }

  const expandedAddress = removeParenthetical(cleaned);
  const suffix = expected.city ? `, ${expected.city}, ${expected.state || ""}, Brasil` : ", Brasil";
  queries.push(...uniqueQueries([
    `${cleaned}${suffix}`,
    `${expandedAddress}${suffix}`,
    cleaned,
    `${cleaned}, Brasil`,
  ]));

  for (const query of queries) {
    const result = (await photonSearch(query, expected)) || (await nominatimSearch(query, expected));
    if (result) {
      // Coordenada do CEP é a referência mais confiável: se o resultado está
      // absurdamente longe dela, prefere o CEP.
      if (cepFallback && haversineKm(cepFallback, result) > 25) return cepFallback;
      return result;
    }
  }

  // Sem match preciso: usa o centro do CEP, depois a cidade
  if (cepFallback) return cepFallback;
  if (expected.city) {
    const cityQuery = `${expected.city}, ${expected.state || ""}, Brasil`;
    const cityCoords = (await photonSearch(cityQuery, { state: expected.state })) ||
      (await nominatimSearch(cityQuery, { state: expected.state }));
    if (cityCoords) return cityCoords;
  }
  return null;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 10) / 10;
}

/**
 * Distância de entrega com guard de sanidade:
 * mesma cidade nunca deve resultar em centenas de km.
 */
export function deliveryDistanceKm(origin: GeoCoords, destination: GeoCoords) {
  const raw = haversineKm(origin, destination);
  const sameCity = !!origin.city && !!destination.city && key(origin.city) === key(destination.city);
  if (sameCity && raw > 60) return { km: 15, approximate: true };
  if (raw > 300) return { km: raw, approximate: true };
  return { km: raw, approximate: false };
}
