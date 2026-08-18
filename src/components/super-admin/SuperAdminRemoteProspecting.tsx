import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Search, Loader2, Sparkles, MessageCircle, Trash2, Phone, AtSign, Globe,
  AlertCircle, Send, Radar, Star, MapPin, Clock, Tag, Map as MapIcon, Mail,
  Building2, ExternalLink, Filter, Bell, Inbox, CheckCircle2, XCircle, Users, BellRing,
  MessageSquareWarning, Layers, NotebookPen,
} from 'lucide-react';
import { toast } from 'sonner';

type Prospect = {
  id: string;
  business_name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  region: string | null;
  neighborhood: string | null;
  address: string | null;
  niche: string | null;
  sector: string | null;
  category: string | null;
  description: string | null;
  rating: number | null;
  reviews_count: number | null;
  hours: string | null;
  maps_url: string | null;
  price_level: number | null;
  instagram_handle: string | null;
  website_url: string | null;
  has_website: boolean;
  has_instagram: boolean;
  priority_score: number;
  status: string;
  initial_message: string | null;
  conversation_log: any[];
  notes: string | null;
  cnpj: string | null;
  scrape_source: string | null;
  last_sent_at: string | null;
  next_followup_at: string | null;
  followup_count: number | null;
  review_notes: string | null;
  pain_signals: string[] | null;
  pain_summary: string | null;
  reviews_sample: any[] | null;
  reviews_scraped_at: string | null;
  manual_intel: string | null;
  manual_website_url: string | null;
  competitor_stack: string[] | null;
  stack_summary: string | null;
  stack_scraped_at: string | null;
  reminder_at?: string | null;
  suggested_next_message?: string | null;
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: 'Novo', color: 'bg-blue-500/20 text-blue-300' },
  ready: { label: 'Mensagem pronta', color: 'bg-purple-500/20 text-purple-300' },
  sent: { label: 'Enviado', color: 'bg-yellow-500/20 text-yellow-300' },
  replied: { label: 'Respondeu', color: 'bg-green-500/20 text-green-300' },
  closed_won: { label: 'Fechou', color: 'bg-emerald-500/20 text-emerald-300' },
  closed_lost: { label: 'Recusou', color: 'bg-rose-500/20 text-rose-300' },
};

const REGIONS = [
  { v: '', l: 'Todas regiões' },
  { v: 'norte', l: 'Norte' },
  { v: 'nordeste', l: 'Nordeste' },
  { v: 'centro-oeste', l: 'Centro-Oeste' },
  { v: 'sudeste', l: 'Sudeste' },
  { v: 'sul', l: 'Sul' },
];

const SECTORS = [
  { v: '', l: 'Todos setores' },
  { v: 'alimentação', l: 'Alimentação' },
  { v: 'varejo', l: 'Varejo' },
  { v: 'serviços', l: 'Serviços' },
  { v: 'beleza', l: 'Beleza & Estética' },
  { v: 'saúde', l: 'Saúde' },
  { v: 'pet', l: 'Pet' },
  { v: 'moda', l: 'Moda' },
  { v: 'mercado', l: 'Mercado / Conveniência' },
  { v: 'oficina', l: 'Oficina / Auto' },
];

const UFS = ['','AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

type ProspectingScope = 'super' | 'client';

const SuperAdminRemoteProspecting = (props?: { scope?: ProspectingScope; tenantId?: string; label?: string }) => {
  const qc = useQueryClient();
  const scope = props?.scope ?? 'super';
  const tenantId = props?.tenantId ?? null;
  const uiTitle = props?.label ?? 'Prospecção remota';
  const isClient = scope === 'client';
  // View principal
  const [view, setView] = useState<'leads' | 'conversar'>('leads');
  const [pipelineStatus, setPipelineStatus] = useState<'ready' | 'sent' | 'replied' | 'closed_won' | 'closed_lost'>('ready');

  // Filtros de BUSCA (envia pra edge function)
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [region, setRegion] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [niche, setNiche] = useState('');
  const [sector, setSector] = useState('');

  // Filtros de VISUALIZAÇÃO (sobre os leads já no banco)
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterText, setFilterText] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterNeighborhood, setFilterNeighborhood] = useState('');
  const [onlyNoSite, setOnlyNoSite] = useState(false);

  const [editingPhone, setEditingPhone] = useState<Record<string, string>>({});
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [leadReply, setLeadReply] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [intelDraft, setIntelDraft] = useState<Record<string, string>>({});
  const [websiteDraft, setWebsiteDraft] = useState<Record<string, string>>({});

  const { data: prospects = [], isLoading } = useQuery({
    queryKey: ['remote_prospects', filterStatus, isClient ? tenantId : 'global'],
    queryFn: async () => {
      let q = supabase.from('remote_prospects').select('*')
        .order('priority_score', { ascending: false })
        .order('created_at', { ascending: false });
      if (filterStatus !== 'all') q = q.eq('status', filterStatus);
      if (isClient && tenantId) q = q.eq('tenant_id', tenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Prospect[];
    },
  });

  const filteredProspects = useMemo(() => {
    const t = filterText.trim().toLowerCase();
    const c = filterCity.trim().toLowerCase();
    const n = filterNeighborhood.trim().toLowerCase();
    return prospects.filter(p => {
      if (onlyNoSite && p.has_website) return false;
      if (c && !(p.city ?? '').toLowerCase().includes(c)) return false;
      if (n && !(p.neighborhood ?? '').toLowerCase().includes(n)) return false;
      if (t) {
        const hay = `${p.business_name} ${p.category ?? ''} ${p.address ?? ''} ${p.niche ?? ''}`.toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [prospects, filterText, filterCity, filterNeighborhood, onlyNoSite]);

  // Pipeline counts (sempre sobre TODOS os prospects, independente dos filtros visuais)
  const pipelineCounts = useMemo(() => {
    const out = { ready: 0, sent: 0, replied: 0, closed_won: 0, closed_lost: 0, overdue: 0 };
    const now = Date.now();
    for (const p of prospects) {
      if (p.status === 'ready' || p.status === 'sent' || p.status === 'replied' || p.status === 'closed_won' || p.status === 'closed_lost') {
        (out as any)[p.status]++;
      }
      if (p.status === 'sent' && p.next_followup_at && new Date(p.next_followup_at).getTime() < now) {
        out.overdue++;
      }
    }
    return out;
  }, [prospects]);

  // Quando estamos no modo "conversar": filtra por status do pipeline e exige initial_message
  const conversarProspects = useMemo(() => {
    return prospects.filter(p => p.status === pipelineStatus && (p.initial_message || (p.conversation_log?.length ?? 0) > 0));
  }, [prospects, pipelineStatus]);

  const displayedProspects = view === 'conversar' ? conversarProspects : filteredProspects;

  const search = useMutation({
    mutationFn: async () => {
      if (!city.trim() || !niche.trim()) throw new Error('Preencha pelo menos cidade e nicho');
      const { data, error } = await supabase.functions.invoke('prospect-google-search', {
        body: {
          city: city.trim(),
          state: state.trim(),
          region: region.trim(),
          neighborhood: neighborhood.trim(),
          niche: niche.trim(),
          sector: sector.trim(),
        },
      });
      if (error) {
        const ctxMsg = (error as any)?.context?.body
          ? (() => { try { return JSON.parse((error as any).context.body)?.message; } catch { return null; } })()
          : null;
        throw new Error(ctxMsg || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);
      return data;
    },
    onSuccess: async (data: any) => {
      const n = data?.inserted ?? 0;
      if (n === 0) {
        toast.warning(data?.message ?? 'Nada encontrado nos filtros — tente abrir mais a busca.');
        return;
      }
      toast.success(`${n} empresas reais encontradas no Google`);
      qc.invalidateQueries({ queryKey: ['remote_prospects'] });

      // Enriquece (CNPJ, Insta) em background
      const leadsArr: any[] = Array.isArray(data?.leads) ? data.leads : [];
      if (leadsArr.length > 0) {
        toast.info(`Buscando CNPJ e Instagram de ${leadsArr.length} leads...`);
        let foundCount = 0;
        for (const lead of leadsArr) {
          try {
            const { data: enr } = await supabase.functions.invoke('prospect-enrich', {
              body: { prospect_id: lead.id },
            });
            if ((enr as any)?.changed) foundCount++;
          } catch { /* ignora */ }
        }
        qc.invalidateQueries({ queryKey: ['remote_prospects'] });
        toast.success(`Enriquecidos ${foundCount}/${leadsArr.length} com dados extras`);
      }
    },
    onError: (e: any) => toast.error(e.message ?? 'Erro na busca'),
  });

  const mapsPhone = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('prospect-maps-phone', {
        body: { prospect_id: id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);
      return data as { found: boolean; phone?: string; source?: string; message?: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['remote_prospects'] });
      if (data.found) toast.success(`Telefone do Maps: ${data.phone} (${data.source})`);
      else toast.warning(data.message ?? 'Não achei no Maps');
    },
    onError: (e: any) => toast.error(e.message ?? 'Erro ao buscar no Maps'),
  });

  const enrich = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('prospect-enrich', {
        body: { prospect_id: id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);
      return data as { found: { instagram: string | null; phone: string | null }; changed: boolean };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['remote_prospects'] });
      const parts: string[] = [];
      if (data.found.phone) parts.push(`telefone ${data.found.phone}`);
      if (data.found.instagram) parts.push(`Insta ${data.found.instagram}`);
      if (parts.length) toast.success(`Achei: ${parts.join(' + ')}`);
      else toast.warning('Nada novo encontrado');
    },
    onError: (e: any) => toast.error(e.message ?? 'Erro ao enriquecer'),
  });

  const analyzeReviews = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('prospect-reviews', {
        body: { prospect_id: id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);
      return data as { reviews_found: number; negatives_found: number; pain_signals: string[]; pain_summary: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['remote_prospects'] });
      if (data.pain_signals?.length) toast.success(`Dores: ${data.pain_signals.join(', ')}`);
      else if (data.reviews_found > 0) toast.info(`${data.reviews_found} avaliações lidas, sem dor clara`);
      else toast.warning('Não consegui ler avaliações desse local');
    },
    onError: (e: any) => toast.error(e.message ?? 'Erro ao analisar avaliações'),
  });

  const siteStack = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('prospect-site-stack', { body: { prospect_id: id } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);
      return data as { site_url: string | null; found_on_maps: boolean; stack: string[]; summary: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['remote_prospects'] });
      if (data.stack?.length) toast.success(`Plataforma detectada: ${data.stack.join(', ')}`);
      else if (data.site_url) toast.info(`Site encontrado${data.found_on_maps ? ' no Maps' : ''}: ${data.site_url}`);
      else toast.warning('Não detectei site nem plataforma');
    },
    onError: (e: any) => toast.error(e.message ?? 'Erro ao detectar plataforma'),
  });

  const generateMsg = useMutation({
    mutationFn: async ({ id, mode }: { id: string; mode: 'initial' | 'reply' | 'followup' }) => {
      const { data, error } = await supabase.functions.invoke('prospect-message', {
        body: { prospect_id: id, mode },
      });
      if (error) {
        const ctxMsg = (error as any)?.context?.body
          ? (() => { try { return JSON.parse((error as any).context.body)?.message; } catch { return null; } })()
          : null;
        throw new Error(ctxMsg || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);
      return {
        id, mode,
        message: (data as any).message as string,
        review_notes: (data as any).review_notes as string,
        reviewer_provider: (data as any).reviewer_provider as string,
        fallback: !!(data as any).fallback,
      };
    },
    onSuccess: ({ id, mode, message, review_notes, reviewer_provider, fallback }) => {
      if (mode === 'reply') setReplyDraft((p) => ({ ...p, [id]: message }));
      qc.invalidateQueries({ queryKey: ['remote_prospects'] });
      const reviewedTag = reviewer_provider && reviewer_provider !== 'skipped' ? ' (revisada por IA)' : '';
      if (fallback) toast.warning(`${mode === 'reply' ? 'Réplica' : 'Mensagem'} via worker (sem IA)`);
      else toast.success(`${mode === 'reply' ? 'Réplica' : mode === 'followup' ? 'Lembrete' : 'Mensagem'} pronta${reviewedTag}`);
      if (review_notes) toast.message('🔍 Revisor IA', { description: review_notes });
    },
    onError: (e: any) => toast.error(e.message ?? 'Erro ao gerar'),
  });

  const markAsSent = useMutation({
    mutationFn: async (id: string) => {
      const p = prospects.find(x => x.id === id);
      if (!p) return;
      const log = Array.isArray(p.conversation_log) ? p.conversation_log : [];
      const newLog = p.initial_message
        ? [...log, { from: 'me', text: p.initial_message, at: new Date().toISOString() }]
        : log;
      // Seguência automática de follow-up: agendar lembretes D+2 e D+5
      const now = Date.now();
      const followup2 = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString();
      const followup5 = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase.from('remote_prospects').update({
        status: 'sent',
        conversation_log: newLog as any,
        last_sent_at: new Date().toISOString(),
        next_followup_at: followup2,
        followup_count: (p.followup_count ?? 0),
        reminder_at: followup5,
        suggested_next_message: `Re-bater ${p.business_name}: mensagem anterior sem resposta. Oferecer condição especial da semana e agendar conversa.`,
        ...(isClient ? { tenant_id: tenantId } : {}),
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Marcado como enviado · lembrete em 2 dias');
      qc.invalidateQueries({ queryKey: ['remote_prospects'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Erro'),
  });

  const updateProspect = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Prospect> }) => {
      const patchSafe = isClient ? { ...(patch as object), tenant_id: tenantId } : (patch as object);
      const { error } = await supabase.from('remote_prospects').update(patchSafe).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['remote_prospects'] }),
  });

  const deleteProspect = useMutation({
    mutationFn: async (id: string) => {
      let q = supabase.from('remote_prospects').delete().eq('id', id);
      if (isClient && tenantId) q = q.eq('tenant_id', tenantId);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Lead removido');
      qc.invalidateQueries({ queryKey: ['remote_prospects'] });
    },
  });

  const deleteBulk = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0;
      let q = supabase.from('remote_prospects').delete().in('id', ids);
      if (isClient && tenantId) q = q.eq('tenant_id', tenantId);
      const { error } = await q;
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} leads removidos`);
      qc.invalidateQueries({ queryKey: ['remote_prospects'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Erro ao apagar'),
  });

  const handleDeleteFiltered = () => {
    const ids = filteredProspects.map(p => p.id);
    if (ids.length === 0) return;
    if (!confirm(`Apagar ${ids.length} lead(s) visíveis? Esta ação não pode ser desfeita.`)) return;
    deleteBulk.mutate(ids);
  };

  const handleDeleteAll = () => {
    const ids = prospects.map(p => p.id);
    if (ids.length === 0) return;
    if (!confirm(`APAGAR TODOS os ${ids.length} leads do banco? Esta ação não pode ser desfeita.`)) return;
    if (!confirm('Tem certeza absoluta? Tudo será removido.')) return;
    deleteBulk.mutate(ids);
  };

  const openWhatsApp = (p: Prospect, message: string) => {
    const phone = (editingPhone[p.id] ?? p.phone ?? '').replace(/\D/g, '');
    if (!phone) {
      toast.error('Adicione o telefone primeiro');
      return;
    }
    const finalPhone = phone.startsWith('55') ? phone : `55${phone}`;
    const log = Array.isArray(p.conversation_log) ? p.conversation_log : [];
    const newLog = [...log, { from: 'me', text: message, at: new Date().toISOString() }];
    const followupAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    updateProspect.mutate({
      id: p.id,
      patch: {
        status: 'sent',
        conversation_log: newLog as any,
        phone: editingPhone[p.id] ?? p.phone ?? '',
        last_sent_at: new Date().toISOString(),
        next_followup_at: followupAt,
      },
    });
    window.open(`https://wa.me/${finalPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const logLeadReply = (p: Prospect) => {
    const txt = (leadReply[p.id] ?? '').trim();
    if (!txt) return;
    const log = Array.isArray(p.conversation_log) ? p.conversation_log : [];
    updateProspect.mutate({
      id: p.id,
      patch: {
        status: 'replied',
        conversation_log: [...log, { from: 'lead', text: txt, at: new Date().toISOString() }] as any,
      },
    });
    setLeadReply((s) => ({ ...s, [p.id]: '' }));
  };

  const sendReply = (p: Prospect) => {
    const txt = (replyDraft[p.id] ?? '').trim();
    if (!txt) return;
    openWhatsApp(p, txt);
    setReplyDraft((s) => ({ ...s, [p.id]: '' }));
  };

  const inputCls = "flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm w-full";
  const selectCls = inputCls + " cursor-pointer";

  const PIPELINE: { id: typeof pipelineStatus; label: string; icon: JSX.Element; tone: string }[] = [
    { id: 'ready',       label: 'A enviar',  icon: <Inbox className="h-3.5 w-3.5" />,        tone: 'bg-purple-500/20 text-purple-300' },
    { id: 'sent',        label: 'Enviado',   icon: <Send className="h-3.5 w-3.5" />,         tone: 'bg-yellow-500/20 text-yellow-300' },
    { id: 'replied',     label: 'Respondeu', icon: <MessageCircle className="h-3.5 w-3.5" />, tone: 'bg-green-500/20 text-green-300' },
    { id: 'closed_won',  label: 'Fechou',    icon: <CheckCircle2 className="h-3.5 w-3.5" />, tone: 'bg-emerald-500/20 text-emerald-300' },
    { id: 'closed_lost', label: 'Recusou',   icon: <XCircle className="h-3.5 w-3.5" />,      tone: 'bg-rose-500/20 text-rose-300' },
  ];

  const isOverdue = (p: Prospect) => p.status === 'sent' && !!p.next_followup_at && new Date(p.next_followup_at).getTime() < Date.now();

  return (
    <div className="space-y-6">
      {/* SUB-ABAS LEADS / CONVERSAR */}
      <div className="flex gap-2 overflow-x-auto">
        <button
          onClick={() => setView('leads')}
          className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-xs font-medium transition-all ${view === 'leads' ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
        >
          <Users className="h-4 w-4" /> Leads ({prospects.length})
        </button>
        <button
          onClick={() => setView('conversar')}
          className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-xs font-medium transition-all ${view === 'conversar' ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
        >
          <MessageCircle className="h-4 w-4" /> Conversar
          {pipelineCounts.overdue > 0 && (
            <span className="ml-1 rounded-full bg-rose-500 text-white text-[10px] px-1.5 py-0.5 flex items-center gap-0.5">
              <BellRing className="h-2.5 w-2.5" /> {pipelineCounts.overdue}
            </span>
          )}
        </button>
      </div>

      {view === 'conversar' && (
        <div className="rounded-xl border border-border bg-gradient-to-br from-card to-card/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-base">Pipeline de conversas</h2>
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {PIPELINE.map(s => (
              <button key={s.id} onClick={() => setPipelineStatus(s.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium ${pipelineStatus === s.id ? 'gradient-primary text-primary-foreground' : `${s.tone} hover:opacity-80`}`}>
                {s.icon} {s.label} ({pipelineCounts[s.id]})
                {s.id === 'sent' && pipelineCounts.overdue > 0 && (
                  <span className="ml-1 rounded-full bg-rose-500 text-white text-[10px] px-1.5">{pipelineCounts.overdue}</span>
                )}
              </button>
            ))}
          </div>
          {pipelineStatus === 'sent' && pipelineCounts.overdue > 0 && (
            <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 rounded-md p-2">
              <BellRing className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span><strong>{pipelineCounts.overdue}</strong> lead(s) sem responder há mais de 2 dias. Use "Gerar lembrete" no card.</span>
            </div>
          )}
        </div>
      )}

      {view === 'leads' && (<>
      {/* PAINEL DE BUSCA */}
      <div className="rounded-xl border border-border bg-gradient-to-br from-card to-card/50 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Radar className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-lg">Prospecção via Google + Bing (dados reais)</h2>
        </div>
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-400" />
          <span>
            Raspagem direta do Google Maps e Bing — empresas, telefone, endereço, avaliações e horários reais.
            Quanto mais filtros você usar, mais relevante o resultado.
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase mb-1 block">Cidade *</label>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex: Birigui" className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase mb-1 block">Estado (UF)</label>
            <select value={state} onChange={(e) => setState(e.target.value)} className={selectCls}>
              {UFS.map(u => <option key={u} value={u}>{u || 'Qualquer'}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase mb-1 block">Região</label>
            <select value={region} onChange={(e) => setRegion(e.target.value)} className={selectCls}>
              {REGIONS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase mb-1 block">Bairro</label>
            <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Ex: Centro, Jardim Europa" className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase mb-1 block">Nicho *</label>
            <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Ex: hamburgueria, pizzaria, açaí" className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase mb-1 block">Setor (vetor)</label>
            <select value={sector} onChange={(e) => setSector(e.target.value)} className={selectCls}>
              {SECTORS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </div>
        </div>
        <button
          onClick={() => search.mutate()}
          disabled={search.isPending}
          className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-md gradient-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {search.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {search.isPending ? 'Raspando Google...' : 'Buscar empresas reais'}
        </button>
      </div>

      {/* FILTROS DE VISUALIZAÇÃO */}
      <div className="rounded-lg border border-border bg-card p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Filter className="h-3.5 w-3.5" /> Filtrar leads salvos
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleDeleteFiltered}
              disabled={deleteBulk.isPending || filteredProspects.length === 0}
              className="flex items-center gap-1.5 rounded-md bg-destructive/10 hover:bg-destructive/20 text-destructive px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Apagar visíveis ({filteredProspects.length})
            </button>
            <button
              onClick={handleDeleteAll}
              disabled={deleteBulk.isPending || prospects.length === 0}
              className="flex items-center gap-1.5 rounded-md bg-destructive hover:bg-destructive/90 text-destructive-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {deleteBulk.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Apagar TODOS ({prospects.length})
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Buscar por nome..." className="h-9 rounded-md border border-input bg-background px-3 text-xs" />
          <input value={filterCity} onChange={(e) => setFilterCity(e.target.value)} placeholder="Cidade" className="h-9 rounded-md border border-input bg-background px-3 text-xs" />
          <input value={filterNeighborhood} onChange={(e) => setFilterNeighborhood(e.target.value)} placeholder="Bairro" className="h-9 rounded-md border border-input bg-background px-3 text-xs" />
          <label className="flex items-center gap-2 text-xs cursor-pointer rounded-md border border-input bg-background px-3 h-9">
            <input type="checkbox" checked={onlyNoSite} onChange={(e) => setOnlyNoSite(e.target.checked)} />
            Só sem site
          </label>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          <button
            onClick={() => setFilterStatus('all')}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs ${filterStatus === 'all' ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
          >Todos ({prospects.length})</button>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <button key={k} onClick={() => setFilterStatus(k)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs ${filterStatus === k ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
            >{v.label}</button>
          ))}
        </div>
      </div>
      </>)}

      {/* LISTAGEM */}
      {isLoading ? (
        <div className="text-center text-muted-foreground py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
      ) : displayedProspects.length === 0 ? (
        <div className="text-center text-muted-foreground py-12 rounded-lg border border-dashed border-border">
          {prospects.length === 0 ? 'Nenhum lead. Faça uma busca acima.' : view === 'conversar' ? 'Nenhuma conversa neste status.' : 'Nenhum lead bate com os filtros aplicados.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {displayedProspects.map((p) => {
            const phoneVal = editingPhone[p.id] ?? p.phone ?? '';
            const status = STATUS_LABELS[p.status] ?? STATUS_LABELS.new;
            const log = Array.isArray(p.conversation_log) ? p.conversation_log : [];
            const isExpanded = expanded[p.id] ?? false;

            return (
              <div key={p.id} className="rounded-xl border border-border bg-card p-4 space-y-3 hover:border-primary/40 transition-colors">
                {/* HEADER */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-base">{p.business_name}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary font-bold">
                        Score {p.priority_score}
                      </span>
                    </div>

                    {/* RATING + CATEGORIA */}
                    <div className="flex items-center gap-3 flex-wrap text-xs mb-1.5">
                      {p.rating && (
                        <span className="flex items-center gap-1 text-amber-400 font-medium">
                          <Star className="h-3.5 w-3.5 fill-amber-400" />
                          {p.rating.toFixed(1)}
                          {p.reviews_count ? <span className="text-muted-foreground font-normal">({p.reviews_count} avaliações)</span> : null}
                        </span>
                      )}
                      {p.category && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Tag className="h-3 w-3" />{p.category}
                        </span>
                      )}
                      {p.price_level && (
                        <span className="text-muted-foreground">{'$'.repeat(p.price_level)}</span>
                      )}
                    </div>

                    {/* LOCALIZAÇÃO */}
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {p.address && (
                        <div className="flex items-start gap-1.5">
                          <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
                          <span>{p.address}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap pl-[18px]">
                        {p.neighborhood && <span className="rounded bg-secondary/60 px-1.5 py-0.5">📍 {p.neighborhood}</span>}
                        <span>{p.city}{p.state ? ` - ${p.state}` : ''}</span>
                        {p.region && <span className="text-[10px] uppercase">· {p.region}</span>}
                      </div>
                      {p.hours && (
                        <div className="flex items-center gap-1.5"><Clock className="h-3 w-3" />{p.hours}</div>
                      )}
                    </div>

                    {/* TAGS DE STATUS */}
                    <div className="flex items-center gap-3 mt-2 text-xs flex-wrap">
                      {p.has_website || p.manual_website_url ? (
                        <a href={p.manual_website_url || p.website_url || '#'} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-amber-300 hover:underline">
                          <Globe className="h-3 w-3" /> Tem site {p.manual_website_url ? '(manual)' : ''} <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ) : (
                        <span className="flex items-center gap-1 text-emerald-300 font-medium">
                          <Globe className="h-3 w-3" /> Sem site (alvo!)
                        </span>
                      )}
                      {p.has_instagram && (
                        <a href={p.instagram_handle ? `https://instagram.com/${p.instagram_handle.replace('@','')}` : '#'} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-pink-300 hover:underline">
                          <AtSign className="h-3 w-3" /> {p.instagram_handle ?? 'Insta'} <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                      {p.maps_url && (
                        <a href={p.maps_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-cyan-300 hover:underline">
                          <MapIcon className="h-3 w-3" /> Maps <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                      {p.cnpj && (
                        <a href={`https://casadosdados.com.br/solucao/cnpj/${p.cnpj}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-purple-300 hover:underline font-mono">
                          <Building2 className="h-3 w-3" /> CNPJ <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                  <button onClick={() => deleteProspect.mutate(p.id)} className="text-muted-foreground hover:text-destructive flex-shrink-0">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* DETALHES (toggle) */}
                {(p.description || p.notes || p.email || p.scrape_source) && (
                  <button
                    onClick={() => setExpanded(s => ({ ...s, [p.id]: !s[p.id] }))}
                    className="text-[11px] text-primary hover:underline"
                  >
                    {isExpanded ? '▼ Ocultar detalhes' : '▶ Ver detalhes'}
                  </button>
                )}
                {isExpanded && (
                  <div className="rounded-md bg-secondary/30 p-3 text-xs space-y-1.5">
                    {p.description && <div><strong>Sobre:</strong> {p.description}</div>}
                    {p.notes && <div className="italic text-muted-foreground">{p.notes}</div>}
                    {p.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{p.email}</div>}
                    {p.cnpj && <div className="font-mono">CNPJ: {p.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}</div>}
                    {p.scrape_source && <div className="text-muted-foreground text-[10px]">Fonte: {p.scrape_source}</div>}
                  </div>
                )}

                {/* TELEFONE + ENRICH */}
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <input
                    value={phoneVal}
                    onChange={(e) => setEditingPhone((s) => ({ ...s, [p.id]: e.target.value }))}
                    onBlur={() => {
                      const v = editingPhone[p.id];
                      if (v !== undefined && v !== p.phone) updateProspect.mutate({ id: p.id, patch: { phone: v } });
                    }}
                    placeholder="DDD + número"
                    className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <button
                    onClick={() => mapsPhone.mutate(p.id)}
                    disabled={mapsPhone.isPending && mapsPhone.variables === p.id}
                    title="Buscar telefone só desta loja no Google Maps"
                    className="flex items-center gap-1 h-9 rounded-md bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30 px-3 text-xs disabled:opacity-50"
                  >
                    {mapsPhone.isPending && mapsPhone.variables === p.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <MapIcon className="h-3.5 w-3.5" />}
                    Maps
                  </button>
                  <button
                    onClick={() => enrich.mutate(p.id)}
                    disabled={enrich.isPending && enrich.variables === p.id}
                    title="Buscar CNPJ, telefone e Insta"
                    className="flex items-center gap-1 h-9 rounded-md bg-secondary px-3 text-xs hover:bg-secondary/80 disabled:opacity-50"
                  >
                    {enrich.isPending && enrich.variables === p.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Radar className="h-3.5 w-3.5" />}
                    Enriquecer
                  </button>
                  <button
                    onClick={() => analyzeReviews.mutate(p.id)}
                    disabled={analyzeReviews.isPending && analyzeReviews.variables === p.id}
                    title="Ler avaliações do Google Maps e extrair dores reais"
                    className="flex items-center gap-1 h-9 rounded-md bg-amber-500/20 text-amber-200 px-3 text-xs hover:bg-amber-500/30 disabled:opacity-50"
                  >
                    {analyzeReviews.isPending && analyzeReviews.variables === p.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <MessageSquareWarning className="h-3.5 w-3.5" />}
                    Avaliações
                  </button>
                  <button
                    onClick={() => siteStack.mutate(p.id)}
                    disabled={siteStack.isPending && siteStack.variables === p.id}
                    title={p.manual_website_url ? `Detectar plataforma a partir do site manual: ${p.manual_website_url}` : "Detectar site (via Maps) e identificar qual plataforma o lojista já usa"}
                    className="flex items-center gap-1 h-9 rounded-md bg-indigo-500/20 text-indigo-200 px-3 text-xs hover:bg-indigo-500/30 disabled:opacity-50"
                  >
                    {siteStack.isPending && siteStack.variables === p.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Layers className="h-3.5 w-3.5" />}
                    Plataforma
                  </button>
                </div>

                {/* SITE MANUAL */}
                <div className="rounded-md bg-emerald-500/5 border border-emerald-500/30 px-3 py-2 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-200">
                    <Globe className="h-3 w-3" /> Site do lojista (se souber, a IA usa na prospecção)
                  </div>
                  <input
                    value={websiteDraft[p.id] ?? p.manual_website_url ?? ''}
                    onChange={(e) => setWebsiteDraft((s) => ({ ...s, [p.id]: e.target.value }))}
                    onBlur={() => {
                      const v = websiteDraft[p.id];
                      if (v !== undefined && v !== (p.manual_website_url ?? '')) {
                        const cleanUrl = v.trim();
                        const patch: any = { manual_website_url: cleanUrl || null };
                        // Se colocou site manual, marca has_website=true
                        if (cleanUrl) patch.has_website = true;
                        updateProspect.mutate({ id: p.id, patch });
                      }
                    }}
                    placeholder="https://exemplo.com.br"
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                  />
                </div>

                {/* INFORMAÇÕES MANUAIS (que eu sei sobre o lojista) */}
                <div className="rounded-md bg-blue-500/5 border border-blue-500/30 px-3 py-2 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-200">
                    <NotebookPen className="h-3 w-3" /> O que eu sei sobre esse lojista (a IA vai usar)
                  </div>
                  <textarea
                    value={intelDraft[p.id] ?? p.manual_intel ?? ''}
                    onChange={(e) => setIntelDraft((s) => ({ ...s, [p.id]: e.target.value }))}
                    onBlur={() => {
                      const v = intelDraft[p.id];
                      if (v !== undefined && v !== (p.manual_intel ?? '')) {
                        updateProspect.mutate({ id: p.id, patch: { manual_intel: v } as any });
                      }
                    }}
                    rows={2}
                    placeholder="Ex: dono é o João, sofre com taxa do iFood, já reclamou em grupo de bairro, abre só à noite, é amigo do fornecedor X..."
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                  />
                </div>

                {/* PLATAFORMA DETECTADA */}
                {(p.competitor_stack?.length || p.stack_summary) && (
                  <div className="rounded-md bg-indigo-500/10 border border-indigo-500/30 px-3 py-2 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-200">
                      <Layers className="h-3 w-3" /> Plataforma / sistema que o lojista usa
                    </div>
                    {!!p.competitor_stack?.length && (
                      <div className="flex flex-wrap gap-1">
                        {p.competitor_stack.map((tag) => (
                          <span key={tag} className="rounded-full bg-indigo-500/30 text-indigo-100 px-2 py-0.5 text-[10px]">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.stack_summary && <p className="text-[11px] text-indigo-100/90 leading-snug">{p.stack_summary}</p>}
                  </div>
                )}

                {/* DORES DETECTADAS */}
                {(p.pain_signals?.length || p.pain_summary) && (
                  <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-200">
                      <MessageSquareWarning className="h-3 w-3" /> Dores detectadas nas avaliações
                    </div>
                    {!!p.pain_signals?.length && (
                      <div className="flex flex-wrap gap-1">
                        {p.pain_signals.map((tag) => (
                          <span key={tag} className="rounded-full bg-amber-500/30 text-amber-100 px-2 py-0.5 text-[10px]">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.pain_summary && <p className="text-[11px] text-amber-100/90 leading-snug">{p.pain_summary}</p>}
                  </div>
                )}


                {/* MENSAGEM + REVIEW IA */}
                {!p.initial_message ? (
                  <button
                    onClick={() => generateMsg.mutate({ id: p.id, mode: 'initial' })}
                    disabled={generateMsg.isPending}
                    className="w-full flex items-center justify-center gap-2 rounded-md bg-secondary text-foreground px-3 py-2 text-sm hover:bg-secondary/80 disabled:opacity-50"
                  >
                    {generateMsg.isPending && (generateMsg.variables as any)?.id === p.id
                      ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Gerar mensagem com IA (rascunho + revisor)
                  </button>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      value={p.initial_message}
                      onChange={(e) => updateProspect.mutate({ id: p.id, patch: { initial_message: e.target.value } })}
                      rows={4}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    {p.review_notes && (
                      <div className="text-[11px] text-purple-300 bg-purple-500/10 rounded-md px-2 py-1.5 flex items-start gap-1.5">
                        <Sparkles className="h-3 w-3 flex-shrink-0 mt-0.5" />
                        <span><strong>Revisor IA:</strong> {p.review_notes}</span>
                      </div>
                    )}
                    {isOverdue(p) && (
                      <div className="text-[11px] text-rose-300 bg-rose-500/10 rounded-md px-2 py-1.5 flex items-start gap-1.5">
                        <BellRing className="h-3 w-3 flex-shrink-0 mt-0.5" />
                        <span>
                          <strong>Sem resposta há {Math.floor((Date.now() - new Date(p.last_sent_at!).getTime()) / 86400000)} dia(s).</strong> Hora do follow-up.
                        </span>
                      </div>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => generateMsg.mutate({ id: p.id, mode: 'initial' })}
                        disabled={generateMsg.isPending && (generateMsg.variables as any)?.id === p.id}
                        className="flex items-center gap-1 rounded-md bg-secondary px-3 py-1.5 text-xs hover:bg-secondary/80 disabled:opacity-50"
                      >
                        {generateMsg.isPending && (generateMsg.variables as any)?.id === p.id && (generateMsg.variables as any)?.mode === 'initial'
                          ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        Regerar
                      </button>
                      {isOverdue(p) && (
                        <button
                          onClick={() => generateMsg.mutate({ id: p.id, mode: 'followup' })}
                          disabled={generateMsg.isPending}
                          className="flex items-center gap-1 rounded-md bg-rose-500/20 text-rose-300 px-3 py-1.5 text-xs hover:bg-rose-500/30 disabled:opacity-50"
                        >
                          <BellRing className="h-3 w-3" /> Gerar lembrete
                        </button>
                      )}
                      {p.status === 'ready' && (
                        <button
                          onClick={() => markAsSent.mutate(p.id)}
                          disabled={markAsSent.isPending}
                          className="flex items-center gap-1 rounded-md bg-yellow-500/20 text-yellow-300 px-3 py-1.5 text-xs hover:bg-yellow-500/30 disabled:opacity-50"
                          title="Já enviei manualmente"
                        >
                          <CheckCircle2 className="h-3 w-3" /> Marcar enviado
                        </button>
                      )}
                      <button
                        onClick={() => openWhatsApp(p, p.initial_message!)}
                        className="flex-1 flex items-center justify-center gap-2 rounded-md bg-emerald-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-emerald-500"
                      >
                        <Send className="h-4 w-4" /> Abrir WhatsApp
                      </button>
                    </div>
                  </div>
                )}

                {/* CONVERSAS */}
                {log.length > 0 && (
                  <div className="rounded-md bg-secondary/40 p-3 space-y-1.5 text-xs max-h-48 overflow-y-auto">
                    {log.map((m: any, i: number) => (
                      <div key={i} className={m.from === 'me' ? 'text-blue-300' : 'text-emerald-300'}>
                        <strong>{m.from === 'me' ? 'Você:' : 'Lead:'}</strong> {m.text}
                      </div>
                    ))}
                  </div>
                )}

                {(p.status === 'sent' || p.status === 'replied') && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" /> Resposta do lead:
                    </div>
                    <textarea
                      value={leadReply[p.id] ?? ''}
                      onChange={(e) => setLeadReply((s) => ({ ...s, [p.id]: e.target.value }))}
                      rows={2}
                      placeholder="Cola aqui o que o lead respondeu..."
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => logLeadReply(p)} className="rounded-md bg-secondary px-3 py-1.5 text-xs hover:bg-secondary/80">
                        Salvar resposta
                      </button>
                      <button
                        onClick={() => generateMsg.mutate({ id: p.id, mode: 'reply' })}
                        disabled={generateMsg.isPending}
                        className="flex items-center gap-1 rounded-md gradient-primary text-primary-foreground px-3 py-1.5 text-xs"
                      >
                        <Sparkles className="h-3 w-3" /> Sugerir réplica
                      </button>
                    </div>
                    {replyDraft[p.id] && (
                      <>
                        <textarea
                          value={replyDraft[p.id]}
                          onChange={(e) => setReplyDraft((s) => ({ ...s, [p.id]: e.target.value }))}
                          rows={3}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                        <button
                          onClick={() => sendReply(p)}
                          className="w-full flex items-center justify-center gap-2 rounded-md bg-emerald-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-emerald-500"
                        >
                          <Send className="h-4 w-4" /> Enviar réplica via WhatsApp
                        </button>
                      </>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button onClick={async () => {
                        await updateProspect.mutateAsync({ id: p.id, patch: { status: 'closed_won' } });
                        const { data, error } = await supabase.functions.invoke('prospect-learn', { body: { prospect_id: p.id, outcome: 'won' } });
                        if (error) toast.error('Lição não foi gerada'); else if ((data as any)?.ok) toast.success(`📚 Lição salva: ${(data as any).lesson}`);
                      }}
                        className="flex-1 rounded-md bg-emerald-600/20 text-emerald-300 px-3 py-1.5 text-xs">
                        Fechou ✓
                      </button>
                      <button onClick={async () => {
                        await updateProspect.mutateAsync({ id: p.id, patch: { status: 'closed_lost' } });
                        const { data, error } = await supabase.functions.invoke('prospect-learn', { body: { prospect_id: p.id, outcome: 'lost' } });
                        if (error) toast.error('Lição não foi gerada'); else if ((data as any)?.ok) toast.success(`📚 Lição salva: ${(data as any).lesson}`);
                      }}
                        className="flex-1 rounded-md bg-rose-600/20 text-rose-300 px-3 py-1.5 text-xs">
                        Recusou ✗
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SuperAdminRemoteProspecting;
