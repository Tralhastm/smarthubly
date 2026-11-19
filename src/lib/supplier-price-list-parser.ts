import {
  extractSupplierImportColors, isSupplierImportColorLine, looksLikeSupplierColorOnlyLine,
} from './supplier-catalog-matching';

export type SupplierPriceListEntry = {
  name: string;
  cost: number | null;
  resale: number | null;
  colors: string[];
  unavailableColors: string[];
  // Texto de linha que tem cara de cor, mas cujo nome não foi reconhecido.
  unknownColors: string[];
  aliases: string[];
};

type PendingEntry = SupplierPriceListEntry & { generic: number | null };

const cleanImportedName = (value: string) => value
  .replace(/\*/g, '').replace(/[_~`]/g, '').replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
  .replace(/^[^A-Za-zÀ-ÿ0-9]+/, '')
  .replace(/\(\s*R?\$?.*$/i, '').replace(/\s*[-–—,:;….•·\u00B7]+\s*$/, '').replace(/[：:]+$/, '').trim();

// Nomes de marca que nunca devem herdar o prefixo da seção. Um cabeçalho
// “REPOSIÇÃO APPLE” não transforma “DUO 256gb” em produto Apple.
const FOREIGN_BRAND_NAME = /^(?:samsung|galaxy|duo|fold|flip|z\s*(?:fold|flip))\b/i;
const brandAliases = (name: string, brand: string): string[] => {
  if (!name || !brand) return [];
  if (FOREIGN_BRAND_NAME.test(name)) return [];
  if (new RegExp(`^${brand}\\b`, 'i').test(name)) return [];
  return [`${brand} ${name}`];
};

const normalizeAppleShortName = (value: string) => {
  const normalized = value.trim().replace(/\b(azul|silver|prata|preto|branco|bordô|bordo)\b/giu, '').replace(/\s+/g, ' ').trim();
  const withStorage = normalized.replace(/\b(\d{3,4})$/i, '$1GB');
  return /^\d{2}\s+pro(?:\s+max)?\b/i.test(withStorage) ? `iPhone ${withStorage}` : value;
};

const parsePrice = (value: string) => {
  const normalized = value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const sectionBrand = (line: string) => {
  const upper = line.toLocaleUpperCase('pt-BR');
  const heading = line
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, ' ')
    .replace(/[*\s]+/gu, ' ')
    .trim();
  const normalizedHeading = heading.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isAppleHeading = /^(?:(?:reposicao|lista|novidades)\s+)?apple(?:\s+(?:novos|novas|estoque))?$/i.test(normalizedHeading)
    || /\breposicao\s+apple\b/i.test(normalizedHeading);
  const isHeading = /(?:-{3,}|_{3,})/.test(line)
    || /^(?:REALME|SAMSUNG|MOTOROLA|INFINIX|OPPO|HONOR|REDMI|POCO|MI|NOTE)$/i.test(heading)
    || isAppleHeading;
  if (!line.includes('🟢') && !isHeading && !/LINHA\s+(REDMI|NOTE|POCO|MI)/i.test(line)) return '';
  if (isAppleHeading) return 'Apple';
  if (upper.includes('SAMSUNG')) return 'Samsung';
  if (upper.includes('MOTOROLA')) return 'Motorola';
  if (upper.includes('REALME')) return 'Realme';
  if (upper.includes('INFINIX')) return 'Infinix';
  if (upper.includes('OPPO')) return 'Oppo';
  if (upper.includes('HONOR')) return 'Honor';
  if (upper.includes('REDMI')) return 'Redmi';
  if (upper.includes('POCO')) return 'Poco';
  if (/LINHA\s+MI/i.test(line)) return 'Mi';
  if (/LINHA\s+NOTE/i.test(line)) return 'Note';
  return '';
};

/**
 * Lê os formatos já aceitos pelo painel do fornecedor e também listas em blocos:
 * modelo/preço em uma linha, seguida por uma ou mais linhas contendo apenas cores.
 */
export function parseSupplierPriceList(text: string): SupplierPriceListEntry[] {
  const entries: SupplierPriceListEntry[] = [];
  let brand = '';
  let nextSpecialVariant = '';
  let nextUnavailable = false;
  let lastPricedEntry: SupplierPriceListEntry | null = null;
  let current: PendingEntry | null = null;

  const flush = () => {
    if (!current) return;
    const pending = current;
    current = null;
    if (pending.name && (pending.cost != null || pending.resale != null || pending.generic != null)) {
      const { generic, ...entry } = pending;
      const aliases = [entry.name];
      aliases.push(...brandAliases(entry.name, brand));
      const savedEntry = {
        ...entry,
        cost: entry.cost ?? generic,
        aliases,
      };
      entries.push(savedEntry);
      lastPricedEntry = savedEntry;
    } else {
      lastPricedEntry = null;
    }
  };

  const numberFromLine = (line: string, labels: string[]) => {
    const label = labels.join('|');
    const match = line.match(new RegExp(`(?:${label})\\s*:?\\s*R?\\$?\\s*([\\d.]+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)`, 'i'));
    return match ? parsePrice(match[1]) : null;
  };
  // A lista Apple usa frequentemente pontuação decorativa entre modelo e R$,
  // por exemplo: “15 128gb….R$4.050”. O ponto também é aceito como separador.
  const genericMatch = (line: string) => line.match(/^(.*?)(?:\s*[-–—:….,]+\s*|\s+)(?:R?\$\s*)?([\d.]+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*$/i);

  const sourceLines = String(text || '').split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex++) {
    let rawLine = sourceLines[lineIndex];
    // HI PHONE frequentemente quebra o preço depois de “R$” ou deixa o nome
    // do produto em uma linha e “(R$ 660)” na seguinte.
    while (/\(\s*R?\$\s*$/i.test(rawLine.trim()) && lineIndex + 1 < sourceLines.length) {
      rawLine = `${rawLine} ${sourceLines[++lineIndex]}`;
    }
    let line = rawLine.trim().replace(/\*/g, '').trim();
    line = line.replace(/R\$\s*R\$/gi, 'R$');
    if (!line) continue;
    if (/edi[cç][aã]o\s+especial\s+iron\s*man/i.test(line)) {
      nextSpecialVariant = 'Preto (Edição Especial IronMan)';
      continue;
    }
    if (/^\s*crit[eé]rio\s*:/i.test(line)) continue;

    const availabilityMarker = /\b(?:falta|verificar\s+disponibilidade|conferir\s+disponibilidade|indispon[ií]vel)\b/gi;
    const hasAvailabilityMarker = availabilityMarker.test(line);
    if (hasAvailabilityMarker) line = line.replace(availabilityMarker, ' ').replace(/\s+/g, ' ').trim();
    if (!line) {
      if (hasAvailabilityMarker && current) {
        current.unavailableColors = [...new Set([...current.unavailableColors, ...(current.colors.length ? current.colors : ['__all__'])])];
        nextUnavailable = false;
        continue;
      }
      if (hasAvailabilityMarker && entries.length > 0) {
        const previous = entries[entries.length - 1];
        previous.unavailableColors = [...new Set([...previous.unavailableColors, ...(previous.colors.length ? previous.colors : ['__all__'])])];
        nextUnavailable = false;
        continue;
      }
      nextUnavailable = true;
      continue;
    }
    if (hasAvailabilityMarker) nextUnavailable = true;

    if (/^(?:🔥\s*)?(?:promo[cç][aã]o\s+apple|apple|ipad|airpods?|apple\s+watch|macbooks?|airtag|apple\s+pencil)\s*:?\s*$/i.test(line.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').trim())) {
      flush();
      brand = /apple/i.test(line) ? 'Apple' : '';
      lastPricedEntry = null;
      continue;
    }
    const detectedBrand = sectionBrand(line);
    if (detectedBrand) {
      flush();
      brand = detectedBrand;
      lastPricedEntry = null;
      continue;
    }

    const colorsOnOwnLine = extractSupplierImportColors(line);
    if (colorsOnOwnLine.length && isSupplierImportColorLine(line)) {
      const target = current || lastPricedEntry;
      if (target) {
        target.colors = [...new Set([...target.colors, ...colorsOnOwnLine])];
        if (nextUnavailable || target.unavailableColors.includes('__all__')) {
          target.unavailableColors = [...new Set([...target.unavailableColors.filter(color => color !== '__all__'), ...colorsOnOwnLine])];
        }
      }
      // Uma linha composta só por cor é continuação do modelo anterior, nunca
      // um produto independente sem preço.
      nextUnavailable = false;
      continue;
    }

    // Cor escrita com um nome fora do dicionário. Sem este registro a linha
    // cairia como “produto sem cor” e o painel aplicaria o custo em todas as
    // variações. Aqui o texto fica marcado para bloquear e avisar.
    if (!current && !isSupplierImportColorLine(line)) {
      const target = lastPricedEntry;
      const hasEmoji = /[\p{Extended_Pictographic}\uFE0F]/u.test(line);
      if (target && looksLikeSupplierColorOnlyLine(line) && (hasEmoji || target.colors.length > 0)) {
        const label = cleanImportedName(line);
        if (label) target.unknownColors = [...new Set([...target.unknownColors, label])];
        nextUnavailable = false;
        continue;
      }
    }

    const vendorPrice = line.match(/\(\s*R?\$\s*([^)]*)\)/i);
    if (vendorPrice) {
      const name = normalizeAppleShortName(cleanImportedName(line.slice(0, vendorPrice.index ?? 0)));
      const vendorCost = parsePrice(vendorPrice[1]);
      const remainder = line.slice((vendorPrice.index ?? 0) + vendorPrice[0].length);
      const vendorResale = numberFromLine(remainder, ['venda sugerida', 'venda', 'revenda', 'resale', 'preço de venda', 'preco de venda']);
      const aliases = [name];
      aliases.push(...brandAliases(name, brand));
      if (!name && current && vendorCost != null) {
        current.cost = current.cost ?? vendorCost;
        current.colors = [...new Set([...current.colors, ...extractSupplierImportColors(remainder)])];
        flush();
        nextUnavailable = false;
        continue;
      }
      flush();
      if (name && vendorCost != null) {
        const colors = extractSupplierImportColors(remainder);
        if (!colors.length && nextSpecialVariant) colors.push(nextSpecialVariant);
        const entry = { name, cost: vendorCost, resale: vendorResale, colors, unavailableColors: nextUnavailable ? (colors.length ? colors : ['__all__']) : [], unknownColors: [], aliases };
        entries.push(entry);
        lastPricedEntry = entry;
        nextUnavailable = false;
        nextSpecialVariant = '';
      }
      continue;
    }

    const cost = numberFromLine(line, ['custo', 'cost', 'preço de custo', 'preco de custo']);
    const resale = numberFromLine(line, ['venda sugerida', 'venda', 'revenda', 'resale', 'preço de venda', 'preco de venda']);
    if (current && (cost != null || resale != null)) {
      current.cost = current.cost ?? cost;
      current.resale = current.resale ?? resale;
      current.colors = [...new Set([...current.colors, ...extractSupplierImportColors(line)])];
      continue;
    }

    if (cost != null || resale != null) {
      const name = normalizeAppleShortName(cleanImportedName(line.split(/\b(?:custo|venda sugerida|venda|revenda|resale|preço de custo|preco de custo|preço de venda|preco de venda)\b/i)[0].replace(/[-–—:]+\s*$/, '')));
      if (name && !/^(?:custo|venda|revenda|resale|preço|preco)$/i.test(name)) {
        const aliases = [name];
        aliases.push(...brandAliases(name, brand));
        const colors = extractSupplierImportColors(line);
        const entry = { name, cost, resale, colors, unavailableColors: nextUnavailable ? (colors.length ? colors : ['__all__']) : [], unknownColors: [], aliases };
        entries.push(entry);
        lastPricedEntry = entry;
        nextUnavailable = false;
      }
      continue;
    }

    const oneLine = genericMatch(line);
    if (oneLine) {
      if (current) {
        current.generic = parsePrice(oneLine[2]);
        current.colors = [...new Set([...current.colors, ...extractSupplierImportColors(line)])];
        continue;
      }
      flush();
      const name = normalizeAppleShortName(cleanImportedName(oneLine[1]));
      const price = parsePrice(oneLine[2]);
      if (name && price > 0) {
        const aliases = [name];
        aliases.push(...brandAliases(name, brand));
        const colors = extractSupplierImportColors(line);
        // Listas “Produto - R$ preço” tratam o valor como custo; revenda só
        // muda quando vier explicitamente identificada como tal.
        const entry = { name, cost: price, resale: null, colors, unavailableColors: nextUnavailable ? (colors.length ? colors : ['__all__']) : [], unknownColors: [], aliases };
        entries.push(entry);
        lastPricedEntry = entry;
        nextUnavailable = false;
      }
      continue;
    }

    if (/^(?:custo|venda|revenda|resale|preço|preco)\b/i.test(line)) continue;
    flush();
    lastPricedEntry = null;
    current = { name: cleanImportedName(line), cost: null, resale: null, colors: extractSupplierImportColors(line), unavailableColors: nextUnavailable ? ['__all__'] : [], unknownColors: [], generic: null };
    nextUnavailable = false;
  }
  flush();

  return entries.map(entry => {
    const aliases = [...entry.aliases];
    const compact = entry.name.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    if (/^\d/.test(compact)) aliases.push(`iphone ${entry.name}`);
    if (/^iphone\b/i.test(compact)) aliases.push(entry.name.replace(/^iphone\s+/i, ''));
    // Cadastros antigos podem guardar “iPhone 17E” sem capacidade.
    if (/^(?:iphone\s*)?17e\b/i.test(compact)) {
      aliases.push('iphone 17e');
      aliases.push('17e');
    }
    if (/^(?:se|serie|s[eé]rie)\b/i.test(compact)) aliases.push(`apple watch ${entry.name}`);
    return { ...entry, aliases: [...new Set(aliases)] };
  });
}
