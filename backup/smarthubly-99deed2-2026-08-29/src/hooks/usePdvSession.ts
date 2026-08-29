// Estado da sessão PDV na maquininha. Persiste no localStorage por tenant.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PdvOperator = {
  type: "admin" | "waiter";
  id: string;
  name: string;
  role: string;
};

export type PdvCartItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
};

const opKey = (slug: string) => `pdv:op:${slug}`;
const cartKey = (slug: string) => `pdv:cart:${slug}`;

export function usePdvSession(slug: string, tenantId?: string) {
  const [operator, setOperator] = useState<PdvOperator | null>(() => {
    try { const raw = localStorage.getItem(opKey(slug)); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [cart, setCart] = useState<PdvCartItem[]>(() => {
    try { const raw = localStorage.getItem(cartKey(slug)); return raw ? JSON.parse(raw) : []; } catch { return []; }
  });

  useEffect(() => {
    if (operator) localStorage.setItem(opKey(slug), JSON.stringify(operator));
    else localStorage.removeItem(opKey(slug));
  }, [operator, slug]);

  useEffect(() => {
    localStorage.setItem(cartKey(slug), JSON.stringify(cart));
  }, [cart, slug]);

  const login = useCallback(async (pin: string): Promise<{ ok: boolean; error?: string }> => {
    if (!tenantId) return { ok: false, error: "Loja não carregada" };
    const { data, error } = await (supabase as any).rpc("validate_pdv_pin", { _tenant_id: tenantId, _pin: pin });
    if (error) return { ok: false, error: error.message };
    const r = data as any;
    if (!r?.ok) return { ok: false, error: r?.error === "pin_too_short" ? "PIN curto demais" : "PIN inválido" };
    setOperator({ type: r.operator_type, id: r.operator_id, name: r.operator_name, role: r.role });
    return { ok: true };
  }, [tenantId]);

  const logout = useCallback(() => { setOperator(null); setCart([]); }, []);

  const addItem = useCallback((p: { id: string; name: string; price: number }) => {
    setCart(prev => {
      const i = prev.findIndex(x => x.productId === p.id);
      if (i >= 0) { const c = [...prev]; c[i] = { ...c[i], quantity: c[i].quantity + 1 }; return c; }
      return [...prev, { productId: p.id, name: p.name, price: p.price, quantity: 1 }];
    });
  }, []);

  const incItem = useCallback((id: string, delta: number) => {
    setCart(prev => prev.map(x => x.productId === id ? { ...x, quantity: Math.max(0, x.quantity + delta) } : x).filter(x => x.quantity > 0));
  }, []);

  const removeItem = useCallback((id: string) => {
    setCart(prev => prev.filter(x => x.productId !== id));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const total = cart.reduce((s, x) => s + x.price * x.quantity, 0);

  return { operator, cart, total, login, logout, addItem, incItem, removeItem, clearCart };
}
