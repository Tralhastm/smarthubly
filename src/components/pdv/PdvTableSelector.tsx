// Escolhe modo: balcão ou abrir/continuar uma mesa.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, ShoppingBag, Utensils, Wallet } from "lucide-react";
import PdvCashRegisterDialog from "./PdvCashRegisterDialog";
import { useOpenCashSession } from "@/hooks/useCashRegister";

interface Props {
  tenantId: string;
  operatorName: string;
  operatorRole?: string;
  onPickBalcao: () => void;
  onPickTable: (tableId: string, tableLabel: string, sessionId?: string) => void;
  onLogout: () => void;
}

export default function PdvTableSelector({ tenantId, operatorName, operatorRole, onPickBalcao, onPickTable, onLogout }: Props) {
  const [cashOpen, setCashOpen] = useState(false);
  const { data: cashSession } = useOpenCashSession(tenantId);
  const tables = useQuery({
    queryKey: ["pdv-tables", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("restaurant_tables")
        .select("id,label,code")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("label");
      if (error) throw error;
      return data as { id: string; label: string; code: string }[];
    },
    refetchInterval: 30000,
  });

  const openSessions = useQuery({
    queryKey: ["pdv-open-sessions", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("table_sessions")
        .select("id,table_id,table_label,total,status")
        .eq("tenant_id", tenantId)
        .in("status", ["open", "sent"]);
      if (error) throw error;
      return data as { id: string; table_id: string; table_label: string; total: number; status: string }[];
    },
    refetchInterval: 10000,
  });

  const openByTable = new Map((openSessions.data || []).map(s => [s.table_id, s]));

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      <header className="px-4 py-3 border-b flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Operador</div>
          <div className="font-semibold text-sm truncate max-w-[160px]">{operatorName}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant={cashSession ? "default" : "outline"} size="sm" onClick={() => setCashOpen(true)}>
            <Wallet className="w-4 h-4 mr-1" /> {cashSession ? "Caixa aberto" : "Abrir caixa"}
          </Button>
          <Button variant="ghost" size="icon" onClick={onLogout}><LogOut className="w-5 h-5" /></Button>
        </div>
      </header>

      <PdvCashRegisterDialog open={cashOpen} onOpenChange={setCashOpen} tenantId={tenantId} operatorName={operatorName} operatorRole={operatorRole} />

      <div className="p-4 space-y-3 overflow-y-auto flex-1">
        <Button onClick={onPickBalcao} className="w-full h-20 text-lg font-semibold gap-3" size="lg">
          <ShoppingBag className="w-7 h-7" />
          Venda Balcão
        </Button>

        <div className="pt-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
            <Utensils className="w-4 h-4" /> Mesas
          </h3>
          {tables.isLoading && <div className="text-sm text-muted-foreground">Carregando mesas...</div>}
          {!tables.isLoading && tables.data?.length === 0 && (
            <div className="text-sm text-muted-foreground p-4 bg-muted rounded-lg text-center">
              Nenhuma mesa cadastrada. Use só balcão por enquanto.
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {tables.data?.map(t => {
              const open = openByTable.get(t.id);
              return (
                <Button
                  key={t.id}
                  variant={open ? "default" : "outline"}
                  className="h-20 flex flex-col items-center justify-center gap-0.5 relative"
                  onClick={() => onPickTable(t.id, t.label, open?.id)}
                >
                  <span className="text-xs opacity-70">Mesa</span>
                  <span className="text-xl font-bold leading-none">{t.label}</span>
                  {open && (
                    <span className="text-[10px] mt-0.5">R$ {Number(open.total).toFixed(2)}</span>
                  )}
                </Button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
