import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ItemToCategorize {
  id: string;
  name: string;
  description?: string | null;
  auto_categorize?: boolean;
}

interface Props {
  items: ItemToCategorize[];
  context: string; // ex: "Loja Texas Bebidas (food/bebidas)"
  /** Recebe lista de {id, category, subcategory} pra você aplicar no banco */
  onResults: (results: { id: string; category: string; subcategory: string }[]) => Promise<void> | void;
  label?: string;
  size?: 'sm' | 'default' | 'lg';
}

export const AutoCategorizeButton = ({ items, context, onResults, label = 'Categorizar com IA', size = 'sm' }: Props) => {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    const eligible = items.filter(it => it.auto_categorize !== false);
    if (eligible.length === 0) {
      toast.info('Nenhum item elegível pra categorização automática.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('auto-categorize', {
        body: {
          items: eligible.map(it => ({ id: it.id, name: it.name, description: it.description })),
          context,
        },
      });
      const fallbackMessage = (error as any)?.message || 'Falha ao categorizar';
      if (error && !data) throw new Error(fallbackMessage);
      if (data?.ok === false || data?.error) throw new Error(data?.error || fallbackMessage);
      const results = (data?.results ?? []) as { id: string; category: string; subcategory: string }[];
      if (results.length === 0) {
        toast.error('IA não retornou categorias. Tenta de novo.');
        return;
      }
      await onResults(results);
      toast.success(`${results.length} item(ns) categorizados! Revisa e ajusta se quiser.`);
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao categorizar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleClick} disabled={loading || items.length === 0} size={size} variant="outline" className="gap-2">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {loading ? 'Categorizando...' : label}
    </Button>
  );
};

export default AutoCategorizeButton;
