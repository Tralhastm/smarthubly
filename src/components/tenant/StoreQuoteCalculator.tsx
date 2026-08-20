import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useQuoteVariables } from '@/hooks/useQuotes';
import { Calculator, MessageCircle, Sparkles, Info, Wand2, Loader2, Clock, TrendingUp, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { unifiedInvoke } from "@/lib/unifiedInvoke";

interface Props {
  tenantId: string;
  tenantName: string;
  whatsapp?: string | null;
  introText?: string;
}

interface AiEstimateItem {
  nome_variavel: string;
  quantidade: number;
  unidade: string;
  preco_unitario: number;
  subtotal: number;
  justificativa: string;
}

interface AiEstimate {
  itens: AiEstimateItem[];
  tempo_estimado: string;
  tempo_justificativa: string;
  mao_de_obra_extra: string | null;
  comparacao_mercado: string | null;
  pacote_recomendado: string | null;
  total_estimado: number;
  explicacao: string;
  observacoes: string;
}

const StoreQuoteCalculator = ({ tenantId, tenantName, whatsapp, introText }: Props) => {
  const { data: variables = [] } = useQuoteVariables(tenantId);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const { toast } = useToast();

  // IA
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiEstimate | null>(null);

  const activeVars = variables.filter(v => v.active);

  const total = useMemo(() => {
    return activeVars.reduce((sum, v) => {
      const q = quantities[v.id] ?? 0;
      return sum + q * Number(v.price_per_unit);
    }, 0);
  }, [activeVars, quantities]);

  const usedItems = activeVars.filter(v => (quantities[v.id] ?? 0) > 0);

  const buildWhatsappMessage = (kind: 'calc' | 'package' | 'ai', pkgName?: string) => {
    let msg = `Olá ${tenantName}! `;
    if (kind === 'calc') {
      if (usedItems.length === 0) msg += `Gostaria de tirar uma dúvida sobre orçamento.`;
      else {
        msg += `Fiz uma simulação no site e queria que vocês analisassem pra me passar o valor certo:\n\n`;
        usedItems.forEach(v => {
          const q = quantities[v.id];
          msg += `• ${v.name}: ${q} ${v.unit}\n`;
        });
        msg += `\n*Estimativa do site: ~R$ ${total.toFixed(2)}*\n\nPodem confirmar o orçamento exato?`;
      }
    } else if (kind === 'ai' && aiResult) {
      msg += `Usei a estimativa por IA do site e queria confirmar:\n\n`;
      msg += `*Pedido:* ${aiDescription}\n\n`;
      aiResult.itens.forEach(it => {
        msg += `• ${it.nome_variavel}: ${it.quantidade} ${it.unidade} (R$ ${it.subtotal.toFixed(2)})\n`;
      });
      msg += `\n*Tempo estimado:* ${aiResult.tempo_estimado}\n`;
      if (aiResult.mao_de_obra_extra) msg += `*Mão de obra:* ${aiResult.mao_de_obra_extra}\n`;
      msg += `\n*Estimativa total: ~R$ ${Number(aiResult.total_estimado).toFixed(2)}*\n\nPodem confirmar o orçamento exato?`;
    } else {
      msg += `Tenho interesse no pacote "${pkgName}". Pode me passar mais detalhes?`;
    }
    return msg;
  };

  const openWhatsapp = (kind: 'calc' | 'package' | 'ai', pkgName?: string) => {
    if (!whatsapp) return;
    const phone = whatsapp.replace(/\D/g, '');
    const msg = encodeURIComponent(buildWhatsappMessage(kind, pkgName));
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
  };

  const runAiEstimate = async () => {
    if (!aiDescription.trim()) {
      toast({ title: 'Descreva o serviço', description: 'Conta o que você precisa pra IA estimar.', variant: 'destructive' });
      return;
    }
    setAiLoading(true);
    setAiResult(null);
    try {
      const { data, error } = await unifiedInvoke("finance-unified", "estimate-quote", { tenantId, description: aiDescription.trim() });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const est = (data as any)?.estimate as AiEstimate;
      if (!est || !Array.isArray(est.itens)) throw new Error('Resposta inválida da IA');
      setAiResult(est);
      // pré-preenche a calculadora manual com os valores estimados
      const newQ: Record<string, number> = { ...quantities };
      est.itens.forEach(it => {
        const v = activeVars.find(x => x.name.trim().toLowerCase() === it.nome_variavel.trim().toLowerCase());
        if (v) newQ[v.id] = it.quantidade;
      });
      setQuantities(newQ);
    } catch (e: any) {
      toast({ title: 'Não rolou estimar agora', description: e?.message || 'Tente novamente em instantes.', variant: 'destructive' });
    } finally {
      setAiLoading(false);
    }
  };

  if (activeVars.length === 0) {
    return (
      <div className="text-center py-12 px-4">
        <Calculator className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">A loja ainda não cadastrou itens de orçamento.</p>
        {whatsapp && (
          <Button onClick={() => openWhatsapp('calc')} className="mt-4">
            <MessageCircle className="h-4 w-4 mr-2" />Falar no WhatsApp
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 max-w-3xl mx-auto">
      {introText && (
        <Card className="p-4 bg-primary/10 border-primary/20">
          <div className="flex gap-2">
            <Sparkles className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-sm text-foreground/90 whitespace-pre-line">{introText}</p>
          </div>
        </Card>
      )}

      {/* Aviso fixo: orçamento é estimativa */}
      <Card className="p-3 bg-muted/40 border-border">
        <div className="flex gap-2">
          <Info className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-xs text-foreground/90">
            <strong>Isso aqui é uma estimativa.</strong> O valor final precisa ser analisado pelo lojista — cada serviço tem seus detalhes que podem mudar o preço.
          </p>
        </div>
      </Card>

      {/* IA: estimar com base em descrição */}
      <Card className="p-5 bg-card border-border">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-foreground">Estimar com IA</h3>
          </div>
          {!aiOpen && (
            <Button size="sm" variant="outline" onClick={() => setAiOpen(true)}>
              <Sparkles className="h-4 w-4 mr-1" /> Usar IA
            </Button>
          )}
        </div>

        {!aiOpen ? (
          <p className="text-xs text-muted-foreground">
            Não sabe quantas unidades calcular? Descreve o serviço (ex: <em>"levantar uma parede de tijolo de 60 m²"</em> ou <em>"aplicar papel de parede num quarto de 3x4m"</em>) e a IA estima quantidades, tempo e mão de obra com base nas variáveis cadastradas pelo lojista.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Descreva seu serviço</Label>
              <Textarea
                value={aiDescription}
                onChange={e => setAiDescription(e.target.value)}
                placeholder="Ex: Preciso levantar uma parede de tijolo, mais ou menos 60 m², no quintal de casa. Já tem o local limpo."
                className="bg-background border-border min-h-[80px] mt-1"
                maxLength={2000}
              />
              <p className="text-[10px] text-muted-foreground mt-1">{aiDescription.length}/2000 — quanto mais detalhe, melhor a estimativa.</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={runAiEstimate} disabled={aiLoading || !aiDescription.trim()} className="flex-1">
                {aiLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Estimando...</> : <><Wand2 className="h-4 w-4 mr-2" /> Gerar estimativa</>}
              </Button>
              <Button variant="outline" onClick={() => { setAiOpen(false); setAiResult(null); }}>Fechar</Button>
            </div>

            {aiResult && (
              <div className="mt-3 space-y-3 p-4 rounded-lg border border-primary/30 bg-primary/5">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Itens estimados</p>
                  <ul className="space-y-1">
                    {aiResult.itens.map((it, i) => (
                      <li key={i} className="text-sm text-foreground">
                        <div className="flex justify-between gap-2">
                          <span><strong>{it.nome_variavel}</strong>: {it.quantidade} {it.unidade}</span>
                          <span className="text-primary font-semibold whitespace-nowrap">R$ {Number(it.subtotal).toFixed(2)}</span>
                        </div>
                        {it.justificativa && <p className="text-xs text-muted-foreground">↳ {it.justificativa}</p>}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <div className="flex gap-2 p-2 rounded bg-muted/40">
                    <Clock className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">{aiResult.tempo_estimado}</p>
                      <p className="text-xs text-muted-foreground">{aiResult.tempo_justificativa}</p>
                    </div>
                  </div>
                  {aiResult.mao_de_obra_extra && (
                    <div className="flex gap-2 p-2 rounded bg-muted/40">
                      <Users className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-foreground">Mão de obra extra</p>
                        <p className="text-xs text-muted-foreground">{aiResult.mao_de_obra_extra}</p>
                      </div>
                    </div>
                  )}
                  {aiResult.comparacao_mercado && (
                    <div className="flex gap-2 p-2 rounded bg-muted/40 sm:col-span-2">
                      <TrendingUp className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-foreground">Comparação de mercado</p>
                        <p className="text-xs text-muted-foreground">{aiResult.comparacao_mercado}</p>
                      </div>
                    </div>
                  )}
                </div>

                {aiResult.pacote_recomendado && (
                  <div className="p-2 rounded bg-primary/10 border border-primary/20 text-sm text-foreground">
                    💡 <strong>Pacote recomendado:</strong> {aiResult.pacote_recomendado}
                  </div>
                )}

                <div className="text-center p-3 rounded-lg bg-primary/15 border border-primary/30">
                  <p className="text-xs text-muted-foreground mb-1">Total estimado pela IA</p>
                  <p className="text-3xl font-bold text-primary">~ R$ {Number(aiResult.total_estimado).toFixed(2)}</p>
                </div>

                {aiResult.explicacao && (
                  <p className="text-sm text-foreground/90 whitespace-pre-line">{aiResult.explicacao}</p>
                )}
                {aiResult.observacoes && (
                  <p className="text-xs text-muted-foreground italic">⚠️ {aiResult.observacoes}</p>
                )}

                {whatsapp && (
                  <Button size="lg" className="w-full bg-[hsl(142,71%,30%)] text-foreground hover:bg-[hsl(142,71%,35%)]" onClick={() => openWhatsapp('ai')}>
                    <MessageCircle className="h-5 w-5 mr-2" /> Enviar estimativa pro lojista
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Calculadora manual */}
      {activeVars.length > 0 && (
        <Card className="p-5 bg-card border-border">
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-foreground">Monte seu orçamento manualmente</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Informe as quantidades que precisa. O valor é uma estimativa — pra fechar e ajustar, fala com o lojista.</p>

          <div className="space-y-3">
            {activeVars.map(v => {
              const q = quantities[v.id] ?? 0;
              const subtotal = q * Number(v.price_per_unit);
              return (
                <div key={v.id} className="p-3 rounded-lg border border-border bg-muted/20">
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <Label className="text-foreground font-medium">{v.name}</Label>
                      <p className="text-xs text-muted-foreground">R$ {Number(v.price_per_unit).toFixed(2)} / {v.unit}</p>
                      {v.description && <p className="text-xs text-muted-foreground mt-1">{v.description}</p>}
                    </div>
                    {subtotal > 0 && <span className="text-sm font-semibold text-primary whitespace-nowrap">R$ {subtotal.toFixed(2)}</span>}
                  </div>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={1}
                    value={q || ''}
                    onChange={e => setQuantities({ ...quantities, [v.id]: parseFloat(e.target.value) || 0 })}
                    placeholder={`Qtd em ${v.unit} (mín ${v.min_quantity}${v.max_quantity ? `, máx ${v.max_quantity}` : ''})`}
                    className="bg-background border-border"
                  />
                </div>
              );
            })}
          </div>

          {total > 0 && (
            <div className="mt-5 p-4 rounded-lg bg-primary/15 border border-primary/30 text-center">
              <p className="text-xs text-muted-foreground mb-1">Estimativa (sujeita a análise do lojista)</p>
              <p className="text-3xl font-bold text-primary">~ R$ {total.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Pra fechar de verdade, envia pro WhatsApp e o lojista confirma o valor exato.</p>
            </div>
          )}

          {whatsapp && (
            <Button size="lg" className="w-full mt-4 bg-[hsl(142,71%,30%)] text-foreground hover:bg-[hsl(142,71%,35%)]" onClick={() => openWhatsapp('calc')}>
              <MessageCircle className="h-5 w-5 mr-2" />
              {total > 0 ? 'Enviar pro lojista analisar' : 'Falar com o lojista'}
            </Button>
          )}
          {!whatsapp && (
            <p className="text-center text-xs text-muted-foreground mt-4">A loja não cadastrou WhatsApp pra contato.</p>
          )}
        </Card>
      )}
    </div>
  );
};

export default StoreQuoteCalculator;
