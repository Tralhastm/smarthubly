// Página /loja/:slug/pdv — PDV pra maquininha.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTenantBySlug } from "@/hooks/useTenants";
import { usePdvSession } from "@/hooks/usePdvSession";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import PdvLogin from "@/components/pdv/PdvLogin";
import PdvTableSelector from "@/components/pdv/PdvTableSelector";
import PdvCatalog from "@/components/pdv/PdvCatalog";
import PdvCart from "@/components/pdv/PdvCart";
import PdvPayment, { type PdvPaymentMethod, type SplitEntry } from "@/components/pdv/PdvPayment";
import PdvReceipt from "@/components/pdv/PdvReceipt";
import { useOpenCashSession } from "@/hooks/useCashRegister";

type Step = "select" | "catalog" | "cart" | "payment" | "receipt";
type Mode = { kind: "balcao" } | { kind: "table"; tableId: string; tableLabel: string; sessionId?: string };

const PAYMENT_LABELS: Record<PdvPaymentMethod, string> = {
  credit_card: "Cartão crédito",
  debit_card: "Cartão débito",
  pix: "PIX",
  dinheiro: "Dinheiro",
  fiado: "Fiado",
};

export default function PdvMaquininha() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { data: tenant, isLoading } = useTenantBySlug(slug);
  const pdv = usePdvSession(slug, tenant?.id);
  const { data: cashSession } = useOpenCashSession(tenant?.id);

  const [step, setStep] = useState<Step>("select");
  const [mode, setMode] = useState<Mode | null>(null);
  const [paying, setPaying] = useState(false);
  const [lastOrder, setLastOrder] = useState<{ id: string; method: PdvPaymentMethod; items: typeof pdv.cart; total: number } | null>(null);

  // Injeta o manifest PWA específico do PDV
  useEffect(() => {
    const linkId = "pdv-manifest-link";
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "manifest";
      link.href = "/pdv-manifest.json";
      document.head.appendChild(link);
    }
    // viewport mais apertado pra maquininha
    const vp = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    const prevVp = vp?.content;
    if (vp) vp.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
    return () => {
      link?.remove();
      if (vp && prevVp) vp.content = prevVp;
    };
  }, []);

  if (isLoading) return <div className="flex items-center justify-center h-[100dvh]">Carregando...</div>;
  if (!tenant) return <div className="flex items-center justify-center h-[100dvh] p-4 text-center">Loja não encontrada</div>;

  if (!pdv.operator) {
    return <PdvLogin storeName={tenant.name || "PDV"} onSubmit={pdv.login} />;
  }

  const contextLabel = !mode ? "" : mode.kind === "balcao" ? "Balcão" : `Mesa ${mode.tableLabel}`;
  const isTable = mode?.kind === "table";

  const goSelect = () => { setMode(null); setStep("select"); pdv.clearCart(); };

  const pickBalcao = () => { setMode({ kind: "balcao" }); setStep("catalog"); };

  const pickTable = async (tableId: string, tableLabel: string, sessionId?: string) => {
    setMode({ kind: "table", tableId, tableLabel, sessionId });
    // Se já tem sessão aberta, carrega items dela pro carrinho
    if (sessionId) {
      const { data } = await (supabase as any)
        .from("table_session_items")
        .select("product_id,product_name,product_price,quantity")
        .eq("session_id", sessionId);
      if (data) {
        pdv.clearCart();
        for (const it of data as any[]) {
          for (let i = 0; i < it.quantity; i++) {
            pdv.addItem({ id: it.product_id, name: it.product_name, price: Number(it.product_price) });
          }
        }
      }
    } else {
      pdv.clearCart();
    }
    setStep("catalog");
  };

  const saveTable = async () => {
    if (!mode || mode.kind !== "table" || !tenant?.id) return;
    try {
      let sessionId = mode.sessionId;
      if (!sessionId) {
        const { data, error } = await (supabase as any).from("table_sessions").insert({
          tenant_id: tenant.id,
          table_id: mode.tableId,
          table_label: mode.tableLabel,
          status: "open",
          total: pdv.total,
          opened_by: pdv.operator!.name,
        }).select("id").single();
        if (error) throw error;
        sessionId = data.id;
      } else {
        // limpa items antigos
        await (supabase as any).from("table_session_items").delete().eq("session_id", sessionId);
        await (supabase as any).from("table_sessions").update({ total: pdv.total }).eq("id", sessionId);
      }
      const itemsToInsert = pdv.cart.map(it => ({
        session_id: sessionId,
        tenant_id: tenant.id,
        product_id: it.productId,
        product_name: it.name,
        product_price: it.price,
        quantity: it.quantity,
        added_by: pdv.operator!.name,
      }));
      if (itemsToInsert.length > 0) {
        const { error } = await (supabase as any).from("table_session_items").insert(itemsToInsert);
        if (error) throw error;
      }
      toast.success(`Salvo na Mesa ${mode.tableLabel}`);
      goSelect();
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar mesa");
    }
  };

  const finalize = async (method: PdvPaymentMethod, split?: SplitEntry[]) => {
    if (!tenant?.id || pdv.cart.length === 0) return;
    setPaying(true);
    try {
      const orderPayload: any = {
        tenant_id: tenant.id,
        total: pdv.total,
        delivery_fee: 0,
        payment_method: method,
        delivery_type: "pickup",
        status: "delivered",
        customer_name: isTable ? `Mesa ${(mode as any).tableLabel}` : "Balcão",
        customer_phone: "",
        customer_address: "",
        table_session_id: isTable ? (mode as any).sessionId ?? null : null,
        table_label: isTable ? (mode as any).tableLabel : null,
        cash_session_id: cashSession?.id ?? null,
        split_payments: split && split.length > 1 ? split : null,
      };
      const items = pdv.cart.map(it => ({
        product_name: it.name,
        product_price: it.price,
        quantity: it.quantity,
      }));
      const { data: newOrderId, error: orderErr } = await (supabase as any).rpc("place_order", {
        _order: orderPayload,
        _items: items,
      });
      if (orderErr) throw orderErr;
      const order = { id: newOrderId as string };

      // Se for de mesa, marca sessão como paga
      if (isTable && (mode as any).sessionId) {
        await (supabase as any).from("table_sessions")
          .update({ status: "paid", paid_at: new Date().toISOString(), order_id: order.id })
          .eq("id", (mode as any).sessionId);
      }

      // Se fiado, cria credit_account
      if (method === "fiado") {
        await (supabase as any).from("credit_accounts").insert({
          tenant_id: tenant.id,
          customer_name: isTable ? `Mesa ${(mode as any).tableLabel}` : "Cliente balcão",
          amount: pdv.total,
          description: `Pedido PDV #${order.id.slice(0,8).toUpperCase()}`,
          due_date: new Date(Date.now() + 7 * 86400000).toISOString(),
        });
      }

      setLastOrder({ id: order.id, method, items: [...pdv.cart], total: pdv.total });
      pdv.clearCart();
      setStep("receipt");
    } catch (e: any) {
      toast.error(e.message || "Erro ao finalizar venda");
    } finally {
      setPaying(false);
    }
  };

  // Renderização por etapa
  if (step === "select" || !mode) {
    return (
      <PdvTableSelector
        tenantId={tenant.id}
        operatorName={pdv.operator.name}
        operatorRole={pdv.operator.role}
        onPickBalcao={pickBalcao}
        onPickTable={pickTable}
        onLogout={pdv.logout}
      />
    );
  }

  if (step === "catalog") {
    return (
      <PdvCatalog
        tenantId={tenant.id}
        cartCount={pdv.cart.reduce((s, x) => s + x.quantity, 0)}
        cartTotal={pdv.total}
        contextLabel={contextLabel}
        onBack={goSelect}
        onAdd={pdv.addItem}
        onOpenCart={() => setStep("cart")}
      />
    );
  }

  if (step === "cart") {
    return (
      <PdvCart
        items={pdv.cart}
        total={pdv.total}
        contextLabel={contextLabel}
        modeIsTable={isTable}
        onBack={() => setStep("catalog")}
        onInc={pdv.incItem}
        onRemove={pdv.removeItem}
        onCheckout={() => setStep("payment")}
        onSaveTable={isTable ? saveTable : undefined}
      />
    );
  }

  if (step === "payment") {
    return (
      <PdvPayment
        total={pdv.total}
        onBack={() => setStep("cart")}
        onPay={finalize}
        loading={paying}
      />
    );
  }

  if (step === "receipt" && lastOrder) {
    return (
      <PdvReceipt
        storeName={tenant.name || "PDV"}
        orderId={lastOrder.id}
        items={lastOrder.items}
        total={lastOrder.total}
        paymentLabel={PAYMENT_LABELS[lastOrder.method]}
        operatorName={pdv.operator.name}
        contextLabel={contextLabel}
        onNew={goSelect}
      />
    );
  }

  return null;
}
