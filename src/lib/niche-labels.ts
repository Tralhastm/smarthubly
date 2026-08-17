/**
 * Adapta textos do app de acordo com o nicho do tenant.
 * - Comida (lanchonete, pizzaria, açaiteria, hamburgueria, restaurante, marmita,
 *   doceria, padaria, sorveteria, etc) → "Bom apetite"
 * - Serviço (barbearia, manicure, salão, mecânica, estética, oficina, etc) → "Até logo"
 * - Loja (mercado, adega, conveniência, eletrônicos, roupa, etc) → "Aproveite"
 * - Genérico/sem nicho → "Obrigado pela preferência"
 *
 * Item-level: cada produto pode ser `product` (compra normal) ou `service` (agendado),
 * o que muda o CTA do botão pra "Comprar"/"Agendar"/"Solicitar".
 */

export type NicheCategory = 'food' | 'service' | 'retail' | 'auto' | 'generic';

const FOOD_KEYWORDS = [
  'lanchonete', 'lanche', 'pizzaria', 'pizza', 'hamburgueria', 'hamburguer', 'burger',
  'restaurante', 'marmita', 'marmitex', 'comida', 'açai', 'acai', 'sorveteria',
  'doceria', 'padaria', 'confeitaria', 'pastelaria', 'sushi', 'japonesa',
  'cafeteria', 'cafe', 'bar', 'pub', 'churrascaria', 'self service',
];

const SERVICE_KEYWORDS = [
  'barbearia', 'barber', 'cabeleireiro', 'salao', 'salão', 'beleza',
  'manicure', 'pedicure', 'estetica', 'estética', 'spa', 'massagem',
  'tatuagem', 'tatoo', 'design', 'consultor', 'agendamento',
];

const AUTO_KEYWORDS = [
  'mecanica', 'mecânica', 'oficina', 'auto', 'carro', 'moto', 'lavajato',
  'lava-jato', 'borracharia', 'eletrica', 'elétrica', 'funilaria',
];

const RETAIL_KEYWORDS = [
  'adega', 'bebidas', 'mercado', 'mercearia', 'conveniencia', 'conveniência',
  'loja', 'roupa', 'moda', 'eletronico', 'eletrônico', 'celular',
  'cosmetico', 'cosmético', 'farmacia', 'farmácia', 'pet', 'petshop',
  'papelaria', 'livraria', 'floricultura',
];

export const detectNicheCategory = (niche?: string | null): NicheCategory => {
  if (!niche) return 'generic';
  const n = niche.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (FOOD_KEYWORDS.some(k => n.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) return 'food';
  if (AUTO_KEYWORDS.some(k => n.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) return 'auto';
  if (SERVICE_KEYWORDS.some(k => n.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) return 'service';
  if (RETAIL_KEYWORDS.some(k => n.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) return 'retail';
  return 'generic';
};

export interface NicheLabels {
  category: NicheCategory;
  /** Frase final no cupom impresso, na página de status, no WhatsApp pós-entrega. */
  thanks: string;
  /** Frase de descrição quando pedido é entregue/finalizado. */
  delivered: string;
  /** Saudação inicial do chatbot/contato. */
  greeting: string;
  /** Como o cliente chama o "carrinho" — útil pra serviço onde não faz sentido. */
  cartLabel: string;
  /** Ação principal padrão pra item do tipo product. */
  buyAction: string;
  /** Ação principal padrão pra item do tipo service. */
  serviceAction: string;
  /** Ação principal pra orçamento (mecânica/oficina). */
  quoteAction: string;
}

export const getNicheLabels = (niche?: string | null): NicheLabels => {
  const cat = detectNicheCategory(niche);
  switch (cat) {
    case 'food':
      return {
        category: cat,
        thanks: 'Bom apetite! 😋',
        delivered: 'Pedido entregue. Bom apetite!',
        greeting: 'Olá! Bem-vindo. Tá com fome?',
        cartLabel: 'Carrinho',
        buyAction: 'Pedir',
        serviceAction: 'Agendar',
        quoteAction: 'Solicitar',
      };
    case 'service':
      return {
        category: cat,
        thanks: 'Até logo! Volte sempre 💙',
        delivered: 'Atendimento concluído. Até a próxima!',
        greeting: 'Olá! Como posso te ajudar hoje?',
        cartLabel: 'Meus itens',
        buyAction: 'Comprar',
        serviceAction: 'Agendar',
        quoteAction: 'Solicitar',
      };
    case 'auto':
      return {
        category: cat,
        thanks: 'Obrigado pela confiança! 🔧',
        delivered: 'Serviço finalizado. Volte sempre!',
        greeting: 'Olá! Em que posso te ajudar?',
        cartLabel: 'Meus itens',
        buyAction: 'Comprar',
        serviceAction: 'Agendar',
        quoteAction: 'Solicitar orçamento',
      };
    case 'retail':
      return {
        category: cat,
        thanks: 'Aproveite! Volte sempre 💙',
        delivered: 'Pedido entregue. Aproveite!',
        greeting: 'Olá! Procurando algo específico?',
        cartLabel: 'Carrinho',
        buyAction: 'Comprar',
        serviceAction: 'Agendar',
        quoteAction: 'Solicitar',
      };
    default:
      return {
        category: cat,
        thanks: 'Obrigado pela preferência! 💙',
        delivered: 'Pedido finalizado. Obrigado pela preferência!',
        greeting: 'Olá! Como posso te ajudar?',
        cartLabel: 'Meus itens',
        buyAction: 'Adicionar',
        serviceAction: 'Agendar',
        quoteAction: 'Solicitar',
      };
  }
};

/** Decide o CTA correto pra um produto baseado em item_type + nicho. */
export const getItemCTA = (
  item: { item_type?: string | null; affiliate_url?: string | null } | null | undefined,
  niche?: string | null,
): string => {
  const labels = getNicheLabels(niche);
  if (item?.affiliate_url) return 'Ver oferta';
  if (item?.item_type === 'service') {
    // Mecânica/oficina → "Solicitar orçamento" faz mais sentido que "Agendar".
    return labels.category === 'auto' ? labels.quoteAction : labels.serviceAction;
  }
  return labels.buyAction;
};
