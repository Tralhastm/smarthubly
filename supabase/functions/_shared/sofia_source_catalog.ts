export type SofiaSourceEvidence = {
  id: string;
  keywords: string[];
  title: string;
  route: string;
  action: string;
  effect: string;
  dataAccess: string;
  automatic: boolean;
  destructive: boolean;
  external: boolean;
  source: string;
  verifiedCommit: string;
};

// Catálogo funcional sanitizado e somente leitura. Não contém código executável,
// credenciais, dados de clientes ou parâmetros capazes de disparar mutações.
const EVIDENCE: SofiaSourceEvidence[] = [
  {
    id: "catalog-hide-unavailable",
    keywords: ["ocultar esgotado", "ocultar indisponivel", "ocultar indisponíveis", "produtos esgotados", "sem estoque oculto", "nao aparecer na vitrine"],
    title: "Ocultar produtos indisponíveis da vitrine",
    route: "Catálogo → Produtos",
    action: "Ocultar indisponíveis; para um item, ícone de olho Ocultar da vitrine",
    effect: "Atualiza store_visible=false nos produtos com in_stock=false. Sem essa ação, o produto pode continuar listado como Indisponível e a compra fica bloqueada.",
    dataAccess: "products: lê in_stock/store_visible e grava somente store_visible nesta ação",
    automatic: false,
    destructive: false,
    external: false,
    source: "src/components/tenant/TenantAdminProducts.tsx:633-650,2175-2179; src/components/tenant/TenantCatalog.tsx:254-276",
    verifiedCommit: "6797419"
  },
  {
    id: "society-cost-rule",
    keywords: ["gasto sociedade", "custo sociedade", "regra sociedade", "apuracao sociedade", "apuração sociedade"],
    title: "Cadastrar gasto na Sociedade",
    route: "Financeiro → Financeiro Avançado → Sociedade → Gastos",
    action: "Preencher nome, valor maior que zero, tipo e escopo; Produto/Variação exigem seleção correspondente; adicionar",
    effect: "Insere uma regra histórica em partnership_cost_rules e invalida a apuração; não altera a taxa da plataforma.",
    dataAccess: "partnership_cost_rules; RPC get_partnership_profit_report",
    automatic: false,
    destructive: false,
    external: false,
    source: "src/components/tenant/TenantSocietyTab.tsx:151-177; supabase/migrations/20261028120000_society_flexible_named_costs.sql",
    verifiedCommit: "6797419"
  },
  {
    id: "automation-weekly-send",
    keywords: ["gerar e enviar", "relatorio semanal enviar", "relatório semanal enviar", "automacao enviar email", "automação enviar e-mail"],
    title: "Gerar e enviar relatório semanal",
    route: "Configurações → Automações",
    action: "Gerar e enviar agora",
    effect: "Chama a automação e pode enviar e-mail real aos destinatários; não é apenas prévia e não há desfazer simples após enfileirar.",
    dataAccess: "automations-cron, automation_runs e provedor de e-mail conforme configuração",
    automatic: true,
    destructive: false,
    external: true,
    source: "src/components/tenant/TenantAdminAutomations.tsx; supabase/functions/automations-cron/index.ts:418-455",
    verifiedCommit: "6797419"
  },
  {
    id: "supplier-import",
    keywords: ["atualizar preços em massa", "atualizar precos em massa", "importar lista fornecedor", "importar exportar fornecedor", "preço de custo em massa", "preco de custo em massa"],
    title: "Importar custos do fornecedor",
    route: "Painel do fornecedor → Catálogo → Importar / Exportar",
    action: "Colar/carregar lista e clicar Atualizar preços",
    effect: "Atualiza custo/oferta e disponibilidade de correspondências existentes; não altera preço de revenda nem cria produto novo. A lista pode ser snapshot completo.",
    dataAccess: "supplier_product_prices, supplier_variant_offers, products e product_variants",
    automatic: false,
    destructive: false,
    external: false,
    source: "supabase/functions/import-supplier-catalog/index.ts:619-880; src/pages/SupplierPanel.tsx:978-1081",
    verifiedCommit: "6797419"
  },
  {
    id: "sofia-agent-plan",
    keywords: ["sofia agente aplicar", "aplicar plano", "alterar preço com ia", "alterar preco com ia", "plano da sofia", "aplicar mudanca sofia"],
    title: "Sofia Agente e aplicação de plano",
    route: "Marketing → Sofia Agente",
    action: "Gerar plano; revisar; clicar Aplicar Plano explicitamente",
    effect: "Toda mensagem gera plano pending. Somente o endpoint acionado pelo botão explícito aplica alterações permitidas em identidade/produtos; palavras como aplicar não executam.",
    dataAccess: "store_agent_plans, tenants e products no tenant autenticado",
    automatic: false,
    destructive: true,
    external: false,
    source: "src/components/super-admin/SofiaStoreAgent.tsx:85-116; supabase/functions/ai-chat-unified/_routes/sofia-agent/index.ts:661-892",
    verifiedCommit: "31a59eb"
  },
  {
    id: "order-payment",
    keywords: ["marcar pagamento recebido", "pagamento recebido pedido", "pedido pago", "confirmar pagamento pedido"],
    title: "Marcar pagamento recebido",
    route: "Operação → Pedidos",
    action: "Marcar pagamento recebido",
    effect: "Grava payment_received=true no pedido; não deduza recebimento pelo método ou status de entrega.",
    dataAccess: "orders.payment_received",
    automatic: false,
    destructive: false,
    external: false,
    source: "src/components/tenant/TenantAdminOrders.tsx; supabase/functions/ai-chat-unified/_routes/sofia-agent/index.ts:430-445",
    verifiedCommit: "6797419"
  }
];

const normalize = (value: string) => value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function getSofiaSourceEvidence(question: string): string {
  const normalized = normalize(question || "");
  const matches = EVIDENCE.filter((item) => item.keywords.some((keyword) => normalized.includes(normalize(keyword))));
  if (!matches.length) {
    return "NENHUMA EVIDÊNCIA FUNCIONAL ESPECÍFICA ENCONTRADA NO CATÁLOGO READ-ONLY. Não invente botão, caminho ou efeito; peça a tela/captura ou encaminhe para Suporte & Treino.";
  }
  return matches.map((item) => [
    `EVIDÊNCIA READ-ONLY: ${item.title}`,
    `Caminho confirmado: ${item.route}`,
    `Ação confirmada: ${item.action}`,
    `Efeito confirmado: ${item.effect}`,
    `Dados/execução: ${item.dataAccess}`,
    `Automaticidade: ${item.automatic ? "pode ser acionada por automação" : "manual; não afirmar que é automática"}`,
    `Risco: ${item.destructive ? "alto; exige revisão explícita" : "sem exclusão direta nesta ação"}${item.external ? "; pode acionar serviço externo" : ""}`,
    `Fonte sanitizada: ${item.source} | commit validado: ${item.verifiedCommit}`
  ].join("\n")).join("\n\n");
}

export function getSofiaSourceEvidenceEntries(): SofiaSourceEvidence[] {
  return EVIDENCE.map((item) => ({ ...item, keywords: [...item.keywords] }));
}
