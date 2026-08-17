import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Save, MapPin, Search, Phone, Crosshair, Loader2, FileText, Target, MessageCircle, CheckCircle2, Flame, TrendingUp, AlertTriangle, Bot, Send, Pencil, Copy, Sparkles, X, Bell, BrainCircuit, Clock } from 'lucide-react';
import { toast } from 'sonner';

type ConvMsg = { from: 'me' | 'lead'; text: string; at: string };
type ProspectTag = {
  id: string;
  label: string;
  color: 'red' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';
  kind: 'auto' | 'manual';
  meta?: any;
  created_at?: string;
};
type Prospect = {
  id: string;
  street_name: string;
  store_name: string;
  has_contact: boolean;
  contact_phone: string;
  status: string;
  message_sent: boolean;
  responded: boolean;
  outcome: string;
  chosen_plan: string;
  liked_point: string;
  refusal_reason: string;
  notes: string;
  visited_at: string;
  manual_intel?: string;
  pasted_history?: string;
  conversation_log?: ConvMsg[];
  ai_draft?: string;
  ai_review_notes?: string;
  tags?: ProspectTag[];
  reminder_at?: string | null;
  suggested_next_message?: string | null;
  last_analysis_at?: string | null;
};

const TAG_COLORS: Record<ProspectTag['color'], string> = {
  red: 'bg-red-500/15 border-red-500/40 text-red-300',
  yellow: 'bg-yellow-500/15 border-yellow-500/40 text-yellow-300',
  green: 'bg-green-500/15 border-green-500/40 text-green-300',
  blue: 'bg-blue-500/15 border-blue-500/40 text-blue-300',
  purple: 'bg-purple-500/15 border-purple-500/40 text-purple-300',
  gray: 'bg-muted border-border text-muted-foreground',
};
const TAG_COLOR_KEYS: ProspectTag['color'][] = ['red', 'yellow', 'green', 'blue', 'purple', 'gray'];

const STATUS_OPTIONS = [
  { value: 'not_contacted', label: 'Não contatado', color: 'bg-muted text-muted-foreground' },
  { value: 'message_sent_no_reply', label: 'Mensagem enviada — sem resposta', color: 'bg-yellow-500/20 text-yellow-300' },
  { value: 'message_sent_replied', label: 'Mensagem enviada — respondeu', color: 'bg-blue-500/20 text-blue-300' },
  { value: 'accepted', label: 'Aceitou', color: 'bg-green-500/20 text-green-300' },
  { value: 'refused', label: 'Recusou', color: 'bg-red-500/20 text-red-300' },
  { value: 'success', label: 'Deu certo', color: 'bg-emerald-500/20 text-emerald-300' },
  { value: 'failed', label: 'Deu errado', color: 'bg-rose-500/20 text-rose-300' },
];

const PLAN_OPTIONS = [
  { value: '', label: '—' },
  { value: 'per_order', label: '% por pedido' },
  { value: 'monthly_fixed', label: 'Mensalidade fixa' },
];

const emptyDraft = (): Partial<Prospect> => ({
  street_name: '',
  store_name: '',
  has_contact: false,
  contact_phone: '',
  status: 'not_contacted',
  chosen_plan: '',
  liked_point: '',
  refusal_reason: '',
  notes: '',
});

const SuperAdminProspecting = () => {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Partial<Prospect>>(emptyDraft());
  const [filterStreet, setFilterStreet] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [locating, setLocating] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});
  const [instructionDraft, setInstructionDraft] = useState<Record<string, string>>({});
  const [newTagLabel, setNewTagLabel] = useState<Record<string, string>>({});
  const [newTagColor, setNewTagColor] = useState<Record<string, ProspectTag['color']>>({});

  const detectStreet = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocalização não suportada neste dispositivo');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
            { headers: { 'Accept-Language': 'pt-BR' } }
          );
          const data = await res.json();
          const a = data.address || {};
          const street = a.road || a.pedestrian || a.cycleway || a.footway || a.path || '';
          if (street) {
            setDraft(d => ({ ...d, street_name: street }));
            toast.success(`Rua detectada: ${street}`);
          } else {
            toast.error('Não consegui detectar o nome da rua. Edite manualmente.');
          }
        } catch {
          toast.error('Erro ao buscar endereço');
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        toast.error(err.code === 1 ? 'Permissão de localização negada' : 'Não consegui obter sua localização');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const { data: prospects = [], isLoading } = useQuery({
    queryKey: ['street-prospects'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('street_prospects')
        .select('*')
        .order('street_name', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as Prospect[];
    },
  });

  const create = useMutation({
    mutationFn: async (payload: Partial<Prospect>) => {
      const { error } = await (supabase as any).from('street_prospects').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Loja adicionada');
      setDraft(emptyDraft());
      qc.invalidateQueries({ queryKey: ['street-prospects'] });
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao salvar'),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Prospect> }) => {
      const { error } = await (supabase as any).from('street_prospects').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['street-prospects'] }),
    onError: (e: any) => toast.error(e.message || 'Erro ao atualizar'),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('street_prospects').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Removido');
      qc.invalidateQueries({ queryKey: ['street-prospects'] });
    },
  });

  const generateAI = async (p: Prospect) => {
    setGenerating(g => ({ ...g, [p.id]: true }));
    try {
      const { data, error } = await supabase.functions.invoke('street-prospect-message', {
        body: { prospect_id: p.id, instruction: instructionDraft[p.id] || undefined },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('Rascunho gerado pela IA');
      qc.invalidateQueries({ queryKey: ['street-prospects'] });
    } catch (e: any) {
      toast.error(e.message || 'Erro ao gerar mensagem');
    } finally {
      setGenerating(g => ({ ...g, [p.id]: false }));
    }
  };

  const analyzeAI = async (p: Prospect) => {
    setAnalyzing(g => ({ ...g, [p.id]: true }));
    try {
      const { data, error } = await supabase.functions.invoke('street-prospect-analyze', {
        body: { prospect_id: p.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('Conversa analisada');
      qc.invalidateQueries({ queryKey: ['street-prospects'] });
    } catch (e: any) {
      toast.error(e.message || 'Erro ao analisar');
    } finally {
      setAnalyzing(g => ({ ...g, [p.id]: false }));
    }
  };

  const addTag = async (p: Prospect) => {
    const label = (newTagLabel[p.id] || '').trim();
    if (!label) { toast.error('Digite o texto do marcador'); return; }
    const color = newTagColor[p.id] || 'blue';
    const tags: ProspectTag[] = Array.isArray(p.tags) ? [...p.tags] : [];
    tags.push({
      id: crypto.randomUUID(),
      label: label.slice(0, 50),
      color,
      kind: 'manual',
      created_at: new Date().toISOString(),
    });
    setNewTagLabel(s => ({ ...s, [p.id]: '' }));
    try {
      const { error } = await (supabase as any).from('street_prospects').update({ tags }).eq('id', p.id);
      if (error) throw error;
      toast.success('Marcador adicionado');
      qc.invalidateQueries({ queryKey: ['street-prospects'] });
    } catch (e: any) {
      console.error('[addTag] erro:', e);
      toast.error(e.message || 'Erro ao salvar marcador');
    }
  };

  const removeTag = (p: Prospect, tagId: string) => {
    const tags = (Array.isArray(p.tags) ? p.tags : []).filter(t => t.id !== tagId);
    update.mutate({ id: p.id, patch: { tags } as any });
  };

  const logSent = async (p: Prospect, text: string) => {
    const log: ConvMsg[] = Array.isArray(p.conversation_log) ? [...p.conversation_log] : [];
    log.push({ from: 'me', text, at: new Date().toISOString() });
    await (supabase as any).from('street_prospects').update({
      conversation_log: log,
      ai_draft: '',
      message_sent: true,
      status: p.status === 'not_contacted' ? 'message_sent_no_reply' : p.status,
    }).eq('id', p.id);
    qc.invalidateQueries({ queryKey: ['street-prospects'] });
  };

  const addLeadReply = async (p: Prospect, text: string) => {
    if (!text.trim()) return;
    const log: ConvMsg[] = Array.isArray(p.conversation_log) ? [...p.conversation_log] : [];
    log.push({ from: 'lead', text: text.trim(), at: new Date().toISOString() });
    await (supabase as any).from('street_prospects').update({
      conversation_log: log,
      status: p.status === 'message_sent_no_reply' ? 'message_sent_replied' : p.status,
    }).eq('id', p.id);
    qc.invalidateQueries({ queryKey: ['street-prospects'] });
  };

  const openWA = (phone: string, text?: string) => {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) { toast.error('Sem telefone cadastrado'); return null; }
    const num = digits.length === 11 ? '55' + digits : digits;
    const url = `https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
    window.open(url, '_blank');
    return url;
  };


  const streets = useMemo(() => {
    const set = new Set(prospects.map(p => p.street_name).filter(Boolean));
    return Array.from(set).sort();
  }, [prospects]);

  const filtered = useMemo(() => {
    return prospects.filter(p => {
      if (filterStreet && !p.street_name.toLowerCase().includes(filterStreet.toLowerCase())) return false;
      if (filterStatus !== 'all' && p.status !== filterStatus) return false;
      return true;
    });
  }, [prospects, filterStreet, filterStatus]);

  const grouped = useMemo(() => {
    const map = new Map<string, Prospect[]>();
    filtered.forEach(p => {
      const k = p.street_name || '(sem rua)';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const stats = useMemo(() => {
    const s: Record<string, number> = {};
    prospects.forEach(p => { s[p.status] = (s[p.status] || 0) + 1; });
    const total = prospects.length;
    const notContacted = s.not_contacted || 0;
    const noReply = s.message_sent_no_reply || 0;
    const replied = s.message_sent_replied || 0;
    const accepted = (s.accepted || 0) + (s.success || 0);
    const refused = (s.refused || 0) + (s.failed || 0);
    const contacted = total - notContacted;
    const conversion = contacted > 0 ? Math.round((accepted / contacted) * 100) : 0;
    const acceptanceOfReplied = (replied + accepted + refused) > 0
      ? Math.round((accepted / (replied + accepted + refused)) * 100) : 0;
    return { byStatus: s, total, notContacted, noReply, replied, accepted, refused, contacted, conversion, acceptanceOfReplied };
  }, [prospects]);

  // Plano de ação de hoje: ruas com mais "não contatado" + leads "sem resposta" pra refollow
  const actionPlan = useMemo(() => {
    const byStreet = new Map<string, { street: string; cold: number; followups: number }>();
    prospects.forEach(p => {
      const k = p.street_name || '(sem rua)';
      const cur = byStreet.get(k) || { street: k, cold: 0, followups: 0 };
      if (p.status === 'not_contacted') cur.cold += 1;
      if (p.status === 'message_sent_no_reply') cur.followups += 1;
      byStreet.set(k, cur);
    });
    const topCold = Array.from(byStreet.values())
      .filter(s => s.cold > 0)
      .sort((a, b) => b.cold - a.cold)
      .slice(0, 3);
    const followups = prospects.filter(p => p.status === 'message_sent_no_reply').slice(0, 5);
    return { topCold, followups };
  }, [prospects]);

  // Lembretes/pendências baseados em tags da IA + reminder_at
  const reminders = useMemo(() => {
    const now = Date.now();
    const due = prospects.filter(p => p.reminder_at && new Date(p.reminder_at).getTime() <= now + 6 * 60 * 60 * 1000);
    const upcoming = prospects.filter(p => p.reminder_at && new Date(p.reminder_at).getTime() > now + 6 * 60 * 60 * 1000)
      .sort((a, b) => new Date(a.reminder_at!).getTime() - new Date(b.reminder_at!).getTime())
      .slice(0, 5);
    const flagged = prospects.filter(p =>
      Array.isArray(p.tags) && p.tags.some(t =>
        t.kind === 'manual' || t.color === 'red' || t.color === 'yellow' || t.color === 'purple'
      )
    ).slice(0, 12);
    return { due, upcoming, flagged };
  }, [prospects]);

  const handleAdd = () => {
    if (!draft.street_name || !draft.store_name) {
      toast.error('Informe rua e nome da loja');
      return;
    }
    create.mutate(draft);
  };

  const buildReport = () => {
    const statusLabel = (v: string) => STATUS_OPTIONS.find(s => s.value === v)?.label || v;
    const planLabel = (v: string) => PLAN_OPTIONS.find(p => p.value === v)?.label || '—';
    const lines: string[] = [];
    lines.push(`RELATÓRIO DE PROSPECÇÃO — ${new Date().toLocaleString('pt-BR')}`);
    lines.push(`Total: ${prospects.length} | Aceitou: ${stats.accepted} | Recusou: ${stats.refused} | A contatar: ${stats.notContacted} | Sem resposta: ${stats.noReply} | Conversão: ${stats.conversion}% | Ruas: ${streets.length}`);
    lines.push('');
    grouped.forEach(([street, items]) => {
      lines.push(`━━━ ${street} (${items.length}) ━━━`);
      items.forEach((p, i) => {
        lines.push(`${i + 1}. ${p.store_name}`);
        lines.push(`   Status: ${statusLabel(p.status)}`);
        if (p.contact_phone) lines.push(`   Telefone: ${p.contact_phone}`);
        if (p.chosen_plan) lines.push(`   Modelo escolhido: ${planLabel(p.chosen_plan)}`);
        if (p.liked_point) lines.push(`   O que gostou: ${p.liked_point}`);
        if (p.refusal_reason) lines.push(`   Motivo recusa: ${p.refusal_reason}`);
        if (p.notes) lines.push(`   Obs: ${p.notes}`);
        lines.push('');
      });
    });
    return lines.join('\n');
  };

  const copyReport = async () => {
    const text = buildReport();
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Relatório copiado!');
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast.success('Relatório copiado!');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-lg text-foreground">Mapeamento</h2>
        <button
          onClick={copyReport}
          disabled={prospects.length === 0}
          className="flex items-center gap-2 rounded-lg bg-primary/15 hover:bg-primary/25 border border-primary/30 px-3 py-2 text-sm font-medium text-primary disabled:opacity-50"
        >
          <FileText className="h-4 w-4" /> Relatório
        </button>
      </div>

      {/* KPIs principais — primeiro o que precisa AÇÃO */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          onClick={() => setFilterStatus('not_contacted')}
          className={`text-left rounded-lg border p-3 transition-all hover:scale-[1.02] ${
            stats.notContacted > 0 ? 'border-orange-500/50 bg-orange-500/10 ring-1 ring-orange-500/20' : 'border-border bg-card'
          }`}
        >
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Flame className="h-3 w-3" /> A contatar
          </p>
          <p className={`text-2xl font-heading ${stats.notContacted > 0 ? 'text-orange-300' : 'text-foreground'}`}>{stats.notContacted}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">clique pra filtrar</p>
        </button>

        <button
          onClick={() => setFilterStatus('message_sent_no_reply')}
          className={`text-left rounded-lg border p-3 transition-all hover:scale-[1.02] ${
            stats.noReply > 0 ? 'border-yellow-500/50 bg-yellow-500/10' : 'border-border bg-card'
          }`}
        >
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Sem resposta
          </p>
          <p className={`text-2xl font-heading ${stats.noReply > 0 ? 'text-yellow-300' : 'text-foreground'}`}>{stats.noReply}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">re-bater amanhã</p>
        </button>

        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Fechados
          </p>
          <p className="text-2xl font-heading text-green-400">{stats.accepted}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{stats.refused} recusaram</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <TrendingUp className="h-3 w-3" /> Conversão
          </p>
          <p className="text-2xl font-heading text-primary">{stats.conversion}%</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {stats.total} mapeados · {streets.length} ruas
          </p>
        </div>
      </div>

      {/* Plano de ação de hoje */}
      {(actionPlan.topCold.length > 0 || actionPlan.followups.length > 0) && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
          <h3 className="font-heading text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" /> Plano de ação de hoje
          </h3>

          {actionPlan.topCold.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-orange-300 flex items-center gap-1">
                <Flame className="h-3 w-3" /> Prioridade — ruas com mais leads frios
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {actionPlan.topCold.map(s => (
                  <button
                    key={s.street}
                    onClick={() => { setFilterStreet(s.street); setFilterStatus('not_contacted'); }}
                    className="text-left rounded-md bg-card border border-border hover:border-primary/50 px-3 py-2 transition-all"
                  >
                    <p className="text-sm text-foreground truncate">{s.street}</p>
                    <p className="text-xs text-orange-300">{s.cold} pra contatar</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {actionPlan.followups.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-yellow-300 flex items-center gap-1">
                <MessageCircle className="h-3 w-3" /> Re-bater (mensagem sem resposta)
              </p>
              <div className="space-y-1">
                {actionPlan.followups.map(p => {
                  const phone = p.contact_phone?.replace(/\D/g, '');
                  const wa = phone ? `https://wa.me/${phone.length === 11 ? '55' + phone : phone}` : null;
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-card border border-border px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground truncate">{p.store_name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{p.street_name}{p.contact_phone ? ` · ${p.contact_phone}` : ''}</p>
                      </div>
                      {wa && (
                        <a href={wa} target="_blank" rel="noreferrer"
                          className="shrink-0 flex items-center gap-1 rounded-md bg-green-500/15 border border-green-500/30 text-green-300 px-2 py-1 text-xs hover:bg-green-500/25">
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lembretes & pendências (IA) */}
      {(reminders.due.length > 0 || reminders.upcoming.length > 0 || reminders.flagged.length > 0) && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-4 space-y-3">
          <h3 className="font-heading text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-purple-300" /> Lembretes & pendências
          </h3>

          {reminders.due.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-red-300 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Pra chamar AGORA
              </p>
              <div className="space-y-1">
                {reminders.due.map(p => {
                  const phone = p.contact_phone?.replace(/\D/g, '');
                  const wa = phone ? `https://wa.me/${phone.length === 11 ? '55' + phone : phone}${p.suggested_next_message ? `?text=${encodeURIComponent(p.suggested_next_message)}` : ''}` : null;
                  return (
                    <div key={p.id} className="rounded-md bg-card border border-red-500/30 px-3 py-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">{p.store_name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            <Clock className="inline h-3 w-3" /> {new Date(p.reminder_at!).toLocaleString('pt-BR')}
                          </p>
                        </div>
                        {wa && (
                          <a href={wa} target="_blank" rel="noreferrer"
                            className="shrink-0 flex items-center gap-1 rounded-md bg-green-500/15 border border-green-500/30 text-green-300 px-2 py-1 text-xs hover:bg-green-500/25">
                            <MessageCircle className="h-3 w-3" /> Chamar
                          </a>
                        )}
                      </div>
                      {p.suggested_next_message && (
                        <p className="text-xs text-foreground/80 italic line-clamp-2">💬 {p.suggested_next_message}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {reminders.upcoming.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-purple-300">Agenda</p>
              <div className="space-y-1">
                {reminders.upcoming.map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-card border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{p.store_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        <Clock className="inline h-3 w-3" /> {new Date(p.reminder_at!).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {reminders.flagged.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-yellow-300">Marcadores ativos</p>
              <div className="flex flex-wrap gap-1.5">
                {reminders.flagged.map(p => (
                  <div key={p.id} className="rounded-md bg-card border border-border px-2 py-1 text-xs">
                    <span className="text-foreground">{p.store_name}</span>
                    {(p.tags || []).slice(0, 3).map(t => (
                      <span key={t.id} className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] border ${TAG_COLORS[t.color] || TAG_COLORS.gray}`}>{t.label}</span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Adicionar */}

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="font-heading text-lg flex items-center gap-2"><Plus className="h-5 w-5 text-primary" /> Adicionar loja</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="flex gap-2">
            <input
              list="streets-list"
              placeholder="Rua *"
              value={draft.street_name || ''}
              onChange={(e) => setDraft({ ...draft, street_name: e.target.value })}
              className="flex-1 rounded-lg bg-secondary border border-border px-3 py-2 text-sm text-foreground"
            />
            <button
              type="button"
              onClick={detectStreet}
              disabled={locating}
              title="Detectar rua pela minha localização"
              className="shrink-0 rounded-lg bg-primary/15 hover:bg-primary/25 border border-primary/30 px-3 text-primary flex items-center justify-center"
            >
              {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
            </button>
          </div>
          <datalist id="streets-list">
            {streets.map(s => <option key={s} value={s} />)}
          </datalist>
          <input
            placeholder="Nome da loja *"
            value={draft.store_name || ''}
            onChange={(e) => setDraft({ ...draft, store_name: e.target.value })}
            className="rounded-lg bg-secondary border border-border px-3 py-2 text-sm text-foreground"
          />
          <input
            placeholder="Telefone / contato"
            value={draft.contact_phone || ''}
            onChange={(e) => setDraft({ ...draft, contact_phone: e.target.value, has_contact: !!e.target.value })}
            className="rounded-lg bg-secondary border border-border px-3 py-2 text-sm text-foreground"
          />
          <select
            value={draft.status || 'not_contacted'}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            className="rounded-lg bg-secondary border border-border px-3 py-2 text-sm text-foreground"
          >
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <textarea
            placeholder="Observações"
            value={draft.notes || ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            className="md:col-span-2 rounded-lg bg-secondary border border-border px-3 py-2 text-sm text-foreground min-h-[60px]"
          />
        </div>
        <button onClick={handleAdd} disabled={create.isPending}
          className="w-full md:w-auto gradient-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium flex items-center justify-center gap-2">
          <Save className="h-4 w-4" /> Salvar loja
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            placeholder="Filtrar por rua..."
            value={filterStreet}
            onChange={(e) => setFilterStreet(e.target.value)}
            className="w-full rounded-lg bg-secondary border border-border pl-10 pr-3 py-2 text-sm text-foreground"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg bg-secondary border border-border px-3 py-2 text-sm text-foreground"
        >
          <option value="all">Todos os status</option>
          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Lista agrupada por rua */}
      {isLoading && <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}

      {!isLoading && grouped.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-8">Nenhuma loja mapeada ainda. Comece adicionando acima.</p>
      )}

      {grouped.map(([street, items]) => (
        <div key={street} className="space-y-2">
          <h3 className="font-heading text-base text-foreground flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" /> {street}
            <span className="text-xs text-muted-foreground font-sans">({items.length})</span>
          </h3>
          {items.map(p => {
            const isAccepted = p.status === 'accepted' || p.status === 'success';
            const isRefused = p.status === 'refused' || p.status === 'failed';
            const statusOpt = STATUS_OPTIONS.find(s => s.value === p.status);
            const borderAccent =
              p.status === 'not_contacted' ? 'border-l-4 border-l-orange-500' :
              p.status === 'message_sent_no_reply' ? 'border-l-4 border-l-yellow-500' :
              p.status === 'message_sent_replied' ? 'border-l-4 border-l-blue-500' :
              isAccepted ? 'border-l-4 border-l-green-500' :
              isRefused ? 'border-l-4 border-l-red-500' : '';
            const phoneDigits = p.contact_phone?.replace(/\D/g, '') || '';
            const waUrl = phoneDigits ? `https://wa.me/${phoneDigits.length === 11 ? '55' + phoneDigits : phoneDigits}` : null;
            const isEditing = !!editing[p.id];
            const isOpen = !!expanded[p.id];
            const isGen = !!generating[p.id];
            const convLog: ConvMsg[] = Array.isArray(p.conversation_log) ? p.conversation_log : [];
            return (
              <div key={p.id} className={`rounded-lg border border-border bg-card p-3 space-y-2 ${borderAccent}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    {isEditing ? (
                      <>
                        <input
                          defaultValue={p.store_name}
                          onBlur={(e) => e.target.value !== p.store_name && update.mutate({ id: p.id, patch: { store_name: e.target.value } })}
                          className="w-full rounded-md bg-secondary border border-border px-2 py-1 text-sm font-medium text-foreground"
                          placeholder="Nome da loja"
                        />
                        <input
                          defaultValue={p.street_name}
                          onBlur={(e) => e.target.value !== p.street_name && update.mutate({ id: p.id, patch: { street_name: e.target.value } })}
                          className="w-full rounded-md bg-secondary border border-border px-2 py-1 text-xs text-foreground"
                          placeholder="Rua"
                        />
                        <input
                          defaultValue={p.contact_phone}
                          onBlur={(e) => e.target.value !== p.contact_phone && update.mutate({ id: p.id, patch: { contact_phone: e.target.value, has_contact: !!e.target.value } })}
                          className="w-full rounded-md bg-secondary border border-border px-2 py-1 text-xs text-foreground"
                          placeholder="Telefone"
                        />
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-foreground">{p.store_name}</p>
                        {p.contact_phone && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {p.contact_phone}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditing(s => ({ ...s, [p.id]: !s[p.id] }))}
                      title="Editar dados"
                      className={`rounded-md border p-1.5 ${isEditing ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-secondary border-border text-muted-foreground hover:text-foreground'}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setExpanded(s => ({ ...s, [p.id]: !s[p.id] }))}
                      title="Perfil & IA"
                      className={`rounded-md border p-1.5 ${isOpen ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-secondary border-border text-muted-foreground hover:text-foreground'}`}
                    >
                      <Bot className="h-3.5 w-3.5" />
                    </button>
                    {waUrl && (
                      <a href={waUrl} target="_blank" rel="noreferrer"
                        title="Abrir no WhatsApp"
                        className="rounded-md bg-green-500/15 border border-green-500/30 text-green-300 p-1.5 hover:bg-green-500/25">
                        <MessageCircle className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <button onClick={() => remove.mutate(p.id)} className="text-red-400 hover:text-red-300 p-1.5">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <select
                  value={p.status}
                  onChange={(e) => update.mutate({ id: p.id, patch: { status: e.target.value } })}
                  className={`w-full rounded-md border border-border px-2 py-1.5 text-xs font-medium ${statusOpt?.color || ''}`}
                >
                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value} className="bg-card text-foreground">{s.label}</option>)}
                </select>

                {/* Tags / marcadores */}
                {(Array.isArray(p.tags) && p.tags.length > 0) && (
                  <div className="flex flex-wrap gap-1">
                    {p.tags.map(t => (
                      <span
                        key={t.id}
                        className={`group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${TAG_COLORS[t.color] || TAG_COLORS.gray}`}
                        title={t.kind === 'auto' ? 'Marcador gerado pela IA' : 'Marcador manual'}
                      >
                        {t.kind === 'auto' && <Sparkles className="h-2.5 w-2.5" />}
                        {t.label}
                        <button
                          onClick={() => removeTag(p, t.id)}
                          className="opacity-60 hover:opacity-100"
                          title="Remover marcador"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Sugestão da IA (sempre visível se houver) */}
                {p.suggested_next_message && (
                  <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2 space-y-1">
                    <p className="text-[10px] font-medium text-purple-300 flex items-center gap-1">
                      <BrainCircuit className="h-3 w-3" /> Sugestão da IA pra próxima mensagem
                    </p>
                    <p className="text-xs text-foreground/90 whitespace-pre-wrap">{p.suggested_next_message}</p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <button
                        onClick={() => {
                          const url = openWA(p.contact_phone, p.suggested_next_message!);
                          if (url) logSent(p, p.suggested_next_message!);
                        }}
                        className="flex items-center gap-1 rounded-md bg-green-500/15 hover:bg-green-500/25 border border-green-500/30 text-green-300 px-2 py-1 text-[11px]"
                      >
                        <Send className="h-3 w-3" /> Usar agora
                      </button>
                      <button
                        onClick={async () => { await navigator.clipboard.writeText(p.suggested_next_message!); toast.success('Copiado'); }}
                        className="flex items-center gap-1 rounded-md bg-secondary border border-border text-foreground px-2 py-1 text-[11px]"
                      >
                        <Copy className="h-3 w-3" /> Copiar
                      </button>
                      <button
                        onClick={() => update.mutate({ id: p.id, patch: { suggested_next_message: null } as any })}
                        className="text-[11px] text-muted-foreground hover:text-foreground px-1"
                      >
                        Descartar
                      </button>
                    </div>
                  </div>
                )}


                {isAccepted && (
                  <div className="space-y-2 pt-1">
                    <select
                      value={p.chosen_plan || ''}
                      onChange={(e) => update.mutate({ id: p.id, patch: { chosen_plan: e.target.value } })}
                      className="w-full rounded-md bg-secondary border border-border px-2 py-1.5 text-xs text-foreground"
                    >
                      {PLAN_OPTIONS.map(o => <option key={o.value} value={o.value}>Modelo: {o.label}</option>)}
                    </select>
                    <textarea
                      placeholder="O que mais gostou / interessou?"
                      defaultValue={p.liked_point}
                      onBlur={(e) => e.target.value !== p.liked_point && update.mutate({ id: p.id, patch: { liked_point: e.target.value } })}
                      className="w-full rounded-md bg-secondary border border-border px-2 py-1.5 text-xs text-foreground min-h-[50px]"
                    />
                  </div>
                )}

                {isRefused && (
                  <textarea
                    placeholder="Motivo da recusa"
                    defaultValue={p.refusal_reason}
                    onBlur={(e) => e.target.value !== p.refusal_reason && update.mutate({ id: p.id, patch: { refusal_reason: e.target.value } })}
                    className="w-full rounded-md bg-secondary border border-border px-2 py-1.5 text-xs text-foreground min-h-[50px]"
                  />
                )}

                <textarea
                  placeholder="Observações"
                  defaultValue={p.notes}
                  onBlur={(e) => e.target.value !== p.notes && update.mutate({ id: p.id, patch: { notes: e.target.value } })}
                  className="w-full rounded-md bg-secondary border border-border px-2 py-1.5 text-xs text-muted-foreground min-h-[40px]"
                />

                {isOpen && (
                  <div className="space-y-3 rounded-md border border-primary/20 bg-primary/5 p-3">
                    {/* Analisar conversa + lembrete + tag manual */}
                    <div className="space-y-2 rounded-md border border-purple-500/30 bg-purple-500/5 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium text-purple-300 flex items-center gap-1">
                          <BrainCircuit className="h-3 w-3" /> Análise inteligente
                        </p>
                        <button
                          onClick={() => analyzeAI(p)}
                          disabled={!!analyzing[p.id]}
                          className="flex items-center gap-1 rounded-md bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 px-2 py-1 text-[11px] disabled:opacity-50"
                        >
                          {analyzing[p.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <BrainCircuit className="h-3 w-3" />}
                          {p.last_analysis_at ? 'Reanalisar conversa' : 'Analisar conversa com IA'}
                        </button>
                      </div>
                      {p.last_analysis_at && (
                        <p className="text-[10px] text-muted-foreground">
                          Última análise: {new Date(p.last_analysis_at).toLocaleString('pt-BR')}
                        </p>
                      )}
                      <div className="space-y-1">
                        <label className="text-[10px] text-muted-foreground">Lembrete (data/hora)</label>
                        <input
                          type="datetime-local"
                          value={p.reminder_at ? new Date(p.reminder_at).toISOString().slice(0, 16) : ''}
                          onChange={(e) => {
                            const v = e.target.value ? new Date(e.target.value).toISOString() : null;
                            update.mutate({ id: p.id, patch: { reminder_at: v } as any });
                          }}
                          className="w-full rounded-md bg-secondary border border-border px-2 py-1 text-xs text-foreground"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-muted-foreground">Adicionar marcador manual</label>
                        <div className="flex gap-1">
                          <input
                            value={newTagLabel[p.id] || ''}
                            onChange={(e) => setNewTagLabel(s => ({ ...s, [p.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') addTag(p); }}
                            placeholder="Ex.: Quer demo na sexta"
                            className="flex-1 rounded-md bg-secondary border border-border px-2 py-1 text-xs text-foreground"
                          />
                          <select
                            value={newTagColor[p.id] || 'blue'}
                            onChange={(e) => setNewTagColor(s => ({ ...s, [p.id]: e.target.value as ProspectTag['color'] }))}
                            className="rounded-md bg-secondary border border-border px-1 py-1 text-xs text-foreground"
                          >
                            {TAG_COLOR_KEYS.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <button type="button" onClick={() => addTag(p)} className="rounded-md bg-primary/20 border border-primary/40 text-primary px-2 text-xs">+</button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-primary flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Perfil — o que eu sei sobre esse lojista
                      </label>
                      <textarea
                        defaultValue={p.manual_intel || ''}
                        onBlur={(e) => e.target.value !== (p.manual_intel || '') && update.mutate({ id: p.id, patch: { manual_intel: e.target.value } as any })}
                        placeholder="Ex.: ele já me disse que sofre com taxa do iFood, prefere falar à tarde, é dono direto..."
                        className="mt-1 w-full rounded-md bg-secondary border border-border px-2 py-1.5 text-xs text-foreground min-h-[60px]"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-primary">Histórico colado de WhatsApp (cole conversas antigas pra IA contextualizar)</label>
                      <textarea
                        defaultValue={p.pasted_history || ''}
                        onBlur={(e) => e.target.value !== (p.pasted_history || '') && update.mutate({ id: p.id, patch: { pasted_history: e.target.value } as any })}
                        placeholder="[14/5 20:47] Hr: Oi&#10;[14/5 20:50] Loja: oii tudo bem..."
                        className="mt-1 w-full rounded-md bg-secondary border border-border px-2 py-1.5 text-xs text-foreground min-h-[90px] font-mono"
                      />
                    </div>

                    {convLog.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[11px] font-medium text-muted-foreground">Conversa registrada no sistema:</p>
                        <div className="space-y-1 max-h-40 overflow-y-auto rounded-md bg-background/50 p-2">
                          {convLog.map((m, i) => (
                            <div key={i} className={`text-xs ${m.from === 'me' ? 'text-primary' : 'text-foreground'}`}>
                              <span className="font-medium">{m.from === 'me' ? 'Eu' : 'Lead'}:</span> {m.text}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-[11px] font-medium text-primary">Instrução pra IA (opcional)</label>
                      <input
                        value={instructionDraft[p.id] || ''}
                        onChange={(e) => setInstructionDraft(s => ({ ...s, [p.id]: e.target.value }))}
                        placeholder="Ex.: foca em fidelidade / responde a objeção de preço"
                        className="mt-1 w-full rounded-md bg-secondary border border-border px-2 py-1.5 text-xs text-foreground"
                      />
                    </div>

                    <button
                      onClick={() => generateAI(p)}
                      disabled={isGen}
                      className="w-full flex items-center justify-center gap-2 rounded-md bg-primary/15 hover:bg-primary/25 border border-primary/30 text-primary px-3 py-2 text-xs font-medium disabled:opacity-50"
                    >
                      {isGen ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {p.ai_draft ? 'Regerar mensagem' : 'Gerar mensagem com IA'}
                    </button>

                    {p.ai_draft && (
                      <div className="space-y-2 rounded-md border border-border bg-card p-2">
                        <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                          <Bot className="h-3 w-3" /> Rascunho IA {p.ai_review_notes ? `· ${p.ai_review_notes}` : ''}
                        </p>
                        <textarea
                          value={p.ai_draft}
                          onChange={(e) => update.mutate({ id: p.id, patch: { ai_draft: e.target.value } as any })}
                          className="w-full rounded-md bg-secondary border border-border px-2 py-1.5 text-xs text-foreground min-h-[80px]"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => {
                              const text = p.ai_draft || '';
                              if (!text.trim()) return;
                              openWA(p.contact_phone, text);
                              logSent(p, text);
                            }}
                            className="flex items-center gap-1 rounded-md bg-green-500/15 hover:bg-green-500/25 border border-green-500/30 text-green-300 px-3 py-1.5 text-xs"
                          >
                            <Send className="h-3 w-3" /> Enviar no WhatsApp
                          </button>
                          <button
                            onClick={async () => { await navigator.clipboard.writeText(p.ai_draft || ''); toast.success('Copiado'); }}
                            className="flex items-center gap-1 rounded-md bg-secondary border border-border text-foreground px-3 py-1.5 text-xs"
                          >
                            <Copy className="h-3 w-3" /> Copiar
                          </button>
                          <button
                            onClick={() => update.mutate({ id: p.id, patch: { ai_draft: '' } as any })}
                            className="flex items-center gap-1 rounded-md text-muted-foreground hover:text-foreground px-2 py-1.5 text-xs"
                          >
                            Descartar
                          </button>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground">Registrar resposta do lead (opcional — alimenta a IA pra próxima)</label>
                      <div className="mt-1 flex gap-2">
                        <input
                          id={`reply-${p.id}`}
                          placeholder="Cole/digite o que o lead respondeu"
                          className="flex-1 rounded-md bg-secondary border border-border px-2 py-1.5 text-xs text-foreground"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const v = (e.target as HTMLInputElement).value;
                              addLeadReply(p, v);
                              (e.target as HTMLInputElement).value = '';
                            }
                          }}
                        />
                        <button
                          onClick={() => {
                            const el = document.getElementById(`reply-${p.id}`) as HTMLInputElement | null;
                            if (el?.value) { addLeadReply(p, el.value); el.value = ''; }
                          }}
                          className="rounded-md bg-secondary border border-border text-foreground px-2 py-1.5 text-xs"
                        >
                          Adicionar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default SuperAdminProspecting;
