const normalizeIdentity = (value: string) => String(value || '')
  .trim()
  .toLocaleLowerCase('pt-BR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ');

const curatedSupplierAliases: Record<string, Record<string, string[]>> = {
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

/** Extrai cores reconhecidas de linhas de preço, incluindo cores em inglês. */
export function extractSupplierImportColors(value: string): string[] {
  const colorPattern = /\b(azul\s+(?:escuro|claro|marinho)|verde\s+(?:escuro|claro)|vermelho\s+(?:escuro|claro)|sky\s+blue|space\s+gray|preto|preta|azul|verde|laranja|amarelo|amarela|roxo|rosa|cinza|branco|branca|dourado|dourada|prata|marrom|bordô|bordo|vermelho|vermelha|violeta|titanium|grafite|gold|iron\s*man|ironman|black|white|blue|green|yellow|pink|silver|orange|sage|midnight|starlight|ocean|grey|gray|purple|violet|brown|red|camuflada)\b/giu;
  const colorAliases: Record<string, string> = {
    azul: 'Azul', preto: 'Preto', preta: 'Preto', branco: 'Branco', branca: 'Branco',
    verde: 'Verde', rosa: 'Rosa', laranja: 'Laranja', amarelo: 'Amarelo', amarela: 'Amarelo',
    roxo: 'Roxo', cinza: 'Cinza', dourado: 'Dourado', dourada: 'Dourado', prata: 'Prata',
    marrom: 'Marrom', vermelho: 'Vermelho', vermelha: 'Vermelho', bordô: 'Bordô', bordo: 'Bordô',
    grafite: 'Grafite', camuflada: 'Camuflada',
    black: 'Preto', blue: 'Azul', green: 'Verde', pink: 'Rosa', silver: 'Prata',
    orange: 'Laranja', yellow: 'Amarelo', midnight: 'Preto', 'space gray': 'Cinza',
    grey: 'Cinza', gray: 'Cinza', purple: 'Roxo', violet: 'Violeta',
    brown: 'Marrom', red: 'Vermelho', gold: 'Dourado', white: 'Branco', violeta: 'Violeta',
    'azul escuro': 'Azul-escuro', 'azul claro': 'Azul-claro',
    'azul marinho': 'Azul-marinho', 'verde escuro': 'Verde-escuro',
    'verde claro': 'Verde-claro', 'vermelho escuro': 'Vermelho-escuro',
    'vermelho claro': 'Vermelho-claro', 'sky blue': 'Sky Blue',
    sage: 'Sage', starlight: 'Starlight',
    titanium: 'Titanium', ironman: 'IronMan', 'iron man': 'IronMan', ocean: 'Ocean',
  };
  const emojiColors: Array<[RegExp, string]> = [
    [/🔵|💙|🩵/u, 'Azul'], [/⚫️?|🖤/u, 'Preto'], [/🩷|💗/u, 'Rosa'],
    [/🟣|💜/u, 'Roxo'], [/⚪️?|🤍/u, 'Branco'], [/🟢|💚/u, 'Verde'],
    [/🟠|🧡/u, 'Laranja'], [/🩶/u, 'Cinza'], [/🌕|🟡/u, 'Dourado'],
  ];

  const normalizedValue = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const colors = [...normalizedValue.matchAll(colorPattern)].map(match => {
    const raw = match[1].toLocaleLowerCase('pt-BR');
    return colorAliases[raw] || match[1];
  });
  emojiColors.forEach(([pattern, color]) => {
    if (!pattern.test(value)) return;
    // Em listas Apple, “Silver ⚪” usa o círculo como representação visual
    // da própria cor prata, não como uma variante branca adicional.
    if (color === 'Branco' && colors.includes('Prata')) return;
    colors.push(color);
  });
  return colors.filter((color, index, all) => all.findIndex(c => c.toLocaleLowerCase('pt-BR') === color.toLocaleLowerCase('pt-BR')) === index);
}

/** Retorna true quando a linha contém somente nomes de cores, conectores e emojis. */
export function isSupplierImportColorLine(value: string): boolean {
  if (!extractSupplierImportColors(value).length) return false;
  const colorPattern = /\b(azul\s+(?:escuro|claro|marinho)|verde\s+(?:escuro|claro)|vermelho\s+(?:escuro|claro)|sky\s+blue|space\s+gray|preto|preta|azul|verde|laranja|amarelo|amarela|roxo|rosa|cinza|branco|branca|dourado|dourada|prata|marrom|bordô|bordo|vermelho|vermelha|violeta|titanium|grafite|gold|iron\s*man|ironman|black|white|blue|green|yellow|pink|silver|orange|sage|midnight|starlight|ocean|grey|gray|purple|violet|brown|red|camuflada)\b/giu;
  const remainder = String(value || '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(colorPattern, ' ')
    .replace(/\b(?:e|ou|and|or|cor|cores)\b/giu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return remainder.length === 0;
}
