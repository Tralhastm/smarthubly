export type OrderWithCourierCode = {
  id: string;
  metadata?: unknown;
};

/**
 * Código de conferência do motoboy.
 * Pedidos novos usam o valor salvo na criação; pedidos antigos têm fallback
 * determinístico para que o fornecedor e o painel continuem usando o mesmo código.
 */
export const getCourierCode = (order: OrderWithCourierCode): string => {
  const metadata = order.metadata && typeof order.metadata === 'object'
    ? order.metadata as Record<string, unknown>
    : {};
  const savedCode = typeof metadata.courier_code === 'string'
    ? metadata.courier_code.trim().toUpperCase()
    : '';

  return savedCode || `MT-${String(order.id).slice(0, 8).toUpperCase()}`;
};
