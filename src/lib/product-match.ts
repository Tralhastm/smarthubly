/** Chave estável para comparar ofertas do mesmo produto entre fornecedores. */
export const productMatchKey = (value: string | null | undefined): string => {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  // A ordem dos atributos costuma mudar entre catálogos (ex.: 5G NFC vs NFC 5G).
  // Ordenar tokens mantém modelo, memória e armazenamento comparáveis.
  return normalized.split(/\s+/).filter(Boolean).sort().join(' ');
};
