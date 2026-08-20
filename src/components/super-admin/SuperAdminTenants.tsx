import { useState } from 'react';
import { useTenants, useAddTenant, useUpdateTenant, useDeleteTenant, type Tenant } from '@/hooks/useTenants';
import { useProducts, useAddProduct } from '@/hooks/useProducts';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { generateSlug } from '@/lib/store';
import { Plus, Edit, Trash2, Check, X, Store, ExternalLink, Package, Sparkles, Eraser, Loader2, Bot } from 'lucide-react';
import ImageUploadField from '@/components/shared/ImageUploadField';
import { ADMIN_SUBTABS, subTabKey } from '@/lib/admin-subtabs';
import { BotEditor, type BotRow as WABoTRow } from './SuperAdminWhatsAppBots';

const telDigits = (t: string) => String(t || '').replace(/[^0-9]/g, '');
const loadBots = async (): Promise<WABoTRow[]> => {
  const { data } = await supabase.from('whatsapp_bots').select('*');
  return (data || []) as WABoTRow[];
};

// ---- Controle das abas do painel do lojista (o super admin decide o que aparece e como se chama)
export type TabsConfig = Record<string, { hidden?: boolean; label?: string }>;

const ADMIN_TABS: { id: string; label: string; group: string }[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'Início' },
  { id: 'orders', label: 'Pedidos', group: 'Operação' },
  { id: 'customer-chats', label: 'Mensagens', group: 'Operação' },
  { id: 'quicksale', label: 'Venda Rápida', group: 'Operação' },
  { id: 'live-floor', label: 'Salão ao Vivo', group: 'Operação' },
  { id: 'tables', label: 'Mesas (Garçom)', group: 'Operação' },
  { id: 'scheduling', label: 'Agenda', group: 'Operação' },
  { id: 'drivers', label: 'Motoboys', group: 'Operação' },
  { id: 'printer', label: 'Impressora', group: 'Operação' },
  { id: 'consultora', label: 'WhatsApp Consultora', group: 'Operação' },
  { id: 'products', label: 'Produtos', group: 'Catálogo' },
  { id: 'quotes', label: 'Orçamento', group: 'Catálogo' },
  { id: 'stock', label: 'Estoque', group: 'Catálogo' },
  { id: 'suppliers', label: 'Fornecedores', group: 'Catálogo' },
  { id: 'shipping', label: 'Frete', group: 'Catálogo' },
  { id: 'ficha', label: 'Ficha Técnica/CMV', group: 'Financeiro' },
  { id: 'financial', label: 'Empresarial', group: 'Financeiro' },
  { id: 'finance-deep', label: 'Financeiro Avançado', group: 'Financeiro' },
  { id: 'reports', label: 'Relatórios Op.', group: 'Financeiro' },
  { id: 'sales', label: 'Vendas', group: 'Financeiro' },
  { id: 'commissions', label: 'Comissões', group: 'Financeiro' },
  { id: 'abc', label: 'Curva ABC', group: 'Financeiro' },
  { id: 'bi', label: 'BI / Previsão', group: 'Financeiro' },
  { id: 'billing', label: 'Cobranças', group: 'Financeiro' },
  { id: 'promo', label: 'Promoção', group: 'Marketing' },
  { id: 'posts', label: 'Posts IA', group: 'Marketing' },
  { id: 'coupons', label: 'Cupons', group: 'Marketing' },
  { id: 'reviews', label: 'Avaliações', group: 'Marketing' },
  { id: 'emails', label: 'E-mails', group: 'Marketing' },
  { id: 'appearance', label: 'Aparência', group: 'Configurações' },
  { id: 'integrations', label: 'Integrações', group: 'Configurações' },
  { id: 'fiscal', label: 'Fiscal (NFC-e)', group: 'Configurações' },
  { id: 'automations', label: 'Automações', group: 'Configurações' },
  { id: 'monitor', label: 'Monitor', group: 'Configurações' },
  { id: 'diagnostic', label: 'Diagnóstico', group: 'Configurações' },
  { id: 'support', label: 'Suporte & Treino', group: 'Configurações' },
  { id: 'users', label: 'Usuários', group: 'Configurações' },
];

const AdminTabsConfigEditor = ({ value, onChange }: { value: TabsConfig; onChange: (v: TabsConfig) => void }) => {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const set = (id: string, patch: { hidden?: boolean; label?: string }) => {
    const next = { ...value, [id]: { ...(value[id] || {}), ...patch } };
    if (!next[id].hidden && !next[id].label) delete next[id];
    onChange(next);
  };
  const groups = Array.from(new Set(ADMIN_TABS.map(t => t.group)));
  const hiddenCount = Object.values(value).filter(v => v?.hidden).length;

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <span className="text-xs font-medium text-foreground">🧩 Abas e sub-abas do painel do lojista</span>
        <span className="text-[10px] text-muted-foreground">{hiddenCount > 0 ? `${hiddenCount} ocultas` : 'todas visíveis'} · {open ? 'fechar' : 'editar'}</span>
      </button>
      {open && (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          <p className="text-[10px] text-muted-foreground">
            Desmarque para esconder a aba no painel da loja. Escreva ao lado para renomear.
            Abas com <b>sub-abas</b> têm o botão “sub-abas” — dá pra esconder/renomear cada uma separadamente.
          </p>
          {groups.map(g => (
            <div key={g} className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{g}</p>
              {ADMIN_TABS.filter(t => t.group === g).map(t => {
                const subs = ADMIN_SUBTABS[t.id] || [];
                const hiddenSubs = subs.filter(s => value[subTabKey(t.id, s.id)]?.hidden).length;
                const isOpen = expanded === t.id;
                return (
                  <div key={t.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={!value[t.id]?.hidden} onChange={e => set(t.id, { hidden: !e.target.checked })} className="accent-primary" />
                      <span className="w-40 shrink-0 truncate text-xs text-foreground">{t.label}</span>
                      <input value={value[t.id]?.label || ''} onChange={e => set(t.id, { label: e.target.value })}
                        placeholder="renomear (opcional)"
                        className="flex-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground" />
                      {subs.length > 0 && (
                        <button type="button" onClick={() => setExpanded(isOpen ? null : t.id)}
                          className="shrink-0 rounded border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground">
                          {isOpen ? '▲' : '▼'} sub-abas{hiddenSubs > 0 ? ` (${hiddenSubs} ocultas)` : ''}
                        </button>
                      )}
                    </div>
                    {isOpen && subs.length > 0 && (
                      <div className="ml-6 space-y-1 border-l border-border pl-3">
                        {subs.map(s => {
                          const key = subTabKey(t.id, s.id);
                          return (
                            <div key={s.id} className="flex items-center gap-2">
                              <input type="checkbox" checked={!value[key]?.hidden} onChange={e => set(key, { hidden: !e.target.checked })} className="accent-primary" />
                              <span className="w-36 shrink-0 truncate text-[11px] text-muted-foreground">{s.label}</span>
                              <input value={value[key]?.label || ''} onChange={e => set(key, { label: e.target.value })}
                                placeholder="renomear sub-aba (opcional)"
                                className="flex-1 rounded border border-border bg-card px-2 py-1 text-[11px] text-foreground" />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const SuperAdminTenants = () => {
  const { data: tenants = [], isLoading } = useTenants();
  const addTenantMutation = useAddTenant();
  const updateTenantMutation = useUpdateTenant();
  const deleteTenantMutation = useDeleteTenant();
  const addProductMutation = useAddProduct();

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [addingProducts, setAddingProducts] = useState<string | null>(null);
  const [createBot, setCreateBot] = useState(false);
  const [bots, setBots] = useState<WABoTRow[]>([]);
  const [botEditor, setBotEditor] = useState<WABoTRow | null | 'new'>(null);
  useEffect(() => { loadBots().then(setBots); }, []);
  const botByTenant = (t: Tenant): WABoTRow | undefined => {
    const tels = [telDigits((t as any).whatsapp), telDigits((t as any).phone)].filter(Boolean);
    return bots.find(b => tels.includes(telDigits(b.telefone)));
  };
  const openTenantBot = (t: Tenant) => {
    const linked = botByTenant(t);
    if (linked) {
      setBotEditor(linked);
    } else {
      setBotEditor({
        id: '', loja_nome: t.name, telefone: (t as any).whatsapp || t.phone || '',
        segmento: (t as any).niche || '', mensagem_boas_vindas: (t as any).description || '',
        humano_telefone: '', tom_conversa: 'amigavel', horario_atendimento: '', ativo: true,
        catalog: [], orcamentos: [], regras: [],
      } as any);
    }
  };
  const [form, setForm] = useState({
    name: '', slug: '', logo_url: '', address: '', phone: '', whatsapp: '', description: '',
    delivery_mode: 1, platform_fee: '5.00', platform_fee_percent: '5', mercadopago_token: '',
    is_dropshipping: false, niche: '', is_donated: false,
    billing_mode: 'per_order' as 'per_order' | 'monthly_fixed',
    billing_email: '',
  });
  const [productForm, setProductForm] = useState({ name: '', price: '', category: 'Geral', description: '', image: '' });

  const handleAdd = async () => {
    if (!form.name) return;
    const slug = form.slug || generateSlug(form.name);
    const isMonthly = form.billing_mode === 'monthly_fixed';
    try {
    await addTenantMutation.mutateAsync({
      name: form.name, slug, logo_url: form.logo_url, address: form.address,
      phone: form.phone, whatsapp: form.whatsapp, description: form.description,
      delivery_mode: form.delivery_mode,
      // Mensalidade fixa zera taxa por pedido
      platform_fee: isMonthly ? 0 : (parseFloat(form.platform_fee) || 5),
      platform_fee_percent: isMonthly ? 0 : (parseFloat(form.platform_fee_percent) || 5),
      is_dropshipping: form.is_dropshipping, niche: form.niche,
      active: true, mercadopago_token: form.mercadopago_token || null,
      is_donated: form.is_donated,
      billing_mode: form.billing_mode,
      monthly_fee: 60,
      billing_email: form.billing_email || null,
    } as any);
    toast.success(`Loja "${form.name}" cadastrada!`);
    setForm({ name: '', slug: '', logo_url: '', address: '', phone: '', whatsapp: '', description: '', delivery_mode: 1, platform_fee: '5.00', platform_fee_percent: '5', mercadopago_token: '', is_dropshipping: false, niche: '', is_donated: false, billing_mode: 'per_order', billing_email: '' });
    setShowAdd(false);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.toLowerCase().includes('slug') && msg.toLowerCase().includes('em uso')) toast.error(msg);
      else if (msg.includes('23505') || msg.includes('unique') || msg.includes('duplicate')) toast.error('Já existe uma loja com esse slug. Escolha outro nome ou slug.');
      else toast.error(`Erro ao cadastrar a loja: ${msg}`);
      return;
    }
    // Criar o bot vinculado se marcado (comércio bot-only ou site+bot)
    if (createBot) {
      const tel = telDigits(form.whatsapp || form.phone);
      if (tel) {
        const { data, error } = await supabase.from('whatsapp_bots').insert({
          loja_nome: form.name, telefone: tel, segmento: form.niche,
          mensagem_boas_vindas: form.description || '', ativo: true,
        }).select('*').single();
        if (error) toast.error('Loja criada, mas o bot falhou: ' + error.message);
        else { toast.success('🤖 Bot WhatsApp criado e vinculado ao comércio!'); loadBots().then(setBots); setBotEditor(data as WABoTRow); }
      } else {
        toast.warning('Loja criada. Preencha o telefone para vincular o bot depois (botão 🤖 no card).');
      }
    }
  };

  const handleUpdate = async (t: Tenant) => {
    try {
      await updateTenantMutation.mutateAsync(t);
      toast.success('Alterações salvas!');
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err?.message || String(err)}`);
    }
    setEditing(null);
  };
  const handleDelete = (id: string) => { if (!confirm('Tem certeza? Todos os dados deste comércio serão apagados.')) return; deleteTenantMutation.mutate(id); };

  const handleAddProduct = (tenantId: string) => {
    if (!productForm.name || !productForm.price) return;
    addProductMutation.mutate({ tenant_id: tenantId, name: productForm.name, price: parseFloat(productForm.price), category: productForm.category || 'Geral', description: productForm.description, image: productForm.image, in_stock: true });
    setProductForm({ name: '', price: '', category: 'Geral', description: '', image: '' });
  };

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-4">
      <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90">
        <Plus className="h-4 w-4" /> Novo Comércio
      </button>

      {showAdd && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value, slug: generateSlug(e.target.value) })} placeholder="Nome do comércio" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder="slug-url" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          </div>
          <ImageUploadField value={form.logo_url} onChange={url => setForm({ ...form, logo_url: url })} tenantId="logos" transparentBg label="Logo do comércio" />
          <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Endereço completo" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Telefone" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            <input value={form.whatsapp} onChange={e => setForm({ ...form, whatsapp: e.target.value })} placeholder="WhatsApp" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          </div>
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descrição" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          <input value={form.niche} onChange={e => setForm({ ...form, niche: e.target.value })} placeholder="Nicho (ex: Adega, Açaíteria, Pizzaria...)" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Modalidade</label>
              <select value={form.delivery_mode} onChange={e => setForm({ ...form, delivery_mode: Number(e.target.value) })} className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
                <option value={1}>1 - Sem motoboy</option>
                <option value={2}>2 - Com motoboy</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Taxa plataforma (%)</label>
              <input value={form.platform_fee_percent} onChange={e => setForm({ ...form, platform_fee_percent: e.target.value })} type="number" step="0.1" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            </div>
          </div>
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
            <label className="text-xs font-medium text-foreground">💰 Modelo de cobrança</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setForm({ ...form, billing_mode: 'per_order' })}
                className={`rounded-lg px-3 py-2 text-sm font-medium border ${form.billing_mode === 'per_order' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary text-foreground'}`}>
                Por pedido
              </button>
              <button type="button" onClick={() => setForm({ ...form, billing_mode: 'monthly_fixed' })}
                className={`rounded-lg px-3 py-2 text-sm font-medium border ${form.billing_mode === 'monthly_fixed' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary text-foreground'}`}>
                Mensalidade R$60
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {form.billing_mode === 'monthly_fixed' ? '✓ Lojista paga R$60/mês fixo. Sem taxa por pedido.' : '✓ Lojista paga taxa por cada pedido (5% padrão).'}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={form.is_dropshipping} onChange={e => setForm({ ...form, is_dropshipping: e.target.checked })} className="accent-primary" />
            Dropshipping (fornecedores controlam estoque/envio)
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={form.is_donated} onChange={e => setForm({ ...form, is_donated: e.target.checked })} className="accent-primary" />
            🎁 Loja doada (não conta nos meus lucros)
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
            <input type="checkbox" checked={createBot} onChange={e => setCreateBot(e.target.checked)} className="accent-primary" />
            <span>🤖 Criar também o <b>Bot WhatsApp</b> deste comércio (atendimento automático no número informado)</span>
          </label>
          <div>
            <label className="text-xs text-muted-foreground">Token Mercado Pago (opcional)</label>
            <input value={form.mercadopago_token} onChange={e => setForm({ ...form, mercadopago_token: e.target.value })} placeholder="APP_USR-..." type="password" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">📧 E-mail de cobrança (lojista)</label>
            <input value={form.billing_email} onChange={e => setForm({ ...form, billing_email: e.target.value })} placeholder="lojista@email.com" type="email" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            <p className="text-[10px] text-muted-foreground mt-1">Para envio de cobranças/avisos de mensalidade</p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={addTenantMutation.isPending} className="flex items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm"><Check className="h-4 w-4" /> Cadastrar</button>
            <button onClick={() => setShowAdd(false)} className="flex items-center gap-1 rounded-lg bg-secondary text-muted-foreground px-4 py-2 text-sm"><X className="h-4 w-4" /> Cancelar</button>
          </div>
        </div>
      )}

      {tenants.map(t => (
        <TenantCard key={t.id} tenant={t} isEditing={editing === t.id} isAddingProducts={addingProducts === t.id}
          onEdit={() => setEditing(t.id)} onSave={handleUpdate} onCancel={() => setEditing(null)} onDelete={() => handleDelete(t.id)}
          onToggleProducts={() => setAddingProducts(addingProducts === t.id ? null : t.id)}
          productForm={productForm} setProductForm={setProductForm} onAddProduct={() => handleAddProduct(t.id)}
          onOpenBot={openTenantBot} bot={botByTenant(t)} />
      ))}

      {botEditor !== null && (
        <BotEditor bot={botEditor === 'new' ? null : botEditor} onClose={() => setBotEditor(null)}
          onSave={() => { setBotEditor(null); loadBots().then(setBots); }} />
      )}
    </div>
  );
};

const TenantCard = ({ tenant, isEditing, isAddingProducts, onEdit, onSave, onCancel, onDelete, onToggleProducts, productForm, setProductForm, onAddProduct, onOpenBot, bot }: {
  tenant: Tenant; isEditing: boolean; isAddingProducts: boolean;
  onEdit: () => void; onSave: (t: Tenant) => void; onCancel: () => void; onDelete: () => void;
  onToggleProducts: () => void; productForm: any; setProductForm: any; onAddProduct: () => void;
  onOpenBot: (t: Tenant) => void; bot?: WABoTRow;
}) => {
  const [form, setForm] = useState(tenant);
  const { data: products = [] } = useProducts(tenant.id);
  const updateTenantMutation = useUpdateTenant();
  const storeUrl = `/loja/${tenant.slug}`;

  if (isEditing) {
    return (
      <div className="rounded-lg border border-primary/30 bg-card p-4 space-y-3">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
        <input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" placeholder="slug" />
        <ImageUploadField value={form.logo_url || ''} onChange={url => setForm({ ...form, logo_url: url })} tenantId="logos" transparentBg label="Logo" />
        <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
        <input value={(form as any).niche || ''} onChange={e => setForm({ ...form, niche: e.target.value } as any)} placeholder="Nicho" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Taxa plataforma (%)</label>
            <input value={(form as any).platform_fee_percent ?? 5} onChange={e => setForm({ ...form, platform_fee_percent: parseFloat(e.target.value) || 0 } as any)} type="number" step="0.1" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Modalidade</label>
            <select value={form.delivery_mode} onChange={e => setForm({ ...form, delivery_mode: Number(e.target.value) })} className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
              <option value={1}>1 - Sem motoboy</option>
              <option value={2}>2 - Com motoboy</option>
            </select>
          </div>
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
          <label className="text-xs font-medium text-foreground">💰 Modelo de cobrança</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setForm({ ...form, billing_mode: 'per_order', platform_fee_percent: (form as any).platform_fee_percent || 5 } as any)}
              className={`rounded-lg px-3 py-2 text-sm font-medium border ${((form as any).billing_mode || 'per_order') === 'per_order' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary text-foreground'}`}>
              Por pedido
            </button>
            <button type="button" onClick={() => setForm({ ...form, billing_mode: 'monthly_fixed', platform_fee: 0, platform_fee_percent: 0 } as any)}
              className={`rounded-lg px-3 py-2 text-sm font-medium border ${(form as any).billing_mode === 'monthly_fixed' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary text-foreground'}`}>
              Mensalidade R$60
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {(form as any).billing_mode === 'monthly_fixed' ? '✓ R$60/mês fixo. Sem taxa por pedido.' : '✓ Taxa por cada pedido.'}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={(form as any).is_dropshipping ?? false} onChange={e => setForm({ ...form, is_dropshipping: e.target.checked } as any)} className="accent-primary" />
          Dropshipping
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={(form as any).is_donated ?? false} onChange={e => setForm({ ...form, is_donated: e.target.checked } as any)} className="accent-primary" />
          🎁 Loja doada
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} className="accent-primary" />
          Ativo
        </label>
        <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
          <label className="text-xs font-medium text-foreground">💳 Provedor de pagamento online</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setForm({ ...form, payment_provider: 'mercadopago' } as any)}
              className={`rounded-lg px-3 py-2 text-xs font-medium border ${((form as any).payment_provider || 'mercadopago') === 'mercadopago' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary text-foreground'}`}>
              Mercado Pago
            </button>
            <button type="button" onClick={() => setForm({ ...form, payment_provider: 'pagbank' } as any)}
              className={`rounded-lg px-3 py-2 text-xs font-medium border ${(form as any).payment_provider === 'pagbank' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary text-foreground'}`}>
              PagBank
            </button>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Token Mercado Pago</label>
            <input value={(form as any).mercadopago_token || ''} onChange={e => setForm({ ...form, mercadopago_token: e.target.value } as any)} placeholder="APP_USR-..." type="password" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Token PagBank</label>
            <input value={(form as any).pagbank_token || ''} onChange={e => setForm({ ...form, pagbank_token: e.target.value } as any)} placeholder="Token da API PagBank" type="password" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Ambiente PagBank</label>
            <select value={(form as any).pagbank_env || 'sandbox'} onChange={e => setForm({ ...form, pagbank_env: e.target.value } as any)}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
              <option value="sandbox">Sandbox (teste)</option>
              <option value="production">Produção</option>
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">Webhook: <code className="text-[10px]">/functions/v1/pagbank-webhook</code> — adicione esta URL nas notificações do PagBank.</p>
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">📧 E-mail de cobrança (lojista)</label>
          <input value={(form as any).billing_email || ''} onChange={e => setForm({ ...form, billing_email: e.target.value } as any)} placeholder="lojista@email.com" type="email" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
        </div>
        <AdminTabsConfigEditor
          value={((form as any).admin_tabs_config || {}) as TabsConfig}
          onChange={cfg => setForm({ ...form, admin_tabs_config: cfg } as any)}
        />
        <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
          <label className="text-xs font-medium text-foreground">🏬 Site (modo supermercado)</label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={(((form as any).storefront_config || {}) as any).partner_enabled !== false}
              onChange={e => setForm({ ...form, storefront_config: { ...(((form as any).storefront_config || {}) as any), partner_enabled: e.target.checked } } as any)}
              className="accent-primary"
            />
            Seção "Seja nosso parceiro" no site
          </label>
          <div>
            <label className="text-xs text-muted-foreground">WhatsApp de contato do site</label>
            <input
              value={(((form as any).storefront_config || {}) as any).contact_whatsapp || ''}
              onChange={e => setForm({ ...form, storefront_config: { ...(((form as any).storefront_config || {}) as any), contact_whatsapp: e.target.value } } as any)}
              placeholder="5531982675538"
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Todos os contatos do site vão para este número. Vazio = WhatsApp da loja.</p>
          </div>
        </div>
        <div className="flex gap-2">

          <button onClick={() => onSave(form)} className="flex items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-3 py-1.5 text-sm"><Check className="h-3 w-3" /> Salvar</button>
          <button onClick={onCancel} className="flex items-center gap-1 rounded-lg bg-secondary text-muted-foreground px-3 py-1.5 text-sm"><X className="h-3 w-3" /> Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {tenant.logo_url ? (
            <img src={tenant.logo_url} alt="" className="h-10 w-10 rounded-md object-cover" />
          ) : (
            <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
              <Store className="h-5 w-5 text-primary" />
            </div>
          )}
          <div>
            <p className="font-medium text-foreground">{tenant.name}</p>
            <p className="text-xs text-muted-foreground">
              /{tenant.slug} · {tenant.active ? '🟢 Ativo' : '🔴 Inativo'} · Modo {tenant.delivery_mode}
              {(tenant as any).billing_mode === 'monthly_fixed' ? ' · 💵 R$60/mês' : ` · Taxa ${(tenant as any).platform_fee_percent ?? 5}%`}
              {(tenant as any).is_dropshipping && ' · 📦 Dropshipping'}
              {(tenant as any).is_donated && ' · 🎁 Doada'}
              {bot && <span className={bot.ativo !== false ? ' text-green-600 font-medium' : ' text-destructive font-medium'}> · 🤖 Bot WhatsApp {bot.ativo !== false ? 'ativo' : 'pausado'}</span>}
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <a href={storeUrl} target="_blank" rel="noopener noreferrer" className="rounded-md p-2 text-muted-foreground hover:text-primary hover:bg-primary/10" title="Ver loja"><ExternalLink className="h-4 w-4" /></a>
          <button onClick={onToggleProducts} className="rounded-md p-2 text-muted-foreground hover:text-primary hover:bg-primary/10" title="Produtos"><Package className="h-4 w-4" /></button>
          <button onClick={() => onOpenBot(tenant)} className={`rounded-md p-2 hover:bg-primary/10 ${bot ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`} title={bot ? 'Editar bot WhatsApp' : 'Criar bot WhatsApp'}><Bot className="h-4 w-4" /></button>
          <button onClick={onEdit} className="rounded-md p-2 text-muted-foreground hover:text-primary hover:bg-primary/10"><Edit className="h-4 w-4" /></button>
          <button onClick={onDelete} className="rounded-md p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      {tenant.address && <p className="text-xs text-muted-foreground">📍 {tenant.address}</p>}
      <p className="text-xs text-muted-foreground">{products.length} produto(s) cadastrado(s)</p>

      <DemoControls tenantId={tenant.id} tenantName={tenant.name} />

      {/* Features opcionais (controle do super admin) */}
      <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
        <p className="text-xs font-medium text-foreground">🎛️ Funcionalidades extras</p>
        <p className="text-[11px] text-muted-foreground">Libere ou esconda abas pra essa loja.</p>
        <FeatureToggle
          label="📅 Agenda (Agendamento)"
          checked={!!(tenant as any).scheduling_enabled}
          onChange={(v) => updateTenantMutation.mutate({ ...tenant, scheduling_enabled: v } as any)}
        />
        <FeatureToggle
          label="🧮 Orçamento"
          checked={!!(tenant as any).quotes_feature_enabled}
          onChange={(v) => updateTenantMutation.mutate({ ...tenant, quotes_feature_enabled: v } as any)}
        />
        <FeatureToggle
          label="🧪 Pagamento DEMO (simular MP)"
          checked={!!(tenant as any).demo_payment_enabled}
          onChange={(v) => updateTenantMutation.mutate({ ...tenant, demo_payment_enabled: v } as any)}
        />
        <FeatureToggle
          label="🚚 Uber Direct DEMO (chaves da plataforma — sandbox)"
          checked={!!(tenant as any).uber_direct_use_platform_keys}
          onChange={(v) => updateTenantMutation.mutate({ ...tenant, uber_direct_use_platform_keys: v } as any)}
        />
      </div>

      {/* Bloqueio da loja (calote, fraude, etc) */}
      <div className={`rounded-lg border p-3 space-y-2 ${(tenant as any).blocked ? 'border-destructive/50 bg-destructive/10' : 'border-border bg-secondary/30'}`}>
        <p className="text-xs font-medium text-foreground">🚫 Bloqueio da loja</p>
        <p className="text-[11px] text-muted-foreground">
          {(tenant as any).blocked
            ? 'Loja BLOQUEADA — clientes e o lojista não conseguem acessar.'
            : 'Bloqueia loja sem excluir (calote, suspeita, etc). Reversível.'}
        </p>
        {(tenant as any).blocked && (tenant as any).blocked_reason && (
          <p className="text-[11px] text-destructive">Motivo: {(tenant as any).blocked_reason}</p>
        )}
        <button
          onClick={() => {
            if ((tenant as any).blocked) {
              if (!confirm(`Desbloquear a loja "${tenant.name}"?`)) return;
              updateTenantMutation.mutate({ ...tenant, blocked: false, blocked_reason: null, blocked_at: null } as any);
            } else {
              // Seletor de motivos predefinidos + motivo livre
              const presets = [
                'Fotos irregulares no catálogo',
                'Produtos proibidos no catálogo',
                'Preços abusivos',
                'Pendência financeira',
                'Denúncia de cliente',
              ];
              const preset = prompt(
                `Bloquear a loja "${tenant.name}".\n\nMotivos sugeridos:\n${presets.map((p, i) => `[${i + 1}] ${p}`).join('\n')}\n\nDigite o número do motivo ou escreva outro (será mostrado pro lojista):`,
                '1'
              );
              if (!preset) return;
              const idx = parseInt(preset, 10) - 1;
              const reason = idx >= 0 && idx < presets.length ? presets[idx] : preset;
              updateTenantMutation.mutate({ ...tenant, blocked: true, blocked_reason: reason, blocked_at: new Date().toISOString() } as any);
            }
          }}
          className={`w-full rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            (tenant as any).blocked
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
          }`}
        >
          {(tenant as any).blocked ? '🔓 Desbloquear loja' : '🔒 Bloquear loja'}
        </button>
      </div>

      {isAddingProducts && (
        <div className="border-t border-border pt-3 space-y-3">
          <h4 className="text-sm font-medium text-foreground">Adicionar Produto</h4>
          <div className="grid grid-cols-2 gap-2">
            <input value={productForm.name} onChange={(e: any) => setProductForm({ ...productForm, name: e.target.value })} placeholder="Nome" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            <input value={productForm.price} onChange={(e: any) => setProductForm({ ...productForm, price: e.target.value })} placeholder="Preço" type="number" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={productForm.category} onChange={(e: any) => setProductForm({ ...productForm, category: e.target.value })} placeholder="Categoria" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            <input value={productForm.image} onChange={(e: any) => setProductForm({ ...productForm, image: e.target.value })} placeholder="URL da imagem" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          </div>
          <input value={productForm.description} onChange={(e: any) => setProductForm({ ...productForm, description: e.target.value })} placeholder="Descrição" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          <button onClick={onAddProduct} className="flex items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-3 py-1.5 text-sm"><Plus className="h-3 w-3" /> Adicionar</button>
          {products.length > 0 && (
            <div className="space-y-1 mt-2">
              {products.map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs bg-secondary rounded-md px-2 py-1.5">
                  <span className="text-foreground">{p.name}</span>
                  <span className="text-primary font-medium">R${p.price.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const DemoControls = ({ tenantId, tenantName }: { tenantId: string; tenantName: string }) => {
  const qc = useQueryClient();
  const [loading, setLoading] = useState<'seed' | 'clear' | null>(null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['products', tenantId] });
    qc.invalidateQueries({ queryKey: ['orders', tenantId] });
    qc.invalidateQueries({ queryKey: ['financial_entries', tenantId] });
    qc.invalidateQueries({ queryKey: ['debts', tenantId] });
    qc.invalidateQueries({ queryKey: ['credit_accounts', tenantId] });
  };

  const run = async (action: 'seed' | 'clear') => {
    if (action === 'clear' && !confirm(`Apagar TODOS os dados demo de "${tenantName}"?`)) return;
    setLoading(action);
    try {
      const { data, error } = await supabase.functions.invoke('demo-data', { body: { action, tenantId } });
      if (error) throw error;
      if (action === 'seed') {
        toast.success(`Demo gerada: ${data.created.products} produtos · ${data.created.orders} pedidos · ${data.created.financial} lançamentos · ${data.created.debts} dívidas · ${data.created.credits} fiados`);
      } else {
        toast.success(`Limpeza ok: ${data.cleared.products} produtos e ${data.cleared.orders} pedidos removidos`);
      }
      invalidateAll();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao executar');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="border-t border-border pt-3 flex flex-wrap gap-2">
      <button
        onClick={() => run('seed')}
        disabled={loading !== null}
        className="flex items-center gap-1.5 rounded-lg bg-primary/10 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/20 disabled:opacity-50"
      >
        {loading === 'seed' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        Gerar Demo
      </button>
      <button
        onClick={() => run('clear')}
        disabled={loading !== null}
        className="flex items-center gap-1.5 rounded-lg bg-destructive/10 text-destructive px-3 py-1.5 text-xs font-medium hover:bg-destructive/20 disabled:opacity-50"
      >
        {loading === 'clear' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eraser className="h-3 w-3" />}
        Limpar Demo
      </button>
    </div>
  );
};

const FeatureToggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="flex w-full items-center justify-between rounded-md bg-background/50 px-2 py-1.5 text-xs hover:bg-background transition-colors"
  >
    <span className="text-foreground">{label}</span>
    <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </span>
  </button>
);

export default SuperAdminTenants;
