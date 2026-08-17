import { supabase } from '@/integrations/supabase/client';

/**
 * Garante UMA E APENAS UMA financial_entry por pedido entregue.
 * Idempotente: usa um marcador estável na descrição (`#ORDER_REVENUE:<id>`)
 * para detectar entradas já criadas e evitar duplicação quando vários
 * fluxos podem disparar (insert direto delivered, update->delivered, webhook).
 */
export const recordOrderRevenue = async (order: {
  id: string;
  tenant_id: string;
  total: number | string;
  payment_method?: string | null;
  status?: string | null;
}): Promise<void> => {
  if (!order?.id || !order?.tenant_id) return;

  const marker = `#ORDER_REVENUE:${order.id}`;
  // Procura entry existente pra esse pedido (idempotência)
  const { data: existing } = await supabase
    .from('financial_entries')
    .select('id')
    .eq('tenant_id', order.tenant_id)
    .ilike('description', `%${marker}%`)
    .limit(1);

  if (existing && existing.length > 0) return;

  const totalNum = Number(order.total) || 0;
  if (totalNum <= 0) return;

  // Fiado não vira receita imediata (vai pra credit_accounts)
  const pm = (order.payment_method || '').toLowerCase();
  if (pm === 'fiado') return;

  const shortId = order.id.slice(0, 8).toUpperCase();
  const label = order.payment_method ? ` (${order.payment_method})` : '';

  await supabase.from('financial_entries').insert({
    tenant_id: order.tenant_id,
    type: 'income',
    category: 'venda',
    description: `Venda #${shortId}${label} ${marker}`,
    amount: totalNum,
    date: new Date().toISOString(),
  });
};
