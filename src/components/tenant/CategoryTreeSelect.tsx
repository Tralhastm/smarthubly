// Seletor de categoria em árvore (n níveis) para o formulário de produto.
// Retorna o PATH de IDs (ex: [raiz, ..., folha]) — compatível com `subcategory_ids`.

import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Layers } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type CatNode = { id: string; name: string; parent_id: string | null; hidden: boolean };

type CategoryTreeSelectProps = {
  tenantId: string;
  /** path de IDs selecionado; vazio = sem categoria */
  value: string[];
  onChange: (path: string[]) => void;
};

const CategoryTreeSelect = ({ tenantId, value, onChange }: CategoryTreeSelectProps) => {
  const [nodes, setNodes] = useState<CatNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let dead = false;
    void (async () => {
      const { data } = await supabase
        .from('product_categories')
        .select('id, name, parent_id, hidden')
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true });
      if (!dead) setNodes((data as CatNode[]) || []);
    })();
    return () => { dead = true; };
  }, [tenantId]);

  const roots = nodes.filter(n => !n.parent_id);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const nx = new Set(prev);
      if (nx.has(id)) nx.delete(id); else nx.add(id);
      return nx;
    });
  };

  // seleção = último nó clicado; visualiza o caminho inteiro
  const selectedId = value[value.length - 1] || null;

  const renderNode = (node: CatNode, depth: number): React.ReactNode => {
    const children = nodes.filter(n => n.parent_id === node.id);
    const isOpen = expanded.has(node.id);
    const isSelected = node.id === selectedId;
    return (
      <div key={node.id}>
        <button
          type="button"
          onClick={() => {
            const path = [...value.slice(0, depth - 1), node.id];
            onChange(isSelected ? value.slice(0, depth - 1) : path);
          }}
          className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs transition-colors ${isSelected ? 'bg-primary/15 text-primary font-medium' : node.hidden ? 'text-muted-foreground/60' : 'text-foreground hover:bg-secondary'}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          {children.length > 0 && (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center" onClick={e => { e.stopPropagation(); toggle(node.id); }}>
              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </span>
          )}
          <span className="truncate">{node.name}</span>
          {isSelected && <span className="ml-auto text-[9px] text-primary">✓</span>}
        </button>
        {isOpen && children.map(c => renderNode(c, depth + 1))}
      </div>
    );
  };

  if (nodes.length === 0) return <p className="text-xs text-muted-foreground px-2 py-1">Crie categorias em "Categorias & subcategorias" primeiro.</p>;

  return (
    <div className="max-h-[260px] overflow-y-auto rounded-lg border border-border bg-secondary p-1">
      {value.length > 0 && (
        <button type="button" onClick={() => onChange([])}
          className="mb-1 w-full rounded px-2 py-1 text-left text-[10px] text-muted-foreground hover:bg-destructive/10">
          ✕ limpar categoria
        </button>
      )}
      {roots.map(r => renderNode(r, 1))}
    </div>
  );
};

// helper para obter o nome legível do path
export const categoryPathNames = async (tenantId: string, pathIds: string[]): Promise<string[]> => {
  if (!pathIds || pathIds.length === 0) return [];
  const { data } = await supabase
    .from('product_categories')
    .select('id, name')
    .in('id', pathIds);
  const byId = new Map((data || []).map(n => [n.id, n.name]));
  return pathIds.map(id => byId.get(id) || '...');
};

export default CategoryTreeSelect;
