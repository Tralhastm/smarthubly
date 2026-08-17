import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, ShoppingCart, Ghost, ShieldAlert, DatabaseBackup,
  Receipt, Tag, MessageSquare, Activity, CheckCircle2, AlertCircle, Link2, Sparkles
} from "lucide-react";

interface Props { tenantId: string; }

interface Run {
  id: string;
  automation_type: string;
  status: string;
  ran_at: string;
  metrics: any;
  error_message: string | null;
}

interface Cart {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  total: number;
  items: any[];
  last_activity_at: string;
  abandoned_notified_at: string | null;
  coupon_code: string | null;
}

interface GhostFlag {
  id: string;
  order_id: string;
  customer_phone: string;
  reason: string;
  ghost_score: number;
  flagged_at: string;
  resolved_at: string | null;
}

interface FraudBlock {
  id: string;
  customer_phone: string;
  customer_name: string;
  reason: string;
  risk_score: number;
  action: string;
  created_at: string;
  resolved_at: string | null;
}

interface Backup {
  id: string;
  created_at: string;
  product_count: number;
  variant_count: number;
  addon_count: number;
  size_bytes: number;
}

interface Suggestion {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  payload: any;
}

const AUTO_LABEL: Record<string, { label: string; icon: React.ReactNode; tone: string }> = {
  auto_cancel_pending_orders: { label: "Cancelar Pix expirado", icon: <Receipt className="h-3.5 w-3.5" />, tone: "bg-amber-500/10 text-amber-600" },
  ghost_detector: { label: "Detector pedido fantasma", icon: <Ghost className="h-3.5 w-3.5" />, tone: "bg-purple-500/10 text-purple-600" },
  catalog_backup: { label: "Backup catálogo", icon: <DatabaseBackup className="h-3.5 w-3.5" />, tone: "bg-blue-500/10 text-blue-600" },
  mp_reconciliation: { label: "Reconciliação MP", icon: <Activity className="h-3.5 w-3.5" />, tone: "bg-emerald-500/10 text-emerald-600" },
  abandoned_cart_cron: { label: "Carrinho abandonado", icon: <ShoppingCart className="h-3.5 w-3.5" />, tone: "bg-pink-500/10 text-pink-600" },
  automations_cron_tick: { label: "Ciclo geral automações", icon: <Sparkles className="h-3.5 w-3.5" />, tone: "bg-indigo-500/10 text-indigo-600" },
  review_ai_reply: { label: "Resposta IA avaliações", icon: <MessageSquare className="h-3.5 w-3.5" />, tone: "bg-cyan-500/10 text-cyan-600" },
  fraud_check: { label: "Antifraude", icon: <ShieldAlert className="h-3.5 w-3.5" />, tone: "bg-red-500/10 text-red-600" },
  affiliate_match: { label: "Match afiliado", icon: <Link2 className="h-3.5 w-3.5" />, tone: "bg-teal-500/10 text-teal-600" },
};

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

export default function TenantAdminAutomationsMonitor({ tenantId }: Props) {
  const [loading, setLoading] = useState(true);
  const [storeMode, setStoreMode] = useState<string>("own");
  const [runs, setRuns] = useState<Run[]>([]);
  const [carts, setCarts] = useState<Cart[]>([]);
  const [ghosts, setGhosts] = useState<GhostFlag[]>([]);
  const [frauds, setFrauds] = useState<FraudBlock[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [t, r, c, g, f, b, s] = await Promise.all([
      supabase.from("tenants").select("store_mode").eq("id", tenantId).maybeSingle(),
      supabase.from("automation_runs").select("*").or(`tenant_id.eq.${tenantId},tenant_id.is.null`).order("ran_at", { ascending: false }).limit(30),
      supabase.from("cart_sessions").select("*").eq("tenant_id", tenantId).is("converted_order_id", null).order("last_activity_at", { ascending: false }).limit(20),
      supabase.from("ghost_order_flags").select("*").eq("tenant_id", tenantId).order("flagged_at", { ascending: false }).limit(20),
      supabase.from("fraud_blocks").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(20),
      supabase.from("catalog_backups").select("id, created_at, product_count, variant_count, addon_count, size_bytes").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(10),
      supabase.from("automation_suggestions").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(20),
    ]);
    setStoreMode((t.data as any)?.store_mode || "own");
    setRuns((r.data as Run[]) || []);
    setCarts((c.data as Cart[]) || []);
    setGhosts((g.data as GhostFlag[]) || []);
    setFrauds((f.data as FraudBlock[]) || []);
    setBackups((b.data as Backup[]) || []);
    setSuggestions((s.data as Suggestion[]) || []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const runFn = async (path: string, body: any = {}) => {
    setRunning(path);
    try {
      const { data, error } = await supabase.functions.invoke(path, { body });
      if (error) throw error;
      toast.success(`✓ ${path} executado`, { description: JSON.stringify(data).slice(0, 120) });
      setTimeout(loadAll, 800);
    } catch (e: any) {
      toast.error(`Falha em ${path}`, { description: e.message });
    } finally {
      setRunning(null);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const meta = (type: string) => AUTO_LABEL[type] ?? { label: type, icon: <Activity className="h-3.5 w-3.5" />, tone: "bg-muted text-muted-foreground" };

  const isAffiliate = storeMode === "affiliate";

  // Botões: marcamos quais só fazem sentido para venda própria.
  const allButtons = [
    { p: "auto-cancel-pending-orders", l: "Cancelar Pix expirado", o: 1, ownOnly: true },
    { p: "ghost-orders-detector",      l: "Detector fantasma",     o: 1, ownOnly: true },
    { p: "catalog-backup-cron",        l: "Backup catálogo",       o: 2, ownOnly: true },
    { p: "mp-reconciliation-cron",     l: "Reconciliar MP",        o: 2, ownOnly: true },
    { p: "abandoned-cart-cron",        l: "Carrinho abandonado",   o: 2, ownOnly: true },
    { p: "automations-cron",           l: "Ciclo geral",           o: 3, ownOnly: false },
    { p: "automations-cron",           l: "Relatório semanal",     o: 3, ownOnly: false, body: { only: "weekly_report", force: true, tenant_id: tenantId } },
    { p: "review-ai-reply",            l: "Resposta IA review",    o: 3, ownOnly: false, body: { tenantId } },
    { p: "affiliate-ai-match",         l: "Match afiliado",        o: 3, ownOnly: false, body: { tenantId } },
    { p: "health-check-ai-keys",       l: "Health AI keys",        o: 3, ownOnly: false },
  ];
  const buttons = isAffiliate ? allButtons.filter(b => !b.ownOnly) : allButtons;

  return (
    <div className="space-y-6">
      {/* Banner do modo da loja */}
      <Card className={`p-3 flex items-center gap-2 ${isAffiliate ? "bg-amber-500/10 border-amber-500/30" : "bg-emerald-500/10 border-emerald-500/30"}`}>
        <Badge className={isAffiliate ? "bg-amber-500/20 text-amber-700" : "bg-emerald-500/20 text-emerald-700"}>
          {isAffiliate ? "Modo afiliado" : "Venda própria"}
        </Badge>
        <p className="text-xs text-muted-foreground">
          {isAffiliate
            ? "Esta loja não processa pedidos próprios. Automações de carrinho, fiado, antifraude, ghost order e backup do catálogo estão desativadas porque a venda acontece fora (Amazon, Mercado Livre, etc.)."
            : "Loja com checkout próprio. Todas as automações de pedido, pagamento e cozinha estão disponíveis."}
        </p>
      </Card>

      {/* Botões disparar manualmente */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading text-sm">Disparar manualmente (teste)</h3>
          <Button size="sm" variant="outline" onClick={loadAll}><RefreshCw className="h-3.5 w-3.5 mr-1" />Atualizar</Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {buttons.map(b => (
            <Button
              key={b.p}
              size="sm"
              variant="secondary"
              disabled={running === b.p}
              onClick={() => runFn(b.p, b.body || {})}
              className="justify-start text-xs h-9"
            >
              {running === b.p ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Badge variant="outline" className="mr-1.5 px-1 py-0 text-[10px]">O{b.o}</Badge>}
              {b.l}
            </Button>
          ))}
        </div>
      </Card>

      {/* Histórico de execuções */}
      <Card className="p-4">
        <h3 className="font-heading text-sm mb-3 flex items-center gap-2"><Activity className="h-4 w-4" /> Histórico de execuções ({runs.length})</h3>
        {runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma execução registrada ainda.</p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {runs.map(r => {
              const m = meta(r.automation_type);
              return (
                <div key={r.id} className="flex items-start gap-2 text-xs p-2 rounded hover:bg-muted/40">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${m.tone} font-medium`}>
                    {m.icon} {m.label}
                  </span>
                  {r.status === "success" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <code className="text-[10px] text-muted-foreground block truncate">{JSON.stringify(r.metrics)}</code>
                    {r.error_message && <p className="text-red-500 text-[10px]">{r.error_message}</p>}
                  </div>
                  <span className="text-muted-foreground text-[10px] shrink-0">{timeAgo(r.ran_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {!isAffiliate && (<>
      {/* Carrinhos abandonados */}
      <Card className="p-4">
        <h3 className="font-heading text-sm mb-3 flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-pink-500" /> Carrinhos abandonados ({carts.length})</h3>
        {carts.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum carrinho abandonado no momento. ✨</p>
        ) : (
          <div className="space-y-2">
            {carts.map(c => (
              <div key={c.id} className="border border-border rounded-lg p-3 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <strong>{c.customer_name || "Sem nome"} · {c.customer_phone}</strong>
                  <span className="text-muted-foreground">{timeAgo(c.last_activity_at)}</span>
                </div>
                <div className="text-muted-foreground">
                  {Array.isArray(c.items) ? c.items.length : 0} itens · R$ {Number(c.total).toFixed(2)}
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  {c.abandoned_notified_at && <Badge variant="secondary" className="text-[10px]">✓ Notificado</Badge>}
                  {c.coupon_code && <Badge className="bg-emerald-500/10 text-emerald-600 text-[10px]">Cupom: {c.coupon_code}</Badge>}
                  {!c.abandoned_notified_at && <Badge variant="outline" className="text-[10px]">Aguardando ação</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Pedidos fantasma */}
      <Card className="p-4">
        <h3 className="font-heading text-sm mb-3 flex items-center gap-2"><Ghost className="h-4 w-4 text-purple-500" /> Pedidos fantasma flagrados ({ghosts.length})</h3>
        {ghosts.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum pedido suspeito.</p>
        ) : (
          <div className="space-y-2">
            {ghosts.map(g => (
              <div key={g.id} className="border border-border rounded-lg p-3 text-xs">
                <div className="flex items-center justify-between">
                  <strong className="text-purple-600">Score {g.ghost_score}</strong>
                  <span className="text-muted-foreground">{timeAgo(g.flagged_at)}</span>
                </div>
                <div className="text-muted-foreground mt-1">
                  Tel: {g.customer_phone || "—"} · Pedido: {g.order_id.slice(0, 8)}
                </div>
                <div className="text-muted-foreground italic">{g.reason}</div>
                {g.resolved_at ? (
                  <Badge variant="secondary" className="mt-1.5 text-[10px]">✓ Resolvido</Badge>
                ) : (
                  <Badge variant="destructive" className="mt-1.5 text-[10px]">Em aberto</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Antifraude */}
      <Card className="p-4">
        <h3 className="font-heading text-sm mb-3 flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-red-500" /> Bloqueios antifraude ({frauds.length})</h3>
        {frauds.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum bloqueio registrado. 🛡️</p>
        ) : (
          <div className="space-y-2">
            {frauds.map(f => (
              <div key={f.id} className="border border-border rounded-lg p-3 text-xs">
                <div className="flex items-center justify-between">
                  <strong>{f.customer_name || "—"} · {f.customer_phone}</strong>
                  <Badge variant={f.action === "blocked" ? "destructive" : "secondary"} className="text-[10px]">{f.action}</Badge>
                </div>
                <div className="text-muted-foreground mt-1">Risco {f.risk_score} · {f.reason}</div>
                <span className="text-muted-foreground text-[10px]">{timeAgo(f.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Backups catálogo */}
      <Card className="p-4">
        <h3 className="font-heading text-sm mb-3 flex items-center gap-2"><DatabaseBackup className="h-4 w-4 text-blue-500" /> Backups do catálogo ({backups.length})</h3>
        {backups.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum backup ainda.</p>
        ) : (
          <div className="space-y-1.5">
            {backups.map(b => (
              <div key={b.id} className="flex items-center justify-between text-xs p-2 rounded hover:bg-muted/40">
                <div>
                  <strong>{b.product_count} produtos</strong>
                  <span className="text-muted-foreground"> · {b.variant_count} variantes · {b.addon_count} adicionais · {(b.size_bytes / 1024).toFixed(1)} KB</span>
                </div>
                <span className="text-muted-foreground">{timeAgo(b.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      </>)}

      {/* Sugestões da IA */}
      <Card className="p-4">
        <h3 className="font-heading text-sm mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-500" /> Sugestões da IA ({suggestions.length})</h3>
        {suggestions.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma sugestão ativa.</p>
        ) : (
          <div className="space-y-2">
            {suggestions.map(s => (
              <div key={s.id} className="border border-border rounded-lg p-3 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <strong>{s.title}</strong>
                  <Badge variant={s.status === "pending" ? "default" : "secondary"} className="text-[10px]">{s.status}</Badge>
                </div>
                <div className="text-muted-foreground">{s.description}</div>
                <div className="flex gap-1.5 mt-1.5">
                  <Badge variant="outline" className="text-[10px]">{s.type}</Badge>
                  <span className="text-muted-foreground text-[10px]">{timeAgo(s.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
