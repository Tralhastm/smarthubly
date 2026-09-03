export type InfinitePayInstallmentFee = { percent: number; fixed: number };

export type InfinitePayCharge = InfinitePayInstallmentFee & {
  installments: number;
  baseTotal: number;
  feeTotal: number;
  chargeTotal: number;
};

export function calculateInfinitePayCharge(
  baseTotal: number,
  installments: number,
  fees: Record<string, InfinitePayInstallmentFee> = {},
): InfinitePayCharge {
  const count = Math.min(12, Math.max(1, Math.trunc(Number(installments) || 1)));
  const row = fees[String(count)] || fees[count === 1 ? '1' : 'default'] || { percent: 0, fixed: 0 };
  const percent = Math.max(0, Number(row.percent) || 0);
  const fixed = Math.max(0, Number(row.fixed) || 0);
  const base = Math.max(0, Number(baseTotal) || 0);
  const feeTotal = Math.round((base * (percent / 100) + fixed) * 100) / 100;
  return { installments: count, baseTotal: Math.round(base * 100) / 100, percent, fixed, feeTotal, chargeTotal: Math.round((base + feeTotal) * 100) / 100 };
}

export function buildInfiniteTapDeeplink(handle: string, amount: number, orderId: string, installments = 1, resultUrl: string): string {
  const params = new URLSearchParams({ amount: String(Math.round(amount * 100)), payment_method: 'credit', installments: String(Math.min(12, Math.max(1, installments))), order_id: orderId, result_url: resultUrl });
  return `infinitetap://pay/${encodeURIComponent(handle)}?${params.toString()}`;
}
