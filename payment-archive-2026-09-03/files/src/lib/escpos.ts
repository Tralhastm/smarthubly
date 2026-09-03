/**
 * Gerador de comandos ESC/POS para impressoras térmicas 58mm/80mm.
 * Funciona com qualquer impressora compatível ESC/POS (Epson, Bematech, Elgin, Knup, MP, etc).
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type PaperWidth = '58mm' | '80mm';

// Largura em caracteres (fonte normal)
const WIDTH_CHARS: Record<PaperWidth, number> = {
  '58mm': 32,
  '80mm': 48,
};

class EscPosBuilder {
  private bytes: number[] = [];
  private width: number;

  constructor(paper: PaperWidth) {
    this.width = WIDTH_CHARS[paper];
    this.init();
  }

  private push(...b: number[]) { this.bytes.push(...b); return this; }

  private init() { return this.push(ESC, 0x40); }

  // Codepage CP860 (Português) — funciona na maioria. Se não funcionar, tenta 0x03 (CP860) ou 0x08 (CP863).
  setCodepage() { return this.push(ESC, 0x74, 0x03); }

  align(a: 'left' | 'center' | 'right') {
    const v = a === 'center' ? 1 : a === 'right' ? 2 : 0;
    return this.push(ESC, 0x61, v);
  }

  bold(on: boolean) { return this.push(ESC, 0x45, on ? 1 : 0); }

  // tamanho: 0 normal, 1 dobro altura, 16 dobro largura, 17 dobro tudo
  size(mode: 0 | 1 | 16 | 17) { return this.push(GS, 0x21, mode); }

  // Texto — converte UTF-8 para CP860 simples (remove acentos não suportados)
  text(s: string) {
    const cleaned = s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove acentos (mais seguro pra impressoras genéricas)
      .replace(/[^\x20-\x7E\n]/g, '?');
    for (let i = 0; i < cleaned.length; i++) this.bytes.push(cleaned.charCodeAt(i));
    return this;
  }

  line(s = '') { return this.text(s).push(LF); }

  // Linha com texto à esquerda e à direita preenchendo até a largura
  twoCols(left: string, right: string) {
    const cleanedL = left.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const cleanedR = right.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const space = Math.max(1, this.width - cleanedL.length - cleanedR.length);
    return this.line(cleanedL + ' '.repeat(space) + cleanedR);
  }

  divider(char = '-') { return this.line(char.repeat(this.width)); }

  feed(lines = 1) { for (let i = 0; i < lines; i++) this.bytes.push(LF); return this; }

  // Corte parcial do papel
  cut() { return this.push(GS, 0x56, 0x42, 0x00); }

  // Beep (alguns modelos)
  beep() { return this.push(ESC, 0x42, 3, 3); }

  build(): Uint8Array { return new Uint8Array(this.bytes); }
}

export interface ReceiptItem {
  product_name: string;
  product_price: number;
  quantity: number;
  variant_name?: string | null;
  addons?: { name: string; price: number; quantity: number }[] | null;
  notes?: string | null;
}

export interface ReceiptData {
  storeName: string;
  headerText?: string;
  footerText?: string;
  orderShortId: string;
  createdAt: string; // ISO
  customerName: string;
  customerPhone: string;
  deliveryType: 'delivery' | 'pickup';
  customerAddress?: string;
  paymentMethod: string;
  changeFor?: number | null;
  items: ReceiptItem[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  notes?: string;
  paperWidth: PaperWidth;
}

const fmtBRL = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;

/** Cupom completo — caixa/entrega */
export function buildCustomerReceipt(data: ReceiptData): Uint8Array {
  const b = new EscPosBuilder(data.paperWidth);
  b.setCodepage();

  // Cabeçalho
  b.align('center').size(17).bold(true).line(data.storeName).size(0).bold(false);
  if (data.headerText) b.line(data.headerText);
  b.divider('=');

  // ID e data
  b.align('center')
    .bold(true).line(`PEDIDO #${data.orderShortId}`).bold(false)
    .line(new Date(data.createdAt).toLocaleString('pt-BR'))
    .divider();

  // Cliente
  b.align('left').bold(true).line('CLIENTE').bold(false)
    .line(data.customerName)
    .line(data.customerPhone)
    .feed(1);

  if (data.deliveryType === 'delivery') {
    b.bold(true).line('ENDERECO DE ENTREGA').bold(false);
    // Quebra endereço longo manualmente
    const addr = data.customerAddress || '';
    const w = data.paperWidth === '58mm' ? 32 : 48;
    for (let i = 0; i < addr.length; i += w) b.line(addr.substring(i, i + w));
    b.feed(1);
  } else {
    b.bold(true).line('** RETIRADA NA LOJA **').bold(false).feed(1);
  }
  b.divider();

  // Itens
  b.bold(true).line('ITENS').bold(false);
  for (const it of data.items) {
    const total = it.quantity * it.product_price;
    b.line(`${it.quantity}x ${it.product_name}`);
    if (it.variant_name) b.line(`   Opcao: ${it.variant_name}`);
    if (it.addons && it.addons.length > 0) {
      for (const ad of it.addons) {
        b.line(`   + ${ad.quantity}x ${ad.name}${ad.price > 0 ? ` (${fmtBRL(ad.price * ad.quantity)})` : ''}`);
      }
    }
    if (it.notes) b.line(`   OBS: ${it.notes}`);
    b.twoCols(`   ${fmtBRL(it.product_price)} cada`, fmtBRL(total));
  }
  b.divider();

  // Totais
  b.twoCols('Subtotal:', fmtBRL(data.subtotal));
  if (data.deliveryFee > 0) b.twoCols('Taxa entrega:', fmtBRL(data.deliveryFee));
  if (data.discount > 0) b.twoCols('Desconto:', `- ${fmtBRL(data.discount)}`);
  b.size(17).bold(true).twoCols('TOTAL:', fmtBRL(data.total)).size(0).bold(false);
  b.divider();

  // Pagamento
  b.bold(true).line('PAGAMENTO').bold(false).line(data.paymentMethod);
  if (data.changeFor && data.changeFor > 0) {
    b.line(`Troco para: ${fmtBRL(data.changeFor)}`);
    b.line(`Levar troco: ${fmtBRL(data.changeFor - data.total)}`);
  }
  if (data.notes) {
    b.feed(1).divider().bold(true).line('OBSERVACOES').bold(false).line(data.notes);
  }

  // Rodapé
  b.divider('=').align('center').line(data.footerText || 'Obrigado pela preferencia!').feed(3).cut();

  return b.build();
}

/** Via da cozinha — só itens, fonte grande */
export function buildKitchenReceipt(data: ReceiptData): Uint8Array {
  const b = new EscPosBuilder(data.paperWidth);
  b.setCodepage();

  b.align('center').size(17).bold(true).line('** COZINHA **').size(0).bold(false);
  b.line(`Pedido #${data.orderShortId}`).line(new Date(data.createdAt).toLocaleTimeString('pt-BR'));
  b.divider('=');

  b.align('left');
  for (const it of data.items) {
    b.size(17).bold(true).line(`${it.quantity}x ${it.product_name}`).size(0).bold(false);
    if (it.variant_name) b.line(`  >> ${it.variant_name}`);
    if (it.addons && it.addons.length > 0) {
      for (const ad of it.addons) {
        b.line(`  + ${ad.quantity}x ${ad.name}`);
      }
    }
    if (it.notes) b.bold(true).line(`  OBS: ${it.notes}`).bold(false);
    b.feed(1);
  }

  if (data.notes) {
    b.divider().bold(true).line('OBS:').bold(false).line(data.notes);
  }

  b.divider('=').align('center').line(`${data.customerName}`).feed(3).cut();
  return b.build();
}
