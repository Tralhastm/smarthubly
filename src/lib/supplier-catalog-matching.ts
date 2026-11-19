const normalizeIdentity = (value: string) => String(value || '')
  .trim()
  .toLocaleLowerCase('pt-BR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ');

const curatedSupplierAliases: Record<string, Record<string, string[]>> = {
  // O HI PHONE também escreve “Galaxy A07 128GB” para o cadastro
  // “Samsung Galaxy A07 128GB/4GB”. O alias não foi aprovado (veja
  // supplier-catalog-matching.test.ts) e a STORYTEK usa o mesmo fornecedor,
  // então a linha aparece como “não encontrada” sem alterar custo algum.
  'mania digital': {
    'samsung galaxy a07 128gb/4gb': ['Galaxy A07 128GB'],
    'xiaomi redmi note 15 pro 256gb/8gb (versao 4g)': ['Note 15 Pro NFC 256/8GB'],
  },
};

/**
 * Retorna aliases de correspondência aprovados para um fornecedor e um cadastro
 * exatos. Os nomes públicos dos produtos não são alterados e não há fuzzy match.
 */
export function getCuratedSupplierProductAliases(supplierName: string, productName: string): string[] {
  const supplierKey = normalizeIdentity(supplierName);
  const productKey = normalizeIdentity(productName);
  return curatedSupplierAliases[supplierKey]?.[productKey] || [];
}

// Compostos vêm primeiro: “rose gold” não pode virar “Rosa” + “Dourado”.
const SUPPLIER_COLOR_PATTERN = /\b(rose\s*gold|azul\s+(?:escuro|claro|marinho|oliva)|verde\s+(?:escuro|claro|oliva)|vermelho\s+(?:escuro|claro)|sky\s+blue|space\s+(?:gray|grey|black|white)|off\s*white|two\s*tone|desert\s+titanium|ultramarine|preto|preta|azul|verde|laranja|amarelo|amarela|roxo|rosa|cobre|terracota|vinho|claret|champanhe|champagne|marfim|ivory|creme|turquesa|teal|petroleo|denim|navy|grafite|cinza|branco|branca|dourado|dourada|prata|marrom|bord[oô]|bordo|vermelho|vermelha|violeta|titanium|gold|iron\s*man|ironman|black|white|blue|green|yellow|pink|silver|orange|sage|midnight|starlight|ocean|grey|gray|purple|violet|brown|red|camuflada)\b/giu;

// Palavras que acompanham o nome da cor sem criar uma cor nova
// (“Space Black”, “Cosmic Orange”, “Deep Blue”, “Desert Titanium”).
const SUPPLIER_COLOR_QUALIFIERS = /\b(?:space|cosmic|deep|clear|dark|light|extra|premium|desert|alpine|sierra|papaya|cliff|canyon|ultra|two|tone|off|cor|cores|e|ou|and|or)\b/giu;

const SUPPLIER_COLOR_ALIASES: Record<string, string> = {
  azul: 'Azul', preto: 'Preto', preta: 'Preto', branco: 'Branco', branca: 'Branco',
  verde: 'Verde', rosa: 'Rosa', laranja: 'Laranja', amarelo: 'Amarelo', amarela: 'Amarelo',
  roxo: 'Roxo', cinza: 'Cinza', dourado: 'Dourado', dourada: 'Dourado', prata: 'Prata',
  marrom: 'Marrom', vermelho: 'Vermelho', vermelha: 'Vermelho', bordô: 'Bordô', bordo: 'Bordô',
  grafite: 'Grafite', camuflada: 'Camuflada',
  black: 'Preto', blue: 'Azul', green: 'Verde', pink: 'Rosa', silver: 'Prata',
  orange: 'Laranja', yellow: 'Amarelo', midnight: 'Preto', 'space gray': 'Cinza',
  'space grey': 'Cinza', 'space black': 'Preto', 'space white': 'Branco',
  grey: 'Cinza', gray: 'Cinza', purple: 'Roxo', violet: 'Violeta',
  brown: 'Marrom', red: 'Vermelho', gold: 'Dourado', white: 'Branco', violeta: 'Violeta',
  'azul escuro': 'Azul-escuro', 'azul claro': 'Azul-claro', 'azul oliva': 'Azul-oliva',
  'azul marinho': 'Azul-marinho', navy: 'Azul-marinho',
  'verde escuro': 'Verde-escuro', 'verde claro': 'Verde-claro', 'verde oliva': 'Verde-oliva',
  'vermelho escuro': 'Vermelho-escuro', 'vermelho claro': 'Vermelho-claro',
  'sky blue': 'Sky Blue', 'rose gold': 'Rose Gold', 'off white': 'Branco',
  'two tone': 'Two Tone', 'desert titanium': 'Titanium', ultramarine: 'Ultramarino',
  sage: 'Sage', starlight: 'Starlight', ocean: 'Ocean', titanium: 'Titanium',
  ironman: 'IronMan', 'iron man': 'IronMan',
  cobre: 'Cobre', terracota: 'Terracota', vinho: 'Vinho', claret: 'Claret',
  champanhe: 'Champanhe', champagne: 'Champanhe', marfim: 'Marfim', ivory: 'Marfim',
  creme: 'Creme', turquesa: 'Turquesa', teal: 'Turquesa', petroleo: 'Petróleo',
  denim: 'Denim',
};

const SUPPLIER_EMOJI_COLORS: Array<[RegExp, string]> = [
  [/🔵|💙|🩵/u, 'Azul'], [/⚫️?|🖤/u, 'Preto'], [/🩷|💗/u, 'Rosa'],
  [/🟣|💜/u, 'Roxo'], [/⚪️?|🤍/u, 'Branco'], [/🟢|💚/u, 'Verde'],
  [/🟠|🧡/u, 'Laranja'], [/🩶/u, 'Cinza'], [/🌕|🟡|🤎/u, 'Dourado'],
  [/🟤|🍷/u, 'Marrom'], [/🍁/u, 'Bordô'],
];

/** Extrai cores reconhecidas de linhas de preço, incluindo cores em inglês. */
export function extractSupplierImportColors(value: string): string[] {
  const normalizedValue = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const colors = [...normalizedValue.matchAll(new RegExp(SUPPLIER_COLOR_PATTERN, 'giu'))].map(match => {
    const raw = match[1].toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
    return SUPPLIER_COLOR_ALIASES[raw] || match[1];
  });
  // O emoji é decoração do nome escrito (“Cobre 🟠”, “Silver ⚪”, “Bordo 🍁”).
  // Quando existe ao menos uma cor em texto, o emoji não pode criar segunda
  // cor: ele só vale quando a linha é composta apenas por emojis (“🩵🖤”).
  if (colors.length) return colors.filter((color, index, all) => all.findIndex(c => c.toLocaleLowerCase('pt-BR') === color.toLocaleLowerCase('pt-BR')) === index);
  SUPPLIER_EMOJI_COLORS.forEach(([pattern, color]) => {
    if (!pattern.test(value)) return;
    colors.push(color);
  });
  return colors.filter((color, index, all) => all.findIndex(c => c.toLocaleLowerCase('pt-BR') === color.toLocaleLowerCase('pt-BR')) === index);
}

/** Retorna true quando a linha contém somente nomes de cores, conectores e emojis. */
export function isSupplierImportColorLine(value: string): boolean {
  if (!extractSupplierImportColors(value).length) return false;
  const remainder = String(value || '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(new RegExp(SUPPLIER_COLOR_PATTERN, 'giu'), ' ')
    .replace(SUPPLIER_COLOR_QUALIFIERS, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return remainder.length === 0;
}

// Palavras de aviso/rodapé que nunca são nomes de cor. Sem isso, uma linha de
// ruído curta viraria “cor não reconhecida” e bloquearia um produto válido.
const SUPPLIER_NOISE_WORDS = /(?:galeria|fotos?|imagens?|obs|observacoes?|atenc(?:ao|ao)|confira|novidades?|promoc(?:ao|ao)|estoque|quantidade|pedidos?|entrega|pagamento|criterio|critico|links?|catalogos?|lista|whatsapp|telegram)/i;

/**
 * Linha que tem cara de continuação de cor (sem preço, sem número, poucas
 * palavras), mas cuja cor não foi reconhecida. Serve para o painel bloquear o
 * item em vez de aplicar silenciosamente um preço no produto inteiro.
 */
export function looksLikeSupplierColorOnlyLine(value: string): boolean {
  const raw = String(value || '').replace(/[*_~]/g, ' ').trim();
  if (!raw) return false;
  if (/\d/.test(raw)) return false;
  if (/(?:r\$|custo|venda|revenda|resale|pre[cç]o|promo[cç][aã]o|obs|edi[cç][aã]o)/i.test(raw)) return false;
  if (SUPPLIER_NOISE_WORDS.test(raw)) return false;
  const tokens = raw
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, ' ')
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  return tokens.length > 0 && tokens.length <= 4;
}
