import { useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Play, CheckCircle2, XCircle, Loader2, Sparkles, Copy, MessageSquare, FileText, Image as ImageIcon, AlertCircle, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import AnonymousIframePanel, { IframeTool } from './AnonymousIframePanel';

type WorkerType = 'chat' | 'txt' | 'image';
const TYPE_LABEL: Record<WorkerType, string> = { chat: 'Chat', txt: 'TXT', image: 'Imagem' };
const TYPE_ICON: Record<WorkerType, JSX.Element> = {
  chat: <MessageSquare className="h-3 w-3" />, txt: <FileText className="h-3 w-3" />, image: <ImageIcon className="h-3 w-3" />,
};

const STATUS_LABEL: Record<string, { label: string; cls: string; icon: JSX.Element }> = {
  draft:        { label: 'Rascunho',  cls: 'bg-secondary text-muted-foreground',           icon: <Sparkles className="h-3 w-3" /> },
  generating:   { label: 'Gerando',   cls: 'bg-blue-500/15 text-blue-300',                 icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  awaiting_link:{ label: 'Aguardando link', cls: 'bg-yellow-500/15 text-yellow-300',       icon: <AlertCircle className="h-3 w-3" /> },
  validating:   { label: 'Validando', cls: 'bg-blue-500/15 text-blue-300',                 icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  testing:      { label: 'Testando',  cls: 'bg-blue-500/15 text-blue-300',                 icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  ready:        { label: '100% Pronto',cls: 'bg-green-500/15 text-green-400',              icon: <CheckCircle2 className="h-3 w-3" /> },
  error:        { label: 'Erro',      cls: 'bg-red-500/15 text-red-400',                   icon: <XCircle className="h-3 w-3" /> },
  approved:     { label: 'Aprovado',  cls: 'bg-emerald-500/20 text-emerald-300',           icon: <CheckCircle2 className="h-3 w-3" /> },
  rejected:     { label: 'Rejeitado', cls: 'bg-red-500/15 text-red-400',                   icon: <XCircle className="h-3 w-3" /> },
};

const GMAIL_GENERATOR_URL = 'https://www.mailticking.com/';
const LOVABLE_SIGNUP_URL = 'https://lovable.dev/pt-br';

const FIXED_PROMPT = `Crie um projeto que funciona como WORKER DE IA (API backend) para um sistema externo de delivery multi-tenant. Este projeto NÃO tem interface visual - ele só expõe 3 edge functions que recebem requisições e respondem usando IA.

O sistema principal vai chamar essas funções quando precisar de IA. Este worker usa a IA do Lovable (Lovable AI Gateway) para processar tudo.

## EDGE FUNCTIONS NECESSÁRIAS

### 1. supabase/functions/ai-chat/index.ts
Recebe mensagens de chat e retorna resposta em streaming (SSE).

**Entrada (POST):**
\`\`\`json
{
  "messages": [{"role": "user", "content": "texto"}],
  "systemPrompt": "Você é o assistente da loja X...",
  "tenantName": "Nome da Loja",
  "niche": "adega"
}
\`\`\`

**Comportamento:**
- Usa o Lovable AI Gateway (https://ai.gateway.lovable.dev/v1/chat/completions)
- Model: google/gemini-3-flash-preview
- Envia o systemPrompt como mensagem de sistema
- Envia as messages como histórico do chat
- STREAMING OBRIGATÓRIO (stream: true)
- Retorna o stream SSE diretamente pro cliente
- Content-Type: text/event-stream
- CORS headers obrigatórios para qualquer origem

**Implementação:**
\`\`\`typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, systemPrompt, tenantName, niche } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const finalSystemPrompt = systemPrompt || \`Você é o assistente virtual da loja "\${tenantName}", especializada em \${niche || 'produtos diversos'}. Seja simpático, objetivo e em português brasileiro.\`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: \`Bearer \${LOVABLE_API_KEY}\`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: finalSystemPrompt }, ...messages],
        stream: true,
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: \`AI error: \${response.status}\` }), {
        status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
\`\`\`

### 2. supabase/functions/ai-parse-txt/index.ts
Recebe texto de um arquivo TXT com lista de produtos e retorna JSON estruturado.

**Entrada (POST):**
\`\`\`json
{ "txtContent": "Coca-Cola 350ml - R$5,00\\nGuaraná 2L - R$8,50..." }
\`\`\`

**Saída esperada:**
\`\`\`json
{ "products": [{"name": "Coca-Cola 350ml", "price": 5.00, "category": "Bebidas", "description": "Refrigerante Coca-Cola gelado 350ml"}] }
\`\`\`

**Comportamento:**
- Usa Lovable AI Gateway SEM streaming
- Manda o prompt pedindo extração de produtos
- O prompt deve pedir: name, price (número), category (inferida), description (curta e atrativa)
- Se preço não estiver claro, coloca 0
- Responde APENAS JSON válido, sem markdown
- CORS headers obrigatórios

**Implementação:**
\`\`\`typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { txtContent } = await req.json();
    if (!txtContent) throw new Error("txtContent required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = \`Você é um parser de produtos. Extraia os produtos do texto abaixo.
Para cada produto extraia: name, price (número), category (inferida do nome), description (curta e atrativa).
Se o preço não estiver claro, coloque 0.
Responda APENAS com JSON válido neste formato exato, sem markdown:
{"products": [{"name": "...", "price": 0, "category": "...", "description": "..."}]}

Texto:
\${txtContent}\`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: \`Bearer \${LOVABLE_API_KEY}\`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Responda APENAS com JSON válido, sem markdown." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: \`AI error: \${response.status}\` }), {
        status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    const cleaned = text.replace(/\`\`\`json\\n?/g, "").replace(/\`\`\`\\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
\`\`\`

### 3. supabase/functions/ai-generate-image/index.ts
Recebe nome do produto e gera uma imagem via IA.

**Entrada (POST):**
\`\`\`json
{ "productName": "Coca-Cola 350ml", "category": "Bebidas", "tenantId": "uuid-do-tenant" }
\`\`\`

**Entrada no modo edição (tratamento de foto existente):**
\`\`\`json
{ "mode": "edit", "prompt": "...", "imageBase64": "<base64 sem prefixo>", "mimeType": "image/jpeg" }
\`\`\`

**Saída esperada:**
\`\`\`json
{ "imageUrl": "data:image/png;base64,..." }
\`\`\`

**Comportamento:**
- Usa Lovable AI Gateway com modelo google/gemini-2.5-flash-image
- Gera imagem fotorrealista do produto (ou trata a imagem recebida quando mode = "edit")
- Retorna como data URL (base64) no campo imageUrl
- O sistema principal vai fazer o upload da imagem
- CORS headers obrigatórios

**Implementação:**
\`\`\`typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { productName, category, mode, prompt: customPrompt, imageBase64, mimeType } = await req.json();
    if (mode !== "edit" && !productName) throw new Error("productName required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = customPrompt || \`Ultra-realistic editorial product photography of "\${productName}" (category: \${category || 'general'}). Shot on a Canon EOS R5 with 85mm lens, shallow depth of field, cinematic lighting. No text, no labels, no watermarks. Photorealistic, 8K quality.\`;

    // modo edição: manda a foto original junto do prompt
    const content = (mode === "edit" && imageBase64)
      ? [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: \`data:\${mimeType || "image/jpeg"};base64,\${imageBase64}\` } },
        ]
      : prompt;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: \`Bearer \${LOVABLE_API_KEY}\`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: \`AI error: \${response.status}\` }), {
        status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "Não foi possível gerar a imagem" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ imageUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
\`\`\`

## REGRAS IMPORTANTES

1. NÃO crie nenhuma interface visual (nenhuma página, nenhum componente React)
2. O projeto é APENAS as 3 edge functions acima
3. Use Lovable Cloud (ele já vem habilitado)
4. O LOVABLE_API_KEY já vem configurado automaticamente
5. CORS deve permitir QUALQUER origem (Access-Control-Allow-Origin: *)
6. Se a IA retornar erro 429 ou 402, retorne o mesmo status code pro cliente
7. Publique o projeto e copie a URL publicada (ex: https://xxx.lovable.app)

Ao terminar, me envie o link publicado para usar como worker de chat, TXT e imagens.`;

const SuperAdminGeneratedWorkers = () => {
  const qc = useQueryClient();
  const [showPrompt, setShowPrompt] = useState(false);
  const [newType, setNewType] = useState<WorkerType>('chat');
  const [newName, setNewName] = useState('');
  const [newGmail, setNewGmail] = useState('');

  // Painel de iframes anônimos
  const [openTools, setOpenTools] = useState<IframeTool[]>([]);
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const openTool = (tool: IframeTool) => {
    setOpenTools((prev) => (prev.find((t) => t.id === tool.id) ? prev : [...prev, tool]));
    setActiveToolId(tool.id);
    setPanelOpen(true);
  };
  const closeTool = (id: string) => {
    setOpenTools((prev) => prev.filter((t) => t.id !== id));
    setActiveToolId((cur) => (cur === id ? null : cur));
  };

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['generated-workers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('generated_workers' as any)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 5000,
  });

  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    items.forEach((i) => { byStatus[i.status] = (byStatus[i.status] || 0) + 1; });
    return {
      total: items.length,
      ready: byStatus.ready || 0,
      approved: byStatus.approved || 0,
      error: byStatus.error || 0,
      working: (byStatus.generating || 0) + (byStatus.validating || 0) + (byStatus.testing || 0) + (byStatus.awaiting_link || 0) + (byStatus.draft || 0),
    };
  }, [items]);

  const createWorker = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('generated_workers' as any).insert({
        worker_type: newType,
        name: newName || `Gerado ${TYPE_LABEL[newType]} ${items.length + 1}`,
        gmail_used: newGmail || null,
        status: 'awaiting_link',
        current_step: 'gmail',
        progress_percent: 10,
        prompt_used: FIXED_PROMPT,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['generated-workers'] });
      setNewName(''); setNewGmail('');
      toast.success('Worker iniciado. Cole o link do Supabase quando estiver pronto.');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateWorker = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) => {
      const { error } = await supabase.from('generated_workers' as any).update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['generated-workers'] }),
  });

  const testWorker = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('generated_workers' as any).update({ status: 'testing', progress_percent: 70 }).eq('id', id);
      const { data, error } = await supabase.functions.invoke('test-generated-worker', {
        body: { generated_worker_id: id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['generated-workers'] });
      if (res?.ok) toast.success(`Teste OK · ${res.latency_ms}ms`);
      else toast.error(`Falhou: ${res?.error_code || 'desconhecido'}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const approveWorker = useMutation({
    mutationFn: async (gw: any) => {
      // Promove para ai_workers
      const { data: created, error: insErr } = await supabase.from('ai_workers').insert({
        name: gw.name,
        base_url: gw.base_url,
        worker_type: gw.worker_type,
        is_active: true,
        is_exhausted: false,
        source: 'generated',
        promoted_from_generated_id: gw.id,
      } as any).select('id').maybeSingle();
      if (insErr) throw insErr;
      const { error: updErr } = await supabase.from('generated_workers' as any).update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        promoted_worker_id: (created as any)?.id,
      }).eq('id', gw.id);
      if (updErr) throw updErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['generated-workers'] });
      qc.invalidateQueries({ queryKey: ['ai-workers'] });
      toast.success('Aprovado e adicionado aos Workers IA!');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rejectWorker = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('generated_workers' as any).update({
        status: 'rejected', rejected_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['generated-workers'] }); toast.success('Rejeitado'); },
  });

  const deleteWorker = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('generated_workers' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['generated-workers'] }),
  });

  const copyPrompt = () => {
    navigator.clipboard.writeText(FIXED_PROMPT);
    toast.success('Prompt copiado!');
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-bold text-foreground">{stats.total}</p></div>
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted-foreground">Em processo</p><p className="text-2xl font-bold text-blue-400">{stats.working}</p></div>
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted-foreground">Prontos</p><p className="text-2xl font-bold text-green-400">{stats.ready}</p></div>
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted-foreground">Aprovados</p><p className="text-2xl font-bold text-emerald-300">{stats.approved}</p></div>
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted-foreground">Erros</p><p className="text-2xl font-bold text-red-400">{stats.error}</p></div>
      </div>

      {/* Aviso de isolamento */}
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-300">
        🛡️ Workers gerados ficam <strong>isolados</strong> dos workers em produção. Só entram no fallback real depois que você clicar em <strong>Aprovar</strong>.
      </div>

      {/* Links úteis - abrem em iframe anônimo persistente */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-sm text-foreground">Ferramentas externas (iframe anônimo)</h3>
          {openTools.length > 0 && !panelOpen && (
            <Button size="sm" variant="outline" onClick={() => setPanelOpen(true)}>
              <Eye className="h-3 w-3 mr-1" /> Mostrar painel ({openTools.length})
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Cada ferramenta abre em um iframe isolado. A sessão fica viva mesmo se você esconder o painel ou trocar de aba. Use <strong>Nova</strong> dentro do painel para limpar tudo. Se um site recarregar sozinho ou bloquear iframe (caso do mailticking), use o botão <strong>Popup</strong> — abre uma janela chromeless real, sem sandbox.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border bg-secondary/40 p-2 text-xs text-foreground">
            <div className="font-medium">📧 Gerar Gmail</div>
            <div className="text-muted-foreground text-[10px] mb-1">mailticking.com</div>
            <div className="flex gap-1">
              <button
                onClick={() => openTool({ id: 'gmail', label: '📧 Gmail', url: GMAIL_GENERATOR_URL })}
                className="flex-1 rounded bg-secondary hover:bg-secondary/80 px-2 py-1 text-[10px]"
              >Iframe</button>
              <button
                onClick={() => window.open(GMAIL_GENERATOR_URL, 'gmail_popup', 'popup=yes,width=520,height=720,noopener=no')}
                className="flex-1 rounded bg-primary/80 hover:bg-primary text-primary-foreground px-2 py-1 text-[10px]"
                title="Recomendado para mailticking — abre janela popup real, evita reload e sandbox"
              >Popup ⭐</button>
            </div>
          </div>
          <div className="rounded-md border border-border bg-secondary/40 p-2 text-xs text-foreground">
            <div className="font-medium">🚀 Criar projeto</div>
            <div className="text-muted-foreground text-[10px] mb-1">lovable.dev</div>
            <div className="flex gap-1">
              <button
                onClick={() => openTool({ id: 'lovable', label: '🚀 Lovable', url: LOVABLE_SIGNUP_URL })}
                className="flex-1 rounded bg-secondary hover:bg-secondary/80 px-2 py-1 text-[10px]"
              >Iframe</button>
              <button
                onClick={() => window.open(LOVABLE_SIGNUP_URL, 'lovable_popup', 'popup=yes,width=1100,height=800,noopener=no')}
                className="flex-1 rounded bg-secondary hover:bg-secondary/80 px-2 py-1 text-[10px]"
              >Popup</button>
            </div>
          </div>
        </div>
        <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 p-2 text-[10px] text-yellow-200/90 leading-relaxed space-y-1">
          <p><strong>Como o mailticking funciona (testado):</strong></p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>Ao abrir, aparece o popup <em>"Your Temp Email is Ready"</em> com um e-mail no topo (ex: <code>ma.s.s.i.vec.vn@gmail.com</code>) e 4 variações abaixo (ponto/plus/googlemail) — <strong>todas caem na mesma caixa</strong>.</li>
            <li>Clique no botão amarelo <strong>Activate</strong> <em>uma vez</em>. Isso fecha o popup e ativa a inbox — sem isso a tela só mostra "No emails received yet".</li>
            <li>Copie o e-mail do input do topo (ícone de copiar ao lado) e use no cadastro do Lovable.</li>
            <li>Volte aqui e clique em <strong>Check emails</strong> ou <strong>Refresh</strong> pra ver o e-mail de verificação chegar.</li>
            <li>Pra gerar outro e-mail diferente, clique no ícone <strong>🔀 (embaralhar)</strong> ao lado do input — NÃO recarregue a página, senão volta o popup inicial.</li>
          </ol>
          <p className="pt-1"><strong>⚠️ Recarregar = popup volta.</strong> No iframe sandbox o site às vezes recarrega sozinho. Use o botão <strong>Popup</strong> (acima) — abre janela real sem sandbox e não recarrega.</p>
        </div>
      </div>

      {/* Prompt fixo */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-sm text-foreground flex items-center gap-2"><Sparkles className="h-4 w-4" /> Prompt fixo (cole no Lovable)</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowPrompt(s => !s)}>{showPrompt ? 'Ocultar' : 'Ver'}</Button>
            <Button size="sm" variant="outline" onClick={copyPrompt}><Copy className="h-3 w-3 mr-1" /> Copiar</Button>
          </div>
        </div>
        {showPrompt && <pre className="text-xs bg-background/50 p-2 rounded whitespace-pre-wrap text-muted-foreground max-h-96 overflow-auto">{FIXED_PROMPT}</pre>}
      </div>

      {/* Iniciar nova geração */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="font-heading text-sm text-foreground">Iniciar nova geração</h3>
        <div className="grid grid-cols-3 gap-2">
          {(['chat', 'txt', 'image'] as WorkerType[]).map(t => (
            <button key={t} onClick={() => setNewType(t)}
              className={`flex items-center justify-center gap-1 rounded-md py-2 text-xs font-medium transition ${newType === t ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
              {TYPE_ICON[t]} {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder={`Nome (auto: Gerado ${TYPE_LABEL[newType]})`} />
        <Input value={newGmail} onChange={e => setNewGmail(e.target.value)} placeholder="Gmail usado (opcional)" />
        <Button size="sm" className="w-full" onClick={() => createWorker.mutate()} disabled={createWorker.isPending}>
          <Plus className="h-4 w-4 mr-1" /> Criar e aguardar link
        </Button>
      </div>

      {/* Lista */}
      <div className="space-y-2">
        <h3 className="font-heading text-sm text-foreground">Workers gerados ({items.length})</h3>
        {items.map((gw: any) => {
          const st = STATUS_LABEL[gw.status] || STATUS_LABEL.draft;
          const t = (gw.worker_type || 'chat') as WorkerType;
          return (
            <div key={gw.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">{gw.name}</span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[10px]">{TYPE_ICON[t]} {TYPE_LABEL[t]}</span>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${st.cls}`}>{st.icon} {st.label}</span>
                  </div>
                  {gw.base_url && <p className="text-xs text-muted-foreground truncate mt-1">{gw.base_url}</p>}
                  {gw.error_message && <p className="text-xs text-red-400 mt-1">⚠ {gw.error_code}: {gw.error_message}</p>}
                  {gw.test_passed && <p className="text-xs text-green-400 mt-1">✓ Latência {gw.test_latency_ms}ms</p>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => deleteWorker.mutate(gw.id)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>

              {/* Input do link Supabase quando aguardando */}
              {(gw.status === 'awaiting_link' || gw.status === 'error') && (
                <div className="flex gap-2">
                  <Input
                    placeholder="Cole aqui: https://xxx.supabase.co  ou  https://xxx.lovable.app"
                    defaultValue={gw.supabase_project_url || gw.lovable_project_url || ''}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (!v) return;
                      const isSupa = /supabase\.co/i.test(v);
                      updateWorker.mutate({
                        id: gw.id,
                        patch: isSupa
                          ? { supabase_project_url: v, status: 'validating', current_step: 'link', progress_percent: 60 }
                          : { lovable_project_url: v, status: 'validating', current_step: 'link', progress_percent: 60 },
                      });
                    }}
                    className="text-xs flex-1"
                  />
                  <Button size="sm" onClick={() => testWorker.mutate(gw.id)} disabled={testWorker.isPending}>
                    <Play className="h-3 w-3 mr-1" /> Testar
                  </Button>
                </div>
              )}

              {/* Re-testar quando há link mas não foi testado ou deu erro */}
              {gw.status !== 'awaiting_link' && gw.status !== 'approved' && (gw.supabase_project_url || gw.lovable_project_url || gw.base_url) && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => testWorker.mutate(gw.id)} disabled={testWorker.isPending}>
                    <Play className="h-3 w-3 mr-1" /> {gw.status === 'ready' ? 'Re-testar' : 'Testar agora'}
                  </Button>
                  {gw.status === 'ready' && (
                    <>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => approveWorker.mutate(gw)} disabled={approveWorker.isPending}>
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Aprovar e enviar p/ produção
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => rejectWorker.mutate(gw.id)}>Rejeitar</Button>
                    </>
                  )}
                </div>
              )}

              {gw.status === 'approved' && (
                <p className="text-xs text-emerald-300">✓ Aprovado e ativo nos Workers IA</p>
              )}
            </div>
          );
        })}
        {items.length === 0 && <p className="text-center text-muted-foreground py-6 text-sm">Nenhuma geração iniciada ainda.</p>}
      </div>

      <AnonymousIframePanel
        open={panelOpen}
        tools={openTools}
        activeId={activeToolId}
        onActivate={setActiveToolId}
        onCloseTool={closeTool}
        onClosePanel={() => setPanelOpen(false)}
      />
    </div>
  );
};

export default SuperAdminGeneratedWorkers;
