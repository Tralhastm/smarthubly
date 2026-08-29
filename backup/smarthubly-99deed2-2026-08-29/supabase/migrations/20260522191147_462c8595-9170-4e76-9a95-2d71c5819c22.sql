
-- Tabela de configurações fiscais por tenant
CREATE TABLE public.fiscal_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'webmania', -- webmania | plugnotas | focusnfe | nfeio
  environment TEXT NOT NULL DEFAULT 'sandbox', -- sandbox | production
  enabled BOOLEAN NOT NULL DEFAULT false,
  -- Credenciais (cada provider usa diferente — guardamos tudo aqui)
  api_token TEXT,           -- PlugNotas/FocusNFe/NFe.io usam só 1 token
  consumer_key TEXT,        -- WebmaniaBR usa 4 chaves
  consumer_secret TEXT,
  access_token TEXT,
  access_token_secret TEXT,
  -- Dados fiscais da empresa
  cnpj TEXT,
  razao_social TEXT,
  nome_fantasia TEXT,
  inscricao_estadual TEXT,
  inscricao_municipal TEXT,
  regime_tributario TEXT DEFAULT 'simples_nacional', -- simples_nacional | simples_excesso | regime_normal
  cnae TEXT,
  -- Endereço fiscal
  endereco_logradouro TEXT,
  endereco_numero TEXT,
  endereco_complemento TEXT,
  endereco_bairro TEXT,
  endereco_cidade TEXT,
  endereco_uf TEXT,
  endereco_cep TEXT,
  endereco_codigo_municipio TEXT, -- IBGE
  -- Defaults fiscais por produto (quando produto não tem)
  cfop_padrao TEXT DEFAULT '5102',
  ncm_padrao TEXT DEFAULT '22030000',
  cest_padrao TEXT,
  origem_padrao TEXT DEFAULT '0',
  csosn_padrao TEXT DEFAULT '102', -- Simples Nacional
  cst_padrao TEXT,                  -- Regime normal
  unidade_padrao TEXT DEFAULT 'UN',
  -- Série e numeração
  serie_nfce INTEGER NOT NULL DEFAULT 1,
  proximo_numero_nfce INTEGER NOT NULL DEFAULT 1,
  csc_id TEXT,        -- ID do token CSC pra NFC-e (homologação=1, produção definido pelo estado)
  csc_token TEXT,     -- Código de Segurança do Contribuinte
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fiscal_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage own tenant fiscal settings"
ON public.fiscal_settings FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER trg_fiscal_settings_updated_at
BEFORE UPDATE ON public.fiscal_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela de notas emitidas
CREATE TABLE public.fiscal_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'nfce', -- nfce | nfe
  numero INTEGER,
  serie INTEGER,
  chave_acesso TEXT,
  protocolo TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | authorized | rejected | cancelled | processing
  total NUMERIC(10,2),
  xml_url TEXT,
  pdf_url TEXT,
  qr_code TEXT,
  error_message TEXT,
  provider_response JSONB,
  emitted_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fiscal_invoices_tenant ON public.fiscal_invoices(tenant_id);
CREATE INDEX idx_fiscal_invoices_order ON public.fiscal_invoices(order_id);
CREATE INDEX idx_fiscal_invoices_status ON public.fiscal_invoices(tenant_id, status);

ALTER TABLE public.fiscal_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view own tenant fiscal invoices"
ON public.fiscal_invoices FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins insert own tenant fiscal invoices"
ON public.fiscal_invoices FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins update own tenant fiscal invoices"
ON public.fiscal_invoices FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER trg_fiscal_invoices_updated_at
BEFORE UPDATE ON public.fiscal_invoices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Campos fiscais opcionais por produto
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ncm TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cfop TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cest TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS origem TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS csosn TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cst TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unidade TEXT;
