/**
 * Helpers do modo "WhatsApp Consultora" do dropshipping.
 * Formata pedidos como mensagem pra consultora externa, gera PDF/TXT,
 * abre wa.me com mensagem pré-preenchida.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export type OrderForConsultora = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  delivery_address: string | null;
  delivery_cep: string | null;
  total: number;
  payment_method: string | null;
  notes?: string | null;
  status: string;
  created_at: string;
  whatsapp_address_source?: string | null;
  whatsapp_sent_at?: string | null;
  whatsapp_batch_id?: string | null;
  order_items?: {
    product_name: string;
    quantity: number;
    product_price: number;
    /** Preço de custo (o que a consultora cobra). Quando presente, usado em vez de product_price. */
    cost_price?: number | null;
    variant_name?: string | null;
    notes?: string | null;
  }[];
};

export type AddressSource = 'customer' | 'store';

const fmtBRL = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

const itemUnit = (i: { product_price: number; cost_price?: number | null }) =>
  i.cost_price != null && i.cost_price > 0 ? Number(i.cost_price) : Number(i.product_price);

const formatItems = (items: OrderForConsultora['order_items']) => {
  if (!items || items.length === 0) return '— sem itens —';
  return items
    .map(i => {
      const variant = i.variant_name ? ` (${i.variant_name})` : '';
      const obs = i.notes ? `\n     📝 ${i.notes}` : '';
      const unit = itemUnit(i);
      return `  • ${i.quantity}x ${i.product_name}${variant} — ${fmtBRL(unit * i.quantity)}${obs}`;
    })
    .join('\n');
};

/** Total a pagar à consultora (soma dos custos, não dos preços de venda). */
const consultoraTotal = (items: OrderForConsultora['order_items']) =>
  (items || []).reduce((s, i) => s + itemUnit(i) * i.quantity, 0);

const resolveAddress = (
  order: OrderForConsultora,
  source: AddressSource,
  storeAddress: string,
): string => {
  if (source === 'store') return storeAddress || '— endereço da loja não configurado —';
  return order.delivery_address || '— sem endereço —';
};

/**
 * Mensagem formatada de UM pedido pra consultora.
 * NÃO inclui frete (lojista lida com isso separadamente).
 */
export const formatOrderMessage = (
  order: OrderForConsultora,
  source: AddressSource,
  storeAddress: string,
  storeName: string,
): string => {
  const shortId = order.id.slice(0, 8).toUpperCase();
  const lines = [
    `🛒 *Pedido #${shortId}* — ${storeName}`,
    '',
    `👤 Cliente: ${order.customer_name || '—'}`,
    order.customer_phone ? `📞 ${order.customer_phone}` : '',
    '',
    '📦 *Itens:*',
    formatItems(order.order_items),
    '',
    `💰 *Total a pagar à consultora:* ${fmtBRL(consultoraTotal(order.order_items))}`,
    '',
    `📍 *Endereço de entrega* ${source === 'store' ? '(loja)' : '(cliente)'}:`,
    resolveAddress(order, source, storeAddress),
    order.delivery_cep ? `CEP: ${order.delivery_cep}` : '',
  ];
  if (order.notes) {
    lines.push('', `📝 Obs: ${order.notes}`);
  }
  return lines.filter(Boolean).join('\n');
};

/**
 * Mensagem formatada de um LOTE de pedidos.
 */
export const formatBatchMessage = (
  orders: OrderForConsultora[],
  sources: Record<string, AddressSource>,
  storeAddress: string,
  storeName: string,
): string => {
  const header = [
    `📋 *Lote de pedidos* — ${storeName}`,
    `Total: ${orders.length} pedido(s)`,
    `Data: ${new Date().toLocaleString('pt-BR')}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
  ].join('\n');

  const body = orders
    .map((o, idx) =>
      [
        `*Pedido ${idx + 1} de ${orders.length}*`,
        formatOrderMessage(o, sources[o.id] || 'customer', storeAddress, storeName),
      ].join('\n'),
    )
    .join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n');

  const grand = orders.reduce((s, o) => s + consultoraTotal(o.order_items), 0);
  const footer = [
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    `💵 *Total geral a pagar à consultora:* ${fmtBRL(grand)}`,
  ].join('\n');

  return header + body + footer;
};

/**
 * Abre wa.me com mensagem pré-preenchida pra consultora.
 */
export const openWhatsAppToConsultora = (consultoraPhone: string, message: string): boolean => {
  if (!consultoraPhone) return false;
  const clean = consultoraPhone.replace(/\D/g, '');
  const final = clean.startsWith('55') || clean.length > 11 ? clean : `55${clean}`;
  const url = `https://wa.me/${final}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
  return true;
};

/**
 * Download de string como arquivo .txt.
 */
export const downloadTxt = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Gera PDF do lote de pedidos pra consultora.
 */
export const downloadBatchPdf = (
  filename: string,
  orders: OrderForConsultora[],
  sources: Record<string, AddressSource>,
  storeAddress: string,
  storeName: string,
) => {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 40;
  let y = margin;

  doc.setFontSize(16);
  doc.text(`Lote de Pedidos — ${storeName}`, margin, y);
  y += 18;
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')} · ${orders.length} pedido(s)`, margin, y);
  y += 18;
  doc.setTextColor(0);

  orders.forEach((order, idx) => {
    if (y > 720) {
      doc.addPage();
      y = margin;
    }
    const shortId = order.id.slice(0, 8).toUpperCase();
    const source = sources[order.id] || 'customer';

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Pedido ${idx + 1}/${orders.length} — #${shortId}`, margin, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Cliente: ${order.customer_name || '—'}`, margin, y);
    y += 12;
    if (order.customer_phone) {
      doc.text(`Telefone: ${order.customer_phone}`, margin, y);
      y += 12;
    }
    doc.text(`Endereço (${source === 'store' ? 'LOJA' : 'CLIENTE'}):`, margin, y);
    y += 12;
    const addr = resolveAddress(order, source, storeAddress);
    const addrLines = doc.splitTextToSize(addr, 515);
    doc.text(addrLines, margin, y);
    y += addrLines.length * 12;
    if (order.delivery_cep) {
      doc.text(`CEP: ${order.delivery_cep}`, margin, y);
      y += 12;
    }
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [['Qtd', 'Produto', 'Custo unit.', 'Subtotal']],
      body: (order.order_items || []).map(i => {
        const unit = (i as any).cost_price != null && (i as any).cost_price > 0
          ? Number((i as any).cost_price)
          : Number(i.product_price);
        return [
          String(i.quantity),
          `${i.product_name}${i.variant_name ? ` (${i.variant_name})` : ''}${i.notes ? `\nObs: ${i.notes}` : ''}`,
          fmtBRL(unit),
          fmtBRL(unit * i.quantity),
        ];
      }),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [59, 130, 246] },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 10;

    const subTotal = (order.order_items || []).reduce((s, i) => {
      const unit = (i as any).cost_price != null && (i as any).cost_price > 0
        ? Number((i as any).cost_price)
        : Number(i.product_price);
      return s + unit * i.quantity;
    }, 0);
    doc.setFont('helvetica', 'bold');
    doc.text(`A pagar à consultora: ${fmtBRL(subTotal)}`, margin, y);
    y += 18;
    doc.setFont('helvetica', 'normal');
    doc.setDrawColor(220);
    doc.line(margin, y, 555, y);
    y += 14;
  });

  if (y > 720) {
    doc.addPage();
    y = margin;
  }
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  const grand = orders.reduce(
    (s, o) =>
      s +
      (o.order_items || []).reduce((ss, i) => {
        const unit = (i as any).cost_price != null && (i as any).cost_price > 0
          ? Number((i as any).cost_price)
          : Number(i.product_price);
        return ss + unit * i.quantity;
      }, 0),
    0,
  );
  doc.text(`TOTAL GERAL A PAGAR À CONSULTORA: ${fmtBRL(grand)}`, margin, y);
  doc.save(filename);
};
