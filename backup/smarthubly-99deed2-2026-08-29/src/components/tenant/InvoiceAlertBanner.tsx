import { useMemo } from 'react';
import { useTenantInvoices } from '@/hooks/useBilling';
import { AlertTriangle, FileText } from 'lucide-react';

const InvoiceAlertBanner = ({ tenantId, onOpenBilling }: { tenantId: string; onOpenBilling?: () => void }) => {
  const { data: invoices = [] } = useTenantInvoices(tenantId);

  const open = useMemo(() => {
    return invoices.filter(i => i.status === 'pending' || i.status === 'overdue' || i.status === 'payment_declared');
  }, [invoices]);

  if (open.length === 0) return null;

  const overdue = open.find(i => i.status === 'overdue');
  const totalOpen = open.reduce((s, i) => s + Number(i.amount), 0);
  const isOverdue = !!overdue;

  return (
    <button
      onClick={onOpenBilling}
      className={`w-full text-left rounded-xl border p-3 mb-3 flex items-center gap-3 transition-colors ${
        isOverdue
          ? 'border-destructive/40 bg-destructive/10 hover:bg-destructive/15'
          : 'border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/15'
      }`}
    >
      <div className={`shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
        isOverdue ? 'bg-destructive/20 text-destructive' : 'bg-yellow-500/20 text-yellow-500'
      }`}>
        {isOverdue ? <AlertTriangle className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold ${isOverdue ? 'text-destructive' : 'text-yellow-500'}`}>
          {isOverdue
            ? `Fatura vencida — R$ ${totalOpen.toFixed(2)}`
            : `${open.length} fatura${open.length > 1 ? 's' : ''} em aberto — R$ ${totalOpen.toFixed(2)}`}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {isOverdue ? 'Sua loja pode ser bloqueada. Toque para regularizar.' : 'Toque aqui para ver detalhes e pagar.'}
        </p>
      </div>
      <span className="shrink-0 text-xs font-medium text-foreground/80">Ver →</span>
    </button>
  );
};

export default InvoiceAlertBanner;
