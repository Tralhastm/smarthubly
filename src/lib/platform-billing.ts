export type PlatformBillingPolicy = {
  societyBillingEnabled?: boolean | null;
  billingMode?: string | null;
  isDonated?: boolean | null;
};

/** Society, subscription, and donated plans do not pay the per-order platform fee. */
export function shouldChargePerOrderPlatformFee(policy: PlatformBillingPolicy): boolean {
  return policy.societyBillingEnabled !== true
    && policy.billingMode !== 'monthly_fixed'
    && policy.isDonated !== true;
}
