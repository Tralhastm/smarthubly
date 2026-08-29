import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import ImageUploadField from '@/components/shared/ImageUploadField';
import { STOREFRONT_DEFAULTS, type StorefrontConfig } from '@/components/tenant/SupermarketStorefront';
import { Loader2 } from 'lucide-react';

// Editor completo do "Modo Supermercado / Distribuidora".
// Tudo que aparece no site (inclusive a foto de fundo do topo) é editável aqui.
const Field = ({ label, value, onChange, hint, textarea }: { label: string; value: string; onChange: (v: string) => void; hint?: string; textarea?: boolean }) => (
  <div>
    <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
    {textarea ? (
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={4}
        className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
    ) : (
      <input value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
    )}
    {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
  </div>
);

const StorefrontEditor = ({ tenantId }: { tenantId: string }) => {
  const [cfg, setCfg] = useState<StorefrontConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('tenants').select('storefront_config').eq('id', tenantId).single().then(({ data }) => {
      setCfg(((data as any)?.storefront_config as StorefrontConfig) || {});
      setLoading(false);
    });
  }, [tenantId]);

  const set = (k: keyof StorefrontConfig) => (v: any) => setCfg(prev => ({ ...prev, [k]: v }));
  const g = (k: keyof typeof STOREFRONT_DEFAULTS) => (cfg[k] as string) ?? STOREFRONT_DEFAULTS[k];

  const badges = cfg.badges?.length ? cfg.badges : [
    { icon: 'shield', title: 'Qualidade garantida', desc: 'Produtos conferidos item a item' },
    { icon: 'truck', title: 'Entrega rápida', desc: 'Logística própria na região' },
    { icon: 'award', title: 'Preço de distribuidora', desc: 'Condições especiais no atacado' },
  ];
  const setBadge = (i: number, patch: any) => {
    const next = badges.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
    setCfg(prev => ({ ...prev, badges: next }));
  };

  const save = async () => {
    setSaving(true);
    await supabase.from('tenants').update({ storefront_config: cfg as any } as any).eq('id', tenantId);
    setSaving(false);
    import('sonner').then(m => m.toast.success('Site atualizado! Recarregue a loja para ver.'));
  };

  if (loading) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-heading text-sm">🖼️ Topo do site (banner)</h3>
        <ImageUploadField label="Foto de fundo do topo" value={cfg.hero_image || ''} onChange={set('hero_image')} tenantId={tenantId} searchQuery="laticínios queijos artesanais" />
        <Field label="Selo pequeno (acima do título)" value={g('hero_kicker')} onChange={set('hero_kicker')} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Título" value={g('hero_title')} onChange={set('hero_title')} />
          <Field label="Título destacado (cor da marca)" value={g('hero_highlight')} onChange={set('hero_highlight')} />
        </div>
        <Field label="Subtítulo" value={g('hero_subtitle')} onChange={set('hero_subtitle')} textarea />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Botão principal" value={g('cta_primary')} onChange={set('cta_primary')} />
          <Field label="Botão secundário (WhatsApp)" value={g('cta_secondary')} onChange={set('cta_secondary')} />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-heading text-sm">✅ Selos de confiança (3 blocos)</h3>
        {badges.map((b, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Ícone</label>
              <select value={b.icon || 'shield'} onChange={e => setBadge(i, { icon: e.target.value })}
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm">
                <option value="shield">Escudo (qualidade)</option>
                <option value="truck">Caminhão (entrega)</option>
                <option value="award">Medalha (preço/prêmio)</option>
              </select>
            </div>
            <Field label="Título" value={b.title} onChange={v => setBadge(i, { title: v })} />
            <Field label="Descrição" value={b.desc || ''} onChange={v => setBadge(i, { desc: v })} />
          </div>
        ))}
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-heading text-sm">🧀 Seção de produtos</h3>
        <Field label="Título" value={g('products_title')} onChange={set('products_title')} />
        <Field label="Subtítulo" value={g('products_subtitle')} onChange={set('products_subtitle')} />
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={cfg.show_prices !== false} onChange={e => setCfg(p => ({ ...p, show_prices: e.target.checked }))} className="h-4 w-4 accent-primary" />
          <span className="text-sm">Mostrar preços no site (desligado = "Sob consulta")</span>
        </label>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-heading text-sm">🏢 Sobre nós</h3>
        <Field label="Título" value={g('about_title')} onChange={set('about_title')} />
        <Field label="Texto" value={g('about_text')} onChange={set('about_text')} textarea />
        <ImageUploadField label="Imagem da seção" value={cfg.about_image || ''} onChange={set('about_image')} tenantId={tenantId} />
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-heading text-sm">🤝 Seja nosso parceiro</h3>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={cfg.partner_enabled !== false} onChange={e => setCfg(p => ({ ...p, partner_enabled: e.target.checked }))} className="h-4 w-4 accent-primary" />
          <span className="text-sm">Mostrar a seção "Seja nosso parceiro" no site</span>
        </label>
        <Field label="Título" value={g('partner_title')} onChange={set('partner_title')} />
        <Field label="Texto" value={g('partner_text')} onChange={set('partner_text')} textarea />
        <Field label="Botão" value={g('partner_cta')} onChange={set('partner_cta')} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="WhatsApp do parceiro" value={cfg.partner_whatsapp || ''} onChange={set('partner_whatsapp')} hint="Só números com DDI/DDD (ex: 5531982675538). Vazio = usa o contato geral." />
          <Field label="Mensagem pronta" value={cfg.partner_message ?? 'Quero ser parceiro'} onChange={set('partner_message')} hint="Texto que já vai escrito no WhatsApp." />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-heading text-sm">📞 Contato e rodapé</h3>
        <Field label="Título da seção" value={g('contact_title')} onChange={set('contact_title')} />
        <Field label="WhatsApp de contato do site" value={cfg.contact_whatsapp || ''} onChange={set('contact_whatsapp')} hint="Todos os botões de contato do site vão para este número. Vazio = usa o WhatsApp cadastrado da loja." />
        <Field label="Endereço" value={cfg.contact_address || ''} onChange={set('contact_address')} hint="Vazio = usa o endereço cadastrado da loja." />
        <Field label="Horário de atendimento" value={cfg.contact_hours || ''} onChange={set('contact_hours')} />
        <Field label="E-mail" value={cfg.contact_email || ''} onChange={set('contact_email')} />
        <Field label="Texto do rodapé" value={g('footer_note')} onChange={set('footer_note')} />
      </div>

      <button onClick={save} disabled={saving}
        className="w-full rounded-lg gradient-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {saving ? 'Salvando…' : 'Salvar site'}
      </button>
    </div>
  );
};

export default StorefrontEditor;
