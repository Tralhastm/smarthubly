const REPOSITORY = "Tralhastm/smarthubly";
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_FILE_BYTES = 350 * 1024;
const MAX_MATCHED_FILES = 8;
const TEXT_EXTENSIONS = /\.(ts|tsx|js|jsx|sql|md|json|css|html)$/i;

let cachedSnapshot: Promise<{ commit: string; files: Array<{ path: string; text: string }> }> | null = null;

const normalize = (value: string) => value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function aliases(question: string): string[] {
  const q = normalize(question);
  const terms = q.split(/[^a-z0-9_]+/).filter((term) => term.length >= 4);
  const extra: Record<string, string[]> = {
    esgotad: ["stock", "in_stock", "store_visible", "unavailable"],
    estoque: ["stock", "in_stock", "stock_quantity"],
    ocult: ["visible", "store_visible", "visibility"],
    vitrine: ["storefront", "catalog", "store_visible"],
    automac: ["automation", "automations-cron"],
    botao: ["button", "onClick"],
    gasto: ["cost", "partnership_cost_rules", "financial_entries"],
    sociedade: ["partnership", "society", "settlement"],
    pedido: ["order", "orders", "order_items"],
    fornecedor: ["supplier", "supplier_product_prices", "import-supplier-catalog"],
    aplicar: ["apply", "autoApply", "store_agent_plans"],
    exportar: ["export", "exportCatalogHtml", "exportCatalogTxt"],
    baixar: ["download", "export", "exportCatalogHtml", "exportCatalogTxt"],
    descricao: ["description", "bulkDescription", "Gerar descrições em massa"]
  };
  return Array.from(new Set([...terms, ...Object.entries(extra).flatMap(([key, values]) => q.includes(key) ? values : [])]));
}

function readTarString(bytes: Uint8Array, start: number, length: number): string {
  let end = start;
  while (end < start + length && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.slice(start, end));
}

function parseTar(bytes: Uint8Array): Array<{ path: string; text: string }> {
  const files: Array<{ path: string; text: string }> = [];
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = readTarString(bytes, offset, 100);
    const prefix = readTarString(bytes, offset + 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const sizeText = readTarString(bytes, offset + 124, 12).trim().replace(/\0/g, "");
    const size = Number.parseInt(sizeText || "0", 8) || 0;
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    const isSource = TEXT_EXTENSIONS.test(path) && !path.includes("/node_modules/") && !path.includes("/.git/");
    if (isSource && size <= MAX_FILE_BYTES && bodyEnd <= bytes.length) {
      files.push({ path, text: new TextDecoder().decode(bytes.slice(bodyStart, bodyEnd)) });
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

function sanitize(text: string): string {
  return text
    .replace(/(SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*["'`][^"'`]+["'`]/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/https?:\/\/[^\s"']+\/storage\/v1\/object\/sign\/[^\s"']+/gi, "[SIGNED_URL_REDACTED]");
}

async function loadSnapshot() {
  const commitResponse = await fetch(`https://api.github.com/repos/${REPOSITORY}/commits/main`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "SmartHubly-Sofia-Readonly" }
  });
  if (!commitResponse.ok) throw new Error(`repository_commit_${commitResponse.status}`);
  const commit = String((await commitResponse.json())?.sha || "");
  if (!commit) throw new Error("repository_commit_missing");
  const archiveResponse = await fetch(`https://codeload.github.com/${REPOSITORY}/tar.gz/${commit}`, {
    headers: { "User-Agent": "SmartHubly-Sofia-Readonly" }
  });
  if (!archiveResponse.ok) throw new Error(`repository_archive_${archiveResponse.status}`);
  const compressed = new Uint8Array(await archiveResponse.arrayBuffer());
  if (compressed.byteLength > MAX_ARCHIVE_BYTES) throw new Error("repository_archive_too_large");
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return { commit, files: parseTar(bytes) };
}

async function getSnapshot() {
  if (!cachedSnapshot) cachedSnapshot = loadSnapshot();
  try {
    return await cachedSnapshot;
  } catch (error) {
    cachedSnapshot = null;
    throw error;
  }
}

export async function searchSofiaRepository(question: string): Promise<string> {
  try {
    const snapshot = await getSnapshot();
    const terms = aliases(question);
    const normalizedQuestion = normalize(question);
    const ranked = snapshot.files.map((file) => {
      const normalizedPath = normalize(file.path);
      const normalizedText = normalize(file.text);
      const phraseHit = normalizedQuestion.length >= 8 && normalizedText.includes(normalizedQuestion) ? 20 : 0;
      const hits = terms.reduce((score, term) => score + (normalizedPath.includes(normalize(term)) ? 5 : normalizedText.includes(normalize(term)) ? 1 : 0), 0);
      return { file, score: phraseHit + hits };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, MAX_MATCHED_FILES);
    if (!ranked.length) return `BUSCA READ-ONLY DO REPOSITÓRIO: nenhum arquivo correspondeu à pergunta no commit ${snapshot.commit.slice(0, 12)}. Não invente o comportamento; peça captura de tela ou encaminhe para Suporte & Treino.`;

    const results = ranked.map(({ file }) => {
      const lower = file.text.toLocaleLowerCase();
      const firstTerm = terms.find((term) => lower.includes(term.toLocaleLowerCase())) || "";
      const index = firstTerm ? lower.indexOf(firstTerm.toLocaleLowerCase()) : 0;
      const start = Math.max(0, index - 420);
      const end = Math.min(file.text.length, index + 900);
      const line = file.text.slice(0, index).split("\n").length;
      return `ARQUIVO: ${file.path} (aprox. linha ${line})\nTRECHO READ-ONLY:\n${sanitize(file.text.slice(start, end))}`;
    });
    return `BUSCA READ-ONLY DO REPOSITÓRIO: commit ${snapshot.commit}\n${results.join("\n\n---\n\n")}\n\nA busca leu arquivos versionados sem executar código e sem capacidade de escrita.`;
  } catch (error) {
    console.warn("[sofia] read-only repository search failed", error);
    return "BUSCA READ-ONLY DO REPOSITÓRIO INDISPONÍVEL. Não invente detalhes de código; use apenas o guia/evidência disponível ou peça captura de tela.";
  }
}
