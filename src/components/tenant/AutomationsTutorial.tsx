import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronUp, Lightbulb, X } from "lucide-react";

const STORAGE_KEY = "automations_tutorial_dismissed_v1";

const STEPS = [
  {
    title: "1. O que é cada interruptor?",
    body: "Cada card abaixo representa uma automação. Um interruptor desligado = a Sofia (IA) não faz nada. Ligado = ela executa a tarefa sozinha conforme o agendamento.",
  },
  {
    title: "2. Onda 1, Onda 2 e Onda 3",
    body: "São apenas grupos de release. Onda 1 = automações operacionais críticas (já vêm ligadas). Onda 2 = engajamento e relatórios. Onda 3 = avançadas (vêm desligadas, ative quando quiser).",
  },
  {
    title: "3. Caixa de Sugestões da IA",
    body: "Quando uma automação detecta algo (combo, promoção, divergência, fantasma…), aparece um card no topo. Você decide se aplica ou descarta — nada é executado sem sua autorização.",
  },
  {
    title: "4. Como saber se funcionou?",
    body: "Vá em Financeiro > Eventos do pedido OU veja a coluna 'Última atividade' nos pedidos. Toda ação automatizada deixa rastro com 'actor: system'.",
  },
  {
    title: "5. Posso desligar tudo a qualquer hora?",
    body: "Sim. Os toggles salvam na hora. Nada é cobrado a mais nem a menos — automações são bônus do plano.",
  },
];

export default function AutomationsTutorial() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch { /* noop */ }
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* noop */ }
    setDismissed(true);
  };

  return (
    <Card className="p-4 border-primary/30 bg-primary/5">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-md bg-primary/15 text-primary shrink-0">
          <Lightbulb className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
          >
            Como funciona esta página? {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {open && (
            <div className="mt-3 space-y-3 text-sm">
              {STEPS.map((s, i) => (
                <div key={i}>
                  <p className="font-medium text-foreground">{s.title}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">{s.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Fechar tutorial"
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </Card>
  );
}
