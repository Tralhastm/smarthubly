import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  tenantId: string;
  /** Nome amigável da loja (cabeçalho do PDF). */
  tenantName?: string;
}

type EntryRow = {
  date: string;
  type: 'income' | 'expense';
  category: string | null;
  subcategory: string | null;
  description: string | null;
  amount: number;
  payment_method: string | null;
  paid: boolean | null;
};

type OrderRow = {
  id: string;
  created_at: string;
  status: string;
  payment_method: string | null;
  total: number;
  platform_fee: number | null;
  delivery_fee: number | null;
};

const fmtBR = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

/**
 * Botão "Relatório p/ Contador" — gera PDF mensal pronto pra enviar.
 * Inclui: resumo (receita, despesa, lucro), pedidos entregues, lançamentos
 * manuais (entradas e saídas), taxa da plataforma. Tudo do mês corrente.
 */
const FinancialReportPDFButton = ({ tenantId, tenantName }: Props) => {
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const start = new Date(y, m, 1).toISOString();
      const end = new Date(y, m + 1, 1).toISOString();

      // Busca em paralelo: tenant, entries, orders
      const [tenantRes, entriesRes, ordersRes] = await Promise.all([
        supabase
          .from('tenants')
          .select('name, slug, billing_mode, platform_fee_percent, monthly_fee')
          .eq('id', tenantId)
          .maybeSingle(),
        supabase
          .from('financial_entries')
          .select('date, type, category, subcategory, description, amount, payment_method, paid')
          .eq('tenant_id', tenantId)
          .gte('date', start)
          .lt('date', end)
          .order('date', { ascending: true }),
        supabase
          .from('orders')
          .select('id, created_at, status, payment_method, total, platform_fee, delivery_fee')
          .eq('tenant_id', tenantId)
          .gte('created_at', start)
          .lt('created_at', end)
          .order('created_at', { ascending: true }),
      ]);

      const tenant = tenantRes.data;
      const entries: EntryRow[] = (entriesRes.data as any[]) || [];
      const orders: OrderRow[] = (ordersRes.data as any[]) || [];

      const displayName = tenant?.name || tenantName || 'Loja';

      // Filtra entries auto criadas pelo trigger pra evitar dupla contagem
      // (vamos contar pedidos diretamente via tabela orders)
      const isOrderRevenueEntry = (e: EntryRow) =>
        !!(e.description && e.description.includes('#ORDER_REVENUE:'));
      const manualEntries = entries.filter(e => !isOrderRevenueEntry(e));

      const deliveredOrders = orders.filter(o => o.status === 'delivered');
      const isFiado = (pm: string | null) => (pm || '').toLowerCase() === 'fiado';
      const realizedOrders = deliveredOrders.filter(o => !isFiado(o.payment_method));

      const orderRevenue = realizedOrders.reduce((s, o) => s + Number(o.total || 0), 0);
      const orderPlatformFees = realizedOrders.reduce(
        (s, o) => s + Number(o.platform_fee || 0),
        0
      );
      const orderDeliveryFees = realizedOrders.reduce(
        (s, o) => s + Number(o.delivery_fee || 0),
        0
      );

      const manualIn = manualEntries
        .filter(e => e.type === 'income')
        .reduce((s, e) => s + Number(e.amount), 0);
      const manualOut = manualEntries
        .filter(e => e.type === 'expense')
        .reduce((s, e) => s + Number(e.amount), 0);

      const totalIncome = orderRevenue + manualIn;
      const totalExpense = orderPlatformFees + manualOut;
      const profit = totalIncome - totalExpense;
      const margin = totalIncome > 0 ? (profit / totalIncome) * 100 : 0;

      // ====== PDF ======
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const monthLabel = now
        .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
        .replace(/^./, c => c.toUpperCase());

      // Cabeçalho
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Relatório Financeiro Mensal', pageW / 2, 50, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.text(displayName, pageW / 2, 70, { align: 'center' });
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(
        `Competência: ${monthLabel}  •  Emitido em ${fmtDate(now.toISOString())}`,
        pageW / 2,
        86,
        { align: 'center' }
      );
      doc.setTextColor(0);

      // Modelo de cobrança da plataforma (transparência)
      const billingLine = (() => {
        if (tenant?.billing_mode === 'monthly_fixed') {
          return `Cobrança da plataforma: mensalidade fixa de ${fmtBR(
            Number(tenant.monthly_fee || 0)
          )} (sem taxa por pedido).`;
        }
        const pct = Number(tenant?.platform_fee_percent || 0);
        return `Cobrança da plataforma: ${pct.toFixed(2)}% por pedido entregue (sem mensalidade).`;
      })();

      // Resumo
      autoTable(doc, {
        startY: 120,
        head: [['Resumo do mês', 'Valor']],
        body: [
          ['Receita de pedidos entregues', fmtBR(orderRevenue)],
          ['Outras entradas (lançamentos manuais)', fmtBR(manualIn)],
          ['Receita total', fmtBR(totalIncome)],
          ['Taxa da plataforma (paga pela loja)', fmtBR(orderPlatformFees)],
          ['Despesas (lançamentos manuais)', fmtBR(manualOut)],
          ['Despesa total', fmtBR(totalExpense)],
          ['Lucro do mês', fmtBR(profit)],
          ['Margem', `${margin.toFixed(2)}%`],
          ['Pedidos entregues (qtd)', String(realizedOrders.length)],
          ['Taxa de entrega cobrada (repasse ao cliente)', fmtBR(orderDeliveryFees)],
        ],
        styles: { fontSize: 9, cellPadding: 5 },
        headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold' },
        columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
        theme: 'grid',
      });

      // Linha de transparência da cobrança
      let cursorY = (doc as any).lastAutoTable.finalY + 14;
      doc.setFontSize(9);
      doc.setTextColor(80);
      doc.text(billingLine, 40, cursorY);
      doc.setTextColor(0);
      cursorY += 16;

      // Pedidos entregues
      if (realizedOrders.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Pedidos entregues no mês', 40, cursorY);
        autoTable(doc, {
          startY: cursorY + 6,
          head: [['Data', 'Pedido', 'Pagamento', 'Total', 'Taxa plat.']],
          body: realizedOrders.map(o => [
            fmtDate(o.created_at),
            `#${o.id.slice(0, 8).toUpperCase()}`,
            o.payment_method || '—',
            fmtBR(Number(o.total || 0)),
            fmtBR(Number(o.platform_fee || 0)),
          ]),
          styles: { fontSize: 8, cellPadding: 3 },
          headStyles: { fillColor: [30, 64, 175], textColor: 255 },
          columnStyles: {
            3: { halign: 'right' },
            4: { halign: 'right' },
          },
          theme: 'striped',
        });
        cursorY = (doc as any).lastAutoTable.finalY + 14;
      }

      // Entradas manuais
      const incomeManual = manualEntries.filter(e => e.type === 'income');
      if (incomeManual.length > 0) {
        if (cursorY > 720) {
          doc.addPage();
          cursorY = 50;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Entradas manuais', 40, cursorY);
        autoTable(doc, {
          startY: cursorY + 6,
          head: [['Data', 'Categoria', 'Descrição', 'Pagamento', 'Valor']],
          body: incomeManual.map(e => [
            fmtDate(e.date),
            e.subcategory || e.category || '—',
            (e.description || '—').replace(/#ORDER_REVENUE:[a-z0-9-]+/gi, '').trim() ||
              '—',
            e.payment_method || '—',
            fmtBR(Number(e.amount)),
          ]),
          styles: { fontSize: 8, cellPadding: 3 },
          headStyles: { fillColor: [22, 101, 52], textColor: 255 },
          columnStyles: { 4: { halign: 'right' } },
          theme: 'striped',
        });
        cursorY = (doc as any).lastAutoTable.finalY + 14;
      }

      // Saídas manuais
      const expenseManual = manualEntries.filter(e => e.type === 'expense');
      if (expenseManual.length > 0) {
        if (cursorY > 720) {
          doc.addPage();
          cursorY = 50;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Despesas / Saídas', 40, cursorY);
        autoTable(doc, {
          startY: cursorY + 6,
          head: [['Data', 'Categoria', 'Descrição', 'Pagamento', 'Pago?', 'Valor']],
          body: expenseManual.map(e => [
            fmtDate(e.date),
            e.subcategory || e.category || '—',
            e.description || '—',
            e.payment_method || '—',
            e.paid === false ? 'Pendente' : 'Sim',
            fmtBR(Number(e.amount)),
          ]),
          styles: { fontSize: 8, cellPadding: 3 },
          headStyles: { fillColor: [153, 27, 27], textColor: 255 },
          columnStyles: { 5: { halign: 'right' } },
          theme: 'striped',
        });
      }

      // Rodapé em todas as páginas
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(140);
        doc.text(
          `${displayName} — Relatório gerado pela plataforma  •  Página ${i}/${pageCount}`,
          pageW / 2,
          doc.internal.pageSize.getHeight() - 20,
          { align: 'center' }
        );
      }

      const slug = tenant?.slug || 'loja';
      const fname = `relatorio-financeiro-${slug}-${y}-${String(m + 1).padStart(2, '0')}.pdf`;
      doc.save(fname);
      toast.success('Relatório PDF gerado — pronto pra enviar ao contador');
    } catch (e: any) {
      console.error('[FinancialReportPDF]', e);
      toast.error(`Falha ao gerar relatório: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={generate}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-60 transition-colors"
      title="Exporta receitas, despesas e taxas do mês corrente em PDF pronto pra contador"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <FileText className="h-3.5 w-3.5" />
      )}
      Relatório p/ contador (PDF)
    </button>
  );
};

export default FinancialReportPDFButton;
