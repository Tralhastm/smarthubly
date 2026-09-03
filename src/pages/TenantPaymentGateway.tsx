import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Copy, ExternalLink, Loader2, QrCode, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenantBySlug } from '@/hooks/useTenants';
import { useToast } from '@/hooks/use-toast';

const PAID = new Set(['received', 'preparing', 'ready-for-pickup', 'out-for-delivery', 'delivered']);

function providerLabel(provider: string) {
  if (provider === 'asaas') return 'Asaas';
  if (provider === 'pagbank') return 'PagBank';
  if (provider === 'infinitepay') return 'InfinitePay';
  return 'Mercado Pago';
}

export default function TenantPaymentGateway() {
  const { slug, orderId } = useParams<{ slug: string; orderId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: tenant } = useTenantBySlug(slug);
  const [provider, setProvider] = useState('mercadopago');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [pixCode, setPixCode] = useState<string | null>(null);
  const [pixImage, setPixImage] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    if (!tenant) return;
    const configured = String((tenant as any).payment_provider || 'mercadopago');
    setProvider(configured === 'asaas' && (tenant as any).asaas_enabled === true ? 'asaas' : configured);
  }, [tenant]);

  useEffect(() => {
    if (!orderId || !tenant?.id) return;
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error: invokeError } = await supabase.functions.invoke('create-payment', { body: { order_id: orderId, tenant_id: tenant.id } });
      if (!active) return;
      const result: any = data || {};
      const message = result.error || result.message || (invokeError as any)?.context?.error || invokeError?.message;
      if (result.provider) setProvider(String(result.provider));
      if (invokeError || (!result.init_point && !result.pix_qr_code)) {
        setError(message || 'Não foi possível preparar o pagamento.');
        setLoading(false);
        return;
      }
      setPaymentUrl(result.init_point || null);
      setPixCode(result.pix_qr_code || null);
      setPixImage(result.pix_qr_image ? `data:image/png;base64,${result.pix_qr_image}` : null);
      setLoading(false);
    })().catch((caught: any) => {
      if (!active) return;
      setError(caught?.message || 'Erro de conexão com o servidor de pagamentos.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [orderId, tenant?.id]);

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    const check = async () => {
      const { data } = await (supabase as any).from('orders_public').select('status,total').eq('id', orderId).maybeSingle();
      if (!active || !data) return;
      setTotal(Number(data.total) || 0);
      if (PAID.has(String(data.status))) navigate(`/loja/${slug}/pedido/${orderId}`, { replace: true });
    };
    check();
    const timer = window.setInterval(check, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [orderId, slug, navigate]);

  const openPayment = () => {
    if (!paymentUrl) return;
    const opened = window.open(paymentUrl, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.assign(paymentUrl);
  };

  const copyPix = async () => {
    if (!pixCode) return;
    await navigator.clipboard.writeText(pixCode);
    toast({ title: 'Pix copiado', description: 'Cole o código no aplicativo do seu banco.' });
  };

  const label = providerLabel(provider);
  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 font-heading text-lg text-foreground"><ShieldCheck className="h-5 w-5 text-primary" /> Pagamento seguro</span>
          <Link to={`/loja/${slug}`} className="flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Loja</Link>
        </div>
      </header>
      <div className="mx-auto max-w-xl space-y-4 px-4 py-6">
        <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5 text-center">
          <p className="text-xs text-muted-foreground">Pedido #{orderId?.slice(0, 8)}</p>
          {total !== null && <p className="mt-1 text-3xl font-bold text-primary">R$ {total.toFixed(2)}</p>}
          <p className="mt-2 text-xs text-muted-foreground">Pagamento processado por <strong className="text-foreground">{label}</strong></p>
        </section>
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="mb-3 flex items-center gap-2 font-bold text-foreground"><CheckCircle2 className="h-4 w-4 text-primary" /> Como pagar</h2>
          <p className="text-muted-foreground">Escolha Pix, cartão ou boleto na página segura do {label}. Depois de pagar, volte para esta tela: a confirmação será detectada automaticamente.</p>
          {provider === 'asaas' && <p className="mt-2 text-xs text-muted-foreground">O Asaas pode solicitar e-mail e CPF/CNPJ do pagador na própria fatura.</p>}
        </section>
        {loading && <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Preparando pagamento...</div>}
        {!loading && error && <section className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4"><p className="flex items-center gap-2 font-medium text-red-400"><AlertCircle className="h-4 w-4" /> Não foi possível criar a cobrança</p><p className="text-sm text-muted-foreground">{error}</p><button onClick={() => window.location.reload()} className="w-full rounded-lg bg-secondary py-2.5 text-sm font-medium text-foreground">Tentar novamente</button></section>}
        {!loading && !error && pixCode && <section className="space-y-3 rounded-xl border border-primary/30 bg-card p-5 text-center"><QrCode className="mx-auto h-8 w-8 text-primary" /><p className="font-semibold text-foreground">Pix disponível pelo {label}</p>{pixImage && <img src={pixImage} alt="QR Code Pix" className="mx-auto h-56 w-56" />}<div className="flex gap-2"><input readOnly value={pixCode} className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono" /><button onClick={copyPix} className="rounded-md border border-border px-3" aria-label="Copiar Pix"><Copy className="h-4 w-4" /></button></div>{paymentUrl && <button onClick={openPayment} className="w-full rounded-lg bg-primary py-3 font-bold text-primary-foreground">Pagar com cartão ou boleto</button>}</section>}
        {!loading && !error && !pixCode && paymentUrl && <button onClick={openPayment} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 text-lg font-bold text-primary-foreground"><ExternalLink className="h-5 w-5" /> Abrir pagamento no {label}</button>}
        <Link to={`/loja/${slug}/pedido/${orderId}`} className="block w-full py-2 text-center text-sm text-muted-foreground">Já paguei — ver status do pedido</Link>
      </div>
    </main>
  );
}
