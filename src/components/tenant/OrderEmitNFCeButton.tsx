// Botão "Emitir NFC-e" pra ser plugado em qualquer card/linha de pedido.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Receipt, FileText, CheckCircle2, XCircle, Loader2, Ban } from "lucide-react";
import { useEmitNFCe, useOrderFiscalInvoice } from "@/hooks/useFiscal";
import { useCanCancel, useCancelNFCe } from "@/hooks/useFiscalContingencia";

interface Props {
  orderId: string;
  tenantId: string;
  orderStatus?: string;
  size?: "sm" | "default";
}

export default function OrderEmitNFCeButton({ orderId, tenantId, orderStatus, size = "sm" }: Props) {
  const { data: invoice } = useOrderFiscalInvoice(orderId);
  const emit = useEmitNFCe();
  const { data: canCancel } = useCanCancel(invoice?.id);
  const cancel = useCancelNFCe();
  const [open, setOpen] = useState(false);
  const [justif, setJustif] = useState("");

  const submitCancel = async () => {
    if (!invoice?.id) return;
    try {
      await cancel.mutateAsync({ tenantId, invoiceId: invoice.id, justificativa: justif });
      setOpen(false);
      setJustif("");
    } catch {}
  };

  if (invoice?.status === "authorized") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="default" className="gap-1"><CheckCircle2 className="w-3 h-3" /> NFC-e {invoice.numero ? `#${invoice.numero}` : "OK"}</Badge>
        {invoice.pdf_url && (
          <a href={invoice.pdf_url} target="_blank" rel="noreferrer">
            <Button variant="outline" size={size} className="gap-1"><FileText className="w-3 h-3" /> DANFE</Button>
          </a>
        )}
        {canCancel && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size={size} className="gap-1 text-destructive border-destructive/40">
                <Ban className="w-3 h-3" /> Cancelar
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Cancelar NFC-e</DialogTitle></DialogHeader>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Permitido até 30 minutos após emissão. Justificativa com mínimo 15 caracteres.</p>
                <Label>Justificativa</Label>
                <Textarea value={justif} onChange={(e) => setJustif(e.target.value)} rows={3} placeholder="Ex: Pedido cancelado pelo cliente antes da entrega" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Voltar</Button>
                <Button variant="destructive" onClick={submitCancel} disabled={cancel.isPending || justif.trim().length < 15}>
                  Cancelar nota
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    );
  }

  if (invoice?.status === "cancelled") {
    return <Badge variant="outline" className="gap-1"><Ban className="w-3 h-3" /> NFC-e cancelada</Badge>;
  }

  if (invoice?.status === "rejected") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="destructive" className="gap-1" title={invoice.error_message || ""}>
          <XCircle className="w-3 h-3" /> Nota rejeitada
        </Badge>
        <Button size={size} variant="outline" onClick={() => emit.mutate({ orderId, tenantId })} disabled={emit.isPending}>
          {emit.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Tentar de novo"}
        </Button>
      </div>
    );
  }

  if (invoice?.status === "processing") {
    return <Badge variant="secondary" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Emitindo...</Badge>;
  }

  const isDelivered = orderStatus === "delivered";

  return (
    <Button
      size={size}
      variant="outline"
      className="gap-1"
      disabled={!isDelivered || emit.isPending}
      onClick={() => emit.mutate({ orderId, tenantId })}
      title={!isDelivered ? "Pedido precisa estar entregue" : "Emitir NFC-e"}
    >
      {emit.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Receipt className="w-3 h-3" />}
      Emitir NFC-e
    </Button>
  );
}
