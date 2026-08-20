import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Bot, Plus, Trash2, X, Check, Package, Calculator, Settings2, Upload } from 'lucide-react';

export type BotRow = {
  id: string;
  loja_nome: string;
  telefone: string;
  segmento: string;
  mensagem_boas_vindas: string;
  humano_telefone: string;
  tom_conversa: string;
  horario_atendimento: string;
  ativo: boolean;
  created_at?: string;
  catalog?: { id: string; nome: string; descricao: string; preco: string | number | null; unidade: string }[];
  orcamentos?: { id: string; servico: string; material: string; preco_min: string | number | null; preco_max: string | number | null; observacao: string }[];
  regras?: { id: string; chave: string; valor: string; descricao: string }[];
};

const EMPTY: Omit<BotRow, 'id'> = {
  loja_nome: '', telefone: '', segmento: '', mensagem_boas_vindas: '',
  humano_telefone: '', tom_conversa: 'amigavel', horario_atendimento: '', ativo: true,
};

const inputCls = "w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary";
const labelCls = "block text-[10px] uppercase tracking-wider text-muted-foreground mb-1";

/* ---------------- componente de edição de um bot (modal) ---------------- */
export const BotEditor = ({ bot, onSave, onClose }: { bot: BotRow | null; onSave: () => void; onClose: () => void }) => {
  const isEdit = !!bot;
  const [form, setForm] = useState<Omit<BotRow, 'id' | 'catalog' | 'orcamentos' | 'regras'>>(
    bot ? ({} as Omit<BotRow, 'id'>) : EMPTY,
  );
  useEffect(() => {
    if (bot) {
      setForm({
        loja_nome: bot.loja_nome || '', telefone: bot.telefone || '', segmento: bot.segmento || '',
        mensagem_boas_vindas: bot.mensagem_boas_vindas || '', humano_telefone: bot.humano_telefone || '',
        tom_conversa: bot.tom_conversa || 'amigavel', horario_atendimento: bot.horario_atendimento || '',
        ativo: bot.ativo !== false,
      });
    }
  }, [bot]);

  const [catalog, setCatalog] = useState<BotRow['catalog']>(bot?.catalog || []);
  const [orcamentos, setOrcamentos] = useState<BotRow['orcamentos']>(bot?.orcamentos || []);
  const [regras, setRegras] = useState<BotRow['regras']>(bot?.regras || []);
  const [saving, setSaving] = useState(false);

  const carregarDetalhes = async () => {
    if (!isEdit) return;
    const [c, o, r] = await Promise.all([
      supabase.from('bot_catalog').select('*').eq('bot_id', bot!.id).order('posicao'),
      supabase.from('bot_orcamentos').select('*').eq('bot_id', bot!.id),
      supabase.from('bot_regras').select('*').eq('bot_id', bot!.id),
    ]);
    setCatalog(c.data || []);
    setOrcamentos(o.data || []);
    setRegras(r.data || []);
  };
  useEffect(() => { carregarDetalhes(); /* eslint-disable-next-line */ }, []);

  const setField = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.loja_nome.trim() || !form.telefone.trim()) {
      toast.error('Preencha o nome da loja e o telefone (com DDD e código do país, ex: 5511999990001)');
      return;
    }
    const tel = form.telefone.replace(/[^\d+]/g, '');
    setSaving(true);
    try {
      const payload = { ...form, telefone: tel };
      if (isEdit) {
        const { error } = await supabase.from('whatsapp_bots').update(payload).eq('id', bot!.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('whatsapp_bots').insert(payload).select('id').single();
        if (error) throw error;
        bot = { id: data.id, ...payload, catalog: [], orcamentos: [], regras: [] } as BotRow;
      }
      const botId = bot!.id;
      // catálogo
      const { error: cErr } = await supabase.from('bot_catalog').delete().eq('bot_id', botId);
      if (cErr) throw cErr;
      if (catalog.length) {
        const { error } = await supabase.from('bot_catalog').insert(
          catalog.map((c, i) => ({ bot_id: botId, nome: c.nome, descricao: c.descricao, preco: c.preco === '' || c.preco == null ? null : Number(c.preco), unidade: c.unidade || 'un', posicao: i })),
        );
        if (error) throw error;
      }
      // orçamentos
      const { error: oErr } = await supabase.from('bot_orcamentos').delete().eq('bot_id', botId);
      if (oErr) throw oErr;
      if (orcamentos.length) {
        const { error } = await supabase.from('bot_orcamentos').insert(
          orcamentos.map(o => ({ bot_id: botId, servico: o.servico, material: o.material, preco_min: o.preco_min == null || o.preco_min === '' ? null : Number(o.preco_min), preco_max: o.preco_max == null || o.preco_max === '' ? null : Number(o.preco_max), observacao: o.observacao })),
        );
        if (error) throw error;
      }
      // regras
      const { error: rErr } = await supabase.from('bot_regras').delete().eq('bot_id', botId);
      if (rErr) throw rErr;
      if (regras.length) {
        const { error } = await supabase.from('bot_regras').insert(
          regras.map(r => ({ bot_id: botId, chave: r.chave, valor: r.valor, descricao: r.descricao })),
        );
        if (error) throw error;
      }
      toast.success(isEdit ? 'Bot atualizado!' : 'Bot criado! O cliente agora será atendido pelo bot personalizado.');
      onSave();
    } catch (e: any) {
      toast.error(e?.message || e?.details || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-3xl rounded-xl border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-heading text-base text-gradient">{isEdit ? 'Editar bot' : 'Novo bot WhatsApp'} — {form.loja_nome || 'sem nome'}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-5 p-5">
          {/* aba 1: dados da loja */}
          <section className="space-y-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">① Loja e atendimento</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className={labelCls}>Nome da loja *</label><input className={inputCls} value={form.loja_nome} onChange={e => setField('loja_nome', e.target.value)} placeholder="Ex: Serralheria do Zé" /></div>
              <div><label className={labelCls}>WhatsApp do bot * <span className="normal-case">(número da loja)</span></label><input className={inputCls} value={form.telefone} onChange={e => setField('telefone', e.target.value)} placeholder="5511999990001" /></div>
              <div><label className={labelCls}>Segmento da loja</label><input className={inputCls} value={form.segmento} onChange={e => setField('segmento', e.target.value)} placeholder="Ex: serralheria, pizzaria, laticínios" /></div>
              <div><label className={labelCls}>Telefone do humano <span className="normal-case">(encaminhamento)</span></label><input className={inputCls} value={form.humano_telefone} onChange={e => setField('humano_telefone', e.target.value)} placeholder="5511988880001" /></div>
              <div><label className={labelCls}>Horário de atendimento</label><input className={inputCls} value={form.horario_atendimento} onChange={e => setField('horario_atendimento', e.target.value)} placeholder="Seg-Sex 8h-18h" /></div>
              <div><label className={labelCls}>Tom da conversa</label>
                <select className={inputCls} value={form.tom_conversa} onChange={e => setField('tom_conversa', e.target.value)}>
                  <option value="amigavel">Amigável</option>
                  <option value="formal">Formal</option>
                  <option value="divertido">Divertido</option>
                  <option value="premium">Premium / sofisticado</option>
                </select>
              </div>
              <div className="sm:col-span-2"><label className={labelCls}>Mensagem de boas-vindas <span className="normal-case">(deixar vazio = automática)</span></label>
                <textarea className={inputCls} rows={2} value={form.mensagem_boas_vindas} onChange={e => setField('mensagem_boas_vindas', e.target.value)} placeholder="Olá! Bem-vindo(a) à loja X! Me diz o que você precisa 😊" />
              </div>
              <div className="flex items-center gap-2 pt-4">
                <input type="checkbox" id="bot-ativo" checked={form.ativo} onChange={e => setField('ativo', e.target.checked)} className="accent-primary" />
                <label htmlFor="bot-ativo" className="text-xs text-muted-foreground">Bot ativo (desligue para pausar o atendimento)</label>
              </div>
            </div>
          </section>

          {/* aba 2: catálogo */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Package className="h-3.5 w-3.5" /> Catálogo de produtos</h4>
              <button type="button" onClick={() => setCatalog([...(catalog || []), { id: '', nome: '', descricao: '', preco: null, unidade: 'un' }])}
                className="flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"><Plus className="h-3 w-3" /> Produto</button>
            </div>
            {(catalog || []).map((c, i) => (
              <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-md border border-border bg-secondary/30 p-2">
                <div className="col-span-4"><label className={labelCls}>Nome *</label><input className={inputCls} value={c.nome} onChange={e => setCatalog(catalog!.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} placeholder="Portão de correr 3m" /></div>
                <div className="col-span-4"><label className={labelCls}>Descrição</label><input className={inputCls} value={c.descricao} onChange={e => setCatalog(catalog!.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)))} placeholder="Aço galvanizado" /></div>
                <div className="col-span-2"><label className={labelCls}>Preço R$</label><input className={inputCls} type="number" inputMode="decimal" value={c.preco ?? ''} onChange={e => setCatalog(catalog!.map((x, j) => (j === i ? { ...x, preco: e.target.value === '' ? null : e.target.value } : x)))} placeholder="1800" /></div>
                <div className="col-span-1"><label className={labelCls}>Un.</label><input className={inputCls} value={c.unidade} onChange={e => setCatalog(catalog!.map((x, j) => (j === i ? { ...x, unidade: e.target.value } : x)))} placeholder="un" /></div>
                <div className="col-span-1 flex justify-end"><button type="button" onClick={() => setCatalog(catalog!.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></div>
              </div>
            ))}
            {(!catalog || catalog.length === 0) && <p className="text-[11px] text-muted-foreground">Ainda não há produtos cadastrados — os clientes compram pelo catálogo.</p>}
          </section>

          {/* aba 3: orçamentos */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Calculator className="h-3.5 w-3.5" /> Tabela de orçamentos / serviços</h4>
              <button type="button" onClick={() => setOrcamentos([...(orcamentos || []), { id: '', servico: '', material: '', preco_min: null, preco_max: null, observacao: '' }])}
                className="flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"><Plus className="h-3 w-3" /> Serviço</button>
            </div>
            {(orcamentos || []).map((o, i) => (
              <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-md border border-border bg-secondary/30 p-2">
                <div className="col-span-3"><label className={labelCls}>Serviço *</label><input className={inputCls} value={o.servico} onChange={e => setOrcamentos(orcamentos!.map((x, j) => (j === i ? { ...x, servico: e.target.value } : x)))} placeholder="Grade de proteção" /></div>
                <div className="col-span-2"><label className={labelCls}>Material</label><input className={inputCls} value={o.material} onChange={e => setOrcamentos(orcamentos!.map((x, j) => (j === i ? { ...x, material: e.target.value } : x)))} placeholder="inox" /></div>
                <div className="col-span-2"><label className={labelCls}>Mín. R$</label><input className={inputCls} type="number" inputMode="decimal" value={o.preco_min ?? ''} onChange={e => setOrcamentos(orcamentos!.map((x, j) => (j === i ? { ...x, preco_min: e.target.value === '' ? null : e.target.value } : x)))} placeholder="250" /></div>
                <div className="col-span-2"><label className={labelCls}>Máx. R$</label><input className={inputCls} type="number" inputMode="decimal" value={o.preco_max ?? ''} onChange={e => setOrcamentos(orcamentos!.map((x, j) => (j === i ? { ...x, preco_max: e.target.value === '' ? null : e.target.value } : x)))} placeholder="400" /></div>
                <div className="col-span-2"><label className={labelCls}>Obs.</label><input className={inputCls} value={o.observacao} onChange={e => setOrcamentos(orcamentos!.map((x, j) => (j === i ? { ...x, observacao: e.target.value } : x)))} placeholder="por m²" /></div>
                <div className="col-span-1 flex justify-end"><button type="button" onClick={() => setOrcamentos(orcamentos!.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></div>
              </div>
            ))}
            {(!orcamentos || orcamentos.length === 0) && <p className="text-[11px] text-muted-foreground">Sem tabela de orçamento — a IA ainda responde, mas sem faixa de preço para esses serviços.</p>}
          </section>

          {/* aba 4: regras */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Settings2 className="h-3.5 w-3.5" /> Regras personalizadas</h4>
              <button type="button" onClick={() => setRegras([...(regras || []), { id: '', chave: '', valor: '', descricao: '' }])}
                className="flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"><Plus className="h-3 w-3" /> Regra</button>
            </div>
            <p className="text-[11px] text-muted-foreground">Regras em linguagem natural — a IA respeita todas. Ex: chave <code>promocao</code> / valor <code>10% off à vista</code>. Use <code>nao_vender</code> para listar o que a loja NÃO faz.</p>
            {(regras || []).map((r, i) => (
              <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-md border border-border bg-secondary/30 p-2">
                <div className="col-span-2"><label className={labelCls}>Chave</label><input className={inputCls} value={r.chave} onChange={e => setRegras(regras!.map((x, j) => (j === i ? { ...x, chave: e.target.value } : x)))} placeholder="promocao" /></div>
                <div className="col-span-8"><label className={labelCls}>Regra (linguagem natural)</label><input className={inputCls} value={r.valor} onChange={e => setRegras(regras!.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} placeholder="10% de desconto no pagamento à vista" /></div>
                <div className="col-span-1 flex justify-end"><button type="button" onClick={() => setRegras(regras!.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></div>
              </div>
            ))}
          </section>

          {/* aba 5: importação rápida */}
          <section className="space-y-2 rounded-md border border-dashed border-border bg-secondary/20 p-3">
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Upload className="h-3.5 w-3.5" /> Importar catálogo de texto</h4>
            <p className="text-[11px] text-muted-foreground">Cole uma lista de produtos no formato <code>nome | descrição | preço</code> (uma linha por produto, o preço é opcional). O texto vai direto para o catálogo.</p>
            <textarea id="import-cat" rows={4} className={inputCls} placeholder={"Portão de correr 3m | aço galvanizado | 1800\nGrade de proteção 2m | inox | 600\nPérgola 4x3 | madeira e aço | 2500"} />
            <button type="button" onClick={() => {
              const txt = (document.getElementById('import-cat') as HTMLTextAreaElement)?.value || '';
              const lines = txt.split('\n').map(l => l.trim()).filter(Boolean);
              if (!lines.length) { toast.error('Cole pelo menos uma linha'); return; }
              const parsed = lines.map(l => {
                const [nome, ...rest] = l.split('|').map(s => s.trim());
                const last = rest[rest.length - 1];
                const preco = last && /^\d+(?:[.,]\d+)?$/.test(last.replace(',', '.')) ? Number(last.replace(',', '.')) : null;
                const descricao = preco !== null ? rest.slice(0, -1).join(' ') : rest.join(' ');
                return { id: '', nome: nome || '', descricao, preco, unidade: 'un' };
              }).filter(p => p.nome);
              if (!parsed.length) { toast.error('Nenhum produto válido encontrado'); return; }
              setCatalog([...(catalog || []), ...parsed]);
              (document.getElementById('import-cat') as HTMLTextAreaElement).value = '';
              toast.success(`${parsed.length} produto(s) adicionado(s) ao catálogo`);
            }} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"><Upload className="h-3 w-3" /> Adicionar ao catálogo</button>
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="rounded-md border border-border bg-secondary px-4 py-2 text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> {saving ? 'Salvando...' : 'Salvar bot'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- componente principal da aba ---------------- */
const SuperAdminWhatsAppBots = () => {
  const [bots, setBots] = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<BotRow | null | 'new'>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('whatsapp_bots').select('*').order('created_at', { ascending: false });
    if (error) toast.error('Erro ao carregar bots: ' + error.message);
    else setBots(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const excluir = async (id: string, nome: string) => {
    if (!window.confirm(`Excluir o bot "${nome}"? O catálogo, orçamentos e regras serão apagados junto.`)) return;
    const { error } = await supabase.from('whatsapp_bots').delete().eq('id', id);
    if (error) toast.error(error.message || 'Erro ao excluir');
    else { toast.success('Bot excluído'); load(); }
  };

  const toggleAtivo = async (id: string, ativo: boolean) => {
    const { error } = await supabase.from('whatsapp_bots').update({ ativo: !ativo }).eq('id', id);
    if (error) toast.error(error.message || 'Erro ao alterar status');
    else { toast.success(!ativo ? 'Bot ativado!' : 'Bot pausado!'); load(); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl text-gradient">🤖 Bot WhatsApp</h2>
          <p className="text-xs text-muted-foreground">Bots personalizados por lojista: catálogo, orçamentos e regras próprias. O bot no celular lê essa configuração automaticamente pelo número.</p>
        </div>
        <button onClick={() => setEditor('new')} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Novo bot
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : bots.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-secondary/20 py-14">
          <Bot className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhum bot cadastrado ainda.</p>
          <p className="max-w-md text-center text-xs text-muted-foreground">Cadastre o primeiro: número do WhatsApp da loja, nome, catálogo e regras. A partir daí, o bot daquele número é 100% personalizado.</p>
          <button onClick={() => setEditor('new')} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"><Plus className="h-3.5 w-3.5" /> Criar primeiro bot</button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-secondary/40">
              <tr>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Loja</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">WhatsApp do bot</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Segmento</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Catálogo</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Orçamentos</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Regras</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {bots.map(b => (
                <tr key={b.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                  <td className="px-4 py-3 font-medium text-foreground">{b.loja_nome}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.telefone}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.segmento || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{(b.catalog || []).length} itens</td>
                  <td className="px-4 py-3 text-muted-foreground">{(b.orcamentos || []).length} serviços</td>
                  <td className="px-4 py-3 text-muted-foreground">{(b.regras || []).length} regras</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleAtivo(b.id, b.ativo)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium ${b.ativo ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${b.ativo ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
                      {b.ativo ? 'Ativo' : 'Pausado'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditor(b)} className="rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">Editar</button>
                    <button onClick={() => excluir(b.id, b.loja_nome)} className="ml-1.5 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor !== null && (
        <BotEditor
          bot={editor === 'new' ? null : editor}
          onSave={() => { setEditor(null); load(); }}
          onClose={() => setEditor(null)}
        />
      )}

      <div className="rounded-lg border border-border bg-secondary/20 p-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <b className="text-foreground">Como funciona:</b> o bot no Termux envia cada mensagem do cliente para a Edge Function da SmartHubly
          (<code>qbcplbcdxoyqpmcehnvu.supabase.co/functions/v1/serralheria-intent</code>) junto com o número de quem mandou.
          A função busca a configuração, o catálogo, a tabela de orçamentos e as regras do bot daquele número, e responde de acordo.
          Se o número não estiver cadastrado aqui, o bot usa as respostas padrão de fábrica. Custo: R$ 0 (Gemini free tier com cascata de chaves e modelos).
        </p>
      </div>
    </div>
  );
};

export default SuperAdminWhatsAppBots;
