// Enriquece um lead com telefone (validado por DDD/UF) e Instagram real.
// Estratégia em camadas:
//  1) Resolve UF a partir da cidade (BrasilAPI IBGE)
//  2) Busca CNPJ por razão social/nome fantasia via casadosdados (público) filtrado pela UF
//  3) Para os top CNPJs, baixa detalhes via BrasilAPI (telefone + e-mail oficiais da Receita)
//  4) Fallback: DDG/Bing pra achar telefone (validado por DDD da UF) e Instagram (validado por nome)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

type CityResolution = { cityName: string; uf: string };
type CnpjDetails = {
  phones: string[];
  email?: string;
  nome?: string;
  razaoSocial?: string;
  uf?: string;
  municipio?: string;
  situacao?: string;
  cnae?: string;
  cnaeDescricao?: string;
  cnaesSecundarios: string[];
};

const STOP_WORDS = new Set([
  "the", "ltda", "ltd", "mei", "me", "eireli", "com", "de", "da", "do", "das", "dos", "para", "por",
  "restaurante", "hamburgueria", "pizzaria", "lanchonete", "loja", "bar", "casa", "delivery", "disk",
  "burger", "burguer", "smash", "grill", "house", "king", "big", "arte", "rei", "mestre", "sabor", "tempero",
  "cantinho", "ponto", "recanto", "silva", "souza", "lima", "costa", "rocha", "mendes", "alves", "pereira", "oliveira", "santos",
]);

const CITY_ALIASES: Record<string, CityResolution> = {
  "rio preto": { cityName: "São José do Rio Preto", uf: "SP" },
  "sao jose rio preto": { cityName: "São José do Rio Preto", uf: "SP" },
  "sjrp": { cityName: "São José do Rio Preto", uf: "SP" },
};

function normalizeText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " e ").replace(/[^a-z0-9]+/g, " ").trim();
}

// DDD → UF
const DDD_UF: Record<string, string> = {
  "11":"SP","12":"SP","13":"SP","14":"SP","15":"SP","16":"SP","17":"SP","18":"SP","19":"SP",
  "21":"RJ","22":"RJ","24":"RJ","27":"ES","28":"ES",
  "31":"MG","32":"MG","33":"MG","34":"MG","35":"MG","37":"MG","38":"MG",
  "41":"PR","42":"PR","43":"PR","44":"PR","45":"PR","46":"PR",
  "47":"SC","48":"SC","49":"SC",
  "51":"RS","53":"RS","54":"RS","55":"RS",
  "61":"DF","62":"GO","64":"GO","63":"TO","65":"MT","66":"MT","67":"MS",
  "68":"AC","69":"RO",
  "71":"BA","73":"BA","74":"BA","75":"BA","77":"BA","79":"SE",
  "81":"PE","87":"PE","82":"AL","83":"PB","84":"RN","85":"CE","88":"CE","86":"PI","89":"PI",
  "91":"PA","93":"PA","94":"PA","92":"AM","97":"AM","95":"RR","96":"AP","98":"MA","99":"MA",
};

function dddsForUf(uf: string): string[] {
  return Object.entries(DDD_UF).filter(([,v]) => v === uf).map(([k]) => k);
}

function tokenize(s: string): string[] {
  return normalizeText(s).split(/\s+/).filter(t => t.length >= 3 && !STOP_WORDS.has(t));
}

async function resolveCity(city: string): Promise<CityResolution | null> {
  // Se a cidade já vier "São Paulo - SP" / "São Paulo/SP"
  const m = city.match(/[\/\-,\s]\s*([A-Z]{2})\s*$/i);
  const explicitUf = m ? m[1].toUpperCase() : null;
  const cityOnly = city.replace(/\s*[-\/,].*$/, "").trim();
  const alias = CITY_ALIASES[normalizeText(cityOnly)];
  if (alias && (!explicitUf || explicitUf === alias.uf)) return alias;
  if (explicitUf) return { cityName: cityOnly, uf: explicitUf };
  try {
    const r = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/municipios", { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const target = normalizeText(cityOnly);
    const mapped = arr.map((row: any) => ({
      row,
      nome: String(row?.nome ?? ""),
      norm: normalizeText(String(row?.nome ?? "")),
      uf: row?.microrregiao?.mesorregiao?.UF?.sigla,
    })).filter((x: any) => x.nome && x.uf);
    const exact = mapped.find((x: any) => x.norm === target);
    const contained = mapped
      .filter((x: any) => x.norm.includes(target) || target.includes(x.norm))
      .sort((a: any, b: any) => a.nome.length - b.nome.length)[0];
    const best = exact ?? contained;
    return best ? { cityName: best.nome, uf: best.uf } : null;
  } catch { /* noop */ }
  return null;
}

async function resolveUf(city: string): Promise<string | null> {
  return (await resolveCity(city))?.uf ?? null;
}

function extractCnpjs(text: string): string[] {
  const re = /(\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2})/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const d = m[1].replace(/\D/g, "");
    if (d.length === 14 && !/^(\d)\1+$/.test(d)) out.add(d);
  }
  return [...out];
}

function normalizePhone(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const br = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (br.length < 10 || br.length > 11) return null;
  if (/^(\d)\1+$/.test(br)) return null;
  return br;
}

async function fetchCnpjDetails(cnpj: string): Promise<CnpjDetails | null> {
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const j = await r.json();
    const phones = [j?.ddd_telefone_1, j?.ddd_telefone_2].map(normalizePhone).filter(Boolean) as string[];
    return {
      phones,
      email: j?.email ?? undefined,
      nome: j?.nome_fantasia || j?.razao_social,
      razaoSocial: j?.razao_social,
      uf: j?.uf,
      municipio: j?.municipio,
      situacao: j?.descricao_situacao_cadastral,
      cnae: j?.cnae_fiscal ? String(j.cnae_fiscal) : undefined,
      cnaeDescricao: j?.cnae_fiscal_descricao,
      cnaesSecundarios: Array.isArray(j?.cnaes_secundarios) ? j.cnaes_secundarios.map((c: any) => String(c?.descricao ?? "")).filter(Boolean) : [],
    };
  } catch { return null; }
}

function nicheTerms(niche: string): string[] {
  const n = normalizeText(niche);
  if (/hamb|burger|burguer|lanche/.test(n)) return ["hamburguer", "hamburgueria", "lanchonete", "lanches", "sandwich", "sanduiche", "fast food", "restaurante", "bares"];
  if (/pizza/.test(n)) return ["pizzaria", "pizza", "restaurante", "lanchonete"];
  if (/acai/.test(n)) return ["acai", "lanchonete", "sucos", "sorvetes", "restaurante"];
  if (/marmit|quentinha|comida/.test(n)) return ["restaurante", "comida", "refeicoes", "marmit", "lanchonete"];
  if (/doc|confeit|bolo/.test(n)) return ["confeitaria", "doces", "padaria", "bolos", "lanchonete"];
  if (/bebida|adega|conveniencia/.test(n)) return ["bebidas", "conveniencia", "mercadorias", "varejista", "bares"];
  const terms = tokenize(niche);
  return terms.length ? terms : [];
}

function cnpjMatchesNiche(det: CnpjDetails, niche: string): boolean {
  const terms = nicheTerms(niche);
  if (terms.length === 0) return true;
  const hay = normalizeText([det.cnaeDescricao, ...det.cnaesSecundarios].join(" "));
  return terms.some(term => hay.includes(normalizeText(term)));
}

function businessNameOverlap(leadName: string, det: CnpjDetails): number {
  const leadTokens = tokenize(leadName);
  if (leadTokens.length === 0) return 0;
  const official = new Set(tokenize(`${det.nome ?? ""} ${det.razaoSocial ?? ""}`));
  return leadTokens.filter(t => official.has(t) || [...official].some(o => o.includes(t) || t.includes(o))).length;
}

function cnpjIsAcceptable(det: CnpjDetails, leadName: string, niche: string, city: string, uf: string | null): boolean {
  if (normalizeText(det.situacao ?? "") !== "ativa") return false;
  if (uf && det.uf && det.uf !== uf) return false;
  if (city && det.municipio && normalizeText(det.municipio) !== normalizeText(city)) return false;
  if (!cnpjMatchesNiche(det, niche)) return false;
  return businessNameOverlap(leadName, det) >= 1;
}

function pickPhoneByDdd(phones: string[], uf: string | null): string | null {
  if (phones.length === 0) return null;
  const validDdds = uf ? new Set(dddsForUf(uf)) : null;
  const mobile = phones.find(p => (!validDdds || validDdds.has(p.slice(0, 2))) && p.length === 11 && p[2] === "9");
  if (mobile) return formatPhone(mobile);
  const any = phones.find(p => !validDdds || validDdds.has(p.slice(0, 2)));
  return any ? formatPhone(any) : null;
}

async function ddgSearch(query: string): Promise<string> {
  try {
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" },
    });
    return r.ok ? await r.text() : "";
  } catch { return ""; }
}

async function bingSearch(query: string): Promise<string> {
  try {
    const r = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=pt-br&cc=br`, {
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" },
    });
    return r.ok ? await r.text() : "";
  } catch { return ""; }
}

async function googleSearch(query: string): Promise<string> {
  try {
    const r = await fetch(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=br`, {
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" },
    });
    return r.ok ? await r.text() : "";
  } catch { return ""; }
}

async function mapsSearch(query: string): Promise<string> {
  try {
    const urls = [
      `https://www.google.com/search?tbm=lcl&q=${encodeURIComponent(query)}&hl=pt-BR&gl=br`,
      `https://www.bing.com/maps?q=${encodeURIComponent(query)}&setlang=pt-br&cc=br`,
    ];
    const htmls = await Promise.all(urls.map(async url => {
      try {
        const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" } });
        return r.ok ? await r.text() : "";
      } catch { return ""; }
    }));
    return htmls.join("\n\n");
  } catch { return ""; }
}

function extractInstagramHandle(html: string, businessHint: string): string | null {
  const re = /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]{2,30})(?:\/|"|\?|#)/g;
  const seen = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const h = m[1].toLowerCase().replace(/\.$/, "");
    if (h.length < 3) continue;
    if (["explore","accounts","p","reel","reels","stories","tv","about","help","developer","privacy","terms","direct","web","legal","oauth","share"].includes(h)) continue;
    seen.set(h, (seen.get(h) ?? 0) + 1);
  }
  if (seen.size === 0) return null;
  const tokens = tokenize(businessHint);
  let best: string | null = null, bestScore = 0;
  for (const [h, count] of seen) {
    let score = 0;
    for (const t of tokens) {
      if (h.includes(t)) { score += t.length * 3; break; }
      if (t.length >= 4 && h.includes(t.slice(0, 4))) { score += 4; break; }
    }
    if (score === 0) continue;
    score += count;
    if (score > bestScore) { bestScore = score; best = h; }
  }
  return best ? `@${best}` : null;
}

function extractPhones(html: string): string[] {
  const cleaned = html.replace(/<[^>]+>/g, " ");
  const patterns = [
    /(?:\+?55[\s.-]?)?\(?\b([1-9]{2})\)?[\s.-]?(9\d{4})[\s.-]?(\d{4})\b/g,
    /(?:\+?55[\s.-]?)?\(?\b([1-9]{2})\)?[\s.-]?([2-5]\d{3})[\s.-]?(\d{4})\b/g,
  ];
  const counts = new Map<string, number>();
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const norm = `${m[1]}${m[2]}${m[3]}`;
      if (norm.length < 10 || norm.length > 11) continue;
      if (/^(\d)\1+$/.test(norm)) continue;
      counts.set(norm, (counts.get(norm) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a,b) => b[1] - a[1]).map(([p]) => p);
}

function formatPhone(digits: string): string {
  if (digits.length === 11) return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
  return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
}

function pickPhoneByUf(phones: string[], uf: string | null): string | null {
  if (phones.length === 0) return null;
  if (!uf) return formatPhone(phones[0]);
  const validDdds = new Set(dddsForUf(uf));
  const match = phones.find(p => validDdds.has(p.slice(0, 2)) && p.length === 11 && p[2] === "9")
    ?? phones.find(p => validDdds.has(p.slice(0, 2)));
  return match ? formatPhone(match) : null;
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

    const { data: roleRow } = await supabase
      .from("platform_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { prospect_id } = await req.json();
    if (!prospect_id) return new Response(JSON.stringify({ error: "prospect_id obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: prospect } = await supabase
      .from("remote_prospects").select("*").eq("id", prospect_id).maybeSingle();
    if (!prospect) return new Response(JSON.stringify({ error: "prospect_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const name = String(prospect.business_name).trim();
    const city = String(prospect.city ?? "").trim();
    const resolvedCity = await resolveCity(city);
    const uf = resolvedCity?.uf ?? null;
    const cityName = resolvedCity?.cityName ?? city.replace(/\s*[-\/,].*$/, "").trim();

    let phone: string | null = null;
    let phoneSource = "";
    let cnpjFound: string | null = null;
    let clearInvalidCnpj = false;

    const existingCnpj = String((prospect as any).cnpj ?? "").replace(/\D/g, "");
    if (existingCnpj.length === 14) {
      const det = await fetchCnpjDetails(existingCnpj);
      if (det && cnpjIsAcceptable(det, name, String(prospect.niche ?? ""), cityName, uf)) {
        cnpjFound = existingCnpj;
        const officialPhone = pickPhoneByDdd(det.phones, uf);
        if (officialPhone) {
          phone = officialPhone;
          phoneSource = `cnpj:${existingCnpj}`;
        }
      } else {
        clearInvalidCnpj = true;
      }
    }

    // === ETAPA 1: busca web (CNPJ + telefone + Instagram) ===
    const queries = [
      `"${name}" "${cityName}" ${uf ?? ""} CNPJ`,
      `"${name}" "${cityName}" ${uf ?? ""} ${prospect.niche ?? ""} CNPJ`,
      `"${name}" "${cityName}" site:instagram.com`,
      `"${name}" "${cityName}" ${uf ?? ""} whatsapp telefone`,
      `${name} ${cityName} ${prospect.niche ?? ""} contato`,
    ];
    const ddgHtmls = await Promise.all(queries.map(q => ddgSearch(q)));
    const bingHtmls = await Promise.all(queries.map(q => bingSearch(q)));
    const googleHtmls = await Promise.all(queries.slice(0, 2).map(q => googleSearch(q)));
    const mapsHtml = await mapsSearch(`${name} ${cityName} ${uf ?? ""} telefone`);
    const combined = [...ddgHtmls, ...bingHtmls, ...googleHtmls, mapsHtml].join("\n\n");

    // === ETAPA 2: extrai CNPJs da web e valida via BrasilAPI ===
    if (!cnpjFound) {
      const candidateCnpjs = extractCnpjs(combined.replace(/<[^>]+>/g, " ")).slice(0, 8);
      for (const cnpj of candidateCnpjs) {
        const det = await fetchCnpjDetails(cnpj);
        if (!det) continue;
        if (!cnpjIsAcceptable(det, name, String(prospect.niche ?? ""), cityName, uf)) continue;
        cnpjFound = cnpj;
        clearInvalidCnpj = false;
        const officialPhone = pickPhoneByDdd(det.phones, uf);
        if (officialPhone) {
          phone = officialPhone;
          phoneSource = `cnpj:${cnpj}`;
        }
        break;
      }
    }

    // === ETAPA 3: telefone via Maps/web (se CNPJ não deu) ===
    if (!phone) {
      const phones = extractPhones(`${mapsHtml}\n${combined}`);
      const picked = pickPhoneByUf(phones, uf);
      if (picked) { phone = picked; phoneSource = mapsHtml ? "maps/web" : "web"; }
    }

    const igHandle = (prospect.instagram_handle && prospect.instagram_handle.startsWith("@"))
      ? prospect.instagram_handle
      : extractInstagramHandle(combined, name);

    // === ETAPA 3: persistir ===
    const patch: Record<string, any> = {};
    let foundIg = false, foundPhone = false;
    if (igHandle && igHandle !== prospect.instagram_handle) {
      patch.instagram_handle = igHandle;
      patch.has_instagram = true;
      foundIg = true;
    }
    if (phone && phone !== prospect.phone) {
      patch.phone = phone;
      foundPhone = true;
    }
    if (cnpjFound && cnpjFound !== (prospect as any).cnpj) {
      patch.cnpj = cnpjFound;
    } else if (clearInvalidCnpj) {
      patch.cnpj = null;
    }

    if (Object.keys(patch).length > 0) {
      const hasSite = !!prospect.has_website;
      const hasIg = patch.has_instagram ?? prospect.has_instagram;
      let score = prospect.priority_score ?? 30;
      if (!hasSite && hasIg) score = Math.max(score, 100);
      if (foundPhone) score = Math.min(100, score + 10);
      if (cnpjFound) score = Math.min(100, score + 5);
      patch.priority_score = score;

      const { error: updErr } = await supabase
        .from("remote_prospects").update(patch).eq("id", prospect_id);
      if (updErr) return new Response(JSON.stringify({ error: "update_failed", detail: updErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      ok: true,
      uf,
      cnpj: cnpjFound,
      phone_source: phoneSource || null,
      found: { instagram: foundIg ? igHandle : null, phone: foundPhone ? phone : null },
      changed: foundIg || foundPhone || !!cnpjFound,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
