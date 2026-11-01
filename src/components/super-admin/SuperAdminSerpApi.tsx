import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Key, Plus, Trash2, RefreshCw, Eye, EyeOff, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const PROVIDER = 'serpapi';

const SuperAdminSerpApi = () => {
  const [newKey, setNewKey] = useState('');
  const [bulkKeys, setBulkKeys] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const queryClient = useQueryClient();

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['serpapi-keys'],
    queryFn: async () => {
      const { data, error } = await supabase.from('api_keys').select('*').eq('provider', PROVIDER).order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const addKey = useMutation({
    mutationFn: async (apiKey: string) => {
      const { error } = await supabase.from('api_keys').insert({ provider: PROVIDER, api_key: apiKey });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serpapi-keys'] });
      setNewKey('');
      toast.success('Chave SerpAPI adicionada!');
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : 'Erro ao adicionar chave'),
  });

  const replaceAll = useMutation({
    mutationFn: async (newKeys: string[]) => {
      const { error: deleteError } = await supabase.from('api_keys').delete().eq('provider', PROVIDER);
      if (deleteError) throw deleteError;
      const { error: insertError } = await supabase.from('api_keys').insert(newKeys.map(api_key => ({ provider: PROVIDER, api_key })));
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serpapi-keys'] });
      setBulkKeys('');
      toast.success('Chaves SerpAPI substituídas!');
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : 'Erro ao substituir chaves'),
  });

  const deleteKey = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('api_keys').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serpapi-keys'] });
      toast.success('Chave removida');
    },
    onError: () => toast.error('Erro ao remover chave'),
  });

  const resetAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('api_keys').update({ is_exhausted: false }).eq('provider', PROVIDER);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serpapi-keys'] });
      toast.success('Status das chaves resetado!');
    },
  });

  const handleBulkReplace = () => {
    const parsed = [...new Set(bulkKeys.split(/\r?\n/).map(key => key.trim()).filter(Boolean))];
    if (!parsed.length) {
      toast.error('Cole pelo menos uma chave SerpAPI, uma por linha');
      return;
    }
    replaceAll.mutate(parsed);
  };

  const maskKey = (key: string) => key.length <= 8 ? '••••••••' : `${key.slice(0, 6)}...${key.slice(-4)}`;
  const activeKeys = keys.filter(key => !key.is_exhausted);
  const exhaustedKeys = keys.filter(key => key.is_exhausted);

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Search className="h-4 w-4 text-primary" /> SerpAPI para o Precificador</div>
        <p className="mt-1 text-xs text-muted-foreground">Cadastre uma ou mais chaves. O Precificador usa as chaves ativas em rotação e troca de chave quando uma atingir limite ou retornar erro.</p>
        <p className="mt-2 text-xs text-amber-300">As chaves ficam protegidas no banco e aparecem mascaradas nesta tela. Nunca cole uma chave em conversas ou arquivos públicos.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Chaves ativas</p><p className="text-2xl font-bold text-green-400">{activeKeys.length}</p></div>
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Com limite/erro</p><p className="text-2xl font-bold text-red-400">{exhaustedKeys.length}</p></div>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h3 className="font-heading text-sm text-foreground">Adicionar chave manualmente</h3>
        <div className="flex gap-2">
          <Input value={newKey} onChange={event => setNewKey(event.target.value)} placeholder="Chave da SerpAPI" type="password" className="flex-1" />
          <Button size="sm" onClick={() => newKey.trim() && addKey.mutate(newKey.trim())} disabled={addKey.isPending}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center gap-2"><Upload className="h-4 w-4 text-primary" /><h3 className="font-heading text-sm text-foreground">Importar várias chaves</h3></div>
        <p className="text-xs text-muted-foreground">Cole uma chave por linha. A ação substitui somente as chaves SerpAPI; as chaves Google permanecem intactas.</p>
        <textarea value={bulkKeys} onChange={event => setBulkKeys(event.target.value)} placeholder="chave_serpapi_1\nchave_serpapi_2" className="min-h-[100px] w-full resize-y rounded-lg border border-border bg-secondary p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground" />
        <Button size="sm" onClick={handleBulkReplace} disabled={replaceAll.isPending}><RefreshCw className="mr-1 h-4 w-4" />{replaceAll.isPending ? 'Salvando...' : 'Substituir chaves SerpAPI'}</Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between"><h3 className="font-heading text-sm text-foreground">Chaves SerpAPI ({keys.length})</h3><Button size="sm" variant="ghost" onClick={() => setShowKeys(value => !value)}>{showKeys ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></div>
        {keys.map((key, index) => <div key={key.id} className={`flex items-center justify-between rounded-lg border p-3 text-sm ${key.is_exhausted ? 'border-red-500/30 bg-red-500/10' : 'border-border bg-secondary'}`}>
          <div className="flex items-center gap-2"><Key className={`h-4 w-4 ${key.is_exhausted ? 'text-red-400' : 'text-green-400'}`} /><div><span className="font-mono text-xs text-foreground">#{index + 1} · {showKeys ? key.api_key : maskKey(key.api_key)}</span><p className="text-xs text-muted-foreground">{key.is_exhausted ? 'Com limite/erro' : 'Ativa'}{key.last_used_at && ` · Usada ${new Date(key.last_used_at).toLocaleDateString('pt-BR')}`}</p></div></div>
          <Button size="sm" variant="ghost" onClick={() => deleteKey.mutate(key.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
        </div>)}
        {!keys.length && <p className="py-4 text-center text-muted-foreground">Nenhuma chave SerpAPI cadastrada.</p>}
      </div>

      <Button size="sm" variant="outline" onClick={() => resetAll.mutate()} disabled={resetAll.isPending}><RefreshCw className="mr-1 h-4 w-4" /> Resetar status</Button>
    </div>
  );
};

export default SuperAdminSerpApi;
