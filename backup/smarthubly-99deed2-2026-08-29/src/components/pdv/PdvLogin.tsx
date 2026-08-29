// Login PDV: teclado numérico grande, PIN 4-6 dígitos.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Delete } from "lucide-react";
import { toast } from "sonner";

interface Props {
  storeName: string;
  onSubmit: (pin: string) => Promise<{ ok: boolean; error?: string }>;
}

export default function PdvLogin({ storeName, onSubmit }: Props) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  const press = (k: string) => {
    if (loading) return;
    if (k === "del") { setPin(p => p.slice(0, -1)); return; }
    if (pin.length >= 6) return;
    setPin(p => p + k);
  };

  const submit = async () => {
    if (pin.length < 4) { toast.error("PIN deve ter pelo menos 4 dígitos"); return; }
    setLoading(true);
    const r = await onSubmit(pin);
    setLoading(false);
    if (!r.ok) { toast.error(r.error || "PIN inválido"); setPin(""); }
  };

  const keys = ["1","2","3","4","5","6","7","8","9","del","0","ok"];

  return (
    <div className="flex flex-col h-[100dvh] bg-background p-4">
      <div className="text-center pt-6 pb-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">PDV</div>
        <h1 className="text-xl font-bold mt-1">{storeName}</h1>
      </div>

      <div className="flex justify-center gap-3 my-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 ${i < pin.length ? "bg-primary border-primary" : "border-border"}`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 mt-auto">
        {keys.map(k => (
          <Button
            key={k}
            variant={k === "ok" ? "default" : k === "del" ? "secondary" : "outline"}
            className="h-16 text-2xl font-semibold active:scale-95 transition-transform"
            onClick={() => k === "ok" ? submit() : press(k)}
            disabled={loading}
          >
            {k === "del" ? <Delete className="w-6 h-6" /> : k === "ok" ? "OK" : k}
          </Button>
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground mt-4">
        Digite seu PIN e toque em OK
      </p>
    </div>
  );
}
