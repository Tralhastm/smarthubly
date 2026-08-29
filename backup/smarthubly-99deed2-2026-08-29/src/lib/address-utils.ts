// Utilitários para extrair partes específicas de um endereço salvo como string.
// Endereços vêm formatados pelos componentes de input com "Ref: <texto>" embutido.

export interface ParsedAddress {
  /** Endereço sem o trecho "Ref: ..." */
  main: string;
  /** Texto do ponto de referência (sem o prefixo "Ref:"), se houver. */
  reference: string | null;
}

/**
 * Separa o endereço principal do ponto de referência.
 * Aceita variações: "Ref:", "Ref.:", "REF:" — case-insensitive.
 * Retorna o texto da referência limpo de pontuação inicial/final.
 */
export function parseAddress(address?: string | null): ParsedAddress {
  const raw = (address || '').trim();
  if (!raw) return { main: '', reference: null };

  // Procura "Ref:" (com ou sem ponto, case-insensitive). Captura tudo até a próxima
  // separação por " - " ou fim da string (o que vier primeiro).
  const match = raw.match(/(.*?)(?:[,\s-]+)?ref\.?\s*:\s*([^-]+?)(?:\s*-\s*.*)?$/i);
  if (!match) return { main: raw, reference: null };

  const main = (match[1] || '').replace(/[,\s-]+$/g, '').trim();
  const reference = (match[2] || '').replace(/[,\s]+$/g, '').trim();

  return {
    main: main || raw,
    reference: reference || null,
  };
}
