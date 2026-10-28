-- Registro do que a Sofia conhece e de onde veio cada conhecimento.
CREATE TABLE IF NOT EXISTS public.sofia_knowledge_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  domain TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'platform',
  source_ref TEXT,
  why_learned TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.0',
  active BOOLEAN NOT NULL DEFAULT true,
  learned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sofia_learning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  surface TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  source_ref TEXT,
  question TEXT,
  answer_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sofia_knowledge_domain ON public.sofia_knowledge_registry(domain, active, learned_at DESC);
CREATE INDEX IF NOT EXISTS idx_sofia_learning_events_created ON public.sofia_learning_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sofia_learning_events_tenant ON public.sofia_learning_events(tenant_id, created_at DESC);
ALTER TABLE public.sofia_knowledge_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_learning_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Super admins read Sofia knowledge" ON public.sofia_knowledge_registry;
CREATE POLICY "Super admins read Sofia knowledge" ON public.sofia_knowledge_registry FOR SELECT TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
DROP POLICY IF EXISTS "Super admins manage Sofia knowledge" ON public.sofia_knowledge_registry;
CREATE POLICY "Super admins manage Sofia knowledge" ON public.sofia_knowledge_registry FOR ALL TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'::platform_role)) WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
DROP POLICY IF EXISTS "Super admins read Sofia learning" ON public.sofia_learning_events;
CREATE POLICY "Super admins read Sofia learning" ON public.sofia_learning_events FOR SELECT TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'::platform_role));

INSERT INTO public.sofia_knowledge_registry (title, domain, content, source_type, source_ref, why_learned, version)
SELECT * FROM (VALUES
  ('Mapa da plataforma', 'plataforma', 'SmartHubly é multi-tenant: cada loja tem catálogo público, checkout, pedidos, painel admin, PWA e configurações próprias.', 'platform_knowledge', 'supabase/functions/_shared/platform_knowledge.ts', 'Base operacional permanente para responder dúvidas sobre o produto.', '2026.10'),
  ('Navegação do painel da loja', 'interface', 'Dashboard, Pedidos, Mensagens, Venda Rápida, Salão ao Vivo, Produtos, Categorias, Financeiro, Usuários, Fornecedores, Motoboys, Frete, Ranking, Aparência, Promoções, Cupons, Avaliações, Cobranças, Impressora, Agendamento, Orçamentos, Integrações, Automações, Diagnóstico, Fiscal, Ficha Técnica, Estoque, Relatórios e Sofia Agente.', 'platform_knowledge', 'src/pages/TenantAdmin.tsx', 'Permitir instruções passo a passo sobre cada aba e botão do painel.', '2026.10'),
  ('Pedidos e operação', 'pedidos', 'Pedidos percorrem recebido, preparando, pronto/saindo, entregue ou cancelado; a Sofia deve consultar contexto vivo antes de afirmar status, pagamento, entrega, cliente ou item.', 'platform_knowledge', 'src/hooks/useOrders.ts', 'Evitar respostas inventadas e orientar operação com dados atuais.', '2026.10'),
  ('Catálogo e produtos', 'catalogo', 'Produtos possuem nome, descrição, preço, imagem, categoria, subcategoria, estoque, variantes e adicionais; disponibilidade real vem do banco e das ofertas vigentes.', 'platform_knowledge', 'src/hooks/useProducts.ts', 'Responder corretamente dúvidas de produtos, preço, estoque e variações.', '2026.10'),
  ('Chats de cliente', 'atendimento', 'A Sofia pode orientar e responder no chat geral de Suporte e no chat vinculado a cada pedido, sempre distinguindo Sofia, cliente e loja.', 'platform_knowledge', 'src/pages/TenantStoreSupport.tsx; src/components/tenant/CustomerOrderChat.tsx', 'Conectar a IA aos pontos reais de atendimento da plataforma.', '2026.10'),
  ('Pedidos e dados sensíveis', 'seguranca', 'A Sofia pode explicar status e próximos passos, mas não deve expor tokens, chaves, dados internos, credenciais ou executar alterações irreversíveis sem confirmação/autorização.', 'policy', 'Sofia operational policy', 'Proteger dados de clientes e evitar ações indevidas.', '2026.10'),
  ('Ações da Sofia Agente', 'automacao', 'A Sofia Agente cria planos revisáveis para identidade da loja e produtos; aplicar mudanças requer revisão do lojista, salvo pedido explícito de aplicação automática.', 'platform_knowledge', 'supabase/functions/ai-chat-unified/_routes/sofia-agent/index.ts', 'Separar orientação de execução e manter rollback/auditoria.', '2026.10'),
  ('Integrações e limites', 'integracoes', 'Lalamove possui integração nativa; Uber, 99, inDrive e outros entram como link de rastreio colado no pedido. A Sofia nunca deve prometer integração inexistente.', 'platform_knowledge', 'supabase/functions/_shared/platform_knowledge.ts', 'Manter respostas comerciais e operacionais verdadeiras.', '2026.10')
) AS seed(title, domain, content, source_type, source_ref, why_learned, version)
WHERE NOT EXISTS (SELECT 1 FROM public.sofia_knowledge_registry k WHERE k.title = seed.title);

CREATE OR REPLACE FUNCTION public.log_sofia_learning_event(
  _tenant_id TEXT, _surface TEXT, _event_type TEXT, _subject TEXT, _reason TEXT DEFAULT '', _source_ref TEXT DEFAULT NULL, _question TEXT DEFAULT NULL, _answer_summary TEXT DEFAULT NULL, _metadata JSONB DEFAULT '{}'::jsonb
) RETURNS public.sofia_learning_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event public.sofia_learning_events;
BEGIN
  INSERT INTO public.sofia_learning_events (tenant_id, surface, event_type, subject, reason, source_ref, question, answer_summary, metadata)
  VALUES (_tenant_id, _surface, _event_type, _subject, COALESCE(_reason, ''), _source_ref, _question, _answer_summary, COALESCE(_metadata, '{}'::jsonb))
  RETURNING * INTO v_event;
  RETURN v_event;
END;
$$;
REVOKE ALL ON FUNCTION public.log_sofia_learning_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_sofia_learning_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
