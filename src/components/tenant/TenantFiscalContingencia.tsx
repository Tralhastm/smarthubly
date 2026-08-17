// Painel de Contingência Fiscal: fila offline, cancelamento (30min), inutilização, SAT.
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useOfflineQueue, useProcessOfflineQueue, useCancellations, useInvalidateNumeros } from '@/hooks/useFiscalContingencia';
import { useFiscalSettings, useUpsertFiscalSettings } from '@/hooks/useFiscal';
import { WifiOff, RefreshCw, FileX, Hash, Cpu } from 'lucide-react';
import { useSubTabs } from '@/lib/admin-subtabs';

const fmtDateTime = (s?: string | null) => s ? new Date(s).toLocaleString('pt-BR') : '—';

export default function TenantFiscalContingencia({ tenantId }: { tenantId: string }) {
  const subs = useSubTabs('fiscal', [
    { id: 'queue', label: 'Fila Offline' },
    { id: 'cancel', label: 'Cancelamentos' },
    { id: 'invalidate', label: 'Inutilização' },
    { id: 'sat', label: 'SAT (SP)' },
  ]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><WifiOff className="w-5 h-5" />Contingência & Cancelamento</CardTitle>
        <CardDescription>NFC-e offline, cancelamento (30 min), inutilização de numeração e SAT (SP).</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={subs[0].id} className="w-full">
          <TabsList className="flex w-full flex-wrap justify-start h-auto gap-1">
            {subs.map(s => <TabsTrigger key={s.id} value={s.id} className="flex-shrink-0">{s.label}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="queue" className="mt-4"><QueueTab tenantId={tenantId} /></TabsContent>
          <TabsContent value="cancel" className="mt-4"><CancelTab tenantId={tenantId} /></TabsContent>
          <TabsContent value="invalidate" className="mt-4"><InvalidateTab tenantId={tenantId} /></TabsContent>
          <TabsContent value="sat" className="mt-4"><SatTab tenantId={tenantId} /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function QueueTab({ tenantId }: { tenantId: string }) {
  const { data: rows = [], isLoading } = useOfflineQueue(tenantId);
  const process = useProcessOfflineQueue();
  const counts = {
    queued: rows.filter(r => r.status === 'queued').length,
    processing: rows.filter(r => r.status === 'processing').length,
    emitted: rows.filter(r => r.status === 'emitted').length,
    failed: rows.filter(r => r.status === 'failed').length,
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 text-sm flex-wrap">
          <Badge variant="secondary">Na fila: {counts.queued}</Badge>
          <Badge>Emitidas: {counts.emitted}</Badge>
          <Badge variant="destructive">Falhas: {counts.failed}</Badge>
        </div>
        <Button size="sm" onClick={() => process.mutate(tenantId)} disabled={process.isPending}>
          <RefreshCw className={`h-4 w-4 mr-2 ${process.isPending ? 'animate-spin' : ''}`} />
          Processar fila agora
        </Button>
      </div>
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr><th className="text-left p-2">Enfileirado</th><th className="text-left p-2">Pedido</th><th className="text-center p-2">Tentativas</th><th className="text-center p-2">Status</th><th className="text-left p-2">Erro</th></tr>
          </thead>
          <tbody>
            {isLoading ? <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Carregando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Nenhuma NFC-e na fila.</td></tr>
            : rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{fmtDateTime(r.enqueued_at)}</td>
                <td className="p-2 font-mono text-xs">{r.order_id ? r.order_id.slice(0, 8) : '—'}</td>
                <td className="p-2 text-center">{r.attempts}</td>
                <td className="p-2 text-center">
                  <Badge variant={r.status === 'emitted' ? 'default' : r.status === 'failed' ? 'destructive' : 'secondary'}>{r.status}</Badge>
                </td>
                <td className="p-2 text-xs text-destructive">{r.last_error || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Quando o PDV não tiver internet, vendas com NFC-e são enfileiradas aqui e emitidas automaticamente assim que voltar a conexão.
      </p>
    </div>
  );
}

function CancelTab({ tenantId }: { tenantId: string }) {
  const { data: rows = [], isLoading } = useCancellations(tenantId);
  const cancels = rows.filter(r => r.kind === 'cancel');
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        O cancelamento da NFC-e só é permitido <strong>até 30 minutos após a emissão</strong> e exige justificativa com no mínimo 15 caracteres.
        Use o botão "Cancelar NFC-e" na aba <strong>Pedidos</strong> para iniciar.
      </p>
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr><th className="text-left p-2">Data</th><th className="text-left p-2">Protocolo</th><th className="text-left p-2">Justificativa</th><th className="text-center p-2">Status</th></tr>
          </thead>
          <tbody>
            {isLoading ? <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Carregando…</td></tr>
            : cancels.length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Nenhum cancelamento.</td></tr>
            : cancels.map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{fmtDateTime(r.performed_at)}</td>
                <td className="p-2 font-mono text-xs">{r.protocolo || '—'}</td>
                <td className="p-2 max-w-xs truncate">{r.justificativa}</td>
                <td className="p-2 text-center">
                  <Badge variant={r.status === 'success' ? 'default' : r.status === 'failed' ? 'destructive' : 'secondary'}>{r.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvalidateTab({ tenantId }: { tenantId: string }) {
  const { data: rows = [] } = useCancellations(tenantId);
  const invalidate = useInvalidateNumeros();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ serie: 1, inicio: 0, fim: 0, justificativa: '' });
  const invs = rows.filter(r => r.kind === 'invalidate');

  const submit = async () => {
    try {
      await invalidate.mutateAsync({ tenantId, ...form });
      setOpen(false);
      setForm({ serie: 1, inicio: 0, fim: 0, justificativa: '' });
    } catch {}
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-muted-foreground">
          Inutilize intervalos de numeração quando houver "buracos" (ex: erro de impressão sem emissão).
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Hash className="h-4 w-4 mr-2" />Nova inutilização</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Inutilizar numeração NFC-e</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div><Label>Série</Label><Input type="number" value={form.serie} onChange={e => setForm({ ...form, serie: Number(e.target.value) })} /></div>
                <div><Label>Nº inicial</Label><Input type="number" value={form.inicio} onChange={e => setForm({ ...form, inicio: Number(e.target.value) })} /></div>
                <div><Label>Nº final</Label><Input type="number" value={form.fim} onChange={e => setForm({ ...form, fim: Number(e.target.value) })} /></div>
              </div>
              <div>
                <Label>Justificativa (mín. 15 caracteres)</Label>
                <Textarea value={form.justificativa} onChange={e => setForm({ ...form, justificativa: e.target.value })} rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={invalidate.isPending}>Inutilizar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr><th className="text-left p-2">Data</th><th className="text-left p-2">Série</th><th className="text-left p-2">Intervalo</th><th className="text-left p-2">Protocolo</th><th className="text-center p-2">Status</th></tr>
          </thead>
          <tbody>
            {invs.length === 0 ? <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Nenhuma inutilização.</td></tr>
            : invs.map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{fmtDateTime(r.performed_at)}</td>
                <td className="p-2">{r.serie}</td>
                <td className="p-2">{r.numero_inicial} – {r.numero_final}</td>
                <td className="p-2 font-mono text-xs">{r.protocolo || '—'}</td>
                <td className="p-2 text-center">
                  <Badge variant={r.status === 'success' ? 'default' : r.status === 'failed' ? 'destructive' : 'secondary'}>{r.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SatTab({ tenantId }: { tenantId: string }) {
  const { data: settings } = useFiscalSettings(tenantId);
  const upsert = useUpsertFiscalSettings();
  const [f, setF] = useState<any>({});
  const cur = { ...(settings || {}), ...f };

  const save = () => upsert.mutate({
    tenant_id: tenantId,
    sat_enabled: !!cur.sat_enabled,
    sat_serial: cur.sat_serial || null,
    sat_assinatura_ac: cur.sat_assinatura_ac || null,
    sat_codigo_ativacao: cur.sat_codigo_ativacao || null,
    offline_mode_enabled: cur.offline_mode_enabled !== false,
  } as any);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 rounded-lg border bg-muted/30">
        <Cpu className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground">
          SAT-CF-e é exigido em São Paulo para certos estabelecimentos. Configure aqui os dados do equipamento SAT acoplado ao PDV.
          Para outros estados, use apenas NFC-e na aba acima.
        </div>
      </div>
      <div className="flex items-center justify-between p-3 rounded-lg border">
        <div>
          <div className="font-semibold">Modo offline ativo</div>
          <div className="text-xs text-muted-foreground">Enfileira NFC-e quando sem internet e emite ao reconectar.</div>
        </div>
        <Switch checked={cur.offline_mode_enabled !== false} onCheckedChange={(v) => setF({ ...f, offline_mode_enabled: v })} />
      </div>
      <div className="flex items-center justify-between p-3 rounded-lg border">
        <div>
          <div className="font-semibold">SAT habilitado (SP)</div>
          <div className="text-xs text-muted-foreground">Emite CF-e-SAT pelo equipamento acoplado.</div>
        </div>
        <Switch checked={!!cur.sat_enabled} onCheckedChange={(v) => setF({ ...f, sat_enabled: v })} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><Label>Nº de série do SAT</Label><Input value={cur.sat_serial || ''} onChange={e => setF({ ...f, sat_serial: e.target.value })} placeholder="ex: 900004019" /></div>
        <div><Label>Código de ativação</Label><Input type="password" value={cur.sat_codigo_ativacao || ''} onChange={e => setF({ ...f, sat_codigo_ativacao: e.target.value })} /></div>
        <div className="md:col-span-2"><Label>Assinatura AC (CNPJ SH + CNPJ Emitente)</Label><Input value={cur.sat_assinatura_ac || ''} onChange={e => setF({ ...f, sat_assinatura_ac: e.target.value })} placeholder="cadeia gerada pela AC-SAT" /></div>
      </div>
      <div className="flex justify-end">
        <Button onClick={save} disabled={upsert.isPending}>Salvar SAT</Button>
      </div>
    </div>
  );
}
