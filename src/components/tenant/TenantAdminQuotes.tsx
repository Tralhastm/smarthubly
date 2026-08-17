import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  useQuoteVariables, useUpsertQuoteVariable, useDeleteQuoteVariable,
  useQuotePackages, useUpsertQuotePackage, useDeleteQuotePackage,
  type QuoteVariable, type QuotePackage,
} from '@/hooks/useQuotes';
import { Calculator, Package, Plus, Trash2, Pencil, X, Save, Lightbulb } from 'lucide-react';
import AutoCategorizeButton from '@/components/shared/AutoCategorizeButton';

interface Props {
  tenantId: string;
  quotesEnabled: boolean;
  quotesIntroText: string;
  onTenantUpdate: () => void;
}

const EMPTY_VAR: Partial<QuoteVariable> = { name: '', unit: 'unidade', price_per_unit: 0, min_quantity: 1, max_quantity: null, description: '', active: true, sort_order: 0 };
const EMPTY_PKG: Partial<QuotePackage> = { name: '', description: '', price: 0, active: true, sort_order: 0 };

const TenantAdminQuotes = ({ tenantId, quotesEnabled, quotesIntroText, onTenantUpdate }: Props) => {
  const { toast } = useToast();
  const { data: variables = [] } = useQuoteVariables(tenantId);
  const { data: packages = [] } = useQuotePackages(tenantId);
  const upsertVar = useUpsertQuoteVariable();
  const deleteVar = useDeleteQuoteVariable();
  const upsertPkg = useUpsertQuotePackage();
  const deletePkg = useDeleteQuotePackage();

  const [editingVar, setEditingVar] = useState<Partial<QuoteVariable> | null>(null);
  const [editingPkg, setEditingPkg] = useState<Partial<QuotePackage> | null>(null);
  const [intro, setIntro] = useState(quotesIntroText);
  const [enabled, setEnabled] = useState(quotesEnabled);

  const saveSettings = async () => {
    const { error } = await supabase.from('tenants').update({ quotes_enabled: enabled, quotes_intro_text: intro }).eq('id', tenantId);
    if (error) toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Configurações salvas' }); onTenantUpdate(); }
  };

  const saveVar = async () => {
    if (!editingVar?.name?.trim()) return toast({ title: 'Nome obrigatório', variant: 'destructive' });
    try {
      await upsertVar.mutateAsync({ ...EMPTY_VAR, ...editingVar, tenant_id: tenantId } as any);
      toast({ title: 'Variável salva' });
      setEditingVar(null);
    } catch (e: any) { toast({ title: 'Erro', description: e.message, variant: 'destructive' }); }
  };

  const savePkg = async () => {
    if (!editingPkg?.name?.trim()) return toast({ title: 'Nome obrigatório', variant: 'destructive' });
    try {
      await upsertPkg.mutateAsync({ ...EMPTY_PKG, ...editingPkg, tenant_id: tenantId } as any);
      toast({ title: 'Pacote salvo' });
      setEditingPkg(null);
    } catch (e: any) { toast({ title: 'Erro', description: e.message, variant: 'destructive' }); }
  };

  return (
    <div className="space-y-6">
      {/* Configurações gerais */}
      <Card className="p-5 bg-card border-border">
        <div className="flex items-center gap-3 mb-4">
          <Calculator className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Calculadora de Orçamento</h2>
        </div>

        <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 mb-4 flex gap-2">
          <Lightbulb className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-xs text-foreground/80">
            Cadastre <b>variáveis</b> (ex: "fileira de tijolo - R$5", "metro de papel de parede - R$25", "hora de mão de obra - R$80") ou <b>pacotes prontos</b> (ex: "Instalação completa de elétrica - R$450"). O cliente acessa, calcula e te chama no WhatsApp pra fechar.
          </p>
        </div>

        <div className="flex items-center justify-between mb-4 p-3 rounded-lg border border-border bg-muted/30">
          <div>
            <Label className="text-foreground">Ativar aba "Solicitar orçamento" na loja</Label>
            <p className="text-xs text-muted-foreground mt-1">Aparece como uma aba na sua loja pública.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="space-y-2 mb-4">
          <Label className="text-foreground">Texto de boas-vindas (opcional)</Label>
          <Textarea
            value={intro}
            onChange={e => setIntro(e.target.value)}
            placeholder="Ex: Use a calculadora abaixo pra ter uma ideia. Pra orçamento exato, fale comigo no WhatsApp!"
            className="bg-background border-border min-h-[60px]"
          />
        </div>

        <Button onClick={saveSettings} className="w-full"><Save className="h-4 w-4 mr-2" />Salvar configurações</Button>
      </Card>

      {/* Variáveis */}
      <Card className="p-5 bg-card border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-foreground">Variáveis ({variables.length})</h3>
          </div>
          <div className="flex items-center gap-2">
            <AutoCategorizeButton
              items={variables.map(v => ({ id: v.id, name: v.name, description: v.description, auto_categorize: (v as any).auto_categorize }))}
              context="Variáveis de orçamento (itens cobrados por unidade) de prestador de serviço"
              onResults={async (results) => {
                for (const r of results) {
                  await supabase.from('quote_variables').update({ category: r.category, subcategory: r.subcategory } as any).eq('id', r.id);
                }
                window.location.reload();
              }}
              label="Categorizar com IA"
            />
            <Button size="sm" onClick={() => setEditingVar({ ...EMPTY_VAR })}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
          </div>
        </div>

        {editingVar && (
          <Card className="p-4 mb-3 bg-muted/30 border-primary/30">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <Label className="text-xs text-muted-foreground">Nome do item *</Label>
                <Input value={editingVar.name || ''} onChange={e => setEditingVar({ ...editingVar, name: e.target.value })} placeholder="Ex: Fileira de tijolo" className="bg-background border-border" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Unidade</Label>
                <Input value={editingVar.unit || ''} onChange={e => setEditingVar({ ...editingVar, unit: e.target.value })} placeholder="fileira, metro, hora, peça..." className="bg-background border-border" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Preço por unidade (R$)</Label>
                <Input type="number" step="0.01" value={editingVar.price_per_unit ?? 0} onChange={e => setEditingVar({ ...editingVar, price_per_unit: parseFloat(e.target.value) || 0 })} className="bg-background border-border" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Mín</Label>
                  <Input type="number" value={editingVar.min_quantity ?? 1} onChange={e => setEditingVar({ ...editingVar, min_quantity: parseFloat(e.target.value) || 1 })} className="bg-background border-border" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Máx (opc.)</Label>
                  <Input type="number" value={editingVar.max_quantity ?? ''} onChange={e => setEditingVar({ ...editingVar, max_quantity: e.target.value ? parseFloat(e.target.value) : null })} className="bg-background border-border" />
                </div>
              </div>
            </div>
            <div className="mb-3">
              <Label className="text-xs text-muted-foreground">Descrição (opcional)</Label>
              <Input value={editingVar.description || ''} onChange={e => setEditingVar({ ...editingVar, description: e.target.value })} placeholder="Ex: Inclui mão de obra e cimento" className="bg-background border-border" />
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Switch checked={editingVar.active ?? true} onCheckedChange={v => setEditingVar({ ...editingVar, active: v })} />
                  <Label className="text-xs text-muted-foreground">Ativa</Label>
                </div>
                <div className="flex items-center gap-2" title="Quando você clicar em 'Categorizar com IA', este item será ignorado">
                  <Switch checked={(editingVar as any).auto_categorize !== false} onCheckedChange={v => setEditingVar({ ...editingVar, auto_categorize: v } as any)} />
                  <Label className="text-xs text-muted-foreground">Incluir na IA</Label>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditingVar(null)}><X className="h-4 w-4" /></Button>
                <Button size="sm" onClick={saveVar}><Save className="h-4 w-4 mr-1" />Salvar</Button>
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-2">
          {variables.length === 0 && !editingVar && (
            <p className="text-center text-sm text-muted-foreground py-6">Nenhuma variável ainda. Clique em "Adicionar" pra criar a primeira.</p>
          )}
          {variables.map(v => (
            <div key={v.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground">{v.name}</span>
                  {!v.active && <Badge variant="secondary" className="text-xs">Inativa</Badge>}
                  {(v as any).category && <Badge variant="outline" className="text-xs">{(v as any).category}{(v as any).subcategory ? ` › ${(v as any).subcategory}` : ''}</Badge>}
                  {(v as any).auto_categorize === false && <Badge variant="outline" className="text-xs text-muted-foreground">🚫 IA off</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">R$ {Number(v.price_per_unit).toFixed(2)} / {v.unit} · mín {v.min_quantity}{v.max_quantity ? ` · máx ${v.max_quantity}` : ''}</p>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEditingVar(v)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Excluir "${v.name}"?`)) deleteVar.mutate({ id: v.id, tenant_id: tenantId }); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Pacotes */}
      <Card className="p-5 bg-card border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-foreground">Pacotes Prontos ({packages.length})</h3>
          </div>
          <Button size="sm" onClick={() => setEditingPkg({ ...EMPTY_PKG })}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
        </div>

        {editingPkg && (
          <Card className="p-4 mb-3 bg-muted/30 border-primary/30">
            <div className="space-y-3 mb-3">
              <div>
                <Label className="text-xs text-muted-foreground">Nome do pacote *</Label>
                <Input value={editingPkg.name || ''} onChange={e => setEditingPkg({ ...editingPkg, name: e.target.value })} placeholder="Ex: Instalação elétrica básica" className="bg-background border-border" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Descrição</Label>
                <Textarea value={editingPkg.description || ''} onChange={e => setEditingPkg({ ...editingPkg, description: e.target.value })} placeholder="O que está incluso, condições, prazo..." className="bg-background border-border" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Preço (R$)</Label>
                <Input type="number" step="0.01" value={editingPkg.price ?? 0} onChange={e => setEditingPkg({ ...editingPkg, price: parseFloat(e.target.value) || 0 })} className="bg-background border-border" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch checked={editingPkg.active ?? true} onCheckedChange={v => setEditingPkg({ ...editingPkg, active: v })} />
                <Label className="text-xs text-muted-foreground">Ativo</Label>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditingPkg(null)}><X className="h-4 w-4" /></Button>
                <Button size="sm" onClick={savePkg}><Save className="h-4 w-4 mr-1" />Salvar</Button>
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-2">
          {packages.length === 0 && !editingPkg && (
            <p className="text-center text-sm text-muted-foreground py-6">Nenhum pacote ainda.</p>
          )}
          {packages.map(p => (
            <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground">{p.name}</span>
                  {!p.active && <Badge variant="secondary" className="text-xs">Inativo</Badge>}
                </div>
                {p.description && <p className="text-xs text-muted-foreground line-clamp-1">{p.description}</p>}
                <p className="text-sm font-semibold text-primary mt-1">R$ {Number(p.price).toFixed(2)}</p>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEditingPkg(p)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Excluir "${p.name}"?`)) deletePkg.mutate({ id: p.id, tenant_id: tenantId }); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

export default TenantAdminQuotes;
