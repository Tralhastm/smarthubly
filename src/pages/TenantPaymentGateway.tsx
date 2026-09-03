import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTenantBySlug } from '@/hooks/useTenants';
import { CreditCard, ArrowLeft, Mail, QrCode, Copy, ExternalLink, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

/**
 * Página intermediária de pagamento online.
 * - Evita o "abre app Mercado Pago automaticamente" porque o redirect só acontece
 *   após CLIQUE explícito do usuário (gesture) → Android não dispara intent automático.
 * - Mostra guia visual: precisa do EMAIL pra receber a chave Pix; explica fluxo.
 * - Após o pagamento aprovado (polling ou webhook), redireciona pro status com toast.
 */
const TenantPaymentGateway = () => {
  const { slug, orderId } = useParams<{ slug: string; orderId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: tenant } = useTenantBySlug(slug);
  const [initPoint, setInitPoint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orderTotal, setOrderTotal] = useState<number | null>(null);
  const [asaasPixCode, setAsaasPixCode] = useState<string | null>(null);
  const [asaasPixImage, setAsaasPixImage] = useState<string | null>(null);
  const [paymentProvider, setPaymentProvider] = useState<string>('mercadopago');

  // 1) Cria a preferência (ou recupera o init_point se já existe)
  useEffect(() => {
    if (!orderId || !tenant?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke('create-payment', {
          body: { order_id: orderId, tenant_id: tenant.id },
        });
        if (cancelled) return;
        const serverMsg: string | undefined =
          (data as any)?.error || (fnErr as any)?.context?.error || (fnErr as any)?.message;
        if (fnErr || (!data?.init_point && !data?.pix_qr_code)) {
          setError(serverMsg || 'Não foi possível abrir o pagamento.');
          setLoading(false);
          return;
        }
        if ((data as any)?.provider === 'asaas' && (data as any)?.pix_qr_code) {
          setPaymentProvider('asaas');
          setAsaasPixCode(String((data as any).pix_qr_code));
          setAsaasPixImage((data as any).pix_qr_image ? `data:image/png;base64,${(data as any).pix_qr_image}` : null);
          return;
        }
        // Força a versão web do Mercado Pago: troca o domínio mobile e força channel=web
        // Isso evita o redirect automático pro app instalado no Android.
        // 🌐 Força versão WEB do Mercado Pago (evita App Link no Android):
        // 1) Remove flags de app
        // 2) Força host desktop www.mercadopago.com.br (sem App Link associado)
        // 3) Marca canal web em vários params que o MP respeita
        let url: string = data.init_point;
        try {
          const u = new URL(url);
          u.searchParams.delete('redirect_from_app');
          u.searchParams.set('source', 'web');
          u.searchParams.set('platform', 'web');
          u.searchParams.set('mode', 'web');
          // Domínios mobile do MP têm App Link — troca pra www
          if (u.hostname === 'mpago.la' || u.hostname === 'mpago.li' || u.hostname.startsWith('m.mercadopago')) {
            u.hostname = 'www.mercadopago.com.br';
          }
          url = u.toString();
        } catch { /* mantém url original se parse falhar */ }
        setInitPoint(url);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Erro de conexão.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orderId, tenant?.id]);

  // 2) Carrega total do pedido pra mostrar
  useEffect(() => {
    if (!orderId) return;
    (supabase as any).from('orders_public').select('total,status').eq('id', orderId).maybeSingle()
      .then(({ data }: any) => {
        if (data) {
          setOrderTotal(Number(data.total) || 0);
          // Se já foi pago (received/preparing/...), redireciona direto pro status
          if (['received', 'preparing', 'ready-for-pickup', 'out-for-delivery', 'delivered'].includes(data.status)) {
            navigate(`/loja/${slug}/pedido/${orderId}`, { replace: true });
          }
        }
      });
  }, [orderId, slug, navigate]);

  // 3) Polling: se o cliente voltar pra essa aba após pagar, detecta aprovação
  useEffect(() => {
    if (!orderId) return;
    const interval = setInterval(async () => {
      const { data }: any = await (supabase as any).from('orders_public')
        .select('status').eq('id', orderId).maybeSingle();
      if (data && ['received', 'preparing'].includes(data.status)) {
        toast({ title: '✅ Pagamento aprovado!', description: 'Seu pedido foi confirmado.' });
        clearInterval(interval);
        navigate(`/loja/${slug}/pedido/${orderId}?paid=1`, { replace: true });
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [orderId, slug, navigate, toast]);

  const handleGoToPayment = () => {
    if (!initPoint) return;
    try { sessionStorage.setItem(`pay-init-${orderId}`, String(Date.now())); } catch {}
    // 🌐 ABRE EM NOVA ABA — Chrome Android NÃO dispara App Links via window.open com gesto.
    // Mantém esta aba viva fazendo o polling de aprovação.
    const win = window.open(initPoint, '_blank', 'noopener,noreferrer');
    // Fallback: se o popup foi bloqueado, navega na mesma aba
    if (!win) window.location.href = initPoint;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <span className="font-heading text-lg text-foreground flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" /> Pagamento Online
          </span>
          <Link to={`/loja/${slug}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
            <ArrowLeft className="h-4 w-4" /> Loja
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-xl space-y-4">
        {/* Resumo */}
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 text-center space-y-2">
          <p className="text-xs text-muted-foreground">Pedido #{orderId?.slice(0, 8)}</p>
          {orderTotal != null && (
            <p className="text-3xl font-bold text-primary">R$ {orderTotal.toFixed(2)}</p>
          )}
          <p className="text-xs text-muted-foreground">Pagamento processado por {paymentProvider === 'asaas' ? 'Asaas' : ((tenant as any)?.payment_provider === 'pagbank') ? 'PagBank' : 'Mercado Pago'}</p>
        </div>

        {/* GUIA — passo a passo */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Como pagar (leia antes!)
          </h2>

          <div className="space-y-2.5 text-sm">
            <div className="flex gap-3">
              <div className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</div>
              <div>
                <p className="text-foreground font-medium">Escolha a forma: Pix, Cartão ou Boleto</p>
                <p className="text-xs text-muted-foreground">Pix cai em segundos. Cartão pode parcelar.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">2</div>
              <div>
                <p className="text-foreground font-medium flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-amber-400" /> Coloque seu e-mail
                </p>
                <p className="text-xs text-muted-foreground">
                  <strong className="text-amber-400">⚠️ Importante:</strong> mesmo no Pix, o Mercado Pago pede um e-mail.
                  Sem e-mail a chave Pix / QR Code não aparece. Pode ser qualquer e-mail seu.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">3</div>
              <div>
                <p className="text-foreground font-medium flex items-center gap-1.5">
                  <QrCode className="h-3.5 w-3.5 text-primary" /> Pague o QR Code ou copie o código
                </p>
                <p className="text-xs text-muted-foreground">
                  Abra seu banco, escaneie o QR ou cole o "copia e cola". Depois é só voltar pra esta aba.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="shrink-0 w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-bold">✓</div>
              <div>
                <p className="text-foreground font-medium">Aguarde a confirmação</p>
                <p className="text-xs text-muted-foreground">
                  Assim que o pagamento for aprovado, você é avisado aqui automaticamente — sem precisar atualizar nada.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Botão principal */}
        {loading ? (
          <div className="rounded-xl border border-border bg-card p-6 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Preparando pagamento...
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-2">
            <p className="text-red-400 font-medium flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Erro</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <button onClick={() => window.location.reload()} className="w-full mt-1 rounded-lg bg-secondary text-foreground py-2.5 text-sm font-medium hover:bg-secondary/80">
              Tentar novamente
            </button>
          </div>
        ) : asaasPixCode ? (
          <div className="rounded-xl border border-primary/30 bg-card p-5 space-y-4 text-center">
            <QrCode className="mx-auto h-8 w-8 text-primary" />
            <p className="font-semibold">Pague com Pix pelo Asaas</p>
            {asaasPixImage && <img src={asaasPixImage} alt="QR Code Pix" className="mx-auto h-56 w-56" />}
            <div className="flex gap-2"><input readOnly value={asaasPixCode} className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono" /><button onClick={() => { navigator.clipboard.writeText(asaasPixCode); toast({ title: 'Pix copiado' }); }} className="rounded-md border border-border px-3"><Copy className="h-4 w-4" /></button></div>
            {initPoint && <a href={initPoint} target="_blank" rel="noreferrer" className="block w-full rounded-lg gradient-primary py-3 text-center text-sm font-bold text-primary-foreground">Pagar com cartão ou escolher outra forma</a>}
            <p className="text-xs text-muted-foreground">Após pagar, permaneça nesta tela. O pedido será confirmado automaticamente pelo webhook.</p>
          </div>
        ) : (
          <>
            <button
              onClick={handleGoToPayment}
              className="w-full gradient-primary text-primary-foreground py-4 rounded-xl font-bold text-lg hover:opacity-90 transition flex items-center justify-center gap-2 shadow-lg"
            >
              <ExternalLink className="h-5 w-5" />
              Ir para o pagamento
            </button>
            <p className="text-[11px] text-center text-muted-foreground">
              Você será levado para o ambiente seguro do provedor. Após pagar, volte para esta página — vamos confirmar tudo aqui.
            </p>
          </>
        )}

        {/* Atalho pra ver o pedido enquanto isso */}
        <Link
          to={`/loja/${slug}/pedido/${orderId}`}
          className="block w-full text-center text-sm text-muted-foreground hover:text-primary py-2"
        >
          Já paguei — ver status do pedido
        </Link>
      </div>
    </div>
  );
};

export default TenantPaymentGateway;
