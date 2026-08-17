-- Sessões de geração (agrupa workers gerados em lote)
CREATE TABLE public.generation_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  total_planned INTEGER NOT NULL DEFAULT 0,
  total_generated INTEGER NOT NULL DEFAULT 0,
  total_ready INTEGER NOT NULL DEFAULT 0,
  total_failed INTEGER NOT NULL DEFAULT 0,
  total_approved INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', -- active | completed | cancelled
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.generation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage generation_sessions"
ON public.generation_sessions FOR ALL TO authenticated
USING (has_platform_role(auth.uid(), 'super_admin'::platform_role))
WITH CHECK (has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER trg_generation_sessions_updated
BEFORE UPDATE ON public.generation_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Workers gerados (isolados de ai_workers até aprovação)
CREATE TABLE public.generated_workers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.generation_sessions(id) ON DELETE SET NULL,
  worker_type TEXT NOT NULL DEFAULT 'chat', -- chat | txt | image
  name TEXT NOT NULL DEFAULT '',
  -- Dados do processo manual
  gmail_used TEXT,
  lovable_project_url TEXT,
  supabase_project_url TEXT,
  base_url TEXT, -- URL final da edge function (ai-chat, etc)
  prompt_used TEXT,
  -- Status do pipeline
  status TEXT NOT NULL DEFAULT 'draft',
    -- draft | generating | awaiting_link | validating | testing | ready | error | approved | rejected
  current_step TEXT NOT NULL DEFAULT 'gmail', -- gmail | signup | confirm | prompt | cloud | link | test | done
  progress_percent INTEGER NOT NULL DEFAULT 0,
  -- Resultado dos testes
  test_passed BOOLEAN,
  test_latency_ms INTEGER,
  test_response_sample TEXT,
  last_test_at TIMESTAMPTZ,
  -- Erros / problemas
  error_code TEXT, -- captcha | invalid_link | not_supabase | quota | timeout | unknown
  error_message TEXT,
  -- Aprovação manual (só aqui vira ai_worker)
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  promoted_worker_id UUID, -- id em ai_workers depois de aprovado
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  -- Meta
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_generated_workers_session ON public.generated_workers(session_id);
CREATE INDEX idx_generated_workers_status ON public.generated_workers(status);

ALTER TABLE public.generated_workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage generated_workers"
ON public.generated_workers FOR ALL TO authenticated
USING (has_platform_role(auth.uid(), 'super_admin'::platform_role))
WITH CHECK (has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER trg_generated_workers_updated
BEFORE UPDATE ON public.generated_workers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Logs de testes feitos nos workers gerados
CREATE TABLE public.worker_test_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  generated_worker_id UUID NOT NULL REFERENCES public.generated_workers(id) ON DELETE CASCADE,
  test_type TEXT NOT NULL DEFAULT 'ping', -- ping | real_call | link_validation
  success BOOLEAN NOT NULL DEFAULT false,
  latency_ms INTEGER,
  http_status INTEGER,
  response_sample TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_worker_test_logs_worker ON public.worker_test_logs(generated_worker_id);

ALTER TABLE public.worker_test_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage worker_test_logs"
ON public.worker_test_logs FOR ALL TO authenticated
USING (has_platform_role(auth.uid(), 'super_admin'::platform_role))
WITH CHECK (has_platform_role(auth.uid(), 'super_admin'::platform_role));

-- Marcador "source" em ai_workers para distinguir legados x promovidos
ALTER TABLE public.ai_workers
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS promoted_from_generated_id UUID;
-- source: 'legacy' (os 18 atuais) | 'generated' (vindos do pipeline aprovado)