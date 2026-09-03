import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getAuthUser, isTenantAdmin } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEMO_TAG = '[DEMO]';

const PRODUCTS = [
  { name: 'Combo Burguer Duplo', price: 38.9, category: 'Hambúrgueres', desc: 'Pão brioche, 2 carnes 120g, queijo cheddar e molho da casa' },
  { name: 'Pizza Calabresa Grande', price: 49.9, category: 'Pizzas', desc: 'Massa artesanal, calabresa fatiada, cebola e azeitona' },
  { name: 'Açaí 500ml', price: 22.0, category: 'Açaí', desc: 'Açaí cremoso com granola, banana e leite condensado' },
  { name: 'Coca-Cola 2L', price: 12.5, category: 'Bebidas', desc: 'Refrigerante 2 litros gelado' },
  { name: 'Cerveja Heineken Long Neck', price: 9.9, category: 'Bebidas', desc: 'Long neck 330ml gelada' },
  { name: 'Batata Frita Grande', price: 18.0, category: 'Acompanhamentos', desc: 'Porção 400g com cheddar e bacon' },
  { name: 'X-Salada', price: 24.9, category: 'Hambúrgueres', desc: 'Pão, hamburguer 150g, alface, tomate e queijo' },
  { name: 'Refrigerante Lata', price: 6.0, category: 'Bebidas', desc: 'Coca, Guaraná ou Sprite 350ml' },
  { name: 'Pizza Mussarela Grande', price: 44.9, category: 'Pizzas', desc: 'Mussarela com molho de tomate caseiro' },
  { name: 'Combo Família', price: 89.9, category: 'Combos', desc: '2 pizzas grandes + refrigerante 2L' },
  { name: 'Suco Natural Laranja', price: 8.5, category: 'Bebidas', desc: 'Copo 400ml feito na hora' },
  { name: 'Sobremesa Pudim', price: 12.0, category: 'Sobremesas', desc: 'Pudim de leite condensado fatia generosa' },
];

const CUSTOMERS = [
  { name: 'João Silva', phone: '(11) 98765-4321' },
  { name: 'Maria Souza', phone: '(11) 91234-5678' },
  { name: 'Pedro Oliveira', phone: '(11) 99876-1234' },
  { name: 'Ana Paula', phone: '(11) 97654-3210' },
  { name: 'Carlos Mendes', phone: '(11) 96543-2109' },
  { name: 'Juliana Costa', phone: '(11) 95432-1098' },
  { name: 'Rafael Lima', phone: '(11) 94321-0987' },
  { name: 'Beatriz Almeida', phone: '(11) 93210-9876' },
];

const ADDRESSES = [
  'Rua das Flores, 123 - Centro',
  'Av. Paulista, 1500 - Bela Vista',
  'Rua Augusta, 890 - Consolação',
  'Av. Brigadeiro, 2200 - Jardins',
  'Rua Oscar Freire, 456 - Cerqueira César',
];

const STATUSES = ['received', 'preparing', 'ready-for-pickup', 'out-for-delivery', 'delivered', 'delivered', 'delivered', 'cancelled'];

const REVIEW_COMMENTS = [
  'Atendimento impecável, entrega rápida!',
  'Comida fresca e saborosa, recomendo.',
  'Chegou bem embalado e quentinho.',
  'Melhor da região, sempre peço aqui.',
  'Qualidade excelente, vale cada centavo.',
];

// Categorias permitidas pelo CHECK constraint:
// fixed | variable | investment | unexpected | taxa_plataforma | venda | dropshipping | taxa_entrega
const PERSONAL_EXPENSES = [
  { cat: 'fixed',    desc: 'Aluguel mensal',          amount: 1800, pm: 'pix' },
  { cat: 'variable', desc: 'Supermercado mensal',     amount: 850,  pm: 'cartao_debito' },
  { cat: 'variable', desc: 'Combustível',             amount: 420,  pm: 'cartao_credito' },
  { cat: 'fixed',    desc: 'Plano de saúde',          amount: 380,  pm: 'pix' },
  { cat: 'fixed',    desc: 'Streaming e assinaturas', amount: 95,   pm: 'cartao_credito' },
  { cat: 'variable', desc: 'Curso online',            amount: 150,  pm: 'pix' },
];

const PERSONAL_INCOME = [
  { cat: 'venda', desc: 'Salário mensal', amount: 4500, pm: 'pix' },
  { cat: 'venda', desc: 'Projeto extra',  amount: 1200, pm: 'pix' },
];

const BUSINESS_EXPENSES = [
  { cat: 'variable', desc: 'Compra de matéria-prima', amount: 2400, pm: 'pix' },
  { cat: 'fixed',    desc: 'Conta de luz',            amount: 580,  pm: 'dinheiro' },
  { cat: 'fixed',    desc: 'Internet comercial',      amount: 180,  pm: 'cartao_credito' },
  { cat: 'fixed',    desc: 'Aluguel do ponto',        amount: 2200, pm: 'pix' },
  { cat: 'fixed',    desc: 'Salário entregador',      amount: 1500, pm: 'pix' },
];

const DEBTS = [
  { name: 'Fornecedor Bebidas - Distribuidora Cia', amount: 1850, type: 'owe', days: 5 },
  { name: 'Empréstimo Banco', amount: 3200, type: 'owe', days: 12 },
  { name: 'Cliente Restaurante Sabor - pendente', amount: 980, type: 'owed', days: 3 },
];

const FIADO_CUSTOMERS = [
  { name: 'Sr. Antônio (vizinho)', phone: '(11) 99111-2233', amount: 145.50, days: 7 },
  { name: 'Dona Cleide', phone: '(11) 98222-3344', amount: 89.90, days: 15 },
  { name: 'Marcos da padaria', phone: '(11) 97333-4455', amount: 230.00, days: 2 },
];

const rand = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { action, tenantId } = await req.json();
    if (!tenantId) throw new Error('tenantId obrigatório');

    // 🔐 Auth: must be authenticated admin of this tenant (or super_admin)
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!(await isTenantAdmin(supabase, user.id, tenantId))) {
      return new Response(JSON.stringify({ error: 'Sem permissão' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    if (action === 'clear') {
      // Deletar tudo marcado como demo
      const { data: demoProds } = await supabase.from('products').select('id').eq('tenant_id', tenantId).like('description', `${DEMO_TAG}%`);
      const prodIds = (demoProds ?? []).map((p) => p.id);

      const { data: demoOrders } = await supabase.from('orders').select('id').eq('tenant_id', tenantId).like('customer_address', `${DEMO_TAG}%`);
      const orderIds = (demoOrders ?? []).map((o) => o.id);

      if (orderIds.length) {
        await supabase.from('order_items').delete().in('order_id', orderIds);
        await supabase.from('order_reviews').delete().in('order_id', orderIds);
        await supabase.from('orders').delete().in('id', orderIds);
      }
      if (prodIds.length) {
        await supabase.from('products').delete().in('id', prodIds);
      }
      await supabase.from('financial_entries').delete().eq('tenant_id', tenantId).like('description', `${DEMO_TAG}%`);
      await supabase.from('debts').delete().eq('tenant_id', tenantId).like('name', `${DEMO_TAG}%`);
      await supabase.from('credit_accounts').delete().eq('tenant_id', tenantId).like('description', `${DEMO_TAG}%`);
      await supabase.from('investments').delete().eq('tenant_id', tenantId).like('name', `${DEMO_TAG}%`);

      return new Response(JSON.stringify({
        ok: true,
        cleared: { products: prodIds.length, orders: orderIds.length },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // SEED
    const created = { products: 0, orders: 0, items: 0, reviews: 0, financial: 0, debts: 0, credits: 0, investments: 0 };

    // 1) Produtos
    const productsToInsert = PRODUCTS.map((p) => ({
      tenant_id: tenantId,
      name: p.name,
      price: p.price,
      original_price: p.price * 1.15,
      category: p.category,
      description: `${DEMO_TAG} ${p.desc}`,
      image: '',
      in_stock: true,
    }));
    const { data: insertedProducts } = await supabase.from('products').insert(productsToInsert).select('id, name, price');
    created.products = insertedProducts?.length ?? 0;

    // 2) Pedidos (espalhados nos últimos 30 dias)
    const orderRows: any[] = [];
    for (let i = 0; i < 25; i++) {
      const customer = rand(CUSTOMERS);
      const status = rand(STATUSES);
      const itemCount = randInt(1, 3);
      const products = Array.from({ length: itemCount }, () => rand(insertedProducts ?? []));
      const subtotal = products.reduce((s, p) => s + Number(p.price) * randInt(1, 2), 0);
      const deliveryFee = randInt(0, 1) ? randInt(5, 15) : 0;
      orderRows.push({
        tenant_id: tenantId,
        customer_name: customer.name,
        customer_phone: customer.phone,
        customer_address: `${DEMO_TAG} ${rand(ADDRESSES)}`,
        delivery_type: deliveryFee ? 'delivery' : 'pickup',
        delivery_fee: deliveryFee,
        platform_fee: subtotal * 0.05,
        payment_method: rand(['pix', 'cash', 'card']),
        status,
        total: subtotal + deliveryFee,
        created_at: daysAgo(randInt(0, 29)),
        _items: products,
      });
    }
    const { data: insertedOrders, error: ordersError } = await supabase.from('orders').insert(orderRows.map(({ _items, ...o }) => o)).select('id, status');
    if (ordersError) {
      console.error('orders insert error', ordersError);
      throw new Error(`orders insert: ${ordersError.message}`);
    }
    created.orders = insertedOrders?.length ?? 0;

    // 3) Order items
    const itemsToInsert: any[] = [];
    insertedOrders?.forEach((o, idx) => {
      orderRows[idx]._items.forEach((p: any) => {
        itemsToInsert.push({
          order_id: o.id,
          product_name: p.name,
          product_price: p.price,
          quantity: randInt(1, 2),
        });
      });
    });
    if (itemsToInsert.length) {
      const { data } = await supabase.from('order_items').insert(itemsToInsert).select('id');
      created.items = data?.length ?? 0;
    }

    // 4) Reviews para pedidos entregues
    const deliveredOrders = (insertedOrders ?? []).filter((o) => o.status === 'delivered').slice(0, 8);
    if (deliveredOrders.length) {
      const reviews = deliveredOrders.map((o) => ({
        tenant_id: tenantId,
        order_id: o.id,
        rating: randInt(4, 5),
        comment: rand(REVIEW_COMMENTS),
      }));
      const { data } = await supabase.from('order_reviews').insert(reviews).select('id');
      created.reviews = data?.length ?? 0;
    }

    // 5) Financeiro pessoal + empresarial (categorias válidas + payment_method + alguns forecasts)
    const finEntries: any[] = [];
    PERSONAL_EXPENSES.forEach((e) => finEntries.push({
      tenant_id: tenantId, type: 'expense', category: e.cat, payment_method: e.pm,
      description: `${DEMO_TAG} Pessoal - ${e.desc}`, amount: e.amount,
      date: daysAgo(randInt(1, 28)), is_forecast: false,
    }));
    PERSONAL_INCOME.forEach((e) => finEntries.push({
      tenant_id: tenantId, type: 'income', category: e.cat, payment_method: e.pm,
      description: `${DEMO_TAG} Pessoal - ${e.desc}`, amount: e.amount,
      date: daysAgo(randInt(1, 28)), is_forecast: false,
      received_at: daysAgo(randInt(1, 28)),
    }));
    BUSINESS_EXPENSES.forEach((e) => finEntries.push({
      tenant_id: tenantId, type: 'expense', category: e.cat, payment_method: e.pm,
      description: `${DEMO_TAG} Empresa - ${e.desc}`, amount: e.amount,
      date: daysAgo(randInt(1, 28)), is_forecast: false,
    }));
    // Algumas previsões (forecasts) — entradas/saídas futuras
    finEntries.push({
      tenant_id: tenantId, type: 'income', category: 'venda', payment_method: 'pix',
      description: `${DEMO_TAG} Pix programado a receber`, amount: 850,
      date: daysAgo(-3), is_forecast: true, forecast_date: daysAgo(-3),
    });
    finEntries.push({
      tenant_id: tenantId, type: 'expense', category: 'variable', payment_method: 'pix',
      description: `${DEMO_TAG} Pedido fornecedor previsto`, amount: 1200,
      date: daysAgo(-7), is_forecast: true, forecast_date: daysAgo(-7),
    });
    const { data: insertedFin, error: finErr } = await supabase.from('financial_entries').insert(finEntries).select('id');
    if (finErr) console.error('financial_entries insert error', finErr);
    created.financial = insertedFin?.length ?? 0;

    // 6) Dívidas
    const debtsToInsert = DEBTS.map((d) => ({
      tenant_id: tenantId,
      name: `${DEMO_TAG} ${d.name}`,
      amount: d.amount,
      type: d.type,
      paid: false,
      due_date: daysAgo(-d.days).slice(0, 10),
    }));
    const { data: insertedDebts } = await supabase.from('debts').insert(debtsToInsert).select('id');
    created.debts = insertedDebts?.length ?? 0;

    // 7) Fiados
    const creditsToInsert = FIADO_CUSTOMERS.map((c) => ({
      tenant_id: tenantId,
      customer_name: c.name,
      customer_phone: c.phone,
      amount: c.amount,
      amount_paid: 0,
      description: `${DEMO_TAG} Compra fiado`,
      due_date: daysAgo(-c.days),
      status: 'open',
    }));
    const { data: insertedCredits } = await supabase.from('credit_accounts').insert(creditsToInsert).select('id');
    created.credits = insertedCredits?.length ?? 0;

    // 8) Investimentos
    const investmentsToInsert = [
      {
        tenant_id: tenantId, name: `${DEMO_TAG} CDB Banco Inter 110% CDI`,
        kind: 'fixed', amount: 8000, yield_rate: 0.110,
        started_at: daysAgo(60), matures_at: daysAgo(-305),
        notes: 'Resgate só no vencimento',
      },
      {
        tenant_id: tenantId, name: `${DEMO_TAG} Tesouro Selic - reserva diária`,
        kind: 'liquid', amount: 3500, yield_rate: 0.105,
        started_at: daysAgo(30), matures_at: null,
        notes: 'Liquidez diária para emergência',
      },
    ];
    const { data: insertedInv } = await supabase.from('investments').insert(investmentsToInsert).select('id');
    created.investments = insertedInv?.length ?? 0;

    return new Response(JSON.stringify({ ok: true, created }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('demo-data error', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
