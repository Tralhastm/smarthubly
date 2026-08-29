// Busca o telefone de UMA loja específica no Google Maps (e fontes equivalentes).
// Estratégia:
//  1) Nominatim (OSM) — busca a empresa pelo nome + cidade e tenta pegar phone/website das tags
//  2) Overpass — busca nodes/ways com mesmo name dentro do bbox da cidade (tag phone)
//  3) Google Maps local pack (HTML) — extrai telefones do snippet
//  4) Bing Maps + DuckDuckGo HTML como fallback
// Valida o DDD pela UF da cidade quando possível.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, assertProspectAccess, type CallerAuth } from "../../../_shared/authorize-caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36";

const DDD_UF: Record<string,string> = {
  "11":"SP","12":"SP","13":"SP","14":"SP","15":"SP","16":"SP","17":"SP","18":"SP","19":"SP",
  "21":"RJ","22":"RJ","24":"RJ","27":"ES","28":"ES",
  "31":"MG","32":"MG","33":"MG","34":"MG","35":"MG","37":"MG","38":"MG",
  "41":"PR","42":"PR","43":"PR","44":"PR","45":"PR","46":"PR",
  "47":"SC","48":"SC","49":"SC","51":"RS","53":"RS","54":"RS","55":"RS",
  "61":"DF","62":"GO","64":"GO","63":"TO","65":"MT","66":"MT","67":"MS","68":"AC","69":"RO",
  "71":"BA","73":"BA","74":"BA","75":"BA","77":"BA","79":"SE",
  "81":"PE","87":"PE","82":"AL","83":"PB","84":"RN","85":"CE","88":"CE","86":"PI","89":"PI",
  "91":"PA","93":"PA","94":"PA","92":"AM","97":"AM","95":"RR","96":"AP","98":"MA","99":"MA",
};
const dddsForUf = (uf: string) => Object.entries(DDD_UF).filter(([,v]) => v === uf).map(([k]) => k);

const norm = (s: string) => (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();

function fmt(d: string): string {
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return d;
}

function extractPhones(html: string): string[] {
  const txt = html.replace(/<[^>]+>/g, " ");
  const re = /(?:\+?55[\s.-]?)?\(?\b([1-9]{2})\)?[\s.-]?(9?\d{4})[\s.-]?(\d{4})\b/g;
  const map = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt)) !== null) {
    const d = `${m[1]}${m[2]}${m[3]}`;
    if (d.length < 10 || d.length > 11) continue;
    if (/^(\d)\1+$/.test(d)) continue;
    map.set(d, (map.get(d) ?? 0) + 1);
  }
  return [...map.entries()].sort((a,b) => b[1]-a[1]).map(([p]) => p);
}

function pickByUf(phones: string[], uf: string | null): string | null {
  if (!phones.length) return null;
  if (!uf) return fmt(phones[0]);
  const ok = new Set(dddsForUf(uf));
  return fmt(
    phones.find(p => ok.has(p.slice(0,2)) && p.length === 11 && p[2] === "9")
    ?? phones.find(p => ok.has(p.slice(0,2)))
    ?? phones[0]
  );
}

async function nominatimSearch(q: string): Promise<{phone: string|null, website: string|null, lat?: number, lon?: number}> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&extratags=1&limit=5&countrycodes=br`, {
      headers: { "User-Agent": "LovableProspectBot/1.0", "Accept-Language": "pt-BR" },
    });
    if (!r.ok) return { phone: null, website: null };
    const arr = await r.json();
    for (const p of arr) {
      const t = p.extratags || {};
      const phone = t["phone"] || t["contact:phone"] || t["contact:mobile"];
      if (phone) return { phone: String(phone), website: t["website"] || t["contact:website"] || null, lat: parseFloat(p.lat), lon: parseFloat(p.lon) };
    }
    if (arr[0]) return { phone: null, website: null, lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) };
  } catch {}
  return { phone: null, website: null };
}

async function overpassByName(name: string, lat: number, lon: number): Promise<string | null> {
  // raio 8km ao redor da coordenada
  const ql = `[out:json][timeout:20];(node(around:8000,${lat},${lon})[name~"${name.replace(/["\\]/g,"")}",i];way(around:8000,${lat},${lon})[name~"${name.replace(/["\\]/g,"")}",i];);out tags 20;`;
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type":"application/x-www-form-urlencoded", "User-Agent": "LovableProspectBot/1.0", "Accept": "application/json" },
      body: "data=" + encodeURIComponent(ql),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const els = Array.isArray(j.elements) ? j.elements : [];
    for (const el of els) {
      const t = el.tags || {};
      const ph = t["phone"] || t["contact:phone"] || t["contact:mobile"];
      if (ph) return String(ph);
    }
  } catch {}
  return null;
}

async function googleLocal(q: string): Promise<string> {
  try {
    const r = await fetch(`https://www.google.com/search?tbm=lcl&q=${encodeURIComponent(q)}&hl=pt-BR&gl=br`, {
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" },
    });
    return r.ok ? await r.text() : "";
  } catch { return ""; }
}
async function bingMaps(q: string): Promise<string> {
  try {
    const r = await fetch(`https://www.bing.com/maps?q=${encodeURIComponent(q)}&setlang=pt-br&cc=br`, {
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" },
    });
    return r.ok ? await r.text() : "";
  } catch { return ""; }
}
async function ddg(q: string): Promise<string> {
  try {
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" },
    });
    return r.ok ? await r.text() : "";
  } catch { return ""; }
}

export async function maps(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "no_auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type":"application/json" } });
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type":"application/json" } });
    const caller = await authorizeCaller(supabase, user.id);
    if ((caller as any).error) {
      const c = caller as { error: string; status: number };
      return new Response(JSON.stringify({ error: c.error }), { status: c.status, headers: { ...corsHeaders, "Content-Type":"application/json" } });
    }
    const callerAuth = caller as CallerAuth;

    const { prospect_id } = await req.json();
    if (!prospect_id) return new Response(JSON.stringify({ error: "missing_prospect_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type":"application/json" } });

    const { data: p } = await supabase.from("remote_prospects").select("*").eq("id", prospect_id).maybeSingle();
    if (!p) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type":"application/json" } });
    const access = assertProspectAccess(callerAuth, p);
    if ((access as any).error) {
      const a = access as { error: string; status: number };
      return new Response(JSON.stringify({ error: a.error }), { status: a.status, headers: { ...corsHeaders, "Content-Type":"application/json" } });
    }

    const name = String(p.business_name).trim();
    const city = String(p.city ?? "").trim();
    const state = String(p.state ?? "").trim().toUpperCase();
    const uf = state || null;
    const fullQ = [name, p.neighborhood, city, state, "telefone"].filter(Boolean).join(" ");

    // 1) Nominatim
    const nm = await nominatimSearch(`${name} ${city} ${state}`.trim());
    let phone: string | null = null;
    let source = "";
    if (nm.phone) {
      const digits = nm.phone.replace(/\D/g,"").replace(/^55(?=\d{10,11}$)/,"");
      if (digits.length >= 10) { phone = fmt(digits); source = "osm"; }
    }

    // 2) Overpass por nome ao redor da coordenada
    if (!phone && nm.lat && nm.lon) {
      const ph = await overpassByName(name, nm.lat, nm.lon);
      if (ph) {
        const digits = ph.replace(/\D/g,"").replace(/^55(?=\d{10,11}$)/,"");
        if (digits.length >= 10) { phone = fmt(digits); source = "overpass"; }
      }
    }

    // 3) Google Maps local + Bing Maps + DDG
    let htmlBag = "";
    if (!phone) {
      const [gh, bh, dh] = await Promise.all([
        googleLocal(fullQ),
        bingMaps(`${name} ${city} ${state}`),
        ddg(`"${name}" ${city} ${state} telefone whatsapp`),
      ]);
      htmlBag = `${gh}\n${bh}\n${dh}`;
      const phones = extractPhones(htmlBag);
      const picked = pickByUf(phones, uf);
      if (picked) { phone = picked; source = gh && phones.length ? "google_maps" : (bh ? "bing_maps" : "web"); }
    }

    if (!phone) {
      return new Response(JSON.stringify({ found: false, message: "Telefone não encontrado no Google Maps/OSM" }), { headers: { ...corsHeaders, "Content-Type":"application/json" } });
    }

    const patch: Record<string, any> = { phone, whatsapp: phone };
    const { error: upErr } = await supabase.from("remote_prospects").update(patch).eq("id", prospect_id);
    if (upErr) return new Response(JSON.stringify({ error: "update_failed", detail: upErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type":"application/json" } });

    return new Response(JSON.stringify({ found: true, phone, source }), { headers: { ...corsHeaders, "Content-Type":"application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type":"application/json" } });
  }

  } catch (e) {
    console.error("[unified:maps] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
