import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Bot, Zap, Receipt, Tag, Sparkles, Bell, ShieldAlert, FileText, BarChart3, Combine, Mail, ListOrdered, MessageSquare, ShieldCheck, DatabaseBackup, Link2, Ghost, Wand2, MapPin, History, Inbox } from "lucide-react";
import AutomationsTutorial from "./AutomationsTutorial";

// Mapa de onde o lojista vê o resultado de cada automação
const RESULT_LOCATIONS: Record<string, { where: string; tip?: string }> = {
  auto_cancel_pending_payment: { where: "Operação → Pedidos (status: Cancelado, motivo 'pagamento expirado')" },
  auto_confirm_paid_orders: { where: "Operação → Pedidos (mudam de 'Aguardando pagamento' para 'Preparando')" },
  auto_confirm_card_payments: { where: "Operação → Pedidos (mudam de 'Aguardando pagamento' para 'Preparando')" },
  auto_log_platform_fee: { where: "Financeiro → Despesas, categoria 'taxa_plataforma'" },
  auto_low_stock_promo: { where: "Aqui mesmo, na Caixa de Sugestões abaixo ⬇️" },
  auto_abandon_coupon: { where: "Aqui mesmo, na Caixa de Sugestões abaixo ⬇️", tip: "Cupom também aparece em Marketing → Cupons" },
  auto_reorder_catalog: { where: "Aqui mesmo, na Caixa de Sugestões abaixo ⬇️", tip: "Aplicar reordena os produtos no Catálogo" },
  auto_credit_reminders: { where: "Financeiro → Fiados (e e-mails enviados ao cliente)" },
  auto_weekly_report: { where: "Aqui mesmo, na Caixa de Sugestões abaixo ⬇️", tip: "Também é enviado por e-mail toda segunda às 8h" },
  auto_categorize_nightly: { where: "Catálogo → Produtos (categoria preenchida automaticamente)" },
  auto_combo_suggestion: { where: "Aqui mesmo, na Caixa de Sugestões abaixo ⬇️" },
  auto_peak_alert: { where: "Aqui mesmo, na Caixa de Sugestões abaixo ⬇️" },
  auto_reconcile_mp: { where: "Aqui mesmo, na Caixa de Sugestões abaixo ⬇️", tip: "Divergências aparecem como sugestões" },
  auto_backup_catalog: { where: "Configurações → Backup (últimos 30 snapshots)" },
  auto_fraud_check: { where: "Operação → Pedidos (pedidos bloqueados aparecem com selo de risco)" },
  auto_review_ai_reply: { where: "Aqui mesmo, na Caixa de Sugestões abaixo ⬇️" },
  auto_detect_ghost_orders: { where: "Aqui mesmo, na Caixa de Sugestões abaixo ⬇️", tip: "Também marca o pedido com bandeira no Operação" },
  auto_affiliate_match: { where: "Aqui mesmo, na Caixa de Sugestões abaixo ⬇️" },
};

// Tipos de sugestão geradas por cada automação (para contar histórico)
const SUGGESTION_TYPES: Record<string, string[]> = {
  auto_low_stock_promo: ["low_stock_promo", "low_stock"],
  auto_abandon_coupon: ["abandoned_cart"],
  auto_reorder_catalog: ["reorder_catalog"],
  auto_weekly_report: ["weekly_report"],
  auto_combo_suggestion: ["combo_suggestion"],
  auto_peak_alert: ["peak_alert"],
  auto_reconcile_mp: ["mp_divergence", "mp_reconcile"],
  auto_review_ai_reply: ["review_reply"],
  auto_detect_ghost_orders: ["ghost_orders"],
  auto_affiliate_match: ["affiliate_match"],
};

interface Props { tenantId: string; }

type AutomationKey =
  | "auto_cancel_pending_payment"
  | "auto_confirm_paid_orders"
  | "auto_confirm_card_payments"
  | "auto_log_platform_fee"
  | "auto_low_stock_promo"
  | "auto_abandon_coupon"
  | "auto_reorder_catalog"
  | "auto_credit_reminders"
  | "auto_weekly_report"
  | "auto_categorize_nightly"
  | "auto_combo_suggestion"
  | "auto_peak_alert"
  | "auto_reconcile_mp"
  | "auto_backup_catalog"
  | "auto_fraud_check"
  | "auto_review_ai_reply"
  | "auto_detect_ghost_orders"
  | "auto_affiliate_match";

interface Item {
  key: AutomationKey;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: "Onda 1" | "Onda 2" | "Onda 3";
}

type AutomationSuggestion = Pick<Database["public"]["Tables"]["automation_suggestions"]["Row"], "id" | "type" | "title" | "description" | "payload" | "status" | "created_at" | "acted_at">;
type TenantUpdate = Database["public"]["Tables"]["tenants"]["Update"];
type ToggleKey = AutomationKey | "auto_cancel_pending_minutes";
type AffiliateMatchResponse = { inserted?: number; errors?: Array<{ message?: string }> };
type AutomationsCronResponse = { results?: Record<string, { weekly?: { error?: string; emailed?: boolean } }> };

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const statusLabel: Record<string, string> = {
  pending: "pendente",
  applied: "aplicado/visto",
  dismissed: "descartado",
};

function formatSuggestionDetail(s: AutomationSuggestion) {
  const payload = asRecord(s.payload);
  if (s.type === "reorder_catalog" && Array.isArray(payload.top_products)) {
    return payload.top_products.map((item, i: number) => {
      const product = asRecord(item);
      return `${i + 1}. ${String(product.name || "Produto")} (${String(product.qty || 0)})`;
    }).join(" · ");
  }
  if (s.type === "weekly_report") {
    const revenue = Number(payload.revenue || 0).toFixed(2);
    return `Pedidos entregues: ${payload.delivered ?? 0} · Faturamento: R$ ${revenue} · Saúde: ${payload.healthScore ?? "—"}/100`;
  }
  if (s.type === "abandoned_cart" && payload.coupon_code) return `Cupom: ${payload.coupon_code}`;
  if (s.type === "low_stock_promo" && payload.current_stock !== undefined) return `Estoque atual: ${payload.current_stock} · Desconto sugerido: ${payload.suggested_discount_percent || 15}%`;
  return "";
}

const ITEMS: Item[] = [
  { key: "auto_cancel_pending_payment", icon: <Zap className="h-4 w-4" />, title: "Cancelar Pix não pago", description: "Pedidos com pagamento Pix em aberto há mais do tempo configurado são cancelados sozinhos. O cliente é avisado para refazer.", badge: "Onda 1" },
  { key: "auto_confirm_paid_orders", icon: <Bell className="h-4 w-4" />, title: "Confirmar pagamento Pix automático", description: "Quando o pagamento Pix é aprovado, o pedido vai direto para 'preparando' e a cozinha é notificada.", badge: "Onda 1" },
  { key: "auto_confirm_card_payments", icon: <Bell className="h-4 w-4" />, title: "Confirmar pagamento Cartão automático", description: "Mesma coisa, mas para pagamentos no cartão. Pode desligar separadamente se preferir revisar manualmente.", badge: "Onda 1" },
  { key: "auto_log_platform_fee", icon: <Receipt className="h-4 w-4" />, title: "Lançar taxa da plataforma no financeiro", description: "Cada pedido entregue vira automaticamente uma despesa categorizada como 'taxa_plataforma'.", badge: "Onda 1" },
  { key: "auto_low_stock_promo", icon: <Sparkles className="h-4 w-4" />, title: "Sugerir promoção quando estoque baixo", description: "Produto com estoque ≤ 5 vira sugestão na sua caixa de aprovação (15% off por padrão).", badge: "Onda 2" },
  { key: "auto_abandon_coupon", icon: <Tag className="h-4 w-4" />, title: "Cupom para carrinho abandonado", description: "Cliente preencheu telefone + carrinho mas não fechou? Gero cupom de 10% (válido 7d) e te aviso pra mandar no WhatsApp.", badge: "Onda 2" },
  { key: "auto_reorder_catalog", icon: <ListOrdered className="h-4 w-4" />, title: "Top vendidos do mês", description: "A cada hora analiso vendas dos últimos 30 dias e sugiro destacar os campeões no topo do cardápio.", badge: "Onda 2" },
  { key: "auto_credit_reminders", icon: <MessageSquare className="h-4 w-4" />, title: "Lembrete automático de fiado", description: "Mando emails progressivos: 3d antes do vencimento, no dia, +3d, +7d, +15d, +30d para clientes em atraso.", badge: "Onda 2" },
  { key: "auto_weekly_report", icon: <FileText className="h-4 w-4" />, title: "Relatório semanal", description: "Toda segunda às 8h, gero resumo dos últimos 7 dias (pedidos, faturamento, cancelamentos) na caixa de sugestões.", badge: "Onda 2" },
  { key: "auto_categorize_nightly", icon: <Bot className="h-4 w-4" />, title: "Auto-categorização noturna", description: "Toda madrugada (3h) a IA categoriza produtos sem categoria pra manter o catálogo organizado.", badge: "Onda 2" },
  { key: "auto_combo_suggestion", icon: <Combine className="h-4 w-4" />, title: "Sugestão de combos", description: "Detecto pares de produtos vendidos juntos (≥3x no mês) e sugiro virar combo com 5-10% de desconto.", badge: "Onda 2" },
  { key: "auto_peak_alert", icon: <BarChart3 className="h-4 w-4" />, title: "Alerta de pico de demanda", description: "Quando a última hora bate 3x a média da loja, te aviso na caixa de sugestões pra reforçar a cozinha.", badge: "Onda 2" },
  { key: "auto_reconcile_mp", icon: <Link2 className="h-4 w-4" />, title: "Reconciliação Mercado Pago", description: "Todo dia cruzo pagamentos aprovados no MP com seus pedidos e te aviso de divergências (valor errado, pedido não encontrado, etc).", badge: "Onda 3" },
  { key: "auto_backup_catalog", icon: <DatabaseBackup className="h-4 w-4" />, title: "Backup automático do catálogo", description: "Snapshot diário de produtos, variantes e adicionais. Mantém últimos 30 dias para você restaurar se precisar.", badge: "Onda 3" },
  { key: "auto_fraud_check", icon: <ShieldCheck className="h-4 w-4" />, title: "Anti-fraude no checkout", description: "Antes do pedido cair na cozinha, avalio risco (telefone inválido, valor alto novo cliente, histórico de cancelados, etc) e bloqueio se passar do limite.", badge: "Onda 3" },
  { key: "auto_review_ai_reply", icon: <Mail className="h-4 w-4" />, title: "Resposta IA a avaliações", description: "Para cada review novo gero uma resposta sugerida pra você aprovar e enviar no WhatsApp.", badge: "Onda 3" },
  { key: "auto_detect_ghost_orders", icon: <Ghost className="h-4 w-4" />, title: "Detecção de pedidos fantasma", description: "Pedido saiu pra entrega há 90min e ninguém confirmou? Te aviso pra ligar pro cliente ou entregador.", badge: "Onda 3" },
  { key: "auto_affiliate_match", icon: <Sparkles className="h-4 w-4" />, title: "Sugestão IA de afiliados", description: "A cada semana a IA sugere novos achadinhos afiliados que combinam com as categorias do seu catálogo.", badge: "Onda 3" },
];

export default function TenantAdminAutomations({ tenantId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [runningAffiliateMatch, setRunningAffiliateMatch] = useState(false);
  const [runningWeeklyReport, setRunningWeeklyReport] = useState(false);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [suggestions, setSuggestions] = useState<AutomationSuggestion[]>([]);
  const [history, setHistory] = useState<AutomationSuggestion[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const cols = [
      ...ITEMS.map(i => i.key),
      "auto_cancel_pending_minutes",
      "auto_phantom_minutes",
      "billing_status",
    ].join(",");
    const { data: t, error } = await supabase
      .from("tenants")
      .select(cols)
      .eq("id", tenantId)
      .single();
    if (error) { toast.error("Não consegui carregar"); setLoading(false); return; }
    setData(asRecord(t));
    setLoading(false);
  }, [tenantId]);

  const loadSuggestions = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [pending, all] = await Promise.all([
      supabase
        .from("automation_suggestions")
        .select("id, type, title, description, payload, status, created_at, acted_at")
        .eq("tenant_id", tenantId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("automation_suggestions")
        .select("id, type, title, description, payload, status, created_at, acted_at")
        .eq("tenant_id", tenantId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    setSuggestions(pending.data || []);
    setHistory(all.data || []);
  }, [tenantId]);

  useEffect(() => { load(); loadSuggestions(); }, [load, loadSuggestions]);

  async function applyLowStockPromo(s: AutomationSuggestion): Promise<string | null> {
    const payload = asRecord(s.payload);
    const productId = typeof payload.product_id === "string" ? payload.product_id : null;
    const discountPct = Number(payload.suggested_discount_percent ?? 15);
    if (!productId) return null;
    // 1) Busca preço atual do produto
    const { data: prod } = await supabase
      .from("products").select("id, name, price").eq("id", productId).maybeSingle();
    if (!prod) return null;
    const oldPrice = Number(prod.price || 0);
    if (oldPrice <= 0) return null;
    const newPrice = Math.max(0.5, Math.round(oldPrice * (1 - discountPct / 100) * 100) / 100);
    // 2) Aplica desconto no preço do produto
    const { error: prodErr } = await supabase
      .from("products").update({ price: newPrice }).eq("id", productId);
    if (prodErr) return prodErr.message;
    // 3) Liga banner de promoção da loja com o produto em destaque
    const { error: tErr } = await supabase
      .from("tenants").update({
        promo_active: true,
        promo_title: "🔥 Estoque baixo — Oferta!",
        promo_text: `${discountPct}% off em ${prod.name}! Últimas unidades — corre 🏃‍♂️`,
      } as TenantUpdate).eq("id", tenantId);
    if (tErr) return tErr.message;
    return `Preço de ${prod.name}: R$ ${oldPrice.toFixed(2)} → R$ ${newPrice.toFixed(2)} · banner ligado`;
  }

  async function actSuggestion(id: string, status: "applied" | "dismissed") {
    const target = [...suggestions, ...history].find(x => x.id === id);
    let extraMsg: string | null = null;
    let applyError: string | null = null;
    if (status === "applied" && target?.type === "low_stock_promo") {
      try {
        extraMsg = await applyLowStockPromo(target);
      } catch (e) {
        applyError = errorMessage(e);
      }
    }
    if (applyError) { toast.error(`Não consegui aplicar: ${applyError}`); return; }

    const { error } = await supabase
      .from("automation_suggestions")
      .update({ status, acted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error("Erro"); return; }
    setSuggestions(s => s.filter(x => x.id !== id));
    setHistory(h => h.map(x => x.id === id ? { ...x, status, acted_at: new Date().toISOString() } : x));
    if (status === "applied") {
      toast.success(extraMsg ? `Aplicado! ${extraMsg}` : "Aplicado!");
    } else {
      toast.success("Descartado");
    }
  }

  async function toggle(key: ToggleKey, value: boolean | number) {
    setSaving(key);
    const { error } = await supabase.from("tenants").update({ [key]: value } as TenantUpdate).eq("id", tenantId);
    if (error) { toast.error("Erro ao salvar"); }
    else {
      setData(d => ({ ...d, [key]: value }));
      toast.success("Salvo!");
    }
    setSaving(null);
  }

  async function runAffiliateMatchNow() {
    if (runningAffiliateMatch) return;
    setRunningAffiliateMatch(true);
    toast.loading("Pedindo sugestões de achadinhos com IA...", { id: "affiliate-match" });
    try {
      const { data: res, error } = await supabase.functions.invoke<AffiliateMatchResponse>("affiliate-ai-match", { body: { tenant_id: tenantId, manual: true } });
      if (error) throw error;
      if (res?.errors?.length) throw new Error(res.errors[0]?.message || "IA falhou");
      toast.success(`${res?.inserted || 0} sugestão(ões) criada(s)`, { id: "affiliate-match" });
      loadSuggestions();
    } catch (e: unknown) {
      toast.error(`Não consegui sugerir agora: ${errorMessage(e)}`, { id: "affiliate-match", duration: 7000 });
    } finally {
      setRunningAffiliateMatch(false);
    }
  }

  async function runWeeklyReportNow() {
    if (runningWeeklyReport) return;
    setRunningWeeklyReport(true);
    toast.loading("Gerando relatório semanal e enviando por e-mail...", { id: "weekly-report" });
    try {
      const { data: res, error } = await supabase.functions.invoke<AutomationsCronResponse>("automations-cron", {
        body: { only: "weekly_report", force: true, tenant_id: tenantId },
      });
      if (error) throw error;
      const wr = res?.results?.[tenantId]?.weekly;
      if (wr?.error) throw new Error(wr.error);
      const sent = wr?.emailed ? "Enviado por e-mail!" : "Gerado (e-mail desativado ou sem e-mail de cobrança)";
      toast.success(sent, { id: "weekly-report", duration: 6000 });
      loadSuggestions();
    } catch (e: unknown) {
      toast.error(`Falhou: ${errorMessage(e)}`, { id: "weekly-report", duration: 8000 });
    } finally {
      setRunningWeeklyReport(false);
    }
  }

  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;

  const billingStatus = data.billing_status || "active";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-1">
          <Bot className="h-5 w-5 text-primary" />
          <h2 className="font-heading text-lg">Automações</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Cada interruptor abaixo controla uma automação. Liga e desliga quando quiser.
          As marcadas como <span className="font-medium text-primary">Onda 1</span> já vêm ativas; <span className="text-emerald-700 dark:text-emerald-400 font-medium">Onda 2</span> ajuda a engajar; <span className="text-violet-700 dark:text-violet-400 font-medium">Onda 3</span> são avançadas (vêm desligadas).
        </p>
      </div>

      <AutomationsTutorial />

      {data.auto_affiliate_match && (
        <Card className="p-4 border-primary/30 bg-primary/5 flex items-start justify-between gap-3">
          <div className="text-sm">
            <p className="font-medium text-foreground">Sugestão IA de afiliados</p>
            <p className="text-xs text-muted-foreground mt-1">Roda semanalmente e sugere novos achadinhos por categoria. Se apagar um link, edite o produto e cole outro link manualmente.</p>
          </div>
          <button onClick={runAffiliateMatchNow} disabled={runningAffiliateMatch}
            className="flex items-center gap-1.5 rounded-lg gradient-primary text-primary-foreground px-3 py-2 text-xs font-medium hover:opacity-90 disabled:opacity-50 shrink-0">
            {runningAffiliateMatch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Testar agora
          </button>
        </Card>
      )}

      {billingStatus !== "active" && (
        <Card className="p-4 border-destructive/50 bg-destructive/5 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-destructive">
              {billingStatus === "warning" && "Atenção: você tem fatura em aberto."}
              {billingStatus === "degraded" && "Sua loja está em modo restrito por falta de pagamento."}
              {billingStatus === "suspended" && "Sua loja foi suspensa por falta de pagamento."}
            </p>
            <p className="text-muted-foreground">Acesse Cobranças para regularizar.</p>
          </div>
        </Card>
      )}

      <Card className="p-4 space-y-2">
        <Label className="text-sm font-medium">⏱ Tempo até cancelar Pix não pago</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={5}
            max={240}
            value={Number(data.auto_cancel_pending_minutes ?? 30)}
            onChange={(e) => setData(d => ({ ...d, auto_cancel_pending_minutes: Number(e.target.value) }))}
            onBlur={(e) => toggle("auto_cancel_pending_minutes", Number(e.target.value))}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">minutos</span>
        </div>
        <p className="text-xs text-muted-foreground">Após esse tempo sem pagamento, o pedido é cancelado e o cliente recebe a mensagem para refazer.</p>
      </Card>

      <Card className="p-4 border-primary/30 bg-primary/5">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            <h3 className="font-medium text-sm">Caixa de Sugestões</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
              {suggestions.length} pendente{suggestions.length === 1 ? "" : "s"}
            </span>
          </div>
          <button
            onClick={() => setShowHistory(v => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <History className="h-3.5 w-3.5" />
            {showHistory ? "Ocultar" : "Ver"} histórico (30d)
          </button>
        </div>

        {suggestions.length === 0 && !showHistory && (
          <p className="text-xs text-muted-foreground">
            Nenhuma sugestão pendente no momento. Quando uma automação gerar algo (cupom, combo, alerta, relatório etc.), aparece aqui pra você revisar.
          </p>
        )}

        {suggestions.length > 0 && (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {suggestions.map(s => (
              <div key={s.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm">{s.title}</p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{s.type}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{s.description}</p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => actSuggestion(s.id, "applied")} className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90">Aplicar / Visto</button>
                  <button onClick={() => actSuggestion(s.id, "dismissed")} className="text-xs px-3 py-1 rounded border border-border text-muted-foreground hover:bg-muted">Descartar</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showHistory && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground mb-2">Histórico (últimos 30 dias) — {history.length} no total</p>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {history.length === 0 && (
                <p className="text-xs text-muted-foreground">Nada gerado ainda nos últimos 30 dias.</p>
              )}
              {history.map(h => (
                <div key={h.id} className="flex items-start gap-2 text-xs rounded border border-border bg-card p-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                    h.status === "pending" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" :
                    h.status === "applied" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" :
                    "bg-muted text-muted-foreground"
                  }`}>{h.status}</span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{h.title}</p>
                    <p className="text-[10px] text-muted-foreground">{h.type} · {new Date(h.created_at).toLocaleString("pt-BR")}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-3">
        {ITEMS.map(item => (
          <Card key={item.key} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <div className="p-2 rounded-md bg-primary/10 text-primary">{item.icon}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{item.title}</p>
                    {item.badge && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        item.badge === "Onda 1" ? "bg-primary/15 text-primary" :
                        item.badge === "Onda 2" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" :
                        "bg-violet-500/15 text-violet-700 dark:text-violet-400"
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                  {RESULT_LOCATIONS[item.key] && (
                    <div className="mt-2 rounded-md bg-muted/50 border border-border/50 px-2 py-1.5">
                      <div className="flex items-start gap-1.5 text-[11px]">
                        <MapPin className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <span className="text-muted-foreground">Onde ver: </span>
                          <span className="text-foreground">{RESULT_LOCATIONS[item.key].where}</span>
                          {RESULT_LOCATIONS[item.key].tip && (
                            <p className="text-muted-foreground mt-0.5">💡 {RESULT_LOCATIONS[item.key].tip}</p>
                          )}
                          {SUGGESTION_TYPES[item.key] && (() => {
                            const types = SUGGESTION_TYPES[item.key];
                            const related = history.filter((h) => types.includes(h.type));
                            const total = related.length;
                            return total > 0 ? (
                              <div className="mt-2 space-y-1.5">
                                <p className="text-primary font-medium">
                                  ✓ {total} resultado{total === 1 ? "" : "s"} nos últimos 30 dias — exibindo abaixo
                                </p>
                                {related.slice(0, 3).map((s) => (
                                  <div key={s.id} className="rounded-md border border-border bg-card px-2 py-1.5">
                                    <div className="flex items-start justify-between gap-2">
                                      <p className="font-medium text-foreground line-clamp-2">{s.title}</p>
                                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                        {statusLabel[s.status] || s.status}
                                      </span>
                                    </div>
                                    <p className="mt-0.5 text-muted-foreground line-clamp-2">{s.description}</p>
                                    {formatSuggestionDetail(s) && (
                                      <p className="mt-0.5 text-foreground/80 line-clamp-2">{formatSuggestionDetail(s)}</p>
                                    )}
                                    <p className="mt-0.5 text-muted-foreground">{new Date(s.created_at).toLocaleString("pt-BR")}</p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-muted-foreground mt-0.5 italic">Nenhum resultado ainda nos últimos 30 dias</p>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                  {item.key === "auto_weekly_report" && (
                    <button
                      onClick={runWeeklyReportNow}
                      disabled={runningWeeklyReport}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg gradient-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      {runningWeeklyReport ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                      Gerar e enviar agora
                    </button>
                  )}
                </div>
              </div>
              <Switch
                checked={!!data[item.key]}
                disabled={saving === item.key}
                onCheckedChange={(v) => toggle(item.key, v)}
              />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
