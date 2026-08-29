// Diálogo para transferir comanda para outra mesa OU juntar com outra comanda aberta.
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowRightLeft, Merge } from 'lucide-react';
import { useTransferTable, useMergeTables, LiveTable } from '@/hooks/useLiveFloor';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sessionId: string;
  currentTableId: string;
  tenantId: string;
  allTables: LiveTable[];
}

export default function TableTransferMergeDialog({ open, onOpenChange, sessionId, currentTableId, tenantId, allTables }: Props) {
  const [targetTable, setTargetTable] = useState('');
  const [targetSession, setTargetSession] = useState('');
  const transfer = useTransferTable();
  const merge = useMergeTables();

  const freeTables = allTables.filter(t => t.active && t.table_id !== currentTableId && !t.session);
  const otherOpenSessions = allTables.filter(t => t.session && t.table_id !== currentTableId);

  const submitTransfer = async () => {
    if (!targetTable) return;
    await transfer.mutateAsync({ sessionId, newTableId: targetTable, tenantId });
    onOpenChange(false);
  };

  const submitMerge = async () => {
    if (!targetSession) return;
    await merge.mutateAsync({ sourceId: sessionId, targetId: targetSession, tenantId });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Mover comanda</DialogTitle></DialogHeader>
        <Tabs defaultValue="transfer">
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="transfer"><ArrowRightLeft className="w-4 h-4 mr-1" />Transferir</TabsTrigger>
            <TabsTrigger value="merge"><Merge className="w-4 h-4 mr-1" />Juntar</TabsTrigger>
          </TabsList>
          <TabsContent value="transfer" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">Mover a comanda inteira para uma mesa livre.</p>
            <Label>Mesa destino</Label>
            <Select value={targetTable} onValueChange={setTargetTable}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {freeTables.length === 0 ? <div className="p-2 text-xs text-muted-foreground">Nenhuma mesa livre</div>
                  : freeTables.map(t => <SelectItem key={t.table_id} value={t.table_id}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button className="w-full" onClick={submitTransfer} disabled={!targetTable || transfer.isPending}>Transferir</Button>
          </TabsContent>
          <TabsContent value="merge" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">Juntar itens e pagamentos desta comanda em outra comanda aberta. Esta comanda será fechada.</p>
            <Label>Comanda destino</Label>
            <Select value={targetSession} onValueChange={setTargetSession}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {otherOpenSessions.length === 0 ? <div className="p-2 text-xs text-muted-foreground">Nenhuma outra comanda aberta</div>
                  : otherOpenSessions.map(t => (
                    <SelectItem key={t.session!.id} value={t.session!.id}>
                      {t.label} — {t.session!.customer_name || 'sem nome'} (R$ {Number(t.session!.total).toFixed(2)})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button className="w-full" onClick={submitMerge} disabled={!targetSession || merge.isPending}>Juntar comandas</Button>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
