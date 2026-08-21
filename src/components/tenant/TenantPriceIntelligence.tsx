import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Package, Factory, TrendingDown, TrendingUp, AlertTriangle, CheckCircle2, DollarSign, ArrowRight, Info, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

type PriceComparison = {
  product_id: string;
  product_name: string;
  current_cost: number;
  current_resale: number;
  current_supplier_name: string;
  best_supplier_name: string;
  best_cost: number;
  potential_margin: number;
  current_margin: number;
  status: 'optimized' | 'warning' | 'critical';
};

const TenantPriceIntelligence = ({ tenantId }: { tenantId: string }) => {
  const [comparisons, setComparisons] = useState<PriceComparison[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Busca todos os produtos com seu fornecedor principal e custo atual
      const { data: products } = await supabase
        .from('products')
        .select('id, name, price, original_price, supplier_id, suppliers(name)')
        .eq('tenant_id', tenantId);

      if (!products) return;

      // 2. Busca todos os preços de fornecedores registrados para comparação
      const { data: supplierPrices } = await supabase
        .from('supplier_product_prices')
        .select('product_name, unit_price, suppliers(name)')
        .eq('available', true);

      const results: PriceComparison[] = products.map(p => {
        const resale = p.price || 0;
        const currentCost = p.original_price || 0;
        const currentSupplier = (p.suppliers as any)?.name || 'Não definido';

        // Encontra o melhor preço entre todos os fornecedores para este produto
        const competitors = (supplierPrices || []).filter(sp => 
          sp.product_name.toLowerCase() === p.name.toLowerCase()
        );

        let bestCost = currentCost;
        let bestSupplier = currentSupplier;

        competitors.forEach(sp => {
          if (sp.unit_price > 0 && (bestCost === 0 || sp.unit_price < bestCost)) {
            bestCost = sp.unit_price;
            bestSupplier = (sp.suppliers as any)?.name;
          }
        });

        const currentMargin = resale > 0 ? ((resale - currentCost) / resale * 100) : 0;
        const potentialMargin = resale > 0 ? ((resale - bestCost) / resale * 100) : 0;
        
        let status: 'optimized' | 'warning' | 'critical' = 'optimized';
        if (bestCost < currentCost) status = 'warning';
        if (currentMargin < 10) status = 'critical';

        return {
          product_id: p.id,
          product_name: p.name,
          current_cost: currentCost,
          current_resale: resale,
          current_supplier_name: currentSupplier,
          best_supplier_name: bestSupplier,
          best_cost: bestCost,
          current_margin: currentMargin,
          potential_margin: potentialMargin,
          status
        };
      });

      setComparisons(results.sort((a, b) => (b.potential_margin - a.potential_margin)));
    } catch (error) {
      console.error('Erro ao carregar inteligência de preços:', error);
      toast.error('Falha ao carregar dados de inteligência.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [tenantId]);

  if (loading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  const savingsOpportunity = comparisons.reduce((acc, c) => acc + (c.current_cost - c.best_cost), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <TrendingDown className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Oportunidade de Economia</p>
            <p className="text-2xl font-bold text-foreground">R$ {savingsOpportunity.toFixed(2)}</p>
            <p className="text-[10px] text-primary">Baseado no melhor fornecedor por item</p>
          </div>
        </div>
        
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Alertas de Margem</p>
            <p className="text-2xl font-bold text-foreground">{comparisons.filter(c => c.status !== 'optimized').length}</p>
            <p className="text-[10px] text-amber-500">Produtos com custo acima do ideal</p>
          </div>
        </div>

        <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-4 flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
            <DollarSign className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Margem Média Potencial</p>
            <p className="text-2xl font-bold text-foreground">
              {(comparisons.reduce((acc, c) => acc + c.potential_margin, 0) / comparisons.length || 0).toFixed(1)}%
            </p>
            <p className="text-[10px] text-green-500">Lucro máximo possível</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Análise de Fornecedores por Produto
          </h3>
          <div className="flex gap-3">
            <button 
              onClick={async () => {
                const targets = comparisons.filter(c => c.best_cost < c.current_cost && c.best_cost > 0);
                if (targets.length === 0) {
                  toast.info("Todos os produtos já estão com o melhor preço de custo!");
                  return;
                }
                if (!confirm(`Deseja atualizar o preço de custo de ${targets.length} produtos para a melhor oferta encontrada?`)) return;
                
                toast.loading(`Sincronizando ${targets.length} preços...`);
                let count = 0;
                for (const t of targets) {
                  const { error } = await supabase
                    .from('products')
                    .update({ original_price: t.best_cost } as any)
                    .eq('id', t.product_id);
                  if (!error) count++;
                }
                toast.success(`${count} preços atualizados com sucesso!`);
                fetchData();
              }}
              className="text-xs bg-primary/10 text-primary px-3 py-1 rounded-full hover:bg-primary/20 font-bold transition-colors"
            >
              Sincronizar Melhores Preços
            </button>
            <button onClick={fetchData} className="text-xs text-primary hover:underline">Atualizar dados</button>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary/50 text-muted-foreground text-[10px] uppercase font-bold">
              <tr>
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Custo Atual</th>
                <th className="px-4 py-3">Melhor Fornecedor</th>
                <th className="px-4 py-3">Margem Real</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {comparisons.map((c, i) => (
                <tr key={i} className="hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-4">
                    <div className="font-medium text-foreground">{c.product_name}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Factory className="h-3 w-3" /> {c.current_supplier_name}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-foreground font-mono">R$ {c.current_cost.toFixed(2)}</div>
                    <div className="text-[10px] text-muted-foreground">Revenda: R$ {c.current_resale.toFixed(2)}</div>
                  </td>
                  <td className="px-4 py-4">
                    {c.best_cost < c.current_cost ? (
                      <div className="space-y-1">
                        <div className="text-green-500 font-bold flex items-center gap-1">
                          <TrendingDown className="h-3 w-3" /> R$ {c.best_cost.toFixed(2)}
                        </div>
                        <div className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 inline-block">
                          {c.best_supplier_name}
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-xs flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-500" /> Já otimizado
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${c.current_margin < 15 ? 'text-destructive' : 'text-foreground'}`}>
                        {c.current_margin.toFixed(1)}%
                      </span>
                      {c.potential_margin > c.current_margin && (
                        <div className="flex items-center text-green-500 text-[10px] font-bold">
                          <ArrowRight className="h-3 w-3 mx-0.5" />
                          {c.potential_margin.toFixed(1)}%
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    {c.status === 'warning' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-600">
                        <AlertTriangle className="h-3 w-3" /> Trocar Fornecedor
                      </span>
                    )}
                    {c.status === 'critical' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-[10px] font-medium text-destructive">
                        <DollarSign className="h-3 w-3" /> Margem Baixa
                      </span>
                    )}
                    {c.status === 'optimized' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-1 text-[10px] font-medium text-green-600">
                        <CheckCircle2 className="h-3 w-3" /> Ideal
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl bg-secondary/50 p-4 border border-border flex items-start gap-3">
        <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-bold text-foreground">Como funciona a Inteligência de Preços?</p>
          <p>O sistema monitora todos os catálogos que você importa. Se o <strong>Mania Digital</strong> baixar o preço de um iPhone que você costuma comprar na <strong>Hiphone Digital</strong>, um alerta aparecerá aqui.</p>
          <p>A "Margem Real" é calculada sobre o custo que você está pagando hoje. A "Margem Potencial" mostra quanto você ganharia se comprasse do fornecedor mais barato detectado pela IA.</p>
        </div>
      </div>
    </div>
  );
};

export default TenantPriceIntelligence;
