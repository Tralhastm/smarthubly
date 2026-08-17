import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown, Sparkles } from "lucide-react";

const FAQS = [
  {
    q: "O que é a Sofia?",
    a: "A Sofia é a IA copiloto da plataforma. Ela conhece sua loja (catálogo, pedidos, métricas) e ajuda a vender, sugerir promoções, responder dúvidas de clientes e cuidar de operações automáticas em segundo plano.",
  },
  {
    q: "Quem é a Clara, e como ela diferencia da Sofia?",
    a: "A Clara é a consultora EMPRESARIAL, dedicada à análise dos números reais do seu negócio (margem, lucro, fiado, dívidas, estoque, top produtos, saldo em caixa vs disponível). A Sofia cuida da OPERAÇÃO (onde clicar, como configurar, suporte). No painel admin você tem dois botões flutuantes: o azul abre a Sofia, o verde-esmeralda abre a Clara.",
  },
  {
    q: "Onde encontro elas?",
    a: "Sofia: na landing (pra dúvidas sobre a plataforma) e no painel admin (botão azul flutuante). Clara: dentro do painel admin, no botão verde-esmeralda flutuante ou na aba Empresarial.",
  },
  {
    q: "Elas tomam decisões sozinhas?",
    a: "Não. Ações que mexem em pedidos, preços ou clientes sempre passam pela sua aprovação na Caixa de Sugestões. Automações silenciosas (cancelar Pix vencido, lançar taxa, detectar pedido fantasma, reconciliar Mercado Pago) você liga/desliga em Configurações > Automações.",
  },
  {
    q: "Que dados a Clara realmente vê?",
    a: "Ela lê em tempo real do seu banco: vendas do mês e do mês anterior, despesas por categoria, fiado em aberto e vencidos, dívidas a fornecedores, top produtos, estoque baixo, ticket médio, crescimento e pedidos em andamento agora. Tudo só do seu tenant — outras lojas não veem nada.",
  },
  {
    q: "Os dados dos clientes são usados pra treinar IA?",
    a: "Não. Cada conversa é isolada da sua loja. As IAs consultam seu banco em tempo real, mas nada é enviado pra fora pra treinamento. O sistema usa fallback automático entre Google AI, Lovable AI Gateway e OpenRouter — se um esgota cota, troca sozinho sem você notar.",
  },
  {
    q: "Quanto custa?",
    a: "Está incluso no plano da loja (% por venda ou R$60/mês fixo). As mensagens das IAs consomem créditos do plano AI; em caso de limite, você é avisado e pode adicionar mais.",
  },
];

export default function SofiaFAQ() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 rounded-md bg-primary/15 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h3 className="font-heading text-base">Sobre Sofia & Clara (IA)</h3>
          <p className="text-xs text-muted-foreground">Perguntas frequentes — toque pra expandir</p>
        </div>
      </div>
      <div className="space-y-2">
        {FAQS.map((f, i) => {
          const open = openIdx === i;
          return (
            <div key={i} className="rounded-lg border border-border bg-card">
              <button
                onClick={() => setOpenIdx(open ? null : i)}
                className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-muted/40 transition-colors rounded-lg"
              >
                <span className="text-sm font-medium text-foreground">{f.q}</span>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
              {open && (
                <p className="px-3 pb-3 text-xs text-muted-foreground leading-relaxed">{f.a}</p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
