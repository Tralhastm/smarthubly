import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, AlertCircle, Loader2, RefreshCw, Activity, Clock } from "lucide-react";
import { toast } from "sonner";

interface Props { tenantId: string; }

type Status = 'pass' | 'warn' | 'fail';

interface Check {
  category: string;
  name: string;
  status: Status;
  detail: string;
  lastRun?: string | null;
  expectedFreq?: string;
}

const since = (s: string | null | undefined) => {
  if (!s) return 'nunca';
  const ms = Date.now() - new Date(s).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
};

const StatusIcon = ({ s }: { s: Status }) => {
  if (s === 'pass') return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />;
  if (s === 'warn') return <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />;
  return <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />;
};

const TenantAdminAutomationsDiagnostic = ({ tenantId }: Props) => {
  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);
  const [storeMode, setStoreMode] = useState<string>('own');

  const run = useCallback(async () => {
    setRunning(true);
    const results: Check[] = [];

    // 0) Modo da loja
    const { data: tenant, error: tErr } = await supabase
      .from('tenants')
      .select('store_mode, auto_abandon_coupon, auto_detect_ghost_orders, auto_cancel_pending_payment, auto_log_platform_fee, auto_reconcile_mp, auto_backup_catalog, auto_review_ai_reply' as any)
      .eq('id', tenantId)
      .maybeSingle();
    if (tErr) console.warn('[Diagnostic] tenant fetch error', tErr);
    const t: any = tenant || {};
    const mode = t.store_mode || 'own';
    setStoreMode(mode);
    const isAffiliate = mode === 'affiliate';

    results.push({
      category: 'Configuração',
      name: 'Modo da loja detectado',
      status: 'pass',
      detail: isAffiliate ? '🔗 Afiliado — só rodam automações compatíveis' : '🏪 Venda própria — todas as automações ativas',
    });

    // Helper: pega última execução por tipo
    const lastRun = async (type: string, scope: 'tenant' | 'global' = 'tenant') => {
      const q = supabase.from('automation_runs').select('ran_at, status, metrics, error_message').eq('automation_type', type);
      const { data } = scope === 'tenant'
        ? await q.eq('tenant_id', tenantId).order('ran_at', { ascending: false }).limit(1)
        : await q.is('tenant_id', null).order('ran_at', { ascending: false }).limit(1);
      return data?.[0] ?? null;
    };

    // 1) Tick geral do cron (deve rodar a cada hora) — gravado por-tenant
    const tick = await lastRun('automations_cron_tick', 'tenant');
    const tickAge = tick ? (Date.now() - new Date(tick.ran_at).getTime()) / 60000 : Infinity;
    results.push({
      category: 'Infra',
      name: 'Cron geral está vivo',
      status: tickAge < 90 ? 'pass' : tickAge < 180 ? 'warn' : 'fail',
      detail: tick ? `Última batida: ${since(tick.ran_at)} (esperado: a cada 1h)` : 'Nunca rodou — cron pode estar desativado',
      lastRun: tick?.ran_at,
      expectedFreq: 'a cada 1h',
    });

    // 2) Carrinho abandonado (só venda própria)
    if (!isAffiliate) {
      const ac = await lastRun('abandoned_cart_cron', 'global');
      const acAge = ac ? (Date.now() - new Date(ac.ran_at).getTime()) / 60000 : Infinity;
      results.push({
        category: 'Vendas',
        name: 'Detector de carrinho abandonado',
        status: !t.auto_abandon_coupon ? 'warn'
          : acAge < 90 ? 'pass' : acAge < 240 ? 'warn' : 'fail',
        detail: !t.auto_abandon_coupon
          ? 'Desligado nas configurações (ative em Automações)'
          : ac ? `Rodou ${since(ac.ran_at)} — ${JSON.stringify(ac.metrics).slice(0, 80)}`
          : 'Nunca rodou',
        lastRun: ac?.ran_at,
      });
    } else {
      results.push({
        category: 'Vendas',
        name: 'Detector de carrinho abandonado',
        status: 'pass',
        detail: '⏭️ Pulado (loja afiliada não tem checkout próprio)',
      });
    }

    // 3) Detector de pedido fantasma (só venda própria)
    if (!isAffiliate) {
      const gh = await lastRun('ghost_detector', 'global');
      const ghAge = gh ? (Date.now() - new Date(gh.ran_at).getTime()) / 60000 : Infinity;
      results.push({
        category: 'Operação',
        name: 'Detector de pedido fantasma',
        status: !t.auto_detect_ghost_orders ? 'warn'
          : ghAge < 30 ? 'pass' : ghAge < 90 ? 'warn' : 'fail',
        detail: !t.auto_detect_ghost_orders
          ? 'Desligado (ative em Automações)'
          : gh ? `Rodou ${since(gh.ran_at)} — ${JSON.stringify(gh.metrics).slice(0, 80)}`
          : 'Nunca rodou',
        lastRun: gh?.ran_at,
      });
    }

    // 4) Reconciliação MercadoPago (só venda própria)
    if (!isAffiliate) {
      const mp = await lastRun('mp_reconciliation');
      const mpAge = mp ? (Date.now() - new Date(mp.ran_at).getTime()) / 3600000 : Infinity;
      results.push({
        category: 'Financeiro',
        name: 'Reconciliação MercadoPago',
        status: mpAge < 26 ? 'pass' : mpAge < 50 ? 'warn' : 'fail',
        detail: mp ? `Rodou ${since(mp.ran_at)} — ${JSON.stringify(mp.metrics).slice(0, 80)}`
          : 'Nunca rodou (esperado: diário)',
        lastRun: mp?.ran_at,
      });
    }

    // 5) Backup do catálogo — gravado global (tenant_id null)
    const bk = await lastRun('catalog_backup', 'global');
    const bkAge = bk ? (Date.now() - new Date(bk.ran_at).getTime()) / 3600000 : Infinity;
    results.push({
      category: 'Catálogo',
      name: 'Backup automático do catálogo',
      status: bkAge < 26 ? 'pass' : bkAge < 50 ? 'warn' : 'fail',
      detail: bk ? `Rodou ${since(bk.ran_at)} — ${JSON.stringify(bk.metrics).slice(0, 80)}`
        : 'Nunca rodou (esperado: diário)',
      lastRun: bk?.ran_at,
    });

    // Conta backups existentes
    const { count: bkCount } = await supabase
      .from('catalog_backups').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);
    results.push({
      category: 'Catálogo',
      name: 'Snapshots de backup armazenados',
      status: (bkCount ?? 0) > 0 ? 'pass' : 'warn',
      detail: `${bkCount ?? 0} backup(s) salvo(s) no banco`,
    });

    // 6) Resposta IA em avaliações
    const rev = await lastRun('review_ai_reply', 'global');
    const revAge = rev ? (Date.now() - new Date(rev.ran_at).getTime()) / 60000 : Infinity;
    results.push({
      category: 'Marketing',
      name: 'Sugestão de resposta IA p/ reviews',
      status: !t.auto_review_ai_reply && !isAffiliate ? 'warn'
        : revAge < 30 ? 'pass' : revAge < 120 ? 'warn' : 'fail',
      detail: rev ? `Rodou ${since(rev.ran_at)} — ${JSON.stringify(rev.metrics).slice(0, 80)}`
        : 'Nunca rodou',
      lastRun: rev?.ran_at,
    });

    // 7) Match de produtos afiliados (só afiliado)
    if (isAffiliate) {
      const am = await lastRun('affiliate_match');
      const amAge = am ? (Date.now() - new Date(am.ran_at).getTime()) / 3600000 : Infinity;
      results.push({
        category: 'Afiliados',
        name: 'IA sugere novos achadinhos afiliados',
        status: !t.auto_affiliate_match ? 'warn'
          : am?.status === 'error' ? 'fail'
          : amAge < 8 * 24 ? 'pass'
          : amAge < 15 * 24 ? 'warn'
          : 'fail',
        detail: !t.auto_affiliate_match
          ? 'Desligado nas configurações (ative em Automações)'
          : am?.status === 'error'
          ? `Falhou: ${am.error_message || 'erro não informado'}`
          : am ? `Rodou ${since(am.ran_at)} — semanal; sugere achadinhos novos por categoria (NÃO preenche link apagado manualmente)`
          : 'Roda toda segunda-feira automaticamente. Use o botão "Testar agora" em Automações pra forçar uma execução e ver sugestões na hora.',
        lastRun: am?.ran_at,
      });

      // Conta cliques registrados
      const { count: clicks } = await supabase
        .from('affiliate_clicks').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      results.push({
        category: 'Afiliados',
        name: 'Tracking de cliques funciona',
        status: (clicks ?? 0) > 0 ? 'pass' : 'warn',
        detail: `${clicks ?? 0} clique(s) registrado(s) (clique em "Comprar" pra testar)`,
      });

      // Conta cupons configurados
      const { count: coupons } = await supabase
        .from('products').select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).not('affiliate_coupon_code', 'is', null);
      results.push({
        category: 'Afiliados',
        name: 'Cupons promocionais cadastrados',
        status: (coupons ?? 0) > 0 ? 'pass' : 'warn',
        detail: `${coupons ?? 0} produto(s) com cupom`,
      });
    }

    // 8) Erros recentes em automações
    const { data: recentErrors } = await supabase
      .from('automation_runs')
      .select('automation_type, ran_at, error_message')
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .eq('status', 'error')
      .order('ran_at', { ascending: false }).limit(5);
    results.push({
      category: 'Saúde',
      name: 'Erros nas últimas execuções',
      status: !recentErrors || recentErrors.length === 0 ? 'pass'
        : recentErrors.length < 3 ? 'warn' : 'fail',
      detail: !recentErrors || recentErrors.length === 0
        ? 'Nenhum erro recente — tudo limpo'
        : `${recentErrors.length} erro(s): ${recentErrors.map(e => e.automation_type).join(', ')}`,
    });

    // 9) Total de execuções nas últimas 24h
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const { count: runs24h } = await supabase
      .from('automation_runs').select('*', { count: 'exact', head: true })
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .gte('ran_at', yesterday);
    results.push({
      category: 'Saúde',
      name: 'Execuções nas últimas 24h',
      status: (runs24h ?? 0) > 5 ? 'pass' : (runs24h ?? 0) > 0 ? 'warn' : 'fail',
      detail: `${runs24h ?? 0} execução(ões) registrada(s)`,
    });

    setChecks(results);
    setRunning(false);
    const fails = results.filter(r => r.status === 'fail').length;
    const warns = results.filter(r => r.status === 'warn').length;
    if (fails === 0 && warns === 0) toast.success(`✅ Tudo verde! ${results.length} checagens OK`);
    else if (fails === 0) toast.message(`⚠️ ${warns} aviso(s), mas nada crítico`);
    else toast.error(`❌ ${fails} problema(s) crítico(s)`);
  }, [tenantId]);

  useEffect(() => { run(); }, [run]);

  const pass = checks.filter(c => c.status === 'pass').length;
  const warn = checks.filter(c => c.status === 'warn').length;
  const fail = checks.filter(c => c.status === 'fail').length;
  const grouped = checks.reduce((acc, c) => {
    (acc[c.category] = acc[c.category] || []).push(c);
    return acc;
  }, {} as Record<string, Check[]>);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-lg">Diagnóstico geral das automações</h3>
          </div>
          <Button size="sm" variant="outline" onClick={run} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1">Re-testar</span>
          </Button>
        </div>

        {checks.length > 0 && (
          <div className={`rounded-lg p-3 mb-3 border ${
            fail > 0 ? 'bg-red-500/10 border-red-500/30'
            : warn > 0 ? 'bg-yellow-500/10 border-yellow-500/30'
            : 'bg-green-500/10 border-green-500/30'
          }`}>
            <p className="text-sm font-medium">
              {fail === 0 && warn === 0 ? '✅ Tudo 100%'
                : fail === 0 ? `⚠️ ${warn} aviso(s) — funcionando, mas confira`
                : `❌ ${fail} problema(s) crítico(s)`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {pass} ✅ · {warn} ⚠️ · {fail} ❌ · Modo: <Badge variant="outline" className="ml-1">{storeMode}</Badge>
            </p>
          </div>
        )}

        {running && checks.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Rodando checagens...</span>
          </div>
        )}

        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} className="mb-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{cat}</h4>
            <div className="space-y-2">
              {items.map((c, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-md bg-secondary/40 border border-border/50">
                  <StatusIcon s={c.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground break-words">{c.detail}</p>
                    {c.lastRun && (
                      <p className="text-[10px] text-muted-foreground/70 mt-1 flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {new Date(c.lastRun).toLocaleString('pt-BR')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>

      <Card className="p-3 bg-muted/30">
        <p className="text-xs text-muted-foreground">
          <strong>Como ler:</strong> ✅ rodando OK · ⚠️ funcionando mas com aviso (pode estar desligado de propósito) · ❌ não rodou recentemente ou deu erro.
          <br />Janela esperada: crons horários (≤90min), diários (≤26h).
        </p>
      </Card>
    </div>
  );
};

export default TenantAdminAutomationsDiagnostic;
