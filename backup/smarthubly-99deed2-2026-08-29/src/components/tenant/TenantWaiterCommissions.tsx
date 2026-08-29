// Onda 2 — Comissão por garçom: edita % e mostra apuração do período.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Users, Percent, DollarSign } from 'lucide-react';

interface Waiter { id: string; name: string; commission_percent: number; active: boolean; }
interface Row { waiter_id: string; waiter_name: string; commission_percent: number; orders_count: number; revenue: number; commission_amount: number; }

export default function TenantWaiterCommissions({ tenantId }: { tenantId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const loadWaiters = async () => {
    const { data } = await (supabase as any).from('waiters').select('id,name,commission_percent,active')
      .eq('tenant_id', tenantId).eq('active', true).order('name');
    setWaiters(data || []);
  };
  const loadReport = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc('get_waiter_commissions', {
      _tenant_id: tenantId, _from: new Date(from + 'T00:00:00').toISOString(),
      _to: new Date(to + 'T23:59:59').toISOString(),
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    setRows(data || []);
  };

  useEffect(() => { loadWaiters(); loadReport(); }, [tenantId]);

  const updatePct = async (id: string, pct: number) => {
    const { error } = await (supabase as any).from('waiters').update({ commission_percent: pct }).eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Comissão atualizada');
    loadWaiters(); loadReport();
  };

  const total = rows.reduce((s, r) => s + Number(r.commission_amount || 0), 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Percent className="w-5 h-5" /> Comissão por garçom</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">Define o % de comissão sobre o total das mesas atendidas (cobrado apenas em mesas pagas).</p>
          <div className="space-y-2">
            {waiters.map(w => (
              <div key={w.id} className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1 font-medium">{w.name}</div>
                <Input type="number" min={0} max={100} step="0.5" defaultValue={w.commission_percent}
                  onBlur={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v) && v !== w.commission_percent) updatePct(w.id, v); }}
                  className="w-24" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            ))}
            {waiters.length === 0 && <p className="text-sm text-muted-foreground">Nenhum garçom cadastrado.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DollarSign className="w-5 h-5" /> Apuração do período</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div><label className="text-xs text-muted-foreground">De</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label className="text-xs text-muted-foreground">Até</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <Button onClick={loadReport} disabled={loading}>{loading ? 'Carregando...' : 'Atualizar'}</Button>
            <div className="ml-auto text-right">
              <div className="text-xs text-muted-foreground">Total a pagar</div>
              <div className="text-2xl font-bold text-primary">R$ {total.toFixed(2)}</div>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Garçom</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Faturamento</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.waiter_id}>
                  <TableCell className="font-medium">{r.waiter_name}</TableCell>
                  <TableCell className="text-right">{Number(r.commission_percent).toFixed(1)}%</TableCell>
                  <TableCell className="text-right">{r.orders_count}</TableCell>
                  <TableCell className="text-right">R$ {Number(r.revenue).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-bold text-primary">R$ {Number(r.commission_amount).toFixed(2)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sem dados no período.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
