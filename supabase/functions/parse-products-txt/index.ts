const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Variant = {
  name: string;
  price: number;
  cost_price: number;
  resale_price: number;
  available: boolean;
};

type Product = {
  name: string;
  price: number;
  cost_price: number;
  resale_price: number;
  category: string;
  description: string;
  variants: Variant[];
};

const COLOR_WORDS = new Set([
  "azul", "amarelo", "branco", "branca", "camuflada", "cinza", "dourado", "dourada",
  "gold", "laranja", "marrom", "prata", "preto", "preta", "roxo", "rosa", "verde",
  "titanium", "storm titanium", "ironman", "iron man", "black", "white", "blue", "pink",
  "purple", "orange", "sage", "green", "yellow", "silver", "golden",
]);

const COLOR_ALIASES: Record<string, string> = {
  blue: "Azul", pink: "Rosa", black: "Preto", white: "Branco", purple: "Roxo",
  orange: "Laranja", sage: "Sálvia", green: "Verde", yellow: "Amarelo",
  silver: "Prata", golden: "Dourado", gold: "Dourado",
};

function parseMoney(raw: string): number {
  const value = String(raw || "").replace(/R\$|\s/gi, "");
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(value) ? value.replace(/\./g, "") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function category(name: string, section: string): string {
  if (section && section !== "Geral") return section;
  const value = name.toLocaleLowerCase("pt-BR");
  if (/redmi|poco|realme|xiaomi|galaxy|moto|iphone|celular|smartphone|infinix|honor|tecno|oppo/.test(value)) return "Celulares";
  return "Geral";
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanName(line: string): string {
  let value = line
    .replace(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/gu, "")
    .split(/\b(?:custo|cost|preço de custo|preco de custo|fornecedor|revenda|venda sugerida|preço de venda|preco de venda)\b/i)[0]
    .replace(/[()]/g, "")
    .trim()
    .replace(/\s*[-–—,:()]+\s*$/, "")
    .trim();
  return value.replace(/^[-–—*•\s]+|[-–—*•\s]+$/g, "").trim();
}

function extractColors(raw: string): string[] {
  const value = raw.replace(/[|*]/g, " ").replace(/\s+/g, " ").trim();
  if (!value || /conferir disponibilidade|cores?$/i.test(value)) return [];
  const parts = value.split(/,|\s+e\s+/i).map((part) => part.trim()).filter(Boolean);
  const colors: string[] = [];
  for (const part of parts) {
    const normalized = normalize(part);
    if (COLOR_WORDS.has(normalized)) colors.push(COLOR_ALIASES[normalized] || part);
  }
  return [...new Set(colors)];
}

function parseCatalog(text: string): Product[] {
  const grouped = new Map<string, Product>();
  let section = "Geral";
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.replace(/^[-=*#\s]+|[-=*#\s]+$/g, "").trim();
    if (!/R\$\s*[\d.,]+/i.test(line) && /^[A-ZÀ-Ý0-9 /&+.'-]{3,60}$/u.test(header)) {
      section = header;
      continue;
    }
    const priceMatch = line.match(/\(\s*R\$\s*([\d.,]+)\s*\)|R\$\s*([\d.,]+)/i);
    if (!priceMatch) continue;
    const price = parseMoney(priceMatch[1] || priceMatch[2]);
    if (price <= 0) continue;
    const beforePrice = line.slice(0, priceMatch.index).trim();
    const afterPrice = line.slice((priceMatch.index || 0) + priceMatch[0].length).trim();
    const name = cleanName(beforePrice);
    if (!name) continue;
    const key = normalize(name);
    let product = grouped.get(key);
    if (!product) {
      product = { name, price, cost_price: price, resale_price: 0, category: category(name, section), description: "", variants: [] };
      grouped.set(key, product);
    }
    const colors = extractColors(afterPrice);
    if (colors.length) {
      for (const color of colors) {
        const colorKey = normalize(color);
        const existing = product.variants.find((variant) => normalize(variant.name) === colorKey);
        if (existing) {
          existing.price = price;
          existing.cost_price = price;
        } else {
          product.variants.push({ name: color, price, cost_price: price, resale_price: 0, available: true });
        }
      }
    } else if (!product.variants.length || product.price <= 0) {
      product.price = price;
      product.cost_price = price;
    }
  }
  return [...grouped.values()].map((product) => ({
    ...product,
    price: product.variants.length ? Math.min(...product.variants.map((variant) => variant.price)) : product.price,
    cost_price: product.variants.length ? Math.min(...product.variants.map((variant) => variant.cost_price)) : product.cost_price,
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const body = await req.json();
    const products = parseCatalog(body?.txtContent || "");
    return new Response(JSON.stringify({ products }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
