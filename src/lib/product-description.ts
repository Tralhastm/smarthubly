const COMPLETE_PRODUCT_GUARANTEE = 'Garantia de 30 dias contra defeitos de funcionamento. Não cobre quedas, quebras, mau uso, danos físicos, contato inadequado com líquidos ou alterações no aparelho.';

/**
 * Mantém o formato editorial e recompõe a garantia quando uma descrição antiga
 * foi salva com reticências no fim da última linha.
 */
export const normalizeProductDescription = (value: unknown) => {
  const description = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (!description) return '';

  const guaranteeStart = description.search(/Garantia de 30 dias contra defeitos de funcion(?:amento)?/i);
  const hasTrailingEllipsis = /\.{2,}\s*$/.test(description);
  if (guaranteeStart < 0 && !hasTrailingEllipsis) return description;
  const body = (guaranteeStart >= 0 ? description.slice(0, guaranteeStart) : description)
    .replace(/\.{2,}\s*$/g, '')
    .trim();

  if (guaranteeStart < 0) return body;
  return body ? `${body}\n\n${COMPLETE_PRODUCT_GUARANTEE}` : COMPLETE_PRODUCT_GUARANTEE;
};
