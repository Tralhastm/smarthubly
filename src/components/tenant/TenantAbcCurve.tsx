// Onda 2 — Curva ABC: classifica produtos por contribuição na receita.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { BarChart3 } from 'lucide-react';

interface Row { product_name: string; qty: number; revenue: number; cumulative_pct: number; abc_class: 'A' | 'B' | 'C'; }

const classColor: Record<string, string> = {
  A: 'bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30',
  B: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30',
  C: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
};

export default function TenantAbcCurve({ tenantId }: { tenantId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const past = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(past);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc('get_abc_curve', {
      _tenant_id: tenantId, _from: new Date(from + 'T00:00:00').toISOString(),
      _to: new Date(to + 'T23:59:59').toISOString(),
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    setRows(data || []);
  };
  useEffect(() => { load(); }, [tenantId]);

  const counts = { A: 0, B: 0, C: 0 };
  const revenues = { A: 0, B: 0, C: 0 };
  rows.forEach(r => { counts[r.abc_class]++; revenues[r.abc_class] += Number(r.revenue); });
  const total = revenues.A + revenues.B + revenues.C;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5" /> Curva ABC de produtos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Classe <b>A</b> = até 80% da receita (foco máximo). <b>B</b> = próximos 15%. <b>C</b> = resto (avalie cortar).
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <div><label className="text-xs text-muted-foreground">De</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">Até</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button onClick={load} disabled={loading}>{loading ? 'Carregando...' : 'Atualizar'}</Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(['A', 'B', 'C'] as const).map(c => (
            <div key={c} className={`rounded-lg border p-3 ${classColor[c]}`}>
              <div className="text-xs font-semibold">Classe {c}</div>
              <div className="text-xl font-bold">{counts[c]} produtos</div>
              <div className="text-xs">R$ {revenues[c].toFixed(2)} ({total > 0 ? ((revenues[c] / total) * 100).toFixed(1) : 0}%)</div>
            </div>
          ))}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Qtde</TableHead>
              <TableHead className="text-right">Receita</TableHead>
              <TableHead className="text-right">Acum.</TableHead>
              <TableHead>Classe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.product_name}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-medium">{r.product_name}</TableCell>
                <TableCell className="text-right">{Number(r.qty).toFixed(0)}</TableCell>
                <TableCell className="text-right">R$ {Number(r.revenue).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.cumulative_pct).toFixed(1)}%</TableCell>
                <TableCell><Badge variant="outline" className={classColor[r.abc_class]}>{r.abc_class}</Badge></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sem vendas no período.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
