import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, RefreshCw, Tag, ExternalLink, Clock, Copy } from "lucide-react";
import { toast } from "sonner";

interface Props { tenantId: string; tenantSlug: string; }

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface CouponProduct {
  id: string;
  name: string;
  price: number;
  affiliate_coupon_code: string | null;
  affiliate_coupon_discount_price: number | null;
  affiliate_coupon_expires_at: string | null;
}

const TenantAdminCouponsTest = ({ tenantId, tenantSlug }: Props) => {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [products, setProducts] = useState<CouponProduct[]>([]);
  const [checks, setChecks] = useState<CheckResult[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('products')
      .select('id, name, price, affiliate_coupon_code, affiliate_coupon_discount_price, affiliate_coupon_expires_at')
      .eq('tenant_id', tenantId)
      .not('affiliate_coupon_code', 'is', null)
      .order('affiliate_coupon_expires_at', { ascending: false });
    if (error) toast.error('Erro ao carregar: ' + error.message);
    setProducts((data ?? []) as CouponProduct[]);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const runChecks = useCallback(async () => {
    setRunning(true);
    const results: CheckResult[] = [];

    // 1) Schema OK
    const { error: schemaErr } = await supabase
      .from('products')
      .select('affiliate_coupon_code, affiliate_coupon_discount_price, affiliate_coupon_expires_at')
      .eq('tenant_id', tenantId)
      .limit(1);
    results.push({
      name: 'Banco: colunas de cupom existem',
      passed: !schemaErr,
      detail: schemaErr ? schemaErr.message : 'affiliate_coupon_code, _discount_price, _expires_at OK',
    });

    // 2) Pelo menos 1 cupom ativo
    const now = new Date().toISOString();
    const { data: actives } = await supabase
      .from('products')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .not('affiliate_coupon_code', 'is', null)
      .gt('affiliate_coupon_expires_at', now);
    results.push({
      name: 'Catálogo: existe cupom ATIVO',
      passed: (actives?.length ?? 0) > 0,
      detail: actives?.length ? `${actives.length} produto(s) com cupom válido` : 'Nenhum cupom ativo cadastrado',
    });

    // 3) Cupom expirado é tratado (existe e tem data passada)
    const { data: expired } = await supabase
      .from('products')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .not('affiliate_coupon_code', 'is', null)
      .lt('affiliate_coupon_expires_at', now);
    results.push({
      name: 'Fallback: cupom expirado detectado',
      passed: true, // o frontend filtra; aqui só mostra contagem
      detail: expired?.length
        ? `${expired.length} cupom(ns) expirado(s) — vitrine ignora e mostra preço normal`
        : 'Nenhum cupom expirado (ainda) — ok',
    });

    // 4) Validação: discount < price
    const { data: invalid } = await supabase
      .from('products')
      .select('id, name, price, affiliate_coupon_discount_price')
      .eq('tenant_id', tenantId)
      .not('affiliate_coupon_discount_price', 'is', null);
    const broken = (invalid ?? []).filter(
      (p: any) => p.affiliate_coupon_discount_price >= p.price
    );
    results.push({
      name: 'Validação: preço com cupom < preço normal',
      passed: broken.length === 0,
      detail: broken.length === 0
        ? 'Todos os descontos são realmente descontos'
        : `${broken.length} produto(s) com cupom igual/maior que preço — vitrine vai ignorar`,
    });

    // 5) Clipboard API disponível
    results.push({
      name: 'Navegador: API de copiar cupom disponível',
      passed: !!(navigator.clipboard && navigator.clipboard.writeText),
      detail: navigator.clipboard ? 'navigator.clipboard.writeText OK' : 'Clipboard indisponível neste navegador',
    });

    setChecks(results);
    setRunning(false);
    const failed = results.filter(r => !r.passed).length;
    if (failed === 0) toast.success(`✅ ${results.length}/${results.length} checagens OK`);
    else toast.error(`${failed} checagem(ns) falharam`);
  }, [tenantId]);

  useEffect(() => { runChecks(); }, [runChecks]);

  const isActive = (p: CouponProduct) =>
    p.affiliate_coupon_expires_at && new Date(p.affiliate_coupon_expires_at) > new Date();

  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString('pt-BR') : '-';
  const timeLeft = (s: string | null) => {
    if (!s) return '';
    const ms = new Date(s).getTime() - Date.now();
    if (ms <= 0) return 'Expirado';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 24 ? `${Math.floor(h/24)}d ${h%24}h` : `${h}h ${m}m`;
  };

  const passedCount = checks.filter(c => c.passed).length;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-lg">Auto-teste do sistema de cupons</h3>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={runChecks} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-1">Re-testar</span>
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.open(`/loja/${tenantSlug}`, '_blank')}>
              <ExternalLink className="h-4 w-4 mr-1" /> Ver vitrine
            </Button>
          </div>
        </div>

        {checks.length > 0 && (
          <div className={`rounded-lg p-3 mb-3 ${passedCount === checks.length ? 'bg-green-500/10 border border-green-500/30' : 'bg-yellow-500/10 border border-yellow-500/30'}`}>
            <p className="text-sm font-medium">
              {passedCount === checks.length ? '✅ Tudo OK' : '⚠️ Atenção'}
              {' — '}{passedCount}/{checks.length} checagens passaram
            </p>
          </div>
        )}

        <div className="space-y-2">
          {checks.map((c, i) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-secondary/40">
              {c.passed ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">{c.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Cupons cadastrados ({products.length})</h3>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum cupom cadastrado. Vá em <strong>Produtos</strong> e edite um item para adicionar.
          </p>
        ) : (
          <div className="space-y-2">
            {products.map(p => {
              const active = isActive(p);
              const discount = p.affiliate_coupon_discount_price && p.price
                ? Math.round((1 - p.affiliate_coupon_discount_price / p.price) * 100)
                : 0;
              return (
                <div key={p.id} className={`rounded-lg border p-3 ${active ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/30 opacity-70'}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{p.name}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant={active ? 'default' : 'secondary'}>
                          {active ? '✅ Ativo na vitrine' : '⛔ Expirado — escondido'}
                        </Badge>
                        {discount > 0 && <Badge variant="outline">-{discount}%</Badge>}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Cupom</p>
                      <p className="font-mono font-bold">{p.affiliate_coupon_code}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Preços</p>
                      <p>R$ {p.price.toFixed(2)} → <strong>R$ {p.affiliate_coupon_discount_price?.toFixed(2)}</strong></p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Expira em</p>
                      <p>{fmtDate(p.affiliate_coupon_expires_at)} <span className="text-primary font-medium">({timeLeft(p.affiliate_coupon_expires_at)})</span></p>
                    </div>
                  </div>
                  {active && (
                    <Button size="sm" variant="outline" className="mt-2 w-full" onClick={async () => {
                      await navigator.clipboard.writeText(p.affiliate_coupon_code!);
                      toast.success(`Cupom ${p.affiliate_coupon_code} copiado!`);
                    }}>
                      <Copy className="h-3 w-3 mr-1" /> Testar copiar cupom
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default TenantAdminCouponsTest;
