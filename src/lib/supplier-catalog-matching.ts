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
    black: 'Preto', blue: 'Azul', green: 'Verde', pink: 'Rosa', silver: 'Prata',
    orange: 'Laranja', yellow: 'Amarelo', midnight: 'Preto', 'space gray': 'Cinza',
    grey: 'Cinza', gray: 'Cinza', purple: 'Roxo', violet: 'Violeta',
    brown: 'Marrom', red: 'Vermelho', gold: 'Dourado', white: 'Branco', violeta: 'Violeta', bordo: 'Bordô', 'bordô': 'Bordô',
    'azul escuro': 'Azul-escuro', 'azul claro': 'Azul-claro',
    'azul marinho': 'Azul-marinho', 'verde escuro': 'Verde-escuro',
    'verde claro': 'Verde-claro', 'vermelho escuro': 'Vermelho-escuro',
    'vermelho claro': 'Vermelho-claro', 'sky blue': 'Sky Blue',
    sage: 'Sage', starlight: 'Starlight',
    titanium: 'Titanium', ironman: 'IronMan', 'iron man': 'IronMan', ocean: 'Ocean',
  };
  const emojiColors: Array<[RegExp, string]> = [
    [/🔵|💙/gu, 'Azul'], [/⚫️?|🖤/gu, 'Preto'], [/🩷|💗/gu, 'Rosa'],
    [/🟣|💜/gu, 'Roxo'], [/⚪️?|🤍/gu, 'Branco'], [/🟢|💚/gu, 'Verde'],
    [/🟠|🧡/gu, 'Laranja'], [/🩶|🩵/gu, 'Cinza'], [/🌕|🟡/gu, 'Dourado'],
  ];

  const colors = [...value.matchAll(colorPattern)].map(match => {
    const raw = match[1].toLocaleLowerCase('pt-BR');
    return colorAliases[raw] || match[1];
  });
  emojiColors.forEach(([pattern, color]) => { if (pattern.test(value)) colors.push(color); });
  return colors.filter((color, index, all) => all.findIndex(c => c.toLocaleLowerCase('pt-BR') === color.toLocaleLowerCase('pt-BR')) === index);
}
