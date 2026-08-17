import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Sparkles, Save, Loader2, Eye, EyeOff, Megaphone } from 'lucide-react';
import { toast } from 'sonner';

const TenantPromoManager = ({ tenantId, niche }: { tenantId: string; niche?: string }) => {
  const [title, setTitle] = useState('Promoção do Dia');
  const [text, setText] = useState('');
  const [active, setActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from('tenants').select('promo_title, promo_text, promo_active').eq('id', tenantId).single().then(({ data, error }) => {
      if (error) { console.error('Promo load error:', error); return; }
      if (data) {
        setTitle(data.promo_title || 'Promoção do Dia');
        setText(data.promo_text || '');
        setActive(data.promo_active || false);
      }
    });
  }, [tenantId]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('tenants').update({
      promo_title: title,
      promo_text: text,
      promo_active: active,
    }).eq('id', tenantId);
    setSaving(false);
    if (error) { toast.error('Erro ao salvar'); return; }
    toast.success('Promoção salva!');
  };

  const refineWithAI = async () => {
    if (!text.trim()) { toast.error('Escreva algo primeiro para refinar'); return; }
    setRefining(true);
    try {
      const { data, error } = await supabase.functions.invoke('refine-promo', {
        body: { text, niche: niche || '' },
      });
      if (error) throw error;
      if (data?.refined) {
        setText(data.refined);
        toast.success('Texto refinado com IA!');
      }
    } catch (err: any) {
      if (err?.status === 429) {
        toast.error('Muitas requisições. Tente novamente em alguns segundos.');
      } else if (err?.status === 402) {
        toast.error('Créditos de IA esgotados.');
      } else {
        toast.error('Erro ao refinar com IA');
      }
    }
    setRefining(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-primary" /> Promoção / Destaque
          </h3>
          <button onClick={async () => {
            const newActive = !active;
            setActive(newActive);
            const { error } = await supabase.from('tenants').update({ promo_active: newActive }).eq('id', tenantId);
            if (error) { toast.error('Erro ao atualizar visibilidade'); setActive(!newActive); return; }
            toast.success(newActive ? 'Promoção visível' : 'Promoção oculta');
          }}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
              active ? 'bg-green-500/20 text-green-400' : 'bg-secondary text-muted-foreground'
            }`}>
            {active ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {active ? 'Visível' : 'Oculto'}
          </button>
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Título (personalize como quiser)</label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Ex: Promoção do Dia, Prato do Dia, Oferta Especial..."
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Texto da promoção</label>
          <textarea value={text} onChange={e => setText(e.target.value)}
            placeholder="Descreva sua promoção, oferta especial, prato do dia..."
            rows={3}
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none" />
        </div>

        <div className="flex gap-2 flex-wrap">
          <button onClick={refineWithAI} disabled={refining || !text.trim()}
            className="flex items-center gap-2 rounded-lg bg-primary/20 text-primary px-4 py-2 text-sm font-medium hover:bg-primary/30 disabled:opacity-50 transition-all">
            {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Refinar com IA
          </button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </button>
        </div>

        {text && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs text-muted-foreground mb-1">Pré-visualização:</p>
            <p className="text-sm font-bold text-primary mb-1">{title}</p>
            <p className="text-sm text-foreground">{text}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TenantPromoManager;
