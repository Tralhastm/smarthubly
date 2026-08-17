import React, { createContext, useContext, useState, ReactNode } from 'react';
import type { Tables } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';

export type Product = Tables<'products'>;

export type CartAddon = {
  id: string;
  name: string;
  price: number;
  quantity: number;
};

export interface CartItem {
  product: Product;
  quantity: number;
  // Identificador único da combinação (productId + variantId + addonsHash)
  // permite que o mesmo produto com variantes/adicionais diferentes sejam
  // linhas distintas no carrinho.
  key: string;
  variantId?: string | null;
  variantName?: string | null;
  variantPriceDelta?: number;
  addons?: CartAddon[];
  notes?: string;
}

interface AddOptions {
  variantId?: string | null;
  variantName?: string | null;
  variantPriceDelta?: number;
  addons?: CartAddon[];
  notes?: string;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (product: Product, opts?: AddOptions) => void;
  removeFromCart: (key: string) => void;
  updateQuantity: (key: string, quantity: number) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
  decrementStock: () => Promise<void>;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const buildKey = (productId: string, opts?: AddOptions): string => {
  const v = opts?.variantId || '';
  const a = (opts?.addons || []).map(x => `${x.id}:${x.quantity}`).sort().join('|');
  const n = opts?.notes || '';
  return `${productId}__${v}__${a}__${n}`;
};

const lineUnitPrice = (item: CartItem): number => {
  const base = item.product.price + (item.variantPriceDelta || 0);
  const addonsSum = (item.addons || []).reduce((s, a) => s + a.price * a.quantity, 0);
  return base + addonsSum;
};

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<CartItem[]>([]);

  const addToCart = (product: Product, opts?: AddOptions) => {
    const key = buildKey(product.id, opts);
    setItems(prev => {
      const existing = prev.find(i => i.key === key);
      const stockQty = (product as any).stock_quantity;
      if (existing) {
        if (stockQty != null && existing.quantity >= stockQty) return prev;
        return prev.map(i => i.key === key ? { ...i, quantity: i.quantity + 1 } : i);
      }
      if (stockQty != null && stockQty <= 0) return prev;
      return [...prev, {
        product,
        quantity: 1,
        key,
        variantId: opts?.variantId || null,
        variantName: opts?.variantName || null,
        variantPriceDelta: opts?.variantPriceDelta || 0,
        addons: opts?.addons || [],
        notes: opts?.notes || '',
      }];
    });
  };

  const removeFromCart = (key: string) => {
    setItems(prev => prev.filter(i => i.key !== key));
  };

  const updateQuantity = (key: string, quantity: number) => {
    if (quantity <= 0) { removeFromCart(key); return; }
    setItems(prev => prev.map(i => {
      if (i.key !== key) return i;
      const stockQty = (i.product as any).stock_quantity;
      const q = stockQty != null ? Math.min(quantity, stockQty) : quantity;
      return { ...i, quantity: q };
    }));
  };

  const clearCart = () => setItems([]);

  const decrementStock = async () => {
    // Soma quantidade total por product_id (todas as variantes contam pro mesmo estoque)
    const byProduct = new Map<string, number>();
    items.forEach(i => {
      byProduct.set(i.product.id, (byProduct.get(i.product.id) || 0) + i.quantity);
    });
    for (const [productId, qty] of byProduct) {
      const item = items.find(i => i.product.id === productId);
      if (!item) continue;
      const stockQty = (item.product as any).stock_quantity;
      if (stockQty != null) {
        const newQty = Math.max(0, stockQty - qty);
        await supabase.from('products').update({
          stock_quantity: newQty,
          in_stock: newQty > 0,
        } as any).eq('id', productId);
      }
    }
  };

  const total = items.reduce((sum, i) => sum + lineUnitPrice(i) * i.quantity, 0);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, updateQuantity, clearCart, total, itemCount, decrementStock }}>
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
};

// Helper exposto pra components calcularem unit price
export const getCartLineUnitPrice = lineUnitPrice;
