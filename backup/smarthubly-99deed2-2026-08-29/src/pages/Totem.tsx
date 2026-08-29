// Modo Totem — autoatendimento balcão em tela cheia (kiosk).
// Cliente: escolhe produtos -> ve carrinho -> escolhe pagamento -> recebe senha.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTenantBySlug } from "@/hooks/useTenants";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeft, CreditCard, Smartphone, Banknote, Minus, Plus, ShoppingCart, Search, Check } from "lucide-react";
import { toast } from "sonner";

type Product = { id: string; name: string; price: number; image: string | null; category: string | null };
type CartItem = { product_id: string; name: string; price: number; qty: number };
type Step = "catalog" | "cart" | "pay" | "done";

const fmt = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

export default function Totem() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { data: tenant, isLoading } = useTenantBySlug(slug);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [step, setStep] = useState<Step>("catalog");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("Todos");
  const [orderTicket, setOrderTicket] = useState<{ ticket: string; method: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Lock viewport pra kiosk
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    const vp = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    const prev = vp?.content;
    if (vp) vp.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
    return () => { if (vp && prev) vp.content = prev; };
  }, []);

  useEffect(() => {
    if (!tenant?.id) return;
    (async () => {
      const { data } = await supabase.from("products")
        .select("id,name,price,image,category")
        .eq("tenant_id", tenant.id).eq("in_stock", true).order("category");
      setProducts((data as any) || []);
    })();
  }, [tenant?.id]);

  const total = useMemo(() => cart.reduce((s, i) => s + i.price * i.qty, 0), [cart]);
  const itemCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    products.forEach(p => p.category && s.add(p.category));
    return ["Todos", ...Array.from(s).sort()];
  }, [products]);

  const filtered = useMemo(() => products.filter(p => {
    if (cat !== "Todos" && p.category !== cat) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [products, cat, search]);

  const addItem = (p: Product) => {
    setCart(prev => {
      const existing = prev.find(i => i.product_id === p.id);
      if (existing) return prev.map(i => i.product_id === p.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { product_id: p.id, name: p.name, price: Number(p.price), qty: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart(prev => prev.map(i => i.product_id === id ? { ...i, qty: i.qty + delta } : i).filter(i => i.qty > 0));
  };

  const finalize = async (method: "credit_card" | "debit_card" | "pix" | "dinheiro") => {
    if (!tenant?.id || cart.length === 0) return;
    setSaving(true);
    try {
      const ticket = `T${Math.floor(Math.random() * 900 + 100)}`;
      const payload: any = {
        tenant_id: tenant.id,
        total,
        delivery_fee: 0,
        payment_method: method,
        delivery_type: "pickup",
        status: method === "dinheiro" ? "received" : "received",
        customer_name: `Senha ${ticket}`,
        customer_phone: "",
        customer_address: "Totem balcão",
      };
      const { data: order, error } = await (supabase as any).from("orders").insert(payload).select("id").single();
      if (error) throw error;
      await (supabase as any).from("order_items").insert(cart.map(i => ({
        order_id: order.id,
        product_id: i.product_id,
        product_name: i.name,
        product_price: i.price,
        quantity: i.qty,
      })));
      setOrderTicket({ ticket, method });
      setCart([]);
      setStep("done");
    } catch (e: any) {
      toast.error(e.message || "Erro");
    } finally {
      setSaving(false);
    }
  };

  // Auto-reset 25s após cupom
  useEffect(() => {
    if (step !== "done") return;
    const t = setTimeout(() => { setOrderTicket(null); setStep("catalog"); }, 25000);
    return () => clearTimeout(t);
  }, [step]);

  if (isLoading) return <div className="h-[100dvh] flex items-center justify-center">Carregando...</div>;
  if (!tenant) return <div className="h-[100dvh] flex items-center justify-center">Loja não encontrada</div>;

  // CUPOM / SENHA
  if (step === "done" && orderTicket) {
    return (
      <div className="h-[100dvh] bg-primary text-primary-foreground flex flex-col items-center justify-center p-8 text-center">
        <Check className="w-24 h-24 mb-6" />
        <div className="text-2xl mb-2 opacity-90">Sua senha</div>
        <div className="text-9xl font-bold tracking-widest mb-4">{orderTicket.ticket}</div>
        <div className="text-xl mb-8">
          {orderTicket.method === "dinheiro" || orderTicket.method === "pix"
            ? "Pague no balcão e aguarde ser chamado"
            : "Aguarde ser chamado para retirar"}
        </div>
        <Button size="lg" variant="secondary" onClick={() => { setOrderTicket(null); setStep("catalog"); }}>
          Novo pedido
        </Button>
        <div className="text-xs opacity-60 mt-6">Tela reinicia em 25 segundos</div>
      </div>
    );
  }

  // PAGAMENTO
  if (step === "pay") {
    return (
      <div className="h-[100dvh] bg-background flex flex-col">
        <header className="p-4 border-b flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setStep("cart")}><ArrowLeft className="w-6 h-6" /></Button>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Pagamento</div>
            <div className="text-xl font-bold">{fmt(total)}</div>
          </div>
        </header>
        <div className="flex-1 p-6 grid grid-cols-2 gap-4 content-center max-w-2xl mx-auto w-full">
          {([
            { m: "credit_card", icon: CreditCard, label: "Cartão de crédito" },
            { m: "debit_card", icon: CreditCard, label: "Cartão de débito" },
            { m: "pix", icon: Smartphone, label: "PIX" },
            { m: "dinheiro", icon: Banknote, label: "Dinheiro no balcão" },
          ] as const).map(o => (
            <Button key={o.m} variant="outline" disabled={saving} className="h-32 flex-col gap-3 text-lg" onClick={() => finalize(o.m as any)}>
              <o.icon className="w-10 h-10" />
              {o.label}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  // CARRINHO
  if (step === "cart") {
    return (
      <div className="h-[100dvh] bg-background flex flex-col">
        <header className="p-4 border-b flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setStep("catalog")}><ArrowLeft className="w-6 h-6" /></Button>
          <div className="flex-1">
            <div className="text-xs uppercase text-muted-foreground">Seu pedido</div>
            <div className="text-xl font-bold">{itemCount} {itemCount === 1 ? "item" : "itens"}</div>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 space-y-2 max-w-2xl mx-auto w-full">
          {cart.length === 0 && <div className="text-center text-muted-foreground py-12">Carrinho vazio</div>}
          {cart.map(i => (
            <Card key={i.product_id} className="p-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="font-semibold">{i.name}</div>
                <div className="text-sm text-muted-foreground">{fmt(i.price)} cada</div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="icon" variant="outline" className="h-10 w-10" onClick={() => updateQty(i.product_id, -1)}><Minus className="w-4 h-4" /></Button>
                <span className="w-8 text-center font-bold text-lg">{i.qty}</span>
                <Button size="icon" variant="outline" className="h-10 w-10" onClick={() => updateQty(i.product_id, 1)}><Plus className="w-4 h-4" /></Button>
              </div>
              <div className="w-24 text-right font-bold text-primary">{fmt(i.price * i.qty)}</div>
            </Card>
          ))}
        </div>
        <div className="border-t p-4 bg-card max-w-2xl mx-auto w-full">
          <div className="flex justify-between text-2xl font-bold mb-3">
            <span>Total</span><span className="text-primary">{fmt(total)}</span>
          </div>
          <Button size="lg" className="w-full h-14 text-lg" disabled={cart.length === 0} onClick={() => setStep("pay")}>
            Ir para pagamento
          </Button>
        </div>
      </div>
    );
  }

  // CATÁLOGO (default)
  return (
    <div className="h-[100dvh] bg-background flex flex-col">
      <header className="p-4 border-b flex items-center gap-3 bg-primary text-primary-foreground">
        {tenant.logo_url ? <img src={tenant.logo_url} alt={tenant.name} className="w-12 h-12 rounded object-cover" /> : null}
        <div className="flex-1">
          <div className="text-xs uppercase opacity-80">Autoatendimento</div>
          <div className="text-xl font-bold">{tenant.name}</div>
        </div>
        <Button size="lg" variant="secondary" onClick={() => setStep("cart")} disabled={cart.length === 0}>
          <ShoppingCart className="w-5 h-5 mr-2" /> {fmt(total)} {itemCount > 0 && <span className="ml-2 bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs">{itemCount}</span>}
        </Button>
      </header>

      <div className="p-3 border-b space-y-2">
        <div className="relative max-w-xl mx-auto">
          <Search className="w-5 h-5 absolute left-3 top-3 text-muted-foreground" />
          <Input className="pl-10 h-11 text-base" placeholder="Buscar produto..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {categories.map(c => (
            <Button key={c} size="sm" variant={cat === c ? "default" : "outline"} className="shrink-0" onClick={() => setCat(c)}>{c}</Button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 content-start">
        {filtered.map(p => (
          <Card key={p.id} className="overflow-hidden flex flex-col cursor-pointer hover:border-primary transition-colors" onClick={() => addItem(p)}>
            {p.image ? <img src={p.image} alt={p.name} className="w-full h-32 object-cover" /> : <div className="w-full h-32 bg-muted" />}
            <div className="p-3 flex-1 flex flex-col">
              <div className="font-semibold text-sm line-clamp-2 flex-1">{p.name}</div>
              <div className="text-primary font-bold text-lg mt-1">{fmt(Number(p.price))}</div>
              <Button size="sm" className="mt-2"><Plus className="w-4 h-4 mr-1" /> Adicionar</Button>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <div className="col-span-full text-center text-muted-foreground py-12">Nada encontrado</div>}
      </div>
    </div>
  );
}
