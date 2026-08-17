// Affiliate-mode helpers: track clicks + save user wishlist to localStorage.
import { supabase } from '@/integrations/supabase/client';

export type SavedAffiliateProduct = {
  productId: string;
  tenantId: string;
  tenantSlug: string;
  name: string;
  image: string;
  price: number;
  affiliateUrl: string;
  network: string | null;
  savedAt: string;
};

const KEY = 'affiliate_saved_v1';

export const getSavedProducts = (): SavedAffiliateProduct[] => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedAffiliateProduct[]) : [];
  } catch {
    return [];
  }
};

export const saveProduct = (p: SavedAffiliateProduct) => {
  const all = getSavedProducts();
  const without = all.filter(x => x.productId !== p.productId);
  localStorage.setItem(KEY, JSON.stringify([p, ...without].slice(0, 200)));
};

export const removeSaved = (productId: string) => {
  const all = getSavedProducts().filter(p => p.productId !== productId);
  localStorage.setItem(KEY, JSON.stringify(all));
};

export const trackAffiliateClick = async (params: {
  productId: string;
  tenantId: string;
}) => {
  try {
    await supabase.from('affiliate_clicks').insert({
      product_id: params.productId,
      tenant_id: params.tenantId,
      user_agent: navigator.userAgent.slice(0, 200),
      referrer: document.referrer.slice(0, 300) || null,
    } as any);
  } catch (e) {
    // Silent — tracking is best-effort
    console.warn('click track failed', e);
  }
};
