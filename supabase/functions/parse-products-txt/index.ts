const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Product = {
  name: string;
  price: number;
  cost_price: number;
  resale_price: number;
  category: string;
  description: string;
};

function parseMoney(raw: string): number {
  const value = String(raw || "").replace(/R\$|\s/gi, "");
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function labeled(line: string, labels: string[]): number {
  const pattern = labels.join("|");
  const match = line.match(new RegExp(`(?:${pattern})\\s*[:=\\-]?\\s*R?\\$?\\s*([\\d.]+(?:,\\d{1,2})?)`, "i"));
  return match ? parseMoney(match[1]) : 0;
}

function category(name: string, section: string): string {
  if (section && section !== "Geral") return section;
  const value = name.toLocaleLowerCase("pt-BR");
  if (/redmi|poco|realme|xiaomi|galaxy|moto|iphone|celular|smartphone/.test(value)) return "Celulares";
  return "Geral";
}

function cleanName(line: string): string {
  let value = line
    .replace(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/gu, "")
    .split(/\b(?:custo|cost|preço de custo|preco de custo|fornecedor|revenda|venda sugerida|preço de venda|preco de venda)\b/i)[0]
    .replace(/\s*[-–—:]+\s*$/, "")
    .trim();
  return value.replace(/^[-–—*•\s]+|[-–—*•\s]+$/g, "").trim();
}

function parseCatalog(text: string, priceType: string): Product[] {
  const products: Product[] = [];
  let section = "Geral";
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cost = labeled(line, ["custo", "cost", "preço de custo", "preco de custo", "fornecedor"]);
    const resale = labeled(line, ["revenda", "venda sugerida", "preço de venda", "preco de venda"]);
    const header = line.replace(/^[-=*#\s]+|[-=*#\s]+$/g, "").trim();
    if (!cost && !resale && !/R\$/.test(line) && /^[A-ZÀ-Ý0-9 /&+.-]{3,45}$/u.test(header)) {
      section = header;
      continue;
    }
    if (!cost && !resale) continue;
    const name = cleanName(line);
    if (!name) continue;
    const selected = priceType === "cost" || priceType === "both" ? (resale || cost) : (resale || cost);
    products.push({
      name,
      price: selected,
      cost_price: cost,
      resale_price: resale,
      category: category(name, section),
      description: "",
    });
  }
  const unique = new Map<string, Product>();
  for (const product of products) {
    const key = product.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!unique.has(key)) unique.set(key, product);
  }
  return [...unique.values()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const body = await req.json();
    const products = parseCatalog(body?.txtContent || "", body?.priceType || "resale");
    return new Response(JSON.stringify({ products }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
