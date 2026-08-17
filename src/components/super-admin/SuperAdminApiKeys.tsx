import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Key, Plus, Trash2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const SuperAdminApiKeys = () => {
  const [newKey, setNewKey] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const queryClient = useQueryClient();

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('api_keys')
        .select('*')
        .eq('provider', 'google_ai')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const addKey = useMutation({
    mutationFn: async (apiKey: string) => {
      const { error } = await supabase.from('api_keys').insert({ provider: 'google_ai', api_key: apiKey });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setNewKey('');
      toast.success('Chave adicionada!');
    },
    onError: () => toast.error('Erro ao adicionar chave'),
  });

  const deleteKey = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('api_keys').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('Chave removida');
    },
  });

  const resetAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('api_keys')
        .update({ is_exhausted: false })
        .eq('provider', 'google_ai');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('Todas as chaves resetadas!');
    },
  });

  const replaceAll = useMutation({
    mutationFn: async (newKeys: string[]) => {
      // Delete all old keys
      const { error: delError } = await supabase.from('api_keys').delete().eq('provider', 'google_ai');
      if (delError) throw delError;
      // Insert new ones
      const rows = newKeys.map(k => ({ provider: 'google_ai', api_key: k.trim() }));
      const { error: insError } = await supabase.from('api_keys').insert(rows);
      if (insError) throw insError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setBulkKeys('');
      toast.success('Chaves substituídas com sucesso!');
    },
    onError: () => toast.error('Erro ao substituir chaves'),
  });

  const [bulkKeys, setBulkKeys] = useState('');

  const handleBulkReplace = () => {
    const lines = bulkKeys.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return toast.error('Cole pelo menos uma chave');
    replaceAll.mutate(lines);
  };

  const maskKey = (key: string) => key.slice(0, 8) + '...' + key.slice(-4);

  const activeKeys = keys.filter(k => !k.is_exhausted);
  const exhaustedKeys = keys.filter(k => k.is_exhausted);

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Chaves Ativas</p>
          <p className="text-2xl font-bold text-green-400">{activeKeys.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Esgotadas</p>
          <p className="text-2xl font-bold text-red-400">{exhaustedKeys.length}</p>
        </div>
      </div>

      {/* Add single key */}
      <div className="space-y-2">
        <h3 className="font-heading text-sm text-foreground">Adicionar Chave</h3>
        <div className="flex gap-2">
          <Input
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            placeholder="AIzaSy..."
            className="flex-1"
          />
          <Button size="sm" onClick={() => newKey.trim() && addKey.mutate(newKey.trim())} disabled={addKey.isPending}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Bulk replace */}
      <div className="space-y-2">
        <h3 className="font-heading text-sm text-foreground">Substituir Todas (cole uma por linha)</h3>
        <textarea
          value={bulkKeys}
          onChange={e => setBulkKeys(e.target.value)}
          placeholder={"AIzaSyBx...\nAIzaSyCd...\nAIzaSyEf..."}
          className="w-full rounded-lg border border-border bg-secondary p-3 text-sm text-foreground placeholder:text-muted-foreground min-h-[100px] resize-y"
          rows={4}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" onClick={handleBulkReplace} disabled={replaceAll.isPending}>
            <RefreshCw className="h-4 w-4 mr-1" /> Substituir Todas
          </Button>
          <Button size="sm" variant="outline" onClick={() => resetAll.mutate()} disabled={resetAll.isPending}>
            Resetar Status
          </Button>
        </div>
      </div>

      {/* Keys list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-sm text-foreground">Chaves ({keys.length})</h3>
          <Button size="sm" variant="ghost" onClick={() => setShowKeys(!showKeys)}>
            {showKeys ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
        {keys.map((k, i) => (
          <div key={k.id} className={`flex items-center justify-between rounded-lg p-3 text-sm ${k.is_exhausted ? 'bg-red-500/10 border border-red-500/30' : 'bg-secondary'}`}>
            <div className="flex items-center gap-2">
              <Key className={`h-4 w-4 ${k.is_exhausted ? 'text-red-400' : 'text-green-400'}`} />
              <div>
                <span className="font-mono text-xs text-foreground">
                  #{i + 1} · {showKeys ? k.api_key : maskKey(k.api_key)}
                </span>
                <p className="text-xs text-muted-foreground">
                  {k.is_exhausted ? '🔴 Esgotada' : '🟢 Ativa'}
                  {k.last_used_at && ` · Usada ${new Date(k.last_used_at).toLocaleDateString('pt-BR')}`}
                </p>
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => deleteKey.mutate(k.id)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
        {keys.length === 0 && <p className="text-center text-muted-foreground py-4">Nenhuma chave cadastrada.</p>}
      </div>
    </div>
  );
};

export default SuperAdminApiKeys;
