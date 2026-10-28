import { describe, expect, it } from 'vitest';
import {
  calculateSofiaVariantSalePrice,
  extractSofiaOrderReference,
  getSofiaOrderPrefixBounds,
  getSofiaLowestInStockVariantPrice,
  getSofiaProductSearchTerms,
  isSofiaFeedbackCategory,
  isSofiaInStock,
  planSofiaOrderLookup,
  redactSofiaText,
  scoreSofiaProductMatch,
  selectRelevantSofiaCases,
  selectRelevantSofiaKnowledge,
  shouldLookupSofiaCases,
  shouldListRecentSofiaOrders,
  shouldLookupSofiaOrders,
  shouldLookupSofiaProducts,
} from '../../supabase/functions/_shared/sofia_runtime_knowledge';

describe('recuperação de dados e conhecimento da Sofia', () => {
  it('aceita somente categorias fixas para feedback negativo', () => {
    expect(isSofiaFeedbackCategory('current_data')).toBe(true);
    expect(isSofiaFeedbackCategory('Não informa CPF da cliente')).toBe(false);
    expect(isSofiaFeedbackCategory(null)).toBe(false);
  });

  it('detecta perguntas de preço e extrai os termos do produto sem as palavras da pergunta', () => {
    const question = 'Qual o preço atual do Pão francês?';

    expect(shouldLookupSofiaProducts(question)).toBe(true);
    expect(getSofiaProductSearchTerms(question)).toEqual(['pão', 'francês']);
    expect(scoreSofiaProductMatch({ name: 'Pao frances' }, getSofiaProductSearchTerms(question))).toBe(2);
  });

  it('trata false booleano e textual como esgotado, como a vitrine faz', () => {
    expect(isSofiaInStock(false)).toBe(false);
    expect(isSofiaInStock('false')).toBe(false);
    expect(isSofiaInStock(true)).toBe(true);
    expect(isSofiaInStock('true')).toBe(true);
    expect(getSofiaLowestInStockVariantPrice(100, [
      { in_stock: 'false', price_delta: -80 },
      { in_stock: true, price_delta: 10 },
    ])).toBe(110);
  });

  it('reconhece consulta ampla de catálogo e pedidos sem transformar a frase em busca de produto', () => {
    const broadCatalogRequest = 'Mostre todo o catálogo de produtos.';
    expect(shouldLookupSofiaProducts('Liste o catálogo e todos os preços')).toBe(true);
    expect(shouldLookupSofiaProducts(broadCatalogRequest)).toBe(true);
    expect(getSofiaProductSearchTerms(broadCatalogRequest)).toEqual([]);
    expect(shouldLookupSofiaProducts('Como funciona a entrega?')).toBe(false);
    expect(shouldLookupSofiaOrders('oi')).toBe(false);
    expect(shouldLookupSofiaOrders('Bom dia, tudo bem?')).toBe(false);
    expect(shouldLookupSofiaOrders('Qual o status do pedido #a1b2c3?')).toBe(true);
    expect(shouldLookupSofiaOrders('Como funciona pagamento por Pix?')).toBe(false);
    expect(shouldListRecentSofiaOrders('Mostre os pedidos recentes')).toBe(true);
  });

  it('só recupera conhecimento global ativo, aprovado e explicitamente validado', () => {
    const entries = [
      { title: 'Pedidos', domain: 'pedidos', content: 'Como consultar pedidos', active: true, status: 'approved', validation_status: 'validated', sharing_scope: 'platform' },
      { title: 'Rascunho', domain: 'pedidos', content: 'Como consultar pedidos', active: true, status: 'pending', validation_status: 'validated', sharing_scope: 'platform' },
      { title: 'Documentado antigo', domain: 'pedidos', content: 'Como consultar pedidos', active: true, status: 'approved', validation_status: 'documented', sharing_scope: 'platform' },
      { title: 'Privado', domain: 'pedidos', content: 'Como consultar pedidos', active: true, status: 'approved', validation_status: 'validated', sharing_scope: 'private_tenant' },
      { title: 'Inativo', domain: 'pedidos', content: 'Como consultar pedidos', active: false, status: 'approved', validation_status: 'validated', sharing_scope: 'platform' },
    ];

    expect(selectRelevantSofiaKnowledge(entries, 'Como consultar pedidos')).toEqual([entries[0]]);
    expect(selectRelevantSofiaKnowledge(entries, 'olá')).toEqual([]);
  });

  it('seleciona apenas casos resolvidos ou validados relevantes à pergunta', () => {
    const cases = [
      { problem: 'Falha ao emitir nota fiscal', diagnosis: 'Integração sem configuração', status: 'resolved' },
      { problem: 'Falha ao emitir nota fiscal', diagnosis: 'Ainda em análise', status: 'needs_review' },
      { problem: 'Impressora desconectada', diagnosis: 'Cabo solto', status: 'validated' },
    ];

    expect(selectRelevantSofiaCases(cases, 'A nota fiscal falhou')).toEqual([cases[0]]);
    expect(shouldLookupSofiaCases('A emissão da nota fiscal deu erro')).toBe(true);
  });

  it('reconhece o código abreviado mostrado na tela e calcula os limites no tenant', () => {
    expect(extractSofiaOrderReference('Qual status do pedido #a1b2c3?')).toEqual({ value: 'a1b2c3', isFullUuid: false });
    expect(extractSofiaOrderReference('Pedido 550e8400-e29b-41d4-a716-446655440000')).toEqual({ value: '550e8400e29b41d4a716446655440000', isFullUuid: true });
    expect(getSofiaOrderPrefixBounds('a1b2c3')).toEqual({
      low: 'a1b2c300-0000-0000-0000-000000000000',
      high: 'a1b2c3ff-ffff-ffff-ffff-ffffffffffff',
    });
    expect(getSofiaOrderPrefixBounds('xyz')).toBeNull();
  });

  it('não permite que chat público escolha nem use pedido vinculado, e mantém tenant no plano autenticado', () => {
    const otherOrder = '550e8400-e29b-41d4-a716-446655440000';
    expect(planSofiaOrderLookup({ scopeSource: 'chat', tenantId: 'tenant-a', requestedOrderId: otherOrder, question: 'meu pedido' })).toBeNull();
    expect(planSofiaOrderLookup({ scopeSource: 'chat', tenantId: 'tenant-a', linkedOrderId: otherOrder, requestedOrderId: '11111111-1111-4111-8111-111111111111', question: 'meu pedido' })).toBeNull();
    expect(planSofiaOrderLookup({ scopeSource: 'authenticated', tenantId: 'tenant-a', linkedOrderId: otherOrder, question: 'meu pedido' })).toMatchObject({ kind: 'exact', tenantId: 'tenant-a', orderId: otherOrder });
    expect(planSofiaOrderLookup({ scopeSource: 'authenticated', tenantId: 'tenant-a', question: 'status do pedido #a1b2c3' })).toMatchObject({
      kind: 'prefix', tenantId: 'tenant-a', reference: 'a1b2c3',
    });
    expect(planSofiaOrderLookup({ scopeSource: 'authenticated', tenantId: 'tenant-a', question: 'Qual o status do pedido?' })).toBeNull();
    expect(planSofiaOrderLookup({ scopeSource: 'authenticated', tenantId: 'tenant-a', question: 'Mostre os pedidos recentes' })).toMatchObject({ kind: 'recent', tenantId: 'tenant-a' });
    expect(planSofiaOrderLookup({ scopeSource: 'authenticated', tenantId: null, question: 'últimos pedidos' })).toBeNull();
  });

  it('calcula o preço de variante como preço-base mais ajuste, sem usar custo ou sugestão antiga', () => {
    expect(calculateSofiaVariantSalePrice(29.9, 5)).toBeCloseTo(34.9);
    expect(calculateSofiaVariantSalePrice(29.9, -40)).toBe(0);
  });

  it('redige telefone, e-mail, documento e UUID em textos usados no contexto', () => {
    const redacted = redactSofiaText('Pedido 550e8400-e29b-41d4-a716-446655440000: Maria maria@example.com, CPF 123.456.789-09, telefone (11) 99999-1234');

    expect(redacted).toContain('[id removido]');
    expect(redacted).toContain('[email removido]');
    expect(redacted).toContain('[documento removido]');
    expect(redacted).toContain('[telefone removido]');
    expect(redacted).not.toContain('maria@example.com');
    expect(redacted).not.toContain('99999-1234');
  });
});
