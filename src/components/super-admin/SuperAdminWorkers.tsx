import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, Plus, Trash2, RefreshCw, Upload, Download, MessageSquare, Image, FileText, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import SuperAdminGeneratedWorkers from './SuperAdminGeneratedWorkers';

type WorkerType = 'chat' | 'txt' | 'image';

const TYPE_LABEL: Record<WorkerType, string> = { chat: 'Chat', txt: 'TXT', image: 'Imagem' };
const TYPE_ICON: Record<WorkerType, JSX.Element> = {
  chat: <MessageSquare className="h-3 w-3" />,
  txt: <FileText className="h-3 w-3" />,
  image: <Image className="h-3 w-3" />,
};

// Parser do TXT: detecta linhas tipo "IA Chat: https://..." | "IA Imagem: https://..." | "IA TXT: https://..."
function parseWorkersTxt(text: string): { url: string; type: WorkerType }[] {
  const out: { url: string; type: WorkerType }[] = [];
  const urlRegex = /(https?:\/\/[^\s,;]+)/i;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const urlMatch = line.match(urlRegex);
    if (!urlMatch) continue;
    const url = urlMatch[1].replace(/[.,;]+$/, '');
    // Olha label (parte antes da URL) + URL
    const beforeUrl = line.slice(0, line.indexOf(urlMatch[1])).toLowerCase();
    const urlLower = url.toLowerCase();
    const haystack = beforeUrl + ' ' + urlLower;

    let type: WorkerType = 'chat';
    // Imagem: imagem/image/img/foto/picture/pic/visual/generate-image/gen-image/dall-e/diffusion
    if (/(imagem|imagens|image|images|\bimg\b|\bimgs\b|foto|picture|\bpic\b|visual|generate[-_ ]?image|gen[-_ ]?image|dall[-_ ]?e|diffusion|gerar[- ]?imagem)/.test(haystack)) {
      type = 'image';
    }
    // TXT: parse-txt/txt/texto/extract/parse-text
    else if (/(parse[-_ ]?txt|\btxt\b|texto|extract[-_ ]?text|parse[-_ ]?text|text[-_ ]?parse|ler[- ]?texto)/.test(haystack)) {
      type = 'txt';
    }
    // Chat: chat/conversa/complete/llm/assistant
    else if (/(chat|conversa|complet|\bllm\b|assistant|conversation)/.test(haystack)) {
      type = 'chat';
    }
    out.push({ url, type });
  }
  // dedup por URL
  const seen = new Set<string>();
  return out.filter(w => {
    if (seen.has(w.url)) return false;
    seen.add(w.url);
    return true;
  });
}

const SuperAdminWorkers = () => {
  const [view, setView] = useState<'production' | 'generated'>('production');
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<WorkerType>('chat');
  const [bulkText, setBulkText] = useState('');
  const queryClient = useQueryClient();

  const { data: workers = [], isLoading } = useQuery({
    queryKey: ['ai-workers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_workers')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Conta quantos do tipo X já existem (para enumerar)
  const countByType = (type: WorkerType) =>
    workers.filter((w: any) => (w.worker_type || 'chat') === type).length;

  const addWorker = useMutation({
    mutationFn: async ({ name, base_url, worker_type }: { name: string; base_url: string; worker_type: WorkerType }) => {
      const cleanUrl = base_url.replace(/\/+$/, '');
      const { error } = await supabase.from('ai_workers').insert({ name, base_url: cleanUrl, worker_type } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-workers'] });
      setNewUrl('');
      setNewName('');
      toast.success('Worker adicionado!');
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao adicionar worker'),
  });

  const bulkImport = useMutation({
    mutationFn: async (text: string) => {
      const parsed = parseWorkersTxt(text);
      if (parsed.length === 0) throw new Error('Nenhuma URL válida encontrada no TXT');

      // Filtra URLs já existentes
      const existingUrls = new Set(workers.map((w: any) => w.base_url.replace(/\/+$/, '')));
      const counters: Record<WorkerType, number> = {
        chat: countByType('chat'),
        txt: countByType('txt'),
        image: countByType('image'),
      };

      const toInsert: { name: string; base_url: string; worker_type: WorkerType }[] = [];
      for (const w of parsed) {
        const cleanUrl = w.url.replace(/\/+$/, '');
        if (existingUrls.has(cleanUrl)) continue;
        counters[w.type] += 1;
        toInsert.push({
          base_url: cleanUrl,
          worker_type: w.type,
          name: `${TYPE_LABEL[w.type]} ${counters[w.type]}`,
        });
      }

      if (toInsert.length === 0) {
        return { added: 0, skipped: parsed.length };
      }

      const { error } = await supabase.from('ai_workers').insert(toInsert as any);
      if (error) throw error;
      return { added: toInsert.length, skipped: parsed.length - toInsert.length };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['ai-workers'] });
      setBulkText('');
      toast.success(`${res.added} worker(s) adicionado(s)${res.skipped ? `, ${res.skipped} já existia(m)` : ''}`);
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao importar TXT'),
  });

  const onFileUpload = async (file: File) => {
    const text = await file.text();
    setBulkText(text);
  };

  const exportTxt = () => {
    if (!workers.length) { toast.error('Nenhum worker cadastrado'); return; }
    const label: Record<WorkerType, string> = { chat: 'IA Chat', txt: 'IA TXT', image: 'IA Imagem' };
    const lines = workers.map((w: any) => {
      const t = (w.worker_type || 'chat') as WorkerType;
      const status = w.is_active ? (w.is_exhausted ? 'esgotado' : 'ativo') : 'inativo';
      return `${label[t]}: ${w.base_url}  # ${w.name} [${status}]`;
    });
    const header = [
      `# Workers de IA — exportado em ${new Date().toLocaleString('pt-BR')}`,
      `# Total: ${workers.length} (chat: ${counts.chat}, txt: ${counts.txt}, imagem: ${counts.image})`,
      '',
    ];
    const blob = new Blob([[...header, ...lines].join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workers-ia-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Arquivo exportado!');
  };


  const deleteWorker = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ai_workers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-workers'] });
      toast.success('Worker removido');
    },
  });

  const toggleWorker = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('ai_workers').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-workers'] }),
  });

  const resetAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('ai_workers').update({ is_exhausted: false }).neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-workers'] });
      toast.success('Workers resetados!');
    },
  });

  const activeWorkers = workers.filter((w: any) => w.is_active && !w.is_exhausted);
  const exhaustedWorkers = workers.filter((w: any) => w.is_exhausted);

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  // Preview do parsing
  const preview = bulkText.trim() ? parseWorkersTxt(bulkText) : [];
  const counts = {
    chat: countByType('chat'),
    txt: countByType('txt'),
    image: countByType('image'),
  };

  const subTabs = (
    <div className="flex gap-2 mb-2">
      <button onClick={() => setView('production')}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition ${view === 'production' ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
        <Bot className="h-3 w-3" /> Em produção ({workers.length})
      </button>
      <button onClick={() => setView('generated')}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition ${view === 'generated' ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
        <Sparkles className="h-3 w-3" /> Geração assistida
      </button>
    </div>
  );

  if (view === 'generated') {
    return (
      <div className="space-y-4">
        {subTabs}
        <SuperAdminGeneratedWorkers />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {subTabs}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Ativos</p>
          <p className="text-2xl font-bold text-green-400">{activeWorkers.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Esgotados</p>
          <p className="text-2xl font-bold text-red-400">{exhaustedWorkers.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><MessageSquare className="h-3 w-3"/>Chat</p>
          <p className="text-2xl font-bold text-foreground">{counts.chat}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="h-3 w-3"/>TXT</p>
          <p className="text-2xl font-bold text-foreground">{counts.txt}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Image className="h-3 w-3"/>Imagem</p>
          <p className="text-2xl font-bold text-foreground">{counts.image}</p>
        </div>
      </div>

      {/* Bulk Import */}
      <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
            <Upload className="h-4 w-4" /> Importar em massa (TXT)
          </h3>
          <label className="cursor-pointer text-xs text-primary hover:underline">
            <input type="file" accept=".txt,text/plain" className="hidden" onChange={e => e.target.files?.[0] && onFileUpload(e.target.files[0])} />
            Carregar arquivo .txt
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Cole o conteúdo do TXT ou faça upload. O sistema detecta automaticamente o tipo (Chat / TXT / Imagem) pela palavra-chave na linha e enumera ("Chat 6", "Imagem 2"...).
        </p>
        <Textarea
          value={bulkText}
          onChange={e => setBulkText(e.target.value)}
          placeholder={`IA Chat: https://xxx.lovable.app/functions/v1/ai-chat\nIA TXT: https://xxx.lovable.app/functions/v1/ai-parse-txt\nIA Imagem: https://xxx.lovable.app/functions/v1/ai-generate-image`}
          rows={5}
          className="font-mono text-xs"
        />
        {preview.length > 0 && (
          <div className="rounded-md bg-secondary/50 p-2 space-y-1 max-h-40 overflow-y-auto">
            <p className="text-xs font-medium text-foreground">Preview ({preview.length} URL{preview.length > 1 ? 's' : ''} detectada{preview.length > 1 ? 's' : ''}):</p>
            {preview.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                  {TYPE_ICON[p.type]} {TYPE_LABEL[p.type]}
                </span>
                <span className="text-muted-foreground truncate flex-1">{p.url}</span>
              </div>
            ))}
          </div>
        )}
        <Button
          size="sm"
          onClick={() => bulkImport.mutate(bulkText)}
          disabled={bulkImport.isPending || !bulkText.trim()}
          className="w-full"
        >
          <Upload className="h-4 w-4 mr-1" />
          {bulkImport.isPending ? 'Importando...' : `Importar ${preview.length} worker(s)`}
        </Button>
      </div>

      {/* Add Manual */}
      <div className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h3 className="font-heading text-sm text-foreground">Adicionar Worker manualmente</h3>
        <div className="grid grid-cols-3 gap-2">
          {(['chat', 'txt', 'image'] as WorkerType[]).map(t => (
            <button
              key={t}
              onClick={() => setNewType(t)}
              className={`flex items-center justify-center gap-1 rounded-md py-2 text-xs font-medium transition ${
                newType === t ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {TYPE_ICON[t]} {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder={`Nome (auto: ${TYPE_LABEL[newType]} ${countByType(newType) + 1})`} />
        <div className="flex gap-2">
          <Input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://xxx.lovable.app/functions/v1/ai-chat" className="flex-1" />
          <Button
            size="sm"
            onClick={() => newUrl.trim() && addWorker.mutate({
              name: newName || `${TYPE_LABEL[newType]} ${countByType(newType) + 1}`,
              base_url: newUrl.trim(),
              worker_type: newType,
            })}
            disabled={addWorker.isPending}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => resetAll.mutate()} disabled={resetAll.isPending}>
          <RefreshCw className="h-4 w-4 mr-1" /> Resetar Esgotados
        </Button>
        <Button size="sm" variant="outline" onClick={exportTxt}>
          <Download className="h-4 w-4 mr-1" /> Exportar TXT
        </Button>
      </div>


      <div className="space-y-2">
        <h3 className="font-heading text-sm text-foreground">Workers ({workers.length})</h3>
        {workers.map((w: any) => {
          const type: WorkerType = (w.worker_type || 'chat') as WorkerType;
          return (
            <div key={w.id} className={`flex items-center justify-between rounded-lg p-3 text-sm ${w.is_exhausted ? 'bg-red-500/10 border border-red-500/30' : w.is_active ? 'bg-secondary' : 'bg-secondary/50 opacity-60'}`}>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Bot className={`h-4 w-4 flex-shrink-0 ${w.is_exhausted ? 'text-red-400' : w.is_active ? 'text-green-400' : 'text-muted-foreground'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-xs font-medium text-foreground truncate">{w.name || 'Worker'}</span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[10px]">
                      {TYPE_ICON[type]} {TYPE_LABEL[type]}
                    </span>
                    {w.source === 'generated' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px]" title="Promovido pelo pipeline de geração">
                        <Sparkles className="h-2.5 w-2.5" /> Gerado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary text-muted-foreground text-[10px]" title="Worker original">
                        Legado
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground block truncate">{w.base_url}</span>
                  <p className="text-xs text-muted-foreground">
                    {w.is_exhausted ? '🔴 Esgotado' : w.is_active ? '🟢 Ativo' : '⚪ Desativado'}
                    {w.last_used_at && ` · ${new Date(w.last_used_at).toLocaleDateString('pt-BR')}`}
                  </p>
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Button size="sm" variant="ghost" onClick={() => toggleWorker.mutate({ id: w.id, is_active: !w.is_active })}>
                  {w.is_active ? '⏸' : '▶'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deleteWorker.mutate(w.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          );
        })}
        {workers.length === 0 && <p className="text-center text-muted-foreground py-4">Nenhum worker cadastrado.</p>}
      </div>
    </div>
  );
};

export default SuperAdminWorkers;
