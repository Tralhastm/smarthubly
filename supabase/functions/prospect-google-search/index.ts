// Prospecção remota REAL — fontes que devolvem dados de verdade:
// 1) OpenStreetMap/Nominatim (POIs reais com phone/website/address — SEM chave, SEM bloqueio)
// 2) Overpass API (busca por categoria dentro do bounding box da cidade)
// 3) Gemini com grounding google_search (busca REAL no Google via API oficial)
// 4) Fallback Lovable AI (sem grounding, conhecimento do modelo)
// 5) Scrape DuckDuckGo HTML (versão "lite" que ainda devolve HTML real)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, type CallerAuth } from "../_shared/authorize-caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REGION_UFS: Record<string, string[]> = {
  norte: ["AC","AP","AM","PA","RO","RR","TO"],
  nordeste: ["AL","BA","CE","MA","PB","PE","PI","RN","SE"],
  "centro-oeste": ["DF","GO","MT","MS"],
  centro_oeste: ["DF","GO","MT","MS"],
  sudeste: ["ES","MG","RJ","SP"],
  sul: ["PR","RS","SC"],
};

const norm = (s: string) => (s ?? "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();

type Lead = {
  business_name: string;
  category?: string | null;
  rating?: number | null;
  reviews_count?: number | null;
  address?: string | null;
  neighborhood?: string | null;
  phone?: string | null;
  hours?: string | null;
  website_url?: string | null;
  maps_url?: string | null;
  description?: string | null;
  price_level?: number | null;
  email?: string | null;
  instagram_handle?: string | null;
  source?: string | null;
  lat?: number | null;
  lon?: number | null;
};

const PHONE_RE = /\(?\b([1-9]{2})\)?[\s.-]?(9?\d{4})[\s.-]?(\d{4})\b/;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const INSTA_RE = /(?:instagram\.com\/|@)([a-zA-Z0-9._]{3,30})/;

function fmtPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g,"");
  if (digits.length < 10) return raw;
  // remove +55 BR
  const d = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return raw;
}

// ============== NOMINATIM (POIs do OSM) ==============
async function searchNominatim(query: string): Promise<Lead[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&extratags=1&namedetails=1&limit=50&countrycodes=br`;
    const r = await fetch(url, {
      headers: { "User-Agent": "LovableProspectBot/1.0 (contato@plataforma.com.br)", "Accept-Language": "pt-BR" },
    });
    if (!r.ok) { console.warn("nominatim status:", r.status); return []; }
    const arr = await r.json();
    if (!Array.isArray(arr)) return [];
    return arr.map((p: any) => {
      const tags = p.extratags || {};
      const addr = p.address || {};
      const phone = tags["phone"] || tags["contact:phone"] || tags["contact:mobile"] || null;
      const website = tags["website"] || tags["contact:website"] || tags["url"] || null;
      const insta = tags["contact:instagram"] || tags["instagram"] || null;
      const email = tags["email"] || tags["contact:email"] || null;
      const hours = tags["opening_hours"] || null;
      const neighborhood = addr.suburb || addr.neighbourhood || addr.quarter || null;
      const fullAddr = [addr.road, addr.house_number, neighborhood, addr.city || addr.town || addr.village].filter(Boolean).join(", ");
      const name = p.namedetails?.name || tags["name"] || (p.display_name?.split(",")[0]) || null;
      if (!name) return null;
      return {
        business_name: String(name).slice(0, 150),
        category: tags["amenity"] || tags["shop"] || tags["cuisine"] || null,
        address: fullAddr || p.display_name || null,
        neighborhood,
        phone: fmtPhone(phone),
        hours,
        website_url: website,
        instagram_handle: insta ? String(insta).replace(/^.*\//,"").replace(/^@/,"") : null,
        email,
        description: p.type ? `${p.type} (OSM)` : null,
        source: "openstreetmap",
        lat: p.lat ? parseFloat(p.lat) : null,
        lon: p.lon ? parseFloat(p.lon) : null,
      } as Lead;
    }).filter(Boolean) as Lead[];
  } catch (e) { console.warn("nominatim erro:", e); return []; }
}

// ============== OVERPASS (busca por categoria em bbox da cidade) ==============
async function geocodeCity(city: string, state: string): Promise<{lat:number; lon:number; bbox: [number,number,number,number]} | null> {
  try {
    const q = `${city}${state ? ", " + state : ""}, Brasil`;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=br`, {
      headers: { "User-Agent": "LovableProspectBot/1.0", "Accept-Language": "pt-BR" },
    });
    const arr = await r.json();
    if (!Array.isArray(arr) || !arr[0]) return null;
    const p = arr[0];
    const bb = p.boundingbox?.map(parseFloat); // [south, north, west, east]
    return { lat: parseFloat(p.lat), lon: parseFloat(p.lon), bbox: [bb[0], bb[2], bb[1], bb[3]] };
  } catch { return null; }
}

const NICHE_OSM: Record<string, string[]> = {
  hamburgueria: ['amenity=fast_food', 'cuisine=burger', 'amenity=restaurant'],
  hamburguer: ['amenity=fast_food', 'cuisine=burger'],
  burger: ['amenity=fast_food', 'cuisine=burger'],
  pizzaria: ['amenity=restaurant', 'cuisine=pizza'],
  pizza: ['cuisine=pizza'],
  restaurante: ['amenity=restaurant'],
  bar: ['amenity=bar', 'amenity=pub'],
  cafeteria: ['amenity=cafe'],
  cafe: ['amenity=cafe'],
  padaria: ['shop=bakery'],
  acougue: ['shop=butcher'],
  mercado: ['shop=supermarket', 'shop=convenience', 'shop=grocery'],
  mercadinho: ['shop=convenience', 'shop=grocery'],
  farmacia: ['amenity=pharmacy'],
  bebidas: ['shop=alcohol', 'shop=beverages'],
  loja: ['shop=*'],
  petshop: ['shop=pet'],
  barbearia: ['shop=hairdresser', 'shop=barber'],
  salao: ['shop=hairdresser', 'shop=beauty'],
  estetica: ['shop=beauty'],
  hotel: ['tourism=hotel'],
  pousada: ['tourism=guest_house'],
};

function nicheToOsm(niche: string): string[] {
  const k = norm(niche);
  for (const key of Object.keys(NICHE_OSM)) {
    if (k.includes(key)) return NICHE_OSM[key];
  }
  return ['amenity=restaurant', 'shop=*']; // fallback genérico
}

async function searchOverpass(city: string, state: string, niche: string, neighborhood: string): Promise<Lead[]> {
  const geo = await geocodeCity(city, state);
  if (!geo) { console.warn("overpass: city not geocoded"); return []; }
  const [s, w, n, e] = geo.bbox;
  const tags = nicheToOsm(niche);
  const bbox = `${s},${w},${n},${e}`;
  const tagFilters = tags.map(t => {
    const [k, v] = t.split("=");
    if (v === "*") return `node[${k}](${bbox});way[${k}](${bbox});`;
    return `node[${k}=${v}](${bbox});way[${k}=${v}](${bbox});`;
  }).join("");
  const ql = `[out:json][timeout:25];(${tagFilters});out tags center 80;`;
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "LovableProspectBot/1.0",
        "Accept": "application/json",
      },
      body: "data=" + encodeURIComponent(ql),
    });
    if (!r.ok) { console.warn("overpass status:", r.status); return []; }
    const j = await r.json();
    const els = Array.isArray(j.elements) ? j.elements : [];
    const nbNorm = norm(neighborhood);
    return els.map((el: any) => {
      const t = el.tags || {};
      const name = t["name"] || t["brand"] || null;
      if (!name) return null;
      const street = t["addr:street"];
      const num = t["addr:housenumber"];
      const nb = t["addr:suburb"] || t["addr:neighbourhood"] || null;
      const addr = [street, num, nb, t["addr:city"] || city].filter(Boolean).join(", ");
      const lead: Lead = {
        business_name: String(name).slice(0, 150),
        category: t["amenity"] || t["shop"] || t["cuisine"] || null,
        address: addr || null,
        neighborhood: nb,
        phone: fmtPhone(t["phone"] || t["contact:phone"] || t["contact:mobile"]),
        hours: t["opening_hours"] || null,
        website_url: t["website"] || t["contact:website"] || null,
        instagram_handle: t["contact:instagram"] ? String(t["contact:instagram"]).replace(/^.*\//,"").replace(/^@/,"") : null,
        email: t["email"] || t["contact:email"] || null,
        description: t["cuisine"] ? `Cozinha: ${t["cuisine"]}` : null,
        source: "overpass_osm",
        lat: el.lat ?? el.center?.lat ?? null,
        lon: el.lon ?? el.center?.lon ?? null,
      };
      // se filtrou bairro, prioriza
      if (nbNorm && nb && norm(nb).includes(nbNorm)) (lead as any)._nbMatch = true;
      return lead;
    }).filter(Boolean) as Lead[];
  } catch (e) { console.warn("overpass erro:", e); return []; }
}

// ============== GEMINI COM GROUNDING google_search ==============
async function geminiGrounded(query: string, googleKey: string): Promise<Lead[]> {
  const prompt = `Use Google Search para encontrar TODAS as empresas reais que correspondem a: "${query}".
Retorne APENAS JSON puro (sem markdown, sem \`\`\`), formato:
{"leads":[{"business_name":"","phone":"(XX) XXXXX-XXXX","address":"","neighborhood":"","rating":0,"reviews_count":0,"website_url":"","instagram_handle":"","hours":"","category":"","description":""}]}
Mínimo 8, máximo 25 empresas. Use só dados encontrados na busca, nunca invente. Se não tiver um campo, deixe null.`;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 8000 },
        }),
      },
    );
    if (!r.ok) { console.warn("gemini grounded status:", r.status, (await r.text()).slice(0,200)); return []; }
    const j = await r.json();
    const text: string = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("\n") ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) { console.warn("gemini sem JSON:", text.slice(0,200)); return []; }
    const parsed = JSON.parse(m[0]);
    return (Array.isArray(parsed.leads) ? parsed.leads : []).map((l: any) => ({ ...l, phone: fmtPhone(l.phone), source: "gemini_grounded" }));
  } catch (e) { console.warn("gemini grounded erro:", e); return []; }
}

// ============== LOVABLE AI (fallback sem grounding) ==============
async function lovableAiLeads(query: string, lovableKey: string): Promise<Lead[]> {
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você lista empresas reais conhecidas do Brasil. Responda só JSON." },
          { role: "user", content: `Liste empresas reais conhecidas pra: "${query}". Formato: {"leads":[{"business_name","phone","address","neighborhood","website_url","instagram_handle","category","description"}]}. Mínimo 6, máx 20.` },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) { console.warn("lovable ai status:", r.status, (await r.text()).slice(0,200)); return []; }
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content ?? "{}";
    try {
      const parsed = JSON.parse(content);
      return (Array.isArray(parsed.leads) ? parsed.leads : []).map((l: any) => ({ ...l, phone: fmtPhone(l.phone), source: "lovable_ai" }));
    } catch (e) { console.warn("lovable ai parse:", e, content.slice(0,200)); return []; }
  } catch (e) { console.warn("lovable ai erro:", e); return []; }
}

// ============== DUCKDUCKGO HTML (último recurso) ==============
async function duckScrape(query: string): Promise<Lead[]> {
  try {
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/121.0 Safari/537.36" },
    });
    if (!r.ok) return [];
    const html = await r.text();
    const out: Lead[] = [];
    const re = /<a[^>]+class="result__a"[^>]*>([^<]{3,120})<\/a>[\s\S]{0,800}?<a[^>]+class="result__snippet"[^>]*>([\s\S]{0,500}?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const name = m[1].replace(/&amp;/g,"&").trim();
      const snippet = m[2].replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
      const ph = snippet.match(PHONE_RE);
      const insta = snippet.match(INSTA_RE);
      const email = snippet.match(EMAIL_RE);
      out.push({
        business_name: name,
        phone: ph ? `(${ph[1]}) ${ph[2]}-${ph[3]}` : null,
        instagram_handle: insta ? insta[1] : null,
        email: email ? email[0] : null,
        description: snippet.slice(0, 220),
        source: "duckduckgo",
      });
    }
    return out;
  } catch { return []; }
}

function dedupe(leads: Lead[]): Lead[] {
  const map = new Map<string, Lead>();
  for (const l of leads) {
    if (!l.business_name) continue;
    const key = norm(l.business_name).slice(0, 60);
    if (!key || key.length < 3) continue;
    const cur = map.get(key);
    if (!cur) { map.set(key, l); continue; }
    map.set(key, {
      ...cur,
      category: cur.category ?? l.category,
      rating: cur.rating ?? l.rating,
      reviews_count: cur.reviews_count ?? l.reviews_count,
      address: cur.address ?? l.address,
      neighborhood: cur.neighborhood ?? l.neighborhood,
      phone: cur.phone ?? l.phone,
      hours: cur.hours ?? l.hours,
      website_url: cur.website_url ?? l.website_url,
      description: cur.description ?? l.description,
      email: cur.email ?? l.email,
      instagram_handle: cur.instagram_handle ?? l.instagram_handle,
      lat: cur.lat ?? l.lat,
      lon: cur.lon ?? l.lon,
      source: [cur.source, l.source].filter(Boolean).join("+"),
    });
  }
  return [...map.values()];
}

function score(l: Lead): number {
  let s = 30;
  if (!l.website_url) s += 25;
  if (l.instagram_handle) s += 15;
  if (l.phone) s += 15;
  if (l.email) s += 10;
  if (l.rating && l.rating >= 4) s += 5;
  if (l.reviews_count && l.reviews_count > 30) s += 5;
  return Math.min(100, s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "no_auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const caller = await authorizeCaller(supabase, user.id);
    if ((caller as any).error) {
      const c = caller as { error: string; status: number };
      return new Response(JSON.stringify({ error: c.error }), { status: c.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const callerAuth = caller as CallerAuth;

    const body = await req.json().catch(() => ({}));
    const city = String(body.city ?? "").trim();
    const niche = String(body.niche ?? "").trim();
    if (!city || !niche) {
      return new Response(JSON.stringify({ error: "missing_params", message: "Cidade e nicho são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const state = String(body.state ?? "").trim().toUpperCase();
    const region = norm(String(body.region ?? ""));
    const neighborhood = String(body.neighborhood ?? "").trim();
    const sector = String(body.sector ?? "").trim();
    const regionLabel = region && REGION_UFS[region] ? `Brasil ${region}` : "";

    const baseQuery = [niche, neighborhood ? `bairro ${neighborhood}` : "", city, state, sector, regionLabel].filter(Boolean).join(" ").trim();
    console.log("[prospect] busca:", baseQuery);

    // Roda fontes em paralelo
    const [nomMain, nomFallback, overpass, duck] = await Promise.all([
      searchNominatim(`${niche} ${neighborhood ? neighborhood + " " : ""}${city} ${state}`.trim()),
      neighborhood ? searchNominatim(`${niche} ${city} ${state}`.trim()) : Promise.resolve([]),
      searchOverpass(city, state, niche, neighborhood),
      duckScrape(`${baseQuery} telefone contato`),
    ]);
    console.log("[prospect] osm:", nomMain.length, "+", nomFallback.length, "overpass:", overpass.length, "duck:", duck.length);

    // Gemini grounded com chaves rotativas
    const { data: keys } = await supabase
      .from("api_keys").select("id, key_value").in("provider", ["google", "google_ai"]).eq("is_exhausted", false).limit(5);
    let aiLeads: Lead[] = [];
    for (const k of (keys || [])) {
      aiLeads = await geminiGrounded(baseQuery, k.key_value as string);
      if (aiLeads.length > 0) { console.log("[prospect] gemini grounded:", aiLeads.length); break; }
      await supabase.from("api_keys").update({ is_exhausted: true, last_error_at: new Date().toISOString() }).eq("id", (k as any).id);
    }
    if (aiLeads.length === 0) {
      const lovableKey = Deno.env.get("LOVABLE_API_KEY");
      if (lovableKey) {
        aiLeads = await lovableAiLeads(baseQuery, lovableKey);
        console.log("[prospect] lovable ai:", aiLeads.length);
      }
    }

    // Junta tudo. Se filtro de bairro existir, prioriza bairro nas fontes OSM.
    let combined = [...nomMain, ...nomFallback, ...overpass, ...aiLeads, ...duck];
    if (neighborhood) {
      const nbN = norm(neighborhood);
      combined.sort((a, b) => {
        const aM = (a.neighborhood && norm(a.neighborhood).includes(nbN)) ? 1 : 0;
        const bM = (b.neighborhood && norm(b.neighborhood).includes(nbN)) ? 1 : 0;
        return bM - aM;
      });
    }

    const all = dedupe(combined).slice(0, 50);

    if (all.length === 0) {
      return new Response(JSON.stringify({
        inserted: 0, leads: [],
        debug: { osm: nomMain.length + nomFallback.length, overpass: overpass.length, ai: aiLeads.length, duck: duck.length },
        message: "Nenhum lead encontrado nas fontes (OSM, Overpass, Gemini grounded, DuckDuckGo). Tente sem o bairro ou com termo mais comum.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rows = all.map((l) => ({
      business_name: l.business_name.slice(0, 200),
      city,
      state: state || null,
      region: region || null,
      neighborhood: l.neighborhood ?? (neighborhood || null),
      address: l.address ?? null,
      sector: sector || null,
      niche,
      category: l.category ?? null,
      rating: l.rating ?? null,
      reviews_count: l.reviews_count ?? null,
      hours: l.hours ?? null,
      maps_url: l.lat && l.lon
        ? `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lon}`
        : `https://www.google.com/maps/search/${encodeURIComponent(l.business_name + " " + city)}`,
      website_url: l.website_url ?? null,
      has_website: !!l.website_url,
      has_instagram: !!l.instagram_handle,
      instagram_handle: l.instagram_handle ?? null,
      phone: l.phone ?? null,
      whatsapp: l.phone ?? null,
      email: l.email ?? null,
      description: l.description ?? null,
      price_level: l.price_level ?? null,
      priority_score: score(l),
      status: "new",
      source: "google_scrape",
      scrape_source: l.source ?? "multi",
      notes: !l.website_url ? "Sem site detectado — alvo prioritário." : "Tem site, mas pode ter dor com taxas de marketplace.",
      raw_data: l as any,
      created_by: user.id,
      tenant_id: callerAuth.isSuperAdmin ? null : callerAuth.tenantId,
    }));

    const { data: inserted, error: insErr } = await supabase
      .from("remote_prospects").insert(rows).select("*");
    if (insErr) {
      console.error("[prospect] insert err:", insErr.message);
      return new Response(JSON.stringify({ error: "insert_failed", detail: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      inserted: inserted?.length ?? 0,
      leads: inserted,
      query: baseQuery,
      debug: { osm: nomMain.length + nomFallback.length, overpass: overpass.length, ai: aiLeads.length, duck: duck.length },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[prospect] fatal:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
