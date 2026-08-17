// Diálogo de pagamento dividido (split) — recebe pagamento parcial por pessoa/forma.
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Trash2, Receipt } from 'lucide-react';
import { useSessionPayments, useAddPartialPayment } from '@/hooks/useLiveFloor';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sessionId: string;
  tenantId: string;
  total: number;
}

const METHODS = ['dinheiro', 'pix', 'cartao-credito', 'cartao-debito', 'voucher'];

export default function TableSplitPaymentDialog({ open, onOpenChange, sessionId, tenantId, total }: Props) {
  const { data: payments = [] } = useSessionPayments(sessionId);
  const add = useAddPartialPayment();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('dinheiro');
  const [payer, setPayer] = useState('');
  const [tabLabel, setTabLabel] = useState('');
  const [splitN, setSplitN] = useState(2);

  const paid = payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
  const balance = Math.max(0, total - paid);

  const submit = async () => {
    const v = parseFloat(amount.replace(',', '.'));
    if (!v || v <= 0) return toast.error('Informe um valor');
    await add.mutateAsync({ session_id: sessionId, tenant_id: tenantId, amount: v, method, payer_name: payer, tab_label: tabLabel } as any);
    setAmount('');
    setPayer('');
  };

  const fillEqual = () => {
    if (splitN < 1) return;
    setAmount((balance / splitN).toFixed(2));
  };

  const removePayment = async (id: string) => {
    const { error } = await (supabase as any).from('table_session_payments').delete().eq('id', id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ['session-payments', sessionId] });
    qc.invalidateQueries({ queryKey: ['live-floor', tenantId] });
    toast.success('Pagamento removido');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Receipt className="w-5 h-5" />Pagamento da comanda</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded border p-2"><div className="text-xs text-muted-foreground">Total</div><div className="font-bold">R$ {total.toFixed(2)}</div></div>
          <div className="rounded border p-2"><div className="text-xs text-muted-foreground">Pago</div><div className="font-bold text-green-600">R$ {paid.toFixed(2)}</div></div>
          <div className="rounded border p-2"><div className="text-xs text-muted-foreground">Falta</div><div className="font-bold text-orange-600">R$ {balance.toFixed(2)}</div></div>
        </div>

        <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
          <div className="text-xs font-semibold">Dividir por nº de pessoas</div>
          <div className="flex items-center gap-2">
            <Input type="number" min={1} value={splitN} onChange={(e) => setSplitN(Number(e.target.value))} className="w-20" />
            <Button size="sm" variant="outline" onClick={fillEqual}>Calcular: R$ {(balance / Math.max(splitN, 1)).toFixed(2)} cada</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div><Label>Valor (R$)</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" /></div>
          <div>
            <Label>Forma</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Pagador</Label><Input value={payer} onChange={(e) => setPayer(e.target.value)} placeholder="ex: João" /></div>
          <div><Label>Comanda/Pessoa</Label><Input value={tabLabel} onChange={(e) => setTabLabel(e.target.value)} placeholder="ex: Pessoa 1" /></div>
        </div>
        <Button onClick={submit} disabled={add.isPending || !amount}>Registrar pagamento</Button>

        <div className="space-y-1 max-h-48 overflow-y-auto">
          <div className="text-xs font-semibold text-muted-foreground">Pagamentos registrados</div>
          {payments.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum.</p> : payments.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{p.method}</Badge>
                {p.tab_label && <Badge>{p.tab_label}</Badge>}
                {p.payer_name && <span className="text-xs">{p.payer_name}</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">R$ {Number(p.amount).toFixed(2)}</span>
                <Button size="icon" variant="ghost" onClick={() => removePayment(p.id)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
