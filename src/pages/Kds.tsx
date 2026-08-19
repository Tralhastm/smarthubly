// KDS — Kitchen Display System. Tela full-screen pra cozinha, com filtro por setor.
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTenantBySlug } from "@/hooks/useTenants";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChefHat, CheckCircle2, Clock, Package } from "lucide-react";
import { toast } from "sonner";

type KdsStatus = "queue" | "preparing" | "ready";
type Sector = "all" | "cozinha" | "bar" | "pizza" | "sobremesa" | "outro";
type KdsItem = { product_name: string; quantity: number; notes?: string | null; kitchen_sector?: string | null };
type KdsOrder = {
  id: string;
  customer_name: string | null;
  table_label: string | null;
  delivery_type: string | null;
  total: number;
  created_at: string;
  kds_status: KdsStatus;
  kds_started_at: string | null;
  items: KdsItem[];
};

const STATUSES: { key: KdsStatus; label: string; color: string }[] = [
  { key: "queue", label: "Na fila", color: "bg-slate-700" },
  { key: "preparing", label: "Em preparo", color: "bg-amber-600" },
  { key: "ready", label: "Pronto", color: "bg-green-600" },
];

const SECTOR_LABEL: Record<Sector, string> = {
  all: "Todos os setores", cozinha: "Cozinha", bar: "Bar", pizza: "Pizza", sobremesa: "Sobremesa", outro: "Outro",
};

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (diff < 1) return "agora";
  if (diff < 60) return `${diff} min`;
  if (diff < 48 * 60) {
    const h = Math.floor(diff / 60);
    return `${h}h ${diff % 60}min`;
  }
  const d = Math.floor(diff / (24 * 60));
  const hd = Math.floor((diff % (24 * 60)) / 60);
  if (d < 14) return `${d}d ${hd}h`;
  const w = Math.floor(d / 7);
  return `${w} sem${w > 1 ? "" : ""} · ${d}d`;
}

export default function Kds() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { data: tenant } = useTenantBySlug(slug);
  const [searchParams, setSearchParams] = useSearchParams();
  const sector = (searchParams.get("sector") as Sector) || "all";
  const setSector = (s: Sector) => {
    const sp = new URLSearchParams(searchParams);
    if (s === "all") sp.delete("sector"); else sp.set("sector", s);
    setSearchParams(sp, { replace: true });
  };

  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [now, setNow] = useState(Date.now());
  const [soundOn, setSoundOn] = useState(true);
  const lastOrderIds = useMemo(() => new Set(orders.map(o => o.id)), [orders]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const beep = () => {
    if (!soundOn) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      o.start(); o.stop(ctx.currentTime + 0.42);
    } catch {}
  };

  const load = async () => {
    if (!tenant?.id) return;
    const { data: ords } = await (supabase as any)
      .from("orders")
      .select("id, customer_name, table_label, delivery_type, total, created_at, kds_status, kds_started_at")
      .eq("tenant_id", tenant.id)
      .in("status", ["received", "preparing", "ready-for-pickup", "out-for-delivery"])
      .order("created_at", { ascending: true });
    if (!ords) return;
    const ids = ords.map((o: any) => o.id);
    const { data: items } = ids.length
      ? await (supabase as any)
          .from("order_items")
          .select("order_id, product_name, quantity, notes")
          .in("order_id", ids)
      : { data: [] };
    // Mapa nome do produto → setor
    const { data: prods } = await (supabase as any)
      .from("products")
      .select("name, kitchen_sector")
      .eq("tenant_id", tenant.id);
    const sectorByName: Record<string, string> = {};
    (prods || []).forEach((p: any) => { if (p.kitchen_sector) sectorByName[p.name] = p.kitchen_sector; });
    const byOrder: Record<string, KdsItem[]> = {};
    (items || []).forEach((it: any) => {
      (byOrder[it.order_id] ||= []).push({
        product_name: it.product_name, quantity: it.quantity, notes: it.notes,
        kitchen_sector: sectorByName[it.product_name] ?? null,
      });
    });
    // Filtro server-side removido: PostgREST exclui NULLs em .neq — filtrar
    // em memória. Pedidos sem kds_status definido entram como "queue" (nunca invisíveis)
    const active = ords.filter((o: any) => o.kds_status !== "done");
    const newList: KdsOrder[] = active.map((o: any) => ({
      ...o,
      kds_status: o.kds_status || "queue",
      items: byOrder[o.id] || [],
    }));
    const hasNew = newList.some(o => !lastOrderIds.has(o.id));
    if (hasNew && orders.length > 0) beep();
    setOrders(newList);
  };

  useEffect(() => {
    if (!tenant?.id) return;
    load();
    const channel = supabase
      .channel(`kds-${tenant.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `tenant_id=eq.${tenant.id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  const move = async (orderId: string, next: KdsStatus | "done") => {
    const order = orders.find(o => o.id === orderId);
    const patch: any = { kds_status: next };
    if (next === "preparing") {
      patch.kds_started_at = new Date().toISOString();
      // Reflete na tela de Operações: pedido entrou em produção
      patch.status = "preparing";
    }
    if (next === "ready") {
      patch.kds_ready_at = new Date().toISOString();
      patch.status = "ready-for-pickup";
    }
    if (next === "done") {
      // "Entregue" no KDS = pedido saiu da cozinha.
      // Delivery → saiu para entrega; retirada/mesa → entregue ao cliente.
      patch.status = (order?.delivery_type === "delivery") ? "out-for-delivery" : "delivered";
    }
    const { error } = await (supabase as any).from("orders").update(patch).eq("id", orderId);
    if (error) toast.error(error.message);
    else load();
  };


  // Filtra pedidos e itens pelo setor escolhido
  const filteredOrders = useMemo(() => {
    if (sector === "all") return orders;
    return orders
      .map(o => ({ ...o, items: o.items.filter(it => (it.kitchen_sector || "outro") === sector) }))
      .filter(o => o.items.length > 0);
  }, [orders, sector]);

  const grouped = useMemo(() => {
    const g: Record<KdsStatus, KdsOrder[]> = { queue: [], preparing: [], ready: [] };
    filteredOrders.forEach(o => { (g[o.kds_status] ||= []).push(o); });
    return g;
  }, [filteredOrders]);

  if (!tenant) return <div className="min-h-screen flex items-center justify-center bg-background">Carregando…</div>;

  return (
    <div className="min-h-screen bg-background text-foreground p-3">
      <header className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <ChefHat className="w-6 h-6 text-primary" /> KDS — {tenant.name}
          {sector !== "all" && <Badge variant="outline" className="ml-2">{SECTOR_LABEL[sector]}</Badge>}
        </h1>
        <div className="flex items-center gap-2">
          <Select value={sector} onValueChange={(v) => setSector(v as Sector)}>
            <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(SECTOR_LABEL) as Sector[]).map(s => (
                <SelectItem key={s} value={s}>{SECTOR_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setSoundOn(s => !s)} title={soundOn ? "Som ativo" : "Som mudo"}>
            {soundOn ? "🔔" : "🔕"}
          </Button>
          <div className="text-xs text-muted-foreground">{filteredOrders.length} pedidos · {new Date(now).toLocaleTimeString("pt-BR")}</div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {STATUSES.map(col => (
          <div key={col.key} className="bg-card border rounded-xl flex flex-col min-h-[calc(100vh-100px)]">
            <div className={`${col.color} text-white px-3 py-2 rounded-t-xl flex justify-between items-center`}>
              <span className="font-semibold uppercase text-sm">{col.label}</span>
              <Badge variant="secondary">{grouped[col.key].length}</Badge>
            </div>
            <div className="p-2 space-y-2 overflow-y-auto flex-1">
              {grouped[col.key].length === 0 && <div className="text-xs text-muted-foreground text-center py-8">Sem pedidos</div>}
              {grouped[col.key].map(o => {
                const elapsed = timeAgo(o.kds_started_at || o.created_at);
                const isOld = (Date.now() - new Date(o.kds_started_at || o.created_at).getTime()) > 15 * 60000;
                return (
                  <div key={o.id} className={`border rounded-lg p-2 ${isOld && col.key === "preparing" ? "border-destructive" : ""}`}>
                    <div className="flex justify-between items-start mb-1">
                      <div>
                        <div className="font-semibold text-sm">#{o.id.slice(0, 6).toUpperCase()}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {o.table_label ? `Mesa ${o.table_label}` : o.delivery_type === "pickup" ? "Retirada" : "Delivery"}
                          {o.customer_name ? ` · ${o.customer_name}` : ""}
                        </div>
                      </div>
                      <div className={`text-xs flex items-center gap-1 ${isOld ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                        <Clock className="w-3 h-3" /> {elapsed}
                      </div>
                    </div>
                    <ul className="text-sm space-y-0.5 mb-2">
                      {o.items.map((it, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="font-bold text-primary">{it.quantity}x</span>
                          <span>{it.product_name}</span>
                          {sector === "all" && it.kitchen_sector && (
                            <Badge variant="outline" className="text-[10px] py-0">{it.kitchen_sector}</Badge>
                          )}
                          {it.notes && <span className="text-xs text-amber-600 italic">({it.notes})</span>}
                        </li>
                      ))}
                    </ul>
                    {col.key === "queue" && (
                      <Button size="sm" className="w-full" onClick={() => move(o.id, "preparing")}>
                        <ChefHat className="w-3 h-3 mr-1" /> Iniciar preparo
                      </Button>
                    )}
                    {col.key === "preparing" && (
                      <Button size="sm" className="w-full bg-green-600 hover:bg-green-700" onClick={() => move(o.id, "ready")}>
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Marcar pronto
                      </Button>
                    )}
                    {col.key === "ready" && (
                      <Button size="sm" variant="outline" className="w-full" onClick={() => move(o.id, "done")}>
                        <Package className="w-3 h-3 mr-1" /> Entregue
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
