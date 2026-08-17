import type { CartItem } from '@/contexts/CartContext';
import { getCartLineUnitPrice } from '@/contexts/CartContext';

export const calculateFreight = (distanceKm: number): number => {
  if (distanceKm <= 0) return 0;
  if (distanceKm <= 5) return 5;
  return 5 + (distanceKm - 5) * 1.5;
};

/**
 * Normaliza um número de WhatsApp para o formato aceito pelo wa.me
 * ("+55 31 8267-5538" -> "553182675538"). Retorna '' se inválido.
 */
export const sanitizeWhatsAppNumber = (raw?: string | null): string => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  // Adiciona DDI 55 quando o lojista salvou só DDD + número (10 ou 11 dígitos)
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
};

const brl = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;

export const buildWhatsAppMessage = (
  items: CartItem[],
  total: number,
  deliveryFee: number,
  address: string,
  deliveryType: string,
  paymentMethod: string,
  storeName: string,
  customerName?: string,
): string => {
  const L: string[] = [];
  L.push(`*NOVO PEDIDO — ${storeName.toUpperCase()}*`);
  L.push('');
  if (customerName) L.push(`👤 Cliente: ${customerName}`);
  L.push('🧾 *Itens do pedido*');
  L.push('────────────────');
  items.forEach(i => {
    const unit = getCartLineUnitPrice(i);
    L.push(`*${i.quantity}x* ${i.product.name}${i.variantName ? ` (${i.variantName})` : ''} — ${brl(unit * i.quantity)}`);
    (i.addons || []).forEach(a => {
      L.push(`   ➕ ${a.quantity}x ${a.name}${a.price > 0 ? ` (+${brl(a.price * a.quantity)})` : ''}`);
    });
    if (i.notes) L.push(`   📝 ${i.notes}`);
  });
  L.push('────────────────');
  L.push(`Subtotal: ${brl(total - deliveryFee)}`);
  if (deliveryType === 'delivery' && deliveryFee > 0) L.push(`Entrega: ${brl(deliveryFee)}`);
  L.push(`*TOTAL: ${brl(total)}*`);
  L.push('');
  L.push(deliveryType === 'delivery' ? `📍 *Entrega em:* ${address}` : '🏪 *Retirada na loja*');
  L.push(`💳 *Pagamento:* ${paymentMethod}`);
  L.push('');
  L.push('_Pedido gerado pelo site. Aguardo a confirmação, por favor 🙂_');
  return encodeURIComponent(L.join('\n'));
};


export const generateSlug = (name: string): string => {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
};
