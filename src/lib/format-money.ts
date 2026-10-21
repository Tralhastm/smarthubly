const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formata valores monetários em reais no padrão brasileiro (ex.: R$ 1.162,05). */
export function formatBRL(value: number | string | null | undefined): string {
  const amount = typeof value === 'number' ? value : Number(value);
  return brlFormatter.format(Number.isFinite(amount) ? amount : 0);
}
