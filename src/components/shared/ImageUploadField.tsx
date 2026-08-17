import { useState, useRef, useEffect } from 'react';
import { uploadProductImage } from '@/hooks/useProductImageUpload';
import { removeSolidBackground } from '@/lib/remove-image-bg';
import { supabase } from '@/integrations/supabase/client';
import { Upload, Loader2, Link, ImageIcon, Search, X, Plus, Wand2, Eraser } from 'lucide-react';
import { toast } from 'sonner';

const ImageUploadField = ({ value, onChange, tenantId, label, searchQuery, transparentBg }: { value: string; onChange: (url: string) => void; tenantId: string; label?: string; searchQuery?: string; transparentBg?: boolean }) => {

  const inputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<'upload' | 'url' | 'google'>('upload');
  const [urlInput, setUrlInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [googleResults, setGoogleResults] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [refs, setRefs] = useState<string[]>([]);
  const [refOnly, setRefOnly] = useState(false);
  const [refUrlInput, setRefUrlInput] = useState('');
  const [refUploading, setRefUploading] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceStyle, setEnhanceStyle] = useState('studio');
  const [aiTag, setAiTag] = useState(true);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [strippingBg, setStrippingBg] = useState(false);


  const refsKey = `img-refs:${tenantId}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(refsKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setRefs(Array.isArray(parsed.refs) ? parsed.refs : []);
        setRefOnly(!!parsed.refOnly);
      }
    } catch { /* ignore */ }
  }, [refsKey]);

  const persistRefs = (next: string[], only = refOnly) => {
    setRefs(next);
    try { localStorage.setItem(refsKey, JSON.stringify({ refs: next, refOnly: only })); } catch { /* ignore */ }
  };
  const persistRefOnly = (only: boolean) => {
    setRefOnly(only);
    try { localStorage.setItem(refsKey, JSON.stringify({ refs, refOnly: only })); } catch { /* ignore */ }
  };

  const handleFile = async (file: File) => {
    const okExt = /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif|avif|tiff?|ico)$/i.test(file.name);
    if (!file.type.startsWith('image/') && !okExt) {
      toast.error('Selecione um arquivo de imagem');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error('Imagem deve ter no máximo 15MB');
      return;
    }
    setUploading(true);
    try {
      let toUpload: File = file;
      if (transparentBg) {
        try {
          const clean = await removeSolidBackground(file);
          if (clean) toUpload = new File([clean], file.name.replace(/\.\w+$/, '') + '.png', { type: 'image/png' });
        } catch { /* mantém original */ }
      }
      const url = await uploadProductImage(toUpload, tenantId);
      onChange(url);
      toast.success(toUpload !== file ? 'Imagem enviada (fundo removido)!' : 'Imagem enviada!');
    } catch (err: any) {
      toast.error('Erro ao enviar imagem: ' + (err.message || ''));
    } finally {
      setUploading(false);
    }
  };

  // Remove o fundo sólido da imagem atual (logos com "caixa" preta/branca)
  const handleRemoveBg = async () => {
    if (!value) return;
    setStrippingBg(true);
    const previous = value;
    try {
      const res = await fetch(value, { mode: 'cors' });
      const blob = await res.blob();
      const clean = await removeSolidBackground(blob);
      if (!clean) { toast.info('Essa imagem não tem um fundo sólido para remover.'); return; }
      const file = new File([clean], 'logo.png', { type: 'image/png' });
      const url = await uploadProductImage(file, tenantId);
      setBeforeUrl(previous);
      onChange(url);
      toast.success('Fundo removido!');
    } catch (err: any) {
      toast.error('Não foi possível remover o fundo: ' + (err?.message || ''));
    } finally {
      setStrippingBg(false);
    }
  };


  const handleRefFiles = async (files: FileList) => {
    setRefUploading(true);
    const added: string[] = [];
    try {
      for (const file of Array.from(files)) {
        if (file.size > 15 * 1024 * 1024) { toast.error(`${file.name}: máx 15MB`); continue; }
        try { added.push(await uploadProductImage(file, tenantId)); } catch { toast.error(`Falha em ${file.name}`); }
      }
      if (added.length) { persistRefs([...refs, ...added]); toast.success(`${added.length} referência(s) adicionada(s)`); }
    } finally {
      setRefUploading(false);
    }
  };

  // Fotos que a loja já usa — o backend descarta qualquer resultado idêntico a elas
  const loadExistingImages = async (): Promise<string[]> => {
    try {
      const { data } = await supabase
        .from('products')
        .select('image')
        .eq('tenant_id', tenantId)
        .not('image', 'is', null)
        .limit(300);
      const urls = (data || [])
        .map((p: any) => p.image as string)
        .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u) && u !== value);
      return [...new Set(urls)];

    } catch {
      return [];
    }
  };

  const handleSearchGoogle = async () => {
    const q = (searchTerm || searchQuery || '').trim();
    if (!q && !(refOnly && refs.length > 0)) { toast.error('Digite o que buscar (ou preencha o nome do produto primeiro)'); return; }
    setSearching(true);
    setGoogleResults([]);
    try {
      const existingImages = await loadExistingImages();
      const { data, error } = await supabase.functions.invoke('search-google-images', {
        body: { query: q, max: 8, refImages: refs, refOnly: refOnly && refs.length > 0, existingImages },
      });
      if (error) throw error;
      const urls = (data?.urls || []) as string[];
      if (urls.length === 0) { toast.warning(refs.length ? 'Nada parecido com as referências (ou só vieram fotos já usadas na loja).' : 'Nada encontrado que já não esteja na loja. Tente outras palavras.'); return; }
      setGoogleResults(urls);
    } catch (err: any) {
      toast.error('Erro na busca: ' + (err.message || ''));
    } finally {
      setSearching(false);
    }
  };

  // Garante que logos escolhidas por link/busca também percam o fundo sólido
  const applyTransparency = async (url: string): Promise<string> => {
    if (!transparentBg || !url) return url;
    try {
      const res = await fetch(url, { mode: 'cors' });
      const blob = await res.blob();
      const clean = await removeSolidBackground(blob);
      if (!clean) return url;
      return await uploadProductImage(new File([clean], 'logo.png', { type: 'image/png' }), tenantId);
    } catch {
      return url;
    }
  };

  const handlePickGoogle = async (url: string) => {
    setUploading(true);
    try {
      const existingImages = await loadExistingImages();
      // Salva EXATAMENTE a foto clicada no nosso bucket (não busca de novo)
      const { data, error } = await supabase.functions.invoke('search-google-images', {
        body: { directUrl: url, tenantId, existingImages },
      });
      if (data?.duplicate) {
        toast.error('Essa foto já está sendo usada em outro produto da loja. Escolha outra.');
        return;
      }
      if (error || !data?.imageUrl) {
        onChange(await applyTransparency(url)); // fallback: usa o link externo original
      } else {
        onChange(await applyTransparency(data.imageUrl));
      }
      toast.success('Foto selecionada!');
      setGoogleResults([]);
    } catch {
      onChange(url);
      toast.success('Foto selecionada (link externo)');
    } finally {
      setUploading(false);
    }
  };


  // Tratador de imagens: melhora a foto atual com IA (mantém o produto, melhora luz/fundo/nitidez)
  const handleEnhance = async () => {
    if (!value) return;
    setEnhancing(true);
    const previous = value;
    try {
      const { data, error } = await supabase.functions.invoke('enhance-image', {
        body: { imageUrl: value, tenantId, productName: searchQuery || searchTerm || undefined, style: enhanceStyle, aiTag },
      });
      if (error || !data?.imageUrl) {
        // pega a mensagem real que a função devolveu (o invoke só diz "non-2xx")
        let msg = data?.error || error?.message || 'Falha ao tratar a imagem';
        try {
          const body = await (error as any)?.context?.json?.();
          if (body?.error) msg = body.error;
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      setBeforeUrl(previous);
      onChange(data.imageUrl);
      toast.success('Imagem tratada por IA!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao tratar imagem');
    } finally {
      setEnhancing(false);
    }
  };


  return (
    <div className="space-y-2">
      {label && <label className="text-xs text-muted-foreground">{label}</label>}
      <div className="flex gap-1 mb-1 flex-wrap">
        <button type="button" onClick={() => setMode('upload')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${mode === 'upload' ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
          <Upload className="h-3 w-3 inline mr-1" />Enviar arquivo
        </button>
        <button type="button" onClick={() => setMode('url')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${mode === 'url' ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
          <Link className="h-3 w-3 inline mr-1" />Colar URL
        </button>
        <button type="button" onClick={() => setMode('google')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${mode === 'google' ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
          <ImageIcon className="h-3 w-3 inline mr-1" />Buscar na web
        </button>
      </div>

      {mode === 'upload' && (
        <div className="flex gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
            className="flex items-center gap-2 rounded-lg bg-secondary text-foreground px-3 py-2 text-sm hover:bg-secondary/80 disabled:opacity-50">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? 'Enviando...' : 'Escolher imagem'}
          </button>
          <input ref={inputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
        </div>
      )}

      {mode === 'url' && (
        <div className="flex gap-2">
          <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://exemplo.com/imagem.jpg"
            className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          <button type="button" onClick={async () => { const u = urlInput.trim(); if (!u) return; setUploading(true); try { onChange(await applyTransparency(u)); setUrlInput(''); } finally { setUploading(false); } }}
            className="rounded-lg gradient-primary text-primary-foreground px-3 py-2 text-sm">OK</button>
        </div>
      )}

      {mode === 'google' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSearchGoogle(); } }}
              placeholder={searchQuery || 'O que procurar (ex: perfume Dior 100ml)'}
              className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            <button type="button" onClick={handleSearchGoogle} disabled={searching}
              className="flex items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-50">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </button>
          </div>

          {/* Referências de imagem (opcional, ilimitadas) */}
          <div className="rounded-lg border border-border p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground">Referências de imagem ({refs.length})</span>
              <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={refOnly} disabled={refs.length === 0}
                  onChange={e => persistRefOnly(e.target.checked)} className="h-3 w-3 accent-primary" />
                Buscar só pelas referências
              </label>
            </div>

            {refs.length > 0 && (
              <div className="grid grid-cols-5 gap-1">
                {refs.map((r, i) => (
                  <div key={i} className="relative aspect-square overflow-hidden rounded border border-border bg-secondary">
                    <img src={r} alt="" loading="lazy" className="h-full w-full object-cover" />
                    <button type="button" onClick={() => persistRefs(refs.filter((_, idx) => idx !== i))}
                      className="absolute right-0 top-0 rounded-bl bg-destructive/90 p-0.5 text-destructive-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => refInputRef.current?.click()} disabled={refUploading}
                className="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1.5 text-xs text-foreground hover:bg-secondary/80 disabled:opacity-50">
                {refUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Galeria
              </button>
              <input ref={refInputRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e => { if (e.target.files?.length) handleRefFiles(e.target.files); e.target.value = ''; }} />
              <input value={refUrlInput} onChange={e => setRefUrlInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (/^https?:\/\//.test(refUrlInput.trim())) { persistRefs([...refs, refUrlInput.trim()]); setRefUrlInput(''); } } }}
                placeholder="ou cole o link da imagem de referência"
                className="min-w-[140px] flex-1 rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs text-foreground" />
              <button type="button"
                onClick={() => { const u = refUrlInput.trim(); if (/^https?:\/\//.test(u)) { persistRefs([...refs, u]); setRefUrlInput(''); } else toast.error('Cole um link válido'); }}
                className="rounded-lg gradient-primary px-2 py-1.5 text-xs text-primary-foreground">Add</button>
              {refs.length > 0 && (
                <button type="button" onClick={() => persistRefs([])} className="text-xs text-destructive hover:underline">Limpar</button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Com referências, a IA compara os resultados e descarta o que não parece com elas
              {refOnly && refs.length > 0 ? ' — busca guiada apenas pelas referências.' : '.'}
            </p>
          </div>

          {googleResults.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {googleResults.map((u, i) => (
                <button key={i} type="button" onClick={() => handlePickGoogle(u)} disabled={uploading}
                  className="aspect-square overflow-hidden rounded-md border border-border bg-secondary hover:border-primary transition-all disabled:opacity-50">
                  <img src={u} alt="" loading="lazy" className="h-full w-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.2'; }} />
                </button>
              ))}
            </div>
          )}
          {googleResults.length === 0 && !searching && (
            <p className="text-[11px] text-muted-foreground">Buscamos no Bing/DuckDuckGo (sem precisar de chave). Clique em uma foto pra usar.</p>
          )}
        </div>
      )}

      {value && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <img src={value} alt="" className="h-10 w-10 rounded object-contain bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:10px_10px]" />
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">{value.split('/').pop()?.split('?')[0]}</span>
            <button type="button" onClick={handleRemoveBg} disabled={strippingBg}
              className="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs text-foreground hover:bg-secondary/80 disabled:opacity-50">
              {strippingBg ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eraser className="h-3 w-3" />}
              Remover fundo
            </button>
            <button type="button" onClick={() => onChange('')} className="text-xs text-destructive hover:underline">Remover</button>
          </div>


          {/* Tratador de imagens por IA */}
          <div className="rounded-lg border border-border p-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={handleEnhance} disabled={enhancing}
                className="flex items-center gap-1 rounded-lg gradient-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">
                {enhancing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                {enhancing ? 'Tratando...' : 'Tratar imagem com IA'}
              </button>
              <select value={enhanceStyle} onChange={e => setEnhanceStyle(e.target.value)}
                className="rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs text-foreground">
                <option value="studio">Estúdio (fundo neutro)</option>
                <option value="white">Fundo branco (marketplace)</option>
                <option value="lifestyle">Lifestyle (ambientada)</option>
                <option value="food">Comida (apetitosa)</option>
              </select>
              <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={aiTag} onChange={e => setAiTag(e.target.checked)} className="h-3 w-3 accent-primary" />
                Marcar "gerado por IA"
              </label>
            </div>
            {beforeUrl && (
              <div className="flex items-center gap-2">
                <img src={beforeUrl} alt="antes" className="h-10 w-10 rounded object-cover opacity-70" />
                <span className="text-[10px] text-muted-foreground">antes</span>
                <button type="button" onClick={() => { onChange(beforeUrl); setBeforeUrl(null); }}
                  className="text-[11px] text-primary hover:underline">Desfazer tratamento</button>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              A IA melhora luz, nitidez e fundo mantendo o mesmo produto, rótulo e cores.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageUploadField;
