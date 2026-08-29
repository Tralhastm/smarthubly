import { useState } from 'react';
import { useCoupons, useUpsertCoupon, useDeleteCoupon, type Coupon } from '@/hooks/useCoupons';
import { Tag, Plus, Trash2, Loader2, Power, PowerOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const emptyForm = {
  code: '', discount_type: 'percent' as 'percent' | 'fixed', discount_value: 10,
  min_order_value: 0, max_uses: '' as string | number, expires_at: '', active: true,
};

const TenantAdminCoupons = ({ tenantId }: { tenantId: string }) => {
  const { data: coupons = [], isLoading } = useCoupons(tenantId);
  const upsert = useUpsertCoupon();
  const del = useDeleteCoupon();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState(emptyForm);

  const open = (c?: Coupon) => {
    if (c) {
      setEditing(c);
      setForm({
        code: c.code,
        discount_type: c.discount_type,
        discount_value: c.discount_value,
        min_order_value: c.min_order_value,
        max_uses: c.max_uses ?? '',
        expires_at: c.expires_at ? c.expires_at.slice(0, 10) : '',
        active: c.active,
      });
    } else {
      setEditing(null);
      setForm(emptyForm);
    }
    setShowForm(true);
  };

  const save = async () => {
    const code = form.code.trim().toUpperCase();
    if (!code) { toast({ title: 'Informe o código', variant: 'destructive' }); return; }
    if (form.discount_value <= 0) { toast({ title: 'Valor de desconto inválido', variant: 'destructive' }); return; }
    if (form.discount_type === 'percent' && form.discount_value > 100) { toast({ title: 'Percentual máximo 100%', variant: 'destructive' }); return; }
    try {
      await upsert.mutateAsync({
        ...(editing ? { id: editing.id } : {}),
        tenant_id: tenantId,
        code,
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
        min_order_value: Number(form.min_order_value) || 0,
        max_uses: form.max_uses === '' ? null : Number(form.max_uses),
        expires_at: form.expires_at ? new Date(form.expires_at + 'T23:59:59').toISOString() : null,
        active: form.active,
      });
      toast({ title: editing ? '✅ Cupom atualizado!' : '🎟️ Cupom criado!' });
      setShowForm(false);
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message?.includes('unique') ? 'Já existe um cupom com esse código' : 'Falha ao salvar', variant: 'destructive' });
    }
  };

  const toggleActive = async (c: Coupon) => {
    await upsert.mutateAsync({ id: c.id, tenant_id: tenantId, code: c.code, active: !c.active });
    toast({ title: !c.active ? 'Cupom ativado' : 'Cupom desativado' });
  };

  const remove = async (c: Coupon) => {
    if (!confirm(`Excluir cupom ${c.code}?`)) return;
    await del.mutateAsync(c.id);
    toast({ title: 'Cupom excluído' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Cupons de Desconto</h2>
        </div>
        <button onClick={() => open()} className="flex items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90">
          <Plus className="h-4 w-4" /> Novo
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-primary/30 bg-card p-4 space-y-3">
          <h3 className="font-bold text-foreground">{editing ? 'Editar cupom' : 'Novo cupom'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Código</label>
              <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="EX: PROMO10" maxLength={30}
                className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-foreground text-sm font-mono uppercase" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tipo</label>
              <select value={form.discount_type} onChange={e => setForm({ ...form, discount_type: e.target.value as any })}
                className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-foreground text-sm">
                <option value="percent">Percentual (%)</option>
                <option value="fixed">Valor fixo (R$)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Desconto {form.discount_type === 'percent' ? '(%)' : '(R$)'}</label>
              <input type="number" min={0} step={form.discount_type === 'percent' ? 1 : 0.01} value={form.discount_value}
                onChange={e => setForm({ ...form, discount_value: Number(e.target.value) })}
                className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-foreground text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Pedido mínimo (R$)</label>
              <input type="number" min={0} step={0.01} value={form.min_order_value}
                onChange={e => setForm({ ...form, min_order_value: Number(e.target.value) })}
                className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-foreground text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Limite de usos (opcional)</label>
              <input type="number" min={1} value={form.max_uses}
                onChange={e => setForm({ ...form, max_uses: e.target.value })}
                placeholder="Ilimitado"
                className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-foreground text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Validade (opcional)</label>
              <input type="date" value={form.expires_at}
                onChange={e => setForm({ ...form, expires_at: e.target.value })}
                className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-foreground text-sm" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} className="accent-primary" />
            Ativo
          </label>
          <div className="flex gap-2">
            <button onClick={save} disabled={upsert.isPending} className="flex-1 rounded-lg gradient-primary text-primary-foreground py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : 'Salvar'}
            </button>
            <button onClick={() => setShowForm(false)} className="flex-1 rounded-lg bg-secondary text-foreground py-2 text-sm font-medium">Cancelar</button>
          </div>
        </div>
      )}

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}

      {!isLoading && coupons.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
          <Tag className="h-8 w-8 mx-auto mb-2 opacity-50" />
          Nenhum cupom criado. Clique em "Novo" para começar.
        </div>
      )}

      <div className="space-y-2">
        {coupons.map(c => (
          <div key={c.id} className="rounded-lg border border-border bg-card p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-foreground">{c.code}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${c.active ? 'bg-green-500/10 text-green-400' : 'bg-muted text-muted-foreground'}`}>
                  {c.active ? 'Ativo' : 'Inativo'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {c.discount_type === 'percent' ? `${c.discount_value}% off` : `R$${c.discount_value.toFixed(2)} off`}
                {c.min_order_value > 0 && ` · mín R$${c.min_order_value.toFixed(2)}`}
                {c.max_uses && ` · ${c.uses_count}/${c.max_uses} usos`}
                {c.expires_at && ` · até ${new Date(c.expires_at).toLocaleDateString('pt-BR')}`}
              </p>
            </div>
            <button onClick={() => toggleActive(c)} className="text-muted-foreground hover:text-primary p-1.5" title={c.active ? 'Desativar' : 'Ativar'}>
              {c.active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
            </button>
            <button onClick={() => open(c)} className="text-xs text-primary hover:underline px-2">Editar</button>
            <button onClick={() => remove(c)} className="text-destructive hover:bg-destructive/10 p-1.5 rounded"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TenantAdminCoupons;
