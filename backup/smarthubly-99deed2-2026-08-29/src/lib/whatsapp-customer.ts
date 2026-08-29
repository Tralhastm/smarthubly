/**
 * Helpers for sending semi-automatic WhatsApp messages to customers
 * about order status changes.
 *
 * Opens wa.me with a pre-filled message — the storekeeper just clicks Send.
 */

export type OrderStatus =
  | 'pending_review'
  | 'received'
  | 'preparing'
  | 'out-for-delivery'
  | 'delivered'
  | 'cancelled'
  | string;

const TEMPLATES: Record<string, (orderId: string, storeName: string) => string> = {
  received: (id, store) =>
    `Olá! Seu pedido #${id.slice(0, 6)} na ${store} foi *confirmado* ✅ Já estamos preparando!`,
  preparing: (id, store) =>
    `Atualização do seu pedido #${id.slice(0, 6)} na ${store}: *em andamento agora* 👨‍🍳`,
  'out-for-delivery': (id, store) =>
    `Boa notícia! Seu pedido #${id.slice(0, 6)} na ${store} *saiu para entrega* 🛵 Em breve aí!`,
  'ready-for-pickup': (id, store) =>
    `Seu pedido #${id.slice(0, 6)} na ${store} está *pronto para retirada* 🎉 Pode vir buscar!`,
  delivered: (id, store) =>
    `Seu pedido #${id.slice(0, 6)} na ${store} foi *finalizado* ✅ Obrigado pela preferência! Volte sempre 💙`,
  cancelled: (id, store) =>
    `Olá! Infelizmente seu pedido #${id.slice(0, 6)} na ${store} foi *cancelado*. Entre em contato pra mais informações.`,
};

export const buildCustomerStatusMessage = (
  status: OrderStatus,
  orderId: string,
  storeName: string,
): string | null => {
  const tpl = TEMPLATES[status];
  if (!tpl) return null;
  return tpl(orderId, storeName);
};

export const openWhatsAppToCustomer = (
  phone: string,
  message: string,
): boolean => {
  if (!phone) return false;
  const cleanPhone = phone.replace(/\D/g, '');
  // Add 55 (Brazil) if missing
  const finalPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
  const url = `https://wa.me/${finalPhone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
  return true;
};

export const notifyCustomerOnStatus = (
  status: OrderStatus,
  orderId: string,
  customerPhone: string,
  storeName: string,
): boolean => {
  const msg = buildCustomerStatusMessage(status, orderId, storeName);
  if (!msg) return false;
  return openWhatsAppToCustomer(customerPhone, msg);
};
