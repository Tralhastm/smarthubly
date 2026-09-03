import { useState, useEffect } from 'react';
import { useProducts } from '@/hooks/useProducts';
import { useOrders } from '@/hooks/useOrders';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, Circle, X, ChevronRight, Sparkles } from 'lucide-react';

interface Props {
  tenantId: string;
  tenant: any;
  onNavigate: (tab: string) => void;
}

const STORAGE_KEY_PREFIX = 'onboarding-dismissed-';

const OnboardingChecklist = ({ tenantId, tenant, onNavigate }: Props) => {
  const { data: products = [] } = useProducts(tenantId);
  const { data: orders = [] } = useOrders(tenantId);
  const [hasSupplier, setHasSupplier] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDismissed(localStorage.getItem(STORAGE_KEY_PREFIX + tenantId) === '1');
    }
  }, [tenantId]);

  useEffect(() => {
    supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('active', true)
      .then(({ count }) => setHasSupplier((count || 0) > 0));
  }, [tenantId]);

  const steps = [
    {
      id: 'logo',
      label: 'Adicione logo e endereço da loja',
      done: !!(tenant?.logo_url && tenant?.address),
      tab: 'settings',
    },
    {
      id: 'products',
      label: `Cadastre seus produtos (${products.length} cadastrados)`,
      done: products.length >= 3,
      tab: 'products',
    },
    {
      id: 'payment',
      label: 'Configure forma de pagamento (Pix ou cartão)',
      done: !!(tenant?.mercadopago_token || tenant?.pix_key),
      tab: 'settings',
    },
    {
      id: 'shipping',
      label: 'Defina como você entrega (frete, retirada ou local)',
      done: tenant?.shipping_enabled === true || tenant?.pickup_enabled === true || tenant?.store_mode === 'local' || hasSupplier,
      tab: 'shipping',
    },
    {
      id: 'first_order',
      label: 'Receba seu primeiro pedido 🎉',
      done: orders.length > 0,
      tab: 'orders',
    },
  ];

  const completed = steps.filter(s => s.done).length;
  const total = steps.length;
  const percent = Math.round((completed / total) * 100);
  const allDone = completed === total;

  if (dismissed || allDone) return null;

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(STORAGE_KEY_PREFIX + tenantId, '1');
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-card p-4 mb-4 relative">
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 text-muted-foreground hover:text-foreground p-1"
        aria-label="Dispensar"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-2 mb-3 pr-6">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="font-heading text-sm text-foreground">Configure sua loja em {total} passos</h3>
        <span className="ml-auto text-xs font-medium text-primary">{completed}/{total}</span>
      </div>

      <div className="h-1.5 bg-secondary rounded-full overflow-hidden mb-3">
        <div className="h-full gradient-primary transition-all" style={{ width: `${percent}%` }} />
      </div>

      <ul className="space-y-1.5">
        {steps.map(s => (
          <li key={s.id}>
            <button
              onClick={() => !s.done && onNavigate(s.tab)}
              disabled={s.done}
              className={`w-full flex items-center gap-2 text-xs text-left rounded-md px-2 py-1.5 transition ${
                s.done ? 'opacity-60 cursor-default' : 'hover:bg-primary/10 cursor-pointer'
              }`}
            >
              {s.done ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className={s.done ? 'line-through text-muted-foreground' : 'text-foreground'}>
                {s.label}
              </span>
              {!s.done && <ChevronRight className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default OnboardingChecklist;
