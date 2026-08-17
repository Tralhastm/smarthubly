// Gerenciador de categorias com SUBCATEGORIAS ILIMITADAS (n níveis)
//
// Estrutura: tabelas `product_categories` (nós) + coluna `path_ids` no produto?
// NÃO. Mantém compatibilidade: produtos continuam com `category` (raiz) e
// `subcategory` (ID do nó final). A árvore permite criar quantos níveis forem.
//
// - product_categories: id, tenant_id, name, parent_id, sort_order, hidden, created_at
// - path_ids[] guardado em `subcategory`? Não — subcategory armazena o NOME da folha (compat
//   com o código antigo). Para resolver sem quebrar nada, adicionamos:
//     `subcategory_path` text[] no products  -> IDs do caminho [raiz, ..., folha]
//   A navegação da loja usa as IDs (via `subcategory_ids`), mas o texto legível
//   continua em subcategory.

import { useState, useEffect } from 'react';
import { FolderPlus, Pencil, Trash2, GripVertical, Loader2, Layers, EyeOff, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type CatNode = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  hidden: boolean;
};

type TenantCategoriesTreeProps = {
  tenantId: string;
};

const TenantCategoriesTree = ({ tenantId }: TenantCategoriesTreeProps) => {
  const [nodes, setNodes] = useState<CatNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [addingParent, setAddingParent] = useState(false);
  const [addChildOf, setAddChildOf] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('product_categories')
      .select('id, name, parent_id, sort_order, hidden')
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true });
    setNodes(data as CatNode[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [tenantId]);

  const createNode = async (parentId: string | null) => {
    const name = newName.trim();
    if (!name) { toast.error('Digite o nome da categoria'); return; }
    const maxSort = nodes.filter(n => n.parent_id === parentId).reduce((m, n) => Math.max(m, n.sort_order), -1);
    const { error } = await supabase.from('product_categories').insert({
      tenant_id: tenantId, name, parent_id: parentId, sort_order: maxSort + 1, hidden: false,
    });
    if (error) { toast.error(error.message); return; }
    setNewName('');
    setAddingParent(false);
    setAddChildOf(null);
    await load();
    toast.success('Categoria criada');
  };

  const updateNode = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    setSaving(id);
    const { error } = await supabase.from('product_categories').update({ name }).eq('id', id);
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    setEditingId(null);
    await load();
    toast.success('Renomeada');
  };

  const deleteNode = async (node: CatNode) => {
    const hasChildren = nodes.some(n => n.parent_id === node.id);
    if (hasChildren) {
      if (!window.confirm(`"${node.name}" tem subcategorias. Excluir tudo dentro dela?`)) return;
      await deleteSubtree(node.id);
      return;
    }
    if (!window.confirm(`Excluir "${node.name}"? Os produtos nela voltam a ficar sem categoria.`)) return;
    setSaving(node.id);
    const { error } = await supabase.from('product_categories').delete().eq('id', node.id);
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    // tira o produto dessa categoria (mantém nível acima)
    await supabase.rpc('remove_product_category', { p_category_id: node.id }).catch(() => {});
    await load();
    toast.success('Excluída');
  };

  const deleteSubtree = async (rootId: string) => {
    const collect = (id: string): string[] => [id, ...nodes.filter(n => n.parent_id === id).flatMap(n => collect(n.id))];
    const ids = collect(rootId);
    setSaving(rootId);
    await Promise.all([
      supabase.from('product_categories').delete().in('id', ids),
      supabase.rpc('remove_product_categories', { p_category_ids: ids }).catch(() => {}),
    ]);
    setSaving(null);
    await load();
    toast.success('Árvore excluída');
  };

  const toggleHidden = async (node: CatNode) => {
    setSaving(node.id);
    const { error } = await supabase.from('product_categories').update({ hidden: !node.hidden }).eq('id', node.id);
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    await load();
  };

  const moveUp = async (node: CatNode) => {
    const siblings = nodes.filter(n => n.parent_id === node.parent_id).sort((a, b) => a.sort_order - b.sort_order);
    const idx = siblings.findIndex(n => n.id === node.id);
    if (idx <= 0) return;
    const prev = siblings[idx - 1];
    await swapOrder(node.id, prev.id);
  };

  const moveDown = async (node: CatNode) => {
    const siblings = nodes.filter(n => n.parent_id === node.parent_id).sort((a, b) => a.sort_order - b.sort_order);
    const idx = siblings.findIndex(n => n.id === node.id);
    if (idx === -1 || idx >= siblings.length - 1) return;
    const next = siblings[idx + 1];
    await swapOrder(node.id, next.id);
  };

  const swapOrder = async (a: string, b: string) => {
    const na = nodes.find(n => n.id === a);
    const nb = nodes.find(n => n.id === b);
    if (!na || !nb) return;
    await Promise.all([
      supabase.from('product_categories').update({ sort_order: nb.sort_order }).eq('id', na.id),
      supabase.from('product_categories').update({ sort_order: na.sort_order }).eq('id', nb.id),
    ]);
    await load();
  };

  // ---------- helpers de renderização ----------
  const roots = nodes.filter(n => !n.parent_id).sort((a, b) => a.sort_order - b.sort_order);

  const renderChildren = (parentId: string, depth: number): React.ReactNode => {
    const children = nodes.filter(n => n.parent_id === parentId).sort((a, b) => a.sort_order - b.sort_order);
    if (children.length === 0 && addingParent === null && addChildOf !== parentId) return null;
    return (
      <div className={depth === 1 ? '' : 'ml-6 border-l border-border/60 pl-3'}>
        {children.map(c => renderNode(c, depth + 1))}
        {addChildOf === parentId && (
          <div className="mt-1 flex items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void createNode(parentId); if (e.key === 'Escape') setAddChildOf(null); }}
              placeholder="Nome da subcategoria..."
              className="w-full max-w-xs rounded-lg border border-primary/40 bg-secondary px-3 py-1.5 text-sm text-foreground"
            />
            <button onClick={() => void createNode(parentId)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Adicionar</button>
            <button onClick={() => setAddChildOf(null)} className="rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground">Cancelar</button>
          </div>
        )}
      </div>
    );
  };

  const renderNode = (node: CatNode, depth: number): React.ReactNode => (
    <div key={node.id} className="mt-1">
      <div className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 group ${depth > 1 ? 'bg-secondary/60' : 'bg-secondary/80'} ${node.hidden ? 'opacity-60' : ''}`}>
        <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {editingId === node.id ? (
          <>
            <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void updateNode(node.id); if (e.key === 'Escape') setEditingId(null); }}
              className="w-full max-w-xs rounded border border-primary/40 bg-background px-2 py-1 text-sm text-foreground" />
            {saving === node.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : (
              <button onClick={() => void updateNode(node.id)} className="text-xs font-medium text-emerald-500">Salvar</button>
            )}
          </>
        ) : (
          <>
            <span className="text-sm text-foreground truncate">{node.name}</span>
            <div className="ml-auto flex items-center gap-1 opacity-60 group-hover:opacity-100">
              <button onClick={() => moveUp(node)} className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground" title="Mover para cima">▲</button>
              <button onClick={() => moveDown(node)} className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground" title="Mover para baixo">▼</button>
              <button onClick={() => { setEditingId(node.id); setEditName(node.name); }} disabled={saving === node.id}
                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50" title="Renomear">
                {saving === node.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => setAddChildOf(node.id)} className="rounded p-1 text-muted-foreground hover:bg-background hover:text-primary" title="Adicionar subcategoria">
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => toggleHidden(node)} disabled={saving === node.id}
                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50" title={node.hidden ? 'Mostrar na loja' : 'Ocultar da loja'}>
                {node.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => void deleteNode(node)} disabled={saving === node.id}
                className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive disabled:opacity-50" title="Excluir">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
      {renderChildren(node.id, depth)}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium text-foreground">Categorias e subcategorias</h3>
          <span className="text-[10px] text-muted-foreground">Níveis ilimitados</span>
        </div>
        {!addingParent && (
          <button onClick={() => setAddingParent(true)}
            className="flex items-center gap-1 rounded-lg gradient-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            <FolderPlus className="h-3.5 w-3.5" /> Nova categoria raiz
          </button>
        )}
      </div>

      {addingParent && (
        <div className="flex items-center gap-2">
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void createNode(null); if (e.key === 'Escape') setAddingParent(false); }}
            placeholder="Nome da categoria raiz (ex: Masculino, Bebidas)..."
            className="w-full max-w-xs rounded-lg border border-primary/40 bg-secondary px-3 py-1.5 text-sm text-foreground" />
          <button onClick={() => void createNode(null)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Adicionar</button>
          <button onClick={() => setAddingParent(false)} className="rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground">Cancelar</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
      ) : roots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhuma categoria cadastrada. Crie a primeira (ex: "Masculino", "Lanches", "Eletrônicos") e depois adicione quantas subcategorias quiser.
        </div>
      ) : (
        <div className="space-y-0.5">
          {roots.map(r => renderNode(r, 1))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Os produtos são vinculados à última subcategoria da árvore. Ao editar um produto, escolha na árvore — funciona como antes para qualquer loja (roupas, mercado, serviços...).
      </p>
    </div>
  );
};

export default TenantCategoriesTree;
