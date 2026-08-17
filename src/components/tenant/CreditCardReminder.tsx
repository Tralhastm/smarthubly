import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CreditCard } from 'lucide-react';

/**
 * Pop-up global que avisa o admin quando uma compra no cartão está perto
 * do vencimento (≤3 dias) ou já venceu. Roda em qualquer tela do painel,
 * faz polling a cada 5 min e usa sessionStorage pra não repetir o mesmo
 * aviso na mesma sessão.
 */
const CreditCardReminder = ({ tenantId }: { tenantId: string }) => {
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;

    const check = async () => {
      const { data, error } = await supabase
        .from('financial_entries')
        .select('id, description, amount, due_date')
        .eq('tenant_id', tenantId)
        .eq('is_credit_card', true)
        .eq('paid', false)
        .not('due_date', 'is', null);
      if (error || cancelled || !data) return;

      const now = Date.now();
      const threeDays = 3 * 86400000;
      const seenKey = `cc_reminder_seen_${tenantId}`;
      const seen: string[] = JSON.parse(sessionStorage.getItem(seenKey) || '[]');

      data.forEach((e: any) => {
        if (!e.due_date) return;
        const due = new Date(e.due_date).getTime();
        const diff = due - now;
        if (diff > threeDays) return; // ainda longe
        if (seen.includes(e.id)) return; // já avisado nesta sessão

        const overdue = diff < 0;
        const days = Math.abs(Math.ceil(diff / 86400000));
        toast.warning(
          overdue
            ? `💳 Fatura VENCIDA há ${days} dia(s)`
            : days === 0
              ? `💳 Fatura vence HOJE`
              : `💳 Fatura vence em ${days} dia(s)`,
          {
            description: `${e.description} — R$${Number(e.amount).toFixed(2)}. Abra a aba 💳 Cartão pra registrar o pagamento.`,
            duration: 12000,
            icon: <CreditCard className="h-4 w-4" />,
          }
        );
        seen.push(e.id);
      });

      sessionStorage.setItem(seenKey, JSON.stringify(seen));
    };

    check();
    const id = setInterval(check, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [tenantId]);

  return null;
};

export default CreditCardReminder;
