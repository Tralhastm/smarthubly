import { supabase } from '@/integrations/supabase/client';
import { buildCustomerReceipt, buildKitchenReceipt, type ReceiptData, type PaperWidth } from './escpos';
import { printBytes } from './printer-bluetooth';
import { isSimulationMode, simulatePrint } from './printer-simulator';
import { getNicheLabels } from './niche-labels';
import type { Tables } from '@/integrations/supabase/types';

async function sendToPrinter(data: Uint8Array, paper: PaperWidth) {
  if (isSimulationMode()) {
    simulatePrint(data, paper);
    return;
  }
  await printBytes(data);
}

type Order = Tables<'orders'> & { order_items: Tables<'order_items'>[] };
type Tenant = Tables<'tenants'>;

interface PrintOptions {
  printKitchen?: boolean;
  paperWidth?: PaperWidth;
}

function buildReceiptData(order: Order, tenant: Tenant, paperWidth: PaperWidth): ReceiptData {
  const subtotal = order.order_items.reduce((sum, i) => sum + i.product_price * i.quantity, 0);
  // Lojista define um rodapé custom? Usa. Caso contrário adapta ao nicho.
  const fallbackThanks = getNicheLabels(tenant.niche).thanks;
  return {
    storeName: tenant.name,
    headerText: tenant.printer_header_text || '',
    footerText: tenant.printer_footer_text || fallbackThanks,
    orderShortId: order.id.slice(0, 8).toUpperCase(),
    createdAt: order.created_at,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    deliveryType: (order.delivery_type === 'pickup' ? 'pickup' : 'delivery'),
    customerAddress: order.customer_address,
    paymentMethod: order.payment_method,
    changeFor: order.change_for,
    items: order.order_items.map(i => ({
      product_name: i.product_name,
      product_price: i.product_price,
      quantity: i.quantity,
      variant_name: (i as any).variant_name || null,
      addons: (i as any).addons || null,
      notes: (i as any).notes || null,
    })),
    subtotal,
    deliveryFee: order.delivery_fee || 0,
    discount: order.discount_amount || 0,
    total: order.total,
    notes: order.delivery_status_note || '',
    paperWidth,
  };
}

/**
 * Imprime via Bluetooth — cupom completo + opcional via cozinha.
 * Marca o pedido como impresso no banco.
 */
export async function printOrder(order: Order, tenant: Tenant, opts: PrintOptions = {}) {
  const paperWidth = opts.paperWidth ?? (tenant.printer_paper_width as PaperWidth) ?? '80mm';
  const printKitchen = opts.printKitchen ?? tenant.printer_kitchen_copy;

  const data = buildReceiptData(order, tenant, paperWidth);

  // Cupom do cliente
  await sendToPrinter(buildCustomerReceipt(data), paperWidth);
  await new Promise(r => setTimeout(r, 600));

  // Via da cozinha (opcional) — agora dividida por setor se houver mais de 1
  if (printKitchen) {
    const names = Array.from(new Set(order.order_items.map(i => i.product_name).filter(Boolean)));
    let sectorByName: Record<string, string> = {};
    if (names.length) {
      const { data: prods } = await supabase
        .from('products')
        .select('name, kitchen_sector')
        .eq('tenant_id', tenant.id)
        .in('name', names);
      (prods || []).forEach((p: any) => { if (p.kitchen_sector) sectorByName[p.name] = p.kitchen_sector; });
    }
    const itemsBySector: Record<string, typeof data.items> = {};
    data.items.forEach((it) => {
      const sec = sectorByName[it.product_name] || 'cozinha';
      (itemsBySector[sec] ||= []).push(it);
    });
    const sectors = Object.keys(itemsBySector);
    if (sectors.length <= 1) {
      await sendToPrinter(buildKitchenReceipt(data), paperWidth);
    } else {
      for (const sec of sectors) {
        const sectorData = { ...data, headerText: `=== ${sec.toUpperCase()} ===\n${data.headerText || ''}`, items: itemsBySector[sec] };
        await sendToPrinter(buildKitchenReceipt(sectorData), paperWidth);
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  // Marca como impresso
  await supabase
    .from('orders')
    .update({
      printed_at: new Date().toISOString(),
      print_count: (order.print_count || 0) + 1,
    })
    .eq('id', order.id);
}

/** Cupom de teste — pra validar pareamento */
export async function printTestReceipt(tenant: Tenant) {
  const paperWidth = (tenant.printer_paper_width as PaperWidth) ?? '80mm';
  const data: ReceiptData = {
    storeName: tenant.name,
    headerText: tenant.printer_header_text || '',
    footerText: 'TESTE DE IMPRESSAO',
    orderShortId: 'TESTE',
    createdAt: new Date().toISOString(),
    customerName: 'Cliente Teste',
    customerPhone: '(11) 99999-9999',
    deliveryType: 'delivery',
    customerAddress: 'Rua Exemplo, 123 - Bairro Centro - Cidade/UF',
    paymentMethod: 'Pix',
    items: [
      { product_name: 'Produto de Teste', product_price: 25.5, quantity: 2 },
      { product_name: 'Outro Produto', product_price: 12.0, quantity: 1 },
    ],
    subtotal: 63.0,
    deliveryFee: 5.0,
    discount: 0,
    total: 68.0,
    paperWidth,
  };
  await sendToPrinter(buildCustomerReceipt(data), paperWidth);
}
