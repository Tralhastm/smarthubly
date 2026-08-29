import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Bot, MessageSquare, Calculator, UserCheck, Phone, TrendingUp, Inbox, CheckCircle2 } from 'lucide-react';

type Conv = {
  id: string;
  bot_id: string;
  telefone_cliente: string;
  mensagem: string | null;
  resposta_bot: string | null;
  intencao: string | null;
  item_catalogo: string | null;
  servico: string | null;
  preco_estimado: string | null;
  status_orcamento: string | null;
  humano_encaminhado: boolean;
  created_at: string;
};

const badgeCls = (s: string) =>
  s === 'fechado'
    ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
    : s === 'pendente'
      ? 'bg-amber-100 text-amber-700 border border-amber-300'
      : 'bg-slate-100 text-slate-600 border border-slate-300';

const cardCls = 'rounded-lg border border-border bg-card p-4';
const bigNum = 'text-2xl font-bold text-foreground';
const smallLabel = 'text-[10px] uppercase tracking-wider text-muted-foreground';

export default function TenantWhatsAppBot() {
  const [botId, setBotId] = useState<string | null>(null);
  const [botNome, setBotNome] = useState('');
  const [convs, setConvs] = useState<Conv[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFiltro, setStatusFiltro] = useState<string>('todos');

  useEffect(() => {
    const carregar = async () => {
      setLoading(true);
      try {
        // O bot do lojista é o registro ativo de whatsapp_bots vinculado ao tenant (ou o único ativo)
        const { data: bots, error: eb } = await supabase
          .from('whatsapp_bots')
          .select('id, loja_nome, telefone')
          .eq('ativo', true)
          .limit(1);
        if (eb) throw eb;
        const bot = bots?.[0] ?? null;
        setBotId(bot?.id ?? null);
        setBotNome(bot?.loja_nome ?? '');
        if (bot?.id) {
          let q = supabase
            .from('bot_conversas')
            .select('*')
            .eq('bot_id', bot.id)
            .order('created_at', { ascending: false })
            .limit(200);
          if (statusFiltro !== 'todos') q = q.eq('status_orcamento', statusFiltro);
          const { data, error } = await q;
          if (error) throw error;
          setConvs(data || []);
        } else {
          setConvs([]);
        }
      } catch (e: any) {
        toast.error('Erro ao carregar o desempenho do bot: ' + (e?.message || e));
      } finally {
        setLoading(false);
      }
    };
    carregar();
    /* eslint-disable-next-line */
  }, [statusFiltro]);

  // recarregar a cada 30s enquanto a aba estiver aberta
  useEffect(() => {
    const t = setInterval(() => setConvs(c => c), 30000);
    return () => clearInterval(t);
  }, []);

  const total = convs.length;
  const orcamentos = convs.filter(c => c.status_orcamento && c.status_orcamento !== 'aberto' || c.servico).length;
  const fechados = convs.filter(c => c.status_orcamento === 'fechado').length;
  const encaminhados = convs.filter(c => c.humano_encaminhado).length;
  const clientesUnicos = new Set(convs.map(c => c.telefone_cliente)).size;

  const fmtTel = (t: string) =>
    t ? `+${t.replace(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/, '$1 $2 $3-$4')}` : '';

  const marcarStatus = async (c: Conv, status: string) => {
    const { error } = await supabase
      .from('bot_conversas')
      .update({ status_orcamento: status })
      .eq('id', c.id);
    if (error) {
      toast.error('Erro ao atualizar: ' + (error.message || error));
      return;
    }
    toast.success(status === 'fechado' ? 'Orçamento marcado como FECHADO 🎉' : 'Status atualizado');
    setConvs(cs => cs.map(x => (x.id === c.id ? { ...x, status_orcamento: status } : x)));
  };

  const marcarEncaminhado = async (c: Conv) => {
    const { error } = await supabase
      .from('bot_conversas')
      .update({ humano_encaminhado: true })
      .eq('id', c.id);
    if (error) {
      toast.error('Erro ao encaminhar: ' + (error.message || error));
      return;
    }
    toast.success('Marcado para atendimento humano — contate: ' + fmtTel(c.telefone_cliente));
    setConvs(cs => cs.map(x => (x.id === c.id ? { ...x, humano_encaminhado: true } : x)));
  };

  if (loading) {
    return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><TrendingUp className="h-4 w-4 animate-pulse" /> Carregando desempenho do bot…</div>;
  }

  if (!botId) {
    return (
      <div className={cardCls + ' text-center py-10'}>
        <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          Nenhum bot WhatsApp ativo para sua loja.{' '}
          <span className="text-primary font-medium">Peça ao suporte da SmartHubly para ativar o Bot WhatsApp na sua loja.</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Bot className="h-4 w-4" />
        <span>
          Bot ativo: <b className="text-foreground">{botNome}</b> — acompanhe aqui tudo que o bot decide e cada orçamento gerado.
        </span>
      </div>

      {/* Cartões de desempenho */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className={cardCls}>
          <MessageSquare className="h-4 w-4 text-muted-foreground mb-1" />
          <div className={bigNum}>{total}</div>
          <div className={smallLabel}>Conversas (7d)</div>
        </div>
        <div className={cardCls}>
          <Calculator className="h-4 w-4 text-muted-foreground mb-1" />
          <div className={bigNum}>{orcamentos}</div>
          <div className={smallLabel}>Orçamentos gerados</div>
        </div>
        <div className={cardCls}>
          <CheckCircle2 className="h-4 w-4 text-emerald-600 mb-1" />
          <div className={bigNum}>{fechados}</div>
          <div className={smallLabel}>Orçamentos fechados</div>
        </div>
        <div className={cardCls}>
          <UserCheck className="h-4 w-4 text-muted-foreground mb-1" />
          <div className={bigNum}>{clientesUnicos}</div>
          <div className={smallLabel}>Clientes atendidos</div>
        </div>
        <div className={cardCls}>
          <Phone className="h-4 w-4 text-muted-foreground mb-1" />
          <div className={bigNum}>{encaminhados}</div>
          <div className={smallLabel}>Encaminhados p/ você</div>
        </div>
      </div>

      {/* Filtro de orçamentos */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Ver:</span>
        {['todos', 'pendente', 'fechado', 'aberto'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFiltro(s)}
            className={
              'rounded-md border px-2.5 py-1 capitalize ' +
              (statusFiltro === s
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:text-foreground')
            }
          >
            {s}
          </button>
        ))}
      </div>

      {/* Histórico */}
      <div className="space-y-2">
        {convs.length === 0 && (
          <div className={cardCls + ' text-center py-8'}>
            <Inbox className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
            <p className="text-xs text-muted-foreground">Nenhuma conversa registrada ainda. Converse com o bot no WhatsApp para começar.</p>
          </div>
        )}
        {convs.map(c => (
          <div key={c.id} className={cardCls + ' grid gap-1 sm:grid-cols-[1fr_auto]'}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="font-medium text-foreground">{fmtTel(c.telefone_cliente || '')}</span>
                <span className="text-muted-foreground">{new Date(c.created_at).toLocaleString('pt-BR')}</span>
                {c.status_orcamento && <span className={'rounded px-1.5 py-0.5 text-[10px] capitalize ' + badgeCls(c.status_orcamento)}>{c.status_orcamento}</span>}
                {c.humano_encaminhado && <span className="rounded bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px]">👤 Humano</span>}
              </div>
              <p className="text-xs text-foreground mt-1 break-words">👤 {c.mensagem || '(vazio)'}</p>
              {c.resposta_bot && <p className="text-xs text-muted-foreground break-words">🤖 {c.resposta_bot}</p>}
              {c.preco_estimado && <p className="text-xs font-semibold text-emerald-700 mt-0.5">💰 Estimativa: {c.preco_estimado}</p>}
              {(c.item_catalogo || c.servico) && <p className="text-[11px] text-muted-foreground">📋 {c.item_catalogo || c.servico}</p>}
            </div>
            <div className="flex flex-col gap-1 justify-start sm:items-end">
              {c.status_orcamento !== 'fechado' && (c.status_orcamento === 'pendente' || c.status_orcamento === 'aberto') && (
                <button
                  onClick={() => marcarStatus(c, 'fechado')}
                  className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-100"
                >
                  Marcar como fechado
                </button>
              )}
              {!c.humano_encaminhado && (
                <button
                  onClick={() => marcarEncaminhado(c)}
                  className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-100"
                >
                  Assumir atendimento 👤
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
