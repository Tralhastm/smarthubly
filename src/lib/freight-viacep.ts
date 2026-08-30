/**
 * Estimativa de frete CEP→CEP usando ViaCEP (gratuito, sem chave).
 *
 * Estratégia simples e barata pra modo WhatsApp/dropshipping:
 *  - Busca cidade/UF de origem e destino no ViaCEP
 *  - Aproxima distância pelos centróides da capital de cada UF e, na mesma
 *    cidade, pela diferença das faixas numéricas dos CEPs
 *  - Estima preço Sedex/PAC com tabela linear (placeholder honesto)
 *
 * Não substitui API Correios — é uma cotação de referência.
 */

type ViaCepResponse = {
  cep?: string;
  uf?: string;
  localidade?: string;
  erro?: boolean;
};

const cleanCep = (cep: string) => (cep || '').replace(/\D/g, '');

const fetchViaCep = async (cep: string): Promise<ViaCepResponse | null> => {
  const c = cleanCep(cep);
  if (c.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${c}/json/`);
    if (!res.ok) return null;
    const data = (await res.json()) as ViaCepResponse;
    if (data.erro) return null;
    return data;
  } catch {
    return null;
  }
};

// Centróides aproximados das capitais (lat, lng).
const UF_COORDS: Record<string, [number, number]> = {
  AC: [-9.97, -67.81], AL: [-9.66, -35.73], AM: [-3.10, -60.02], AP: [0.03, -51.07],
  BA: [-12.97, -38.50], CE: [-3.71, -38.54], DF: [-15.78, -47.92], ES: [-20.31, -40.33],
  GO: [-16.68, -49.25], MA: [-2.53, -44.30], MG: [-19.92, -43.93], MS: [-20.45, -54.62],
  MT: [-15.60, -56.10], PA: [-1.45, -48.50], PB: [-7.12, -34.86], PE: [-8.05, -34.90],
  PI: [-5.09, -42.80], PR: [-25.43, -49.27], RJ: [-22.91, -43.20], RN: [-5.79, -35.21],
  RO: [-8.76, -63.90], RR: [2.82, -60.67], RS: [-30.03, -51.23], SC: [-27.59, -48.55],
  SE: [-10.91, -37.07], SP: [-23.55, -46.63], TO: [-10.18, -48.33],
};

const haversineKm = (a: [number, number], b: [number, number]): number => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
};

export type FreightEstimate = {
  pac: number;
  sedex: number;
  distanceKm: number;
  fromCity: string;
  toCity: string;
  sameCity: boolean;
};

/**
 * Estima frete PAC e Sedex entre dois CEPs.
 * Modelo:
 *  - Mesma cidade: PAC R$15, Sedex R$22
 *  - Distância > 0: PAC = 18 + 0.04 * km, Sedex = 28 + 0.07 * km
 *  - Cap em R$120 (PAC) / R$180 (Sedex) pra evitar disparates
 */
export const estimateFreight = async (
  originCep: string,
  destCep: string,
): Promise<FreightEstimate | null> => {
  const [origin, dest] = await Promise.all([fetchViaCep(originCep), fetchViaCep(destCep)]);
  if (!origin || !dest || !origin.uf || !dest.uf) return null;

  const sameCity =
    origin.uf === dest.uf &&
    (origin.localidade || '').toLowerCase() === (dest.localidade || '').toLowerCase();

  const a = UF_COORDS[origin.uf];
  const b = UF_COORDS[dest.uf];
  // O ViaCEP não fornece coordenadas precisas. Para não exibir 0 km quando
  // os bairros são diferentes, usamos a diferença das faixas de CEP como
  // estimativa local conservadora. O valor continua sendo apenas referência.
  const originPrefix = Number(cleanCep(originCep).slice(0, 5));
  const destPrefix = Number(cleanCep(destCep).slice(0, 5));
  const sameCityKm = Math.max(1, Math.round(Math.abs(destPrefix - originPrefix) * 0.012 * 10) / 10);
  const km = sameCity ? sameCityKm : a && b ? haversineKm(a, b) : 500;

  let pac = sameCity ? 15 : 18 + 0.04 * km;
  let sedex = sameCity ? 22 : 28 + 0.07 * km;
  pac = Math.min(120, Math.round(pac * 100) / 100);
  sedex = Math.min(180, Math.round(sedex * 100) / 100);

  return {
    pac,
    sedex,
    distanceKm: Math.round(km),
    fromCity: `${origin.localidade || ''}/${origin.uf}`,
    toCity: `${dest.localidade || ''}/${dest.uf}`,
    sameCity,
  };
};
