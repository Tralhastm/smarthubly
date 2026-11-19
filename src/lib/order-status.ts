export const PENDING_PAYMENT_STATUS = 'pending_payment';
export const CANCELLED_ORDER_STATUS = 'cancelled';

type OrderStatusLike = {
  status: string;
  metadata?: unknown;
};

export const isTestOrder = (order: { metadata?: unknown }) => {
  const metadata = order.metadata && typeof order.metadata === 'object'
    ? order.metadata as Record<string, unknown>
    : {};
  const isTrue = (value: unknown) => value === true || value === 'true';
  // Só o marcador administrativo explícito classifica um pedido como teste.
  // Flags de checkout/estoque não anulam uma cobrança real do Mercado Pago.
  return isTrue(metadata.is_test_order);
};

export const isVisibleOrder = (order: OrderStatusLike, includeTestOrders = false) => {
  if (isTestOrder(order)) return includeTestOrders;
  return order.status !== PENDING_PAYMENT_STATUS && order.status !== CANCELLED_ORDER_STATUS;
};

// ============================================================
// Status flow per delivery TYPE (per-order, not per-store)
// ============================================================
//
// A loja pode ser híbrida (Local + Delivery), então o fluxo de status
// depende do TIPO do pedido (delivery_type) e não só do modo da loja.
//
// - delivery: received → preparing → out-for-delivery → delivered
// - pickup:   received → preparing → ready-for-pickup → delivered
// ============================================================

export type OrderFlowType = 'delivery' | 'pickup';

export const READY_FOR_PICKUP = 'ready-for-pickup';
export const OUT_FOR_DELIVERY = 'out-for-delivery';

export const getNextStatus = (current: string, flow: OrderFlowType): string | null => {
  if (flow === 'pickup') {
    const map: Record<string, string | null> = {
      pending_review: 'received',
      received: 'preparing',
      preparing: READY_FOR_PICKUP,
      [READY_FOR_PICKUP]: 'delivered',
      delivered: null,
    };
    return map[current] ?? null;
  }
  // delivery
  const map: Record<string, string | null> = {
    pending_review: 'received',
    received: 'preparing',
    preparing: OUT_FOR_DELIVERY,
    [OUT_FOR_DELIVERY]: 'delivered',
    delivered: null,
  };
  return map[current] ?? null;
};

export const getFlowFromOrder = (order: { delivery_type: string }): OrderFlowType => {
  return order.delivery_type === 'pickup' ? 'pickup' : 'delivery';
};
