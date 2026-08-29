import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Trash2, Copy, Printer, QrCode, Users, UserPlus, RefreshCw, Pencil } from 'lucide-react';
import WaiterComandaEditor from '@/components/tenant/WaiterComandaEditor';

interface Props {
  tenantId: string;
  slug: string;
}

interface Table {
  id: string;
  label: string;
  code: string;
  active: boolean;
}

interface Waiter {
  id: string;
  name: string;
  access_token: string;
  active: boolean;
}

interface OpenSession {
  id: string;
  table_label: string;
  customer_name: string;
  total: number;
  share_code: string | null;
  assigned_waiter_name: string | null;
  status: string;
  opened_at: string;
}

export default function TenantAdminTables({ tenantId, slug }: Props) {
  const [tables, setTables] = useState<Table[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [openSessions, setOpenSessions] = useState<OpenSession[]>([]);
  const [assignOpenFor, setAssignOpenFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [newWaiter, setNewWaiter] = useState('');
  const [tablesEnabled, setTablesEnabled] = useState(false);
  const [editingSession, setEditingSession] = useState<any>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const load = async () => {
    setLoading(true);
    const [t, w, tn, os] = await Promise.all([
      (supabase as any).from('restaurant_tables').select('*').eq('tenant_id', tenantId).order('label'),
      (supabase as any).from('waiters').select('*').eq('tenant_id', tenantId).order('name'),
      (supabase as any).from('tenants').select('tables_enabled').eq('id', tenantId).maybeSingle(),
      (supabase as any).from('table_sessions').select('id,table_label,customer_name,total,share_code,assigned_waiter_name,status,opened_at')
        .eq('tenant_id', tenantId).in('status', ['open', 'sent']).order('opened_at'),
    ]);
    setTables(t.data || []);
    setWaiters(w.data || []);
    setTablesEnabled(tn.data?.tables_enabled || false);
    setOpenSessions(os.data || []);
    setLoading(false);
  };

  const releaseSession = async (id: string, label: string) => {
    if (!confirm(`Liberar ${label}? A comanda será cancelada.`)) return;
    const { error } = await (supabase as any).from('table_sessions').update({ status: 'cancelled' }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${label} liberada`);
    load();
  };

  const reassignSession = async (sessionId: string, waiterId: string, waiterName: string) => {
    const { error } = await (supabase as any).from('table_sessions').update({
      assigned_waiter_id: waiterId,
      assigned_waiter_name: waiterName,
    }).eq('id', sessionId);
    if (error) { toast.error(error.message); return; }
    toast.success(`Comanda movida para ${waiterName}`);
    load();
  };

  useEffect(() => { load(); }, [tenantId]);

  // Migração leve: garantir code/active em mesas antigas sem código
  useEffect(() => {
    if (tables.length > 0 && tables.some(t => !t.code)) {
      (async () => {
        const missing = tables.filter(t => !t.code);
        for (const t of missing) {
          await (supabase as any).from('restaurant_tables')
            .update({ code: genCode(), active: 't' }).eq('id', t.id);
        }
        load();
      })();
    }
  }, [tables.length]);

  const toggleEnabled = async (v: boolean) => {
    setTablesEnabled(v);
    await (supabase as any).from('tenants').update({ tables_enabled: v }).eq('id', tenantId);
    toast.success(v ? 'Modo Mesas ativado' : 'Modo Mesas desativado');
  };

  const genCode = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

  const addTable = async () => {
    if (!newLabel.trim()) return;
    const { error } = await (supabase as any).from('restaurant_tables').insert({
      tenant_id: tenantId, label: newLabel.trim(),
      code: genCode(), active: 't',
    });
    if (error) { toast.error(error.message); return; }
    setNewLabel(''); load();
  };

  const addBatch = async (n: number) => {
    const start = tables.length + 1;
    const rows = Array.from({ length: n }, (_, i) => ({
      tenant_id: tenantId, label: `Mesa ${start + i}`,
      code: genCode(), active: 't',
    }));
    const { error } = await (supabase as any).from('restaurant_tables').insert(rows);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const removeTable = async (id: string) => {
    if (!confirm('Excluir esta mesa? Comandas em aberto serão removidas.')) return;
    await (supabase as any).from('restaurant_tables').delete().eq('id', id);
    load();
  };

  const genToken = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');

  const addWaiter = async () => {
    if (!newWaiter.trim()) return;
    const { error } = await (supabase as any).from('waiters').insert({
      tenant_id: tenantId, name: newWaiter.trim(),
      access_token: genToken(), active: true,
    });
    if (error) { toast.error(error.message); return; }
    setNewWaiter(''); load();
    toast.success('Garçom adicionado');
  };

  // Migração leve: gerar token para garçons antigos sem access_token
  useEffect(() => {
    if (waiters.length > 0 && waiters.some(w => !w.access_token)) {
      (async () => {
        const missing = waiters.filter(w => !w.access_token);
        for (const w of missing) {
          await (supabase as any).from('waiters')
            .update({ access_token: genToken(), active: true }).eq('id', w.id);
        }
        load();
      })();
    }
  }, [waiters.length]);

  const removeWaiter = async (id: string) => {
    if (!confirm('Remover este garçom? O link dele para de funcionar.')) return;
    await (supabase as any).from('waiters').delete().eq('id', id);
    load();
  };

  const renewWaiter = async (id: string) => {
    if (!confirm('Gerar novo link? O atual deixa de funcionar.')) return;
    const newToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    await (supabase as any).from('waiters').update({ access_token: newToken }).eq('id', id);
    load();
    toast.success('Link renovado');
  };

  const toggleWaiter = async (id: string, active: boolean) => {
    const { error } = await (supabase as any)
      .from('waiters').update({ active: !active }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
    toast.success(!active ? 'Garçom ativado' : 'Garçom desativado');
  };

  const tableUrl = (code: string) => `${origin}/loja/${slug}/mesa/${code}`;
  const waiterUrl = (token: string) => `${origin}/loja/${slug}/garcom/${token}`;

  const copyText = (s: string) => {
    navigator.clipboard.writeText(s);
    toast.success('Copiado!');
  };

  const printAllQRs = () => {
    const html = `
      <html><head><title>QR Codes - Mesas</title>
      <style>
        body{font-family:sans-serif;padding:20px}
        .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}
        .card{border:2px solid #000;border-radius:8px;padding:16px;text-align:center;page-break-inside:avoid}
        .card h2{margin:0 0 10px;font-size:24px}
        img{width:240px;height:240px}
        .url{font-size:11px;word-break:break-all;margin-top:8px;color:#444}
      </style></head><body>
      <div class="grid">
        ${tables.map(t => `
          <div class="card">
            <h2>${t.label}</h2>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(tableUrl(t.code))}" />
            <div class="url">Escaneie para abrir a comanda</div>
          </div>`).join('')}
      </div>
      </body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500); }
  };

  if (loading) return <div className="p-6">Carregando...</div>;

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2"><Users className="h-5 w-5" /> Modo Mesas (Garçom)</h2>
            <p className="text-sm text-muted-foreground">Comandas digitais por QR. Cada mesa escaneada sorteia um garçom automaticamente.</p>
          </div>
          <div className="flex items-center gap-2">
            <Label>Ativar</Label>
            <Switch checked={tablesEnabled} onCheckedChange={toggleEnabled} />
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-bold flex items-center gap-2"><UserPlus className="h-4 w-4" /> Garçons ({waiters.length})</h3>
        <p className="text-sm text-muted-foreground">Cada garçom recebe um link único. Quando o cliente escaneia uma mesa, o sistema sorteia um deles.</p>
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Nome do garçom" value={newWaiter} onChange={e => setNewWaiter(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addWaiter()} className="flex-1 min-w-[200px]" />
          <Button onClick={addWaiter}>Adicionar</Button>
        </div>
        {waiters.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">Nenhum garçom cadastrado. Adicione pelo menos um para o modo mesas funcionar.</div>
        ) : (
          <div className="space-y-2">
            {waiters.map(w => (
              <div key={w.id} className={`flex items-center gap-2 p-2 rounded border bg-muted/30 ${!w.active ? 'opacity-60' : ''}`}>
                <div className="font-medium min-w-[120px]">{w.name}</div>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={!!w.active}
                    onCheckedChange={() => toggleWaiter(w.id, !!w.active)}
                  />
                  <span className="text-xs text-muted-foreground w-14">{w.active ? 'Ativo' : 'Inativo'}</span>
                </div>
                <Input readOnly value={waiterUrl(w.access_token)} className="flex-1 text-xs" />
                <Button size="icon" variant="ghost" onClick={() => copyText(waiterUrl(w.access_token))}><Copy className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => renewWaiter(w.id)} title="Renovar link"><RefreshCw className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => removeWaiter(w.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {openSessions.length > 0 && (
        <Card className="p-4 space-y-2 border-primary/40">
          <h3 className="font-bold flex items-center gap-2 text-primary">
            🟢 Mesas ocupadas agora ({openSessions.length})
          </h3>
          <p className="text-xs text-muted-foreground">Use "Liberar" se houver bug no painel do garçom.</p>
          <div className="space-y-2">
            {openSessions.map(s => (
              <div key={s.id} className="flex items-center gap-2 p-2 rounded border bg-muted/30 flex-wrap">
                <div className="flex-1 min-w-[140px]">
                  <div className="font-bold text-sm">{s.table_label}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.customer_name || '—'}
                    {s.assigned_waiter_name && <> • 👤 {s.assigned_waiter_name}</>}
                    {s.share_code && <> • cód <span className="font-mono">{s.share_code}</span></>}
                  </div>
                </div>
                <div className="text-sm font-bold text-primary">R$ {Number(s.total || 0).toFixed(2)}</div>
                <Button size="sm" variant="default" onClick={() => setEditingSession(s)}>
                  <Pencil className="h-3 w-3 mr-1" /> Editar
                </Button>
                <div className="relative inline-block">
                  <Button size="sm" variant="outline" onClick={() => setAssignOpenFor(assignOpenFor === s.id ? null : s.id)}>
                    <Users className="h-3 w-3 mr-1" /> Mover
                  </Button>
                  {assignOpenFor === s.id && (
                    <div className="absolute right-0 mt-1 z-20 w-48 rounded border bg-popover shadow-lg max-h-60 overflow-auto">
                      {waiters.map(w => (
                        <button
                          key={w.id}
                          disabled={!w.active}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed ${
                            s.assigned_waiter_name === w.name ? 'bg-muted font-medium' : ''
                          }`}
                          onClick={() => { setAssignOpenFor(null); reassignSession(s.id, w.id, w.name); }}
                        >
                          {w.name}{!w.active ? ' (inativo)' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => releaseSession(s.id, s.table_label)}>
                  <Trash2 className="h-3 w-3 mr-1" /> Liberar
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <h3 className="font-bold">Cadastrar mesas</h3>
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Ex: Mesa 1" value={newLabel} onChange={e => setNewLabel(e.target.value)} className="flex-1 min-w-[200px]" />
          <Button onClick={addTable}>Adicionar</Button>
          <Button variant="outline" onClick={() => addBatch(5)}>+5 mesas</Button>
          <Button variant="outline" onClick={() => addBatch(10)}>+10 mesas</Button>
        </div>
      </Card>

      <div className="flex justify-between items-center">
        <h3 className="font-bold">Mesas ({tables.length})</h3>
        {tables.length > 0 && (
          <Button onClick={printAllQRs} variant="outline"><Printer className="h-4 w-4 mr-1" /> Imprimir QR Codes</Button>
        )}
      </div>

      {tables.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">Nenhuma mesa cadastrada ainda.</Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tables.map(t => (
            <Card key={t.id} className="p-4 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-lg">{t.label}</div>
                  <div className="text-xs text-muted-foreground">code: {t.code}</div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => removeTable(t.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              <div className="flex justify-center">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(tableUrl(t.code))}`}
                  alt={`QR ${t.label}`} className="w-40 h-40"
                />
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => copyText(tableUrl(t.code))}>
                  <Copy className="h-3 w-3 mr-1" /> Link
                </Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => window.open(tableUrl(t.code), '_blank')}>
                  <QrCode className="h-3 w-3 mr-1" /> Abrir
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <WaiterComandaEditor
        open={!!editingSession}
        onClose={() => { setEditingSession(null); load(); }}
        session={editingSession}
        tenantId={tenantId}
      />
    </div>
  );
}
