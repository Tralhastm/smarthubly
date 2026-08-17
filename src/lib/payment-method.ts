// Rótulos canônicos de método de pagamento (sempre minúsculos, em PT).
// Use SEMPRE estes valores ao gravar em `orders.payment_method` ou `financial_entries.payment_method`.

export type PaymentMethod =
  | 'dinheiro'
  | 'pix'
  | 'crédito'
  | 'débito'
  | 'mercadopago'
  | 'fiado'
  | 'outro';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pix', label: 'Pix' },
  { value: 'crédito', label: 'Crédito' },
  { value: 'débito', label: 'Débito' },
  { value: 'mercadopago', label: 'MercadoPago' },
  { value: 'fiado', label: 'Fiado' },
  { value: 'outro', label: 'Outro' },
];

/** Normaliza qualquer string para um dos rótulos canônicos. */
export function normalizePaymentMethod(raw?: string | null): PaymentMethod {
  if (!raw) return 'outro';
  const s = raw.toString().trim().toLowerCase();
  if (!s) return 'outro';
  if (/(^|\W)(cash|dinheiro|money|especie|espécie)(\W|$)/.test(s)) return 'dinheiro';
  if (/mercado\s*pago|^mp\b|mercadopago/.test(s)) return 'mercadopago';
  if (/^pix$|\bpix\b/.test(s)) return 'pix';
  if (/credit|crédito|credito|cart[aã]o\s*cr/.test(s)) return 'crédito';
  if (/debit|débito|debito|cart[aã]o\s*d[eé]b/.test(s)) return 'débito';
  if (/fiado/.test(s)) return 'fiado';
  return 'outro';
}

/** Rótulo bonito pra exibir na UI (capitalizado). */
export function formatPaymentMethodLabel(raw?: string | null): string {
  const v = normalizePaymentMethod(raw);
  return PAYMENT_METHODS.find(m => m.value === v)?.label || 'Outro';
}
