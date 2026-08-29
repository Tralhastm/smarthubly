import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { BadgeDollarSign, Check, Copy, Plus, Save, Trash2, Users, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type Seller = { id: string; name: string; phone: string | null; pix_key: string | null; pix_key_type: string | null; commission_percent: number; active: boolean };
type SellerCode = { id: string; seller_id: string; code: string; discount_type: 'percent' | 'fixed'; discount_value: number; active: boolean; max_uses: number | null; uses_count: number; };
type ReportRow = { seller_id: string; product_name: string; quantity: number; line_total: number; discount_amount: number; commission_amount: number; created_at: string; };

const money = (n: number) => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;

export default function TenantSellerManagement({ tenantId }: { tenantId: string }) {
  const { toast } = useToast();
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [codes, setCodes] = useState<SellerCode[]>([]);
  const [report, setReport] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seller, setSeller] = useState({ name: '', phone: '', pix_key: '', pix_key_type: 'aleatória', commission_percent: '0' });
  const [selectedSeller, setSelectedSeller] = useState('');
  const [code, setCode] = useState({ code: '', discount_type: 'percent', discount_value: '0', max_uses: '' });

  const load = async () => {
    setLoading(true);
    const [{ data: sellerRows }, { data: codeRows }, { data: reportRows }] = await Promise.all([
      (supabase as any).from('sellers').select('id,name,phone,pix_key,pix_key_type,commission_percent,active').eq('tenant_id', tenantId).order('name'),
      (supabase as any).from('seller_codes').select('id,seller_id,code,discount_type,discount_value,active,max_uses,uses_count').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      (supabase as any).from('seller_order_items').select('seller_id,product_name,quantity,line_total,discount_amount,commission_amount,created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(500),
    ]);
    setSellers((sellerRows || []) as Seller[]); setCodes((codeRows || []) as SellerCode[]); setReport((reportRows || []) as ReportRow[]); setLoading(false);
  };
  useEffect(() => { void load(); }, [tenantId]);

  const totals = useMemo(() => report.reduce((a, r) => ({ sales: a.sales + Number(r.line_total || 0), discount: a.discount + Number(r.discount_amount || 0), commission: a.commission + Number(r.commission_amount || 0) }), { sales: 0, discount: 0, commission: 0 }), [report]);
  const sellerName = (id: string) => sellers.find(s => s.id === id)?.name || 'Vendedor removido';

  const saveSeller = async () => {
    if (!seller.name.trim()) return toast({ title: 'Informe o nome do vendedor', variant: 'destructive' });
    setSaving(true);
    const { error } = await (supabase as any).from('sellers').insert({ tenant_id: tenantId, name: seller.name.trim(), phone: seller.phone.trim() || null, pix_key: seller.pix_key.trim() || null, pix_key_type: seller.pix_key_type, commission_percent: Number(seller.commission_percent) || 0 });
    setSaving(false);
    if (error) return toast({ title: 'Não foi possível cadastrar', description: error.message, variant: 'destructive' });
    setSeller({ name: '', phone: '', pix_key: '', pix_key_type: 'aleatória', commission_percent: '0' }); await load(); toast({ title: 'Vendedor cadastrado' });
  };

  const saveCode = async () => {
    if (!selectedSeller || !code.code.trim()) return toast({ title: 'Escolha o vendedor e informe o código', variant: 'destructive' });
    const { error } = await (supabase as any).from('seller_codes').insert({ tenant_id: tenantId, seller_id: selectedSeller, code: code.code.trim().toUpperCase(), discount_type: code.discount_type, discount_value: Number(code.discount_value) || 0, max_uses: code.max_uses ? Number(code.max_uses) : null });
    if (error) return toast({ title: 'Não foi possível salvar o código', description: error.message, variant: 'destructive' });
    setCode({ code: '', discount_type: 'percent', discount_value: '0', max_uses: '' }); await load(); toast({ title: 'Código vinculado ao vendedor' });
  };

  const toggleCode = async (row: SellerCode) => { await (supabase as any).from('seller_codes').update({ active: !row.active }).eq('id', row.id); await load(); };
  const deleteSeller = async (id: string) => { if (!window.confirm('Excluir este vendedor e seus códigos?')) return; const { error } = await (supabase as any).from('sellers').delete().eq('id', id); if (error) toast({ title: 'Não foi possível excluir', description: error.message, variant: 'destructive' }); else await load(); };
  const copy = async (text: string) => { await navigator.clipboard?.writeText(text); toast({ title: 'Código copiado' }); };

  if (loading) return <div className="p-6 text-muted-foreground">Carregando vendedores…</div>;
  return <div className="space-y-6">
    <div><h2 className="text-xl font-bold flex items-center gap-2"><Users className="h-5 w-5" /> Vendedores</h2><p className="text-sm text-muted-foreground mt-1">Cadastre vendedores, vincule códigos e acompanhe quanto cada um tem a receber.</p></div>
    <div className="grid md:grid-cols-2 gap-4">
      <section className="rounded-xl border bg-card p-4 space-y-3"><h3 className="font-semibold flex items-center gap-2"><Plus className="h-4 w-4" /> Novo vendedor</h3>
        <input className="w-full rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Nome completo" value={seller.name} onChange={e => setSeller({ ...seller, name: e.target.value })} />
        <input className="w-full rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Telefone / WhatsApp" value={seller.phone} onChange={e => setSeller({ ...seller, phone: e.target.value })} />
        <div className="grid grid-cols-2 gap-2"><select className="rounded-lg border bg-background px-3 py-2 text-sm" value={seller.pix_key_type} onChange={e => setSeller({ ...seller, pix_key_type: e.target.value })}><option>aleatória</option><option>CPF</option><option>CNPJ</option><option>telefone</option><option>e-mail</option></select><input type="number" min="0" max="100" step="0.01" className="rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Comissão %" value={seller.commission_percent} onChange={e => setSeller({ ...seller, commission_percent: e.target.value })} /></div>
        <input className="w-full rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Chave Pix" value={seller.pix_key} onChange={e => setSeller({ ...seller, pix_key: e.target.value })} />
        <button disabled={saving} onClick={saveSeller} className="w-full rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold flex justify-center gap-2"><Save className="h-4 w-4" /> {saving ? 'Salvando…' : 'Cadastrar vendedor'}</button>
      </section>
      <section className="rounded-xl border bg-card p-4 space-y-3"><h3 className="font-semibold flex items-center gap-2"><BadgeDollarSign className="h-4 w-4" /> Código e desconto</h3>
        <select className="w-full rounded-lg border bg-background px-3 py-2 text-sm" value={selectedSeller} onChange={e => setSelectedSeller(e.target.value)}><option value="">Selecione o vendedor</option>{sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input className="w-full rounded-lg border bg-background px-3 py-2 text-sm uppercase" placeholder="CÓDIGO DO VENDEDOR" value={code.code} onChange={e => setCode({ ...code, code: e.target.value })} />
        <div className="grid grid-cols-3 gap-2"><select className="rounded-lg border bg-background px-2 py-2 text-sm" value={code.discount_type} onChange={e => setCode({ ...code, discount_type: e.target.value })}><option value="percent">%</option><option value="fixed">R$</option></select><input type="number" min="0" className="rounded-lg border bg-background px-2 py-2 text-sm" placeholder="Desconto" value={code.discount_value} onChange={e => setCode({ ...code, discount_value: e.target.value })} /><input type="number" min="1" className="rounded-lg border bg-background px-2 py-2 text-sm" placeholder="Limite" value={code.max_uses} onChange={e => setCode({ ...code, max_uses: e.target.value })} /></div>
        <button onClick={saveCode} className="w-full rounded-lg bg-secondary text-secondary-foreground px-4 py-2 text-sm font-semibold">Vincular código</button>
        <div className="space-y-2 max-h-40 overflow-auto">{codes.map(c => <div key={c.id} className="flex items-center justify-between rounded-lg border p-2 text-sm"><span><b>{c.code}</b> · {sellerName(c.seller_id)}<small className="block text-muted-foreground">{c.discount_type === 'percent' ? `${c.discount_value}%` : money(c.discount_value)} · {c.uses_count} uso(s)</small></span><span className="flex gap-1"><button title="Copiar" onClick={() => copy(c.code)} className="p-1"><Copy className="h-4 w-4" /></button><button onClick={() => toggleCode(c)} className={`px-2 py-1 rounded text-xs ${c.active ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>{c.active ? 'Ativo' : 'Inativo'}</button></span></div>)}</div>
      </section>
    </div>
    <section className="rounded-xl border bg-card p-4"><h3 className="font-semibold flex items-center gap-2 mb-3"><Wallet className="h-4 w-4" /> Resumo de comissões</h3><div className="grid grid-cols-3 gap-2 mb-4"><div className="rounded-lg bg-muted p-3"><small>Vendas</small><b className="block">{money(totals.sales)}</b></div><div className="rounded-lg bg-muted p-3"><small>Descontos</small><b className="block">{money(totals.discount)}</b></div><div className="rounded-lg bg-primary/10 p-3"><small>A pagar</small><b className="block">{money(totals.commission)}</b></div></div>
      <div className="space-y-2">{sellers.map(s => { const rows = report.filter(r => r.seller_id === s.id); const due = rows.reduce((n, r) => n + Number(r.commission_amount || 0), 0); return <div key={s.id} className="rounded-lg border p-3"><div className="flex justify-between gap-2"><div><b>{s.name}</b><p className="text-xs text-muted-foreground">{s.phone || 'Sem telefone'} · Pix: {s.pix_key || 'não informado'} · Comissão: {s.commission_percent}%</p></div><strong>{money(due)}</strong></div>{rows.length > 0 && <div className="mt-2 overflow-auto"><table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Data</th><th>Produto</th><th>Qtd.</th><th>Desconto</th><th>Comissão</th></tr></thead><tbody>{rows.map((r, i) => <tr key={`${r.created_at}-${i}`} className="border-t"><td>{new Date(r.created_at).toLocaleDateString('pt-BR')}</td><td>{r.product_name}</td><td>{r.quantity}</td><td>{money(r.discount_amount)}</td><td>{money(r.commission_amount)}</td></tr>)}</tbody></table></div>}<button onClick={() => deleteSeller(s.id)} className="mt-2 text-xs text-destructive flex items-center gap-1"><Trash2 className="h-3 w-3" /> Excluir vendedor</button></div> })}{sellers.length === 0 && <p className="text-sm text-muted-foreground">Nenhum vendedor cadastrado.</p>}</div>
    </section>
  </div>;
}
