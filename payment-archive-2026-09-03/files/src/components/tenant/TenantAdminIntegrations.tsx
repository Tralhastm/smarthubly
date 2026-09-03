import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useIntegrationSettings, useUpsertIntegrationSettings, useRotateIntegrationKey, triggerSync } from "@/hooks/useIntegration";
import { Plug, KeyRound, RefreshCw, CheckCircle2, AlertCircle, Copy, Eye, EyeOff, Link as LinkIcon } from "lucide-react";

type Props = { tenantId: string };

const TenantAdminIntegrations = ({ tenantId }: Props) => {
  const { toast } = useToast();
  const { data: settings, isLoading } = useIntegrationSettings(tenantId);
  const upsert = useUpsertIntegrationSettings();
  const rotate = useRotateIntegrationKey();

  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [syncOrders, setSyncOrders] = useState(true);
  const [syncProducts, setSyncProducts] = useState(true);
  const [syncStock, setSyncStock] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [autoSync, setAutoSync] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem(`autoSync:${tenantId}`);
    return v === null ? true : v === "1";
  });
  const [lastAutoTick, setLastAutoTick] = useState<Date | null>(null);
  const [asaasEnabled, setAsaasEnabled] = useState(false);
  const [asaasEnvironment, setAsaasEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [asaasSandboxToken, setAsaasSandboxToken] = useState('');
  const [asaasProductionToken, setAsaasProductionToken] = useState('');
  const [asaasWebhookToken, setAsaasWebhookToken] = useState('');
  const [showAsaasTokens, setShowAsaasTokens] = useState(false);

  // Número de falhas consecutivas do tick antes de pausar o autoSync (5s * 24 = 2 min)

  useEffect(() => {
    supabase.from('tenants').select('asaas_enabled,asaas_environment,asaas_sandbox_token,asaas_production_token,asaas_webhook_token').eq('id', tenantId).single().then(({ data }) => {
      if (!data) return;
      setAsaasEnabled((data as any).asaas_enabled ?? false);
      setAsaasEnvironment(((data as any).asaas_environment as any) || 'sandbox');
      setAsaasSandboxToken((data as any).asaas_sandbox_token || '');
      setAsaasProductionToken((data as any).asaas_production_token || '');
      setAsaasWebhookToken((data as any).asaas_webhook_token || '');
    });
  }, [tenantId]);

  useEffect(() => {
    if (settings) {
      setUrl(settings.financeflow_url || "");
      setEnabled(settings.enabled);
      setSyncOrders(settings.sync_orders);
      setSyncProducts(settings.sync_products);
      setSyncStock(settings.sync_stock);
    }
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(`autoSync:${tenantId}`, autoSync ? "1" : "0");
  }, [autoSync, tenantId]);

  const MAX_CONSECUTIVE_FAILURES = 24;

  // Polling automático a cada 5s — empurra delta (vendas entregues, produtos editados, mudanças de estoque)
  useEffect(() => {
    if (!autoSync || !settings?.enabled || !settings.financeflow_url) return;

    let cancelled = false;
    // Desativa o autoSync permanentemente (neste navegador) quando o endpoint configurado
    // é inválido — evita milhares de falhas silenciosas de DNS a cada 5s.
    let urlValid = false;
    try {
      const u = new URL(settings.financeflow_url!);
      urlValid = u.protocol === "http:" || u.protocol === "https:";
    } catch {
      urlValid = false;
    }
    if (!urlValid) {
      localStorage.setItem(`autoSync:${tenantId}`, "0");
      setAutoSync(false);
      toast({ title: "Integração pausada", description: `O endpoint configurado ("${settings.financeflow_url}") não é uma URL válida. O sync automático foi desligado para evitar erros em fila. Corrija a URL e reative.`, variant: "destructive" });
      return;
    }
    let lastTick = settings.last_sync_at
      ? new Date(settings.last_sync_at).toISOString()
      : new Date(Date.now() - 60_000).toISOString();

    const tick = async () => {
      if (cancelled) return;
      try {
        const nowIso = new Date().toISOString();

        if (settings.sync_orders) {
          const { data: orders } = await supabase
            .from("orders")
            .select("id,total,delivery_fee,discount_amount,payment_method,customer_name,customer_phone,delivery_type,status,created_at,updated_at,coupon_code")
            .eq("tenant_id", tenantId)
            .eq("status", "delivered")
            .gte("updated_at", lastTick)
            .limit(50);
          if (orders && orders.length > 0) {
            await triggerSync(tenantId, "order_delivered", { orders });
          }

          // Cancelamentos recentes — pra FinanceFlow estornar receita fantasma
          const { data: cancelled } = await supabase
            .from("orders")
            .select("id,total,payment_method,updated_at,cancel_reason,customer_name,customer_phone")
            .eq("tenant_id", tenantId)
            .eq("status", "cancelled")
            .gte("updated_at", lastTick)
            .limit(50);
          if (cancelled && cancelled.length > 0) {
            await triggerSync(tenantId, "order_cancelled", { orders: cancelled });
          }
        }

        if (settings.sync_products) {
          const { data: products } = await supabase
            .from("products")
            .select("id,name,price,original_price,category,stock_quantity,description,image,in_stock,updated_at")
            .eq("tenant_id", tenantId)
            .gte("updated_at", lastTick)
            .limit(50);
          if (products && products.length > 0) {
            await triggerSync(tenantId, "product_upsert", { products });
          }
        }

        if (settings.sync_stock) {
          const { data: stock } = await supabase
            .from("products")
            .select("id,name,stock_quantity,in_stock,updated_at")
            .eq("tenant_id", tenantId)
            .gte("updated_at", lastTick)
            .limit(50);
          if (stock && stock.length > 0) {
            await triggerSync(tenantId, "stock_change", { stock });
          }
        }

        lastTick = nowIso;
        if (!cancelled) { setLastAutoTick(new Date()); consecutiveFailures = 0; }
      } catch (e) {
        console.warn("auto-sync tick falhou:", e);
        consecutiveFailures++;
        // Falha consecutiva persistente (2 min) — endpoint provavelmente inválido/fora do ar.
        // Pausa o autoSync e avisa o usuário em vez de continuar falhando em silêncio.
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          localStorage.setItem(`autoSync:${tenantId}`, "0");
          if (!cancelled) setAutoSync(false);
          if (!cancelled) toast({ title: "Integração pausada", description: `O endpoint da integração falhou repetidamente (${consecutiveFailures}x). O sync automático foi desligado para não congestionar. Verifique a URL e reative quando corrigir.`, variant: "destructive" });
          clearInterval(id);
          cancelled = true;
        }
      }
    };

    let consecutiveFailures = 0;
    const id = setInterval(tick, 5000);
    tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [
    autoSync,
    settings?.enabled,
    settings?.financeflow_url,
    settings?.sync_orders,
    settings?.sync_products,
    settings?.sync_stock,
    settings?.last_sync_at,
    tenantId,
  ]);

  const saveAsaas = async () => {
    const sandboxToken = asaasSandboxToken.trim() || null;
    const productionToken = asaasProductionToken.trim() || null;
    const selectedToken = asaasEnvironment === 'production' ? productionToken : sandboxToken;
    const asaasIsReady = asaasEnabled && !!selectedToken;
    const { error } = await supabase.from('tenants').update({
      asaas_enabled: asaasEnabled,
      asaas_environment: asaasEnvironment,
      asaas_sandbox_token: sandboxToken,
      asaas_production_token: productionToken,
      asaas_webhook_token: asaasWebhookToken.trim() || null,
      payment_provider: asaasIsReady ? 'asaas' : 'mercadopago',
    } as any).eq('id', tenantId);
    if (error) toast({ title: 'Erro ao salvar Asaas', description: error.message, variant: 'destructive' });
    else toast({ title: 'Asaas salvo', description: 'As credenciais foram atualizadas com segurança.' });
  };

  const save = async () => {
    try {
      const cleanUrl = url.trim().replace(/\/+$/, "");
      await upsert.mutateAsync({
        tenant_id: tenantId,
        financeflow_url: cleanUrl,
        enabled, sync_orders: syncOrders, sync_products: syncProducts, sync_stock: syncStock,
      });
      toast({ title: "Configurações salvas", description: "Integração atualizada." });
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    }
  };

  const rotateKey = async () => {
    if (!confirm("Gerar nova chave? A antiga vai parar de funcionar imediatamente.")) return;
    try {
      await rotate.mutateAsync(tenantId);
      toast({ title: "Nova chave gerada", description: "Atualize a chave também no Send My File." });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copiado` });
  };

  const syncAllProducts = async () => {
    if (!settings?.enabled || !settings.financeflow_url) {
      toast({ title: "Configure primeiro", description: "Cole a URL do Send My File e ative a integração antes.", variant: "destructive" });
      return;
    }
    setSyncing(true);
    try {
      const { data: products, error } = await supabase
        .from("products").select("id,name,price,original_price,category,stock_quantity,description,image,in_stock")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      await triggerSync(tenantId, "full_catalog", { products: products || [] });
      toast({ title: "Catálogo enviado", description: `${products?.length || 0} produtos sincronizados.` });
    } catch (e: any) {
      toast({ title: "Falha", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  if (isLoading) return <div className="text-muted-foreground">Carregando…</div>;

  const apiKey = settings?.api_key || "";
  const projectUrl = import.meta.env.VITE_SUPABASE_URL || "";
  const pullUrl = `${projectUrl}/functions/v1/pull-for-financeflow`;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Plug className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Send My File — Integração financeira</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Liga sua loja com o <strong>Send My File</strong> (gestor financeiro). Vendas entregues viram receita PJ automática lá; produtos e estoque ficam sincronizados.
        </p>

        <div className="space-y-3">
          <div className="rounded-md border border-border bg-secondary/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <LinkIcon className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">📥 Cole isto NO Send My File</span>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">URL desta loja (endpoint pull)</label>
                <div className="mt-1 flex gap-2">
                  <input readOnly value={pullUrl} className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono" />
                  <button type="button" onClick={() => copy(pullUrl, "URL")} className="rounded-md border border-border px-3 hover:bg-secondary">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <KeyRound className="h-3 w-3" /> Chave de API desta loja
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    type={showKey ? "text" : "password"} value={apiKey} readOnly
                    className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
                  />
                  <button type="button" onClick={() => setShowKey(s => !s)} className="rounded-md border border-border px-3 hover:bg-secondary" title={showKey ? "Ocultar" : "Mostrar"}>
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={() => copy(apiKey, "Chave")} className="rounded-md border border-border px-3 hover:bg-secondary">
                    <Copy className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={rotateKey} className="rounded-md border border-border px-3 hover:bg-secondary" title="Gerar nova">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                No Send My File: cole essa URL e essa chave nas configurações da integração. O botão "Sincronizar" lá vai puxar tudo desta loja.
              </p>
            </div>
          </div>

          <div className="rounded-md border border-border bg-secondary/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <LinkIcon className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">📤 URL do Send My File (push automático em tempo real)</span>
            </div>
            <input
              type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://share-with-warmth.lovable.app"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Opcional. Se preencher, toda venda entregue / produto novo é empurrado pra lá em tempo real (não precisa esperar sync manual).
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
            <span className="text-sm font-medium">Integração ativa</span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pl-6">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={syncOrders} onChange={(e) => setSyncOrders(e.target.checked)} className="h-4 w-4" />
              Vendas (entregues → receita PJ)
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={syncProducts} onChange={(e) => setSyncProducts(e.target.checked)} className="h-4 w-4" />
              Produtos (criar/editar)
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={syncStock} onChange={(e) => setSyncStock(e.target.checked)} className="h-4 w-4" />
              Estoque (baixa automática)
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button onClick={save} disabled={upsert.isPending} className="rounded-md gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              Salvar configurações
            </button>
            <button onClick={syncAllProducts} disabled={syncing || !enabled || !url} className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50">
              {syncing ? "Enviando…" : "Empurrar catálogo agora"}
            </button>
            <label className="ml-auto flex items-center gap-2 cursor-pointer text-sm rounded-md border border-border px-3 py-2 hover:bg-secondary">
              <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} className="h-4 w-4" />
              <span className="font-medium">Sync automático (5s)</span>
              {autoSync && enabled && url && (
                <span className="inline-flex h-2 w-2 rounded-full bg-primary animate-pulse" title="Ativo" />
              )}
            </label>
          </div>
          {autoSync && enabled && url && lastAutoTick && (
            <p className="text-xs text-muted-foreground pl-1">
              Última verificação automática: {lastAutoTick.toLocaleTimeString("pt-BR")}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /><h3 className="font-semibold">Asaas — pagamentos</h3></div>
        <p className="text-sm text-muted-foreground">Cole os tokens da sua conta Asaas. O token usado pelo sistema muda conforme o ambiente selecionado.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={asaasEnabled} onChange={e => setAsaasEnabled(e.target.checked)} className="h-4 w-4" /> Ativar Asaas nesta loja</label>
        <div><label className="text-xs font-medium text-muted-foreground">Ambiente</label><select value={asaasEnvironment} onChange={e => setAsaasEnvironment(e.target.value as any)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"><option value="sandbox">Sandbox / homologação</option><option value="production">Produção</option></select></div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-muted-foreground">Token Sandbox<input type={showAsaasTokens ? 'text' : 'password'} value={asaasSandboxToken} onChange={e => setAsaasSandboxToken(e.target.value)} placeholder="$aact_hmlg_..." className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" /></label>
          <label className="text-xs font-medium text-muted-foreground">Token Produção<input type={showAsaasTokens ? 'text' : 'password'} value={asaasProductionToken} onChange={e => setAsaasProductionToken(e.target.value)} placeholder="$aact_..." className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" /></label>
        </div>
        <label className="text-xs font-medium text-muted-foreground">Token de autenticação do webhook<input type={showAsaasTokens ? 'text' : 'password'} value={asaasWebhookToken} onChange={e => setAsaasWebhookToken(e.target.value)} placeholder="Token definido em Configurações → Webhooks no Asaas" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" /></label>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setShowAsaasTokens(v => !v)} className="rounded-md border border-border px-3 py-2 text-sm">{showAsaasTokens ? 'Ocultar tokens' : 'Mostrar tokens'}</button><button type="button" onClick={saveAsaas} className="rounded-md gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground">Salvar Asaas</button></div>
        <p className="text-xs text-muted-foreground">Webhook: <code>{`${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/asaas-webhook`}</code></p>
      </div>

      {settings?.last_sync_at && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          <div className="flex items-center gap-2 mb-1">
            {settings.last_sync_status?.startsWith("success") ? (
              <CheckCircle2 className="h-4 w-4 text-primary" />
            ) : (
              <AlertCircle className="h-4 w-4 text-destructive" />
            )}
            <span className="font-medium">Última sincronização:</span>
            <span className="text-muted-foreground">{new Date(settings.last_sync_at).toLocaleString("pt-BR")}</span>
          </div>
          <p className="text-xs text-muted-foreground">Status: {settings.last_sync_status || "—"}</p>
          {settings.last_sync_error && (
            <p className="mt-1 text-xs text-destructive break-all">{settings.last_sync_error}</p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border bg-secondary/40 p-4 text-sm">
        <h4 className="font-medium mb-2">📘 Como funciona</h4>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li><strong>PULL (manual):</strong> no Send My File, cole a URL e chave acima. Quando clicar em "Sincronizar" lá, ele puxa todos produtos e vendas entregues desta loja.</li>
          <li><strong>PUSH (automático):</strong> se preencher a URL do Send My File aqui, toda venda entregue + produto novo já cai lá na hora.</li>
          <li><strong>Estoque:</strong> a loja é dona do estoque — qualquer venda baixa o estoque tanto aqui quanto lá.</li>
          <li><strong>XML/TXT:</strong> a importação de produtos por arquivo (NF-e, ERP) fica do lado do Send My File.</li>
        </ul>
      </div>
    </div>
  );
};

export default TenantAdminIntegrations;
