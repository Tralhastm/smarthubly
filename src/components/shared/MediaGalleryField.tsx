import { useState, useRef } from 'react';
import { uploadProductImage } from '@/hooks/useProductImageUpload';
import { supabase } from '@/integrations/supabase/client';
import { Upload, Loader2, Link, Video, Image as ImageIcon, Trash2, MoveUp, MoveDown, Plus } from 'lucide-react';
import { toast } from 'sonner';

export type MediaItem = { type: 'image' | 'video'; url: string };

const uploadProductVideo = async (file: File, tenantId: string): Promise<string> => {
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const path = `${tenantId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from('product-images')
    .upload(path, file, { contentType: file.type || 'video/mp4', upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
};

type Props = {
  value: MediaItem[];
  onChange: (items: MediaItem[]) => void;
  tenantId: string;
  label?: string;
};

const MediaGalleryField = ({ value, onChange, tenantId, label }: Props) => {
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [uploadMode, setUploadMode] = useState<'file' | 'url'>('file');
  const fileRef = useRef<HTMLInputElement>(null);
  const MAX = 10;

  const isVideo = (url: string) => /\.(mp4|webm|mov|m4v)$/i.test(url);

  const addItems = (newItems: MediaItem[]) => {
    if (!newItems.length) return;
    const limited = newItems.slice(0, MAX - value.length);
    if (newItems.length > limited.length) toast.warning(`Limite de ${MAX} mídias por produto — as demais foram ignoradas.`);
    onChange([...value, ...limited]);
  };

  const handleFiles = async (files: FileList) => {
    setUploading(true);
    const added: MediaItem[] = [];
    try {
      for (const file of Array.from(files)) {
        if (file.size > 40 * 1024 * 1024) { toast.error(`${file.name}: máx 40MB`); continue; }
        const isVid = file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
        try {
          const url = isVid ? await uploadProductVideo(file, tenantId) : await uploadProductImage(file, tenantId);
          added.push({ type: isVid ? 'video' : 'image', url });
        } catch {
          toast.error(`Falha em ${file.name}`);
        }
      }
      if (added.length) addItems(added);
      if (added.length) toast.success(`${added.length} mídia(s) adicionada(s) à galeria!`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleUrl = async () => {
    const u = urlInput.trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u)) { toast.error('Cole um link válido (https://...)'); return; }
    addItems([{ type: isVideo(u) ? 'video' : 'image', url: u }]);
    setUrlInput('');
    toast.success('Mídia adicionada!');
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  const accept = value.filter((m) => m.type === 'image').length >= MAX ? undefined : 'image/*,video/*';

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center gap-1.5">
          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <label className="text-xs text-muted-foreground">
            {label} <span className="text-[10px]">(opcional — carrossel no cardápio, até {MAX})</span>
          </label>
        </div>
      )}

      <div className="flex gap-1 flex-wrap">
        <button type="button" onClick={() => setUploadMode('file')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${uploadMode === 'file' ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
          <Upload className="h-3 w-3 inline mr-1" />Arquivos
        </button>
        <button type="button" onClick={() => setUploadMode('url')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${uploadMode === 'url' ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
          <Link className="h-3 w-3 inline mr-1" />Colar link
        </button>
      </div>

      {uploadMode === 'file' && (
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || value.length >= MAX}
          className="flex items-center gap-2 rounded-lg bg-secondary text-foreground px-3 py-2 text-sm hover:bg-secondary/80 disabled:opacity-50">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {uploading ? 'Enviando...' : 'Adicionar fotos/vídeo à galeria'}
        </button>
      )}

      {uploadMode === 'url' && (
        <div className="flex gap-2">
          <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleUrl(); } }}
            placeholder="https://exemplo.com/foto.jpg ou .mp4"
            className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          <button type="button" onClick={handleUrl} disabled={value.length >= MAX}
            className="rounded-lg gradient-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-50">OK</button>
        </div>
      )}

      <input ref={fileRef} type="file" accept={accept} multiple className="hidden"
        onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); }} />

      {value.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {value.map((m, i) => (
            <div key={`${m.url}-${i}`} className="relative group aspect-square overflow-hidden rounded-md border border-border bg-secondary">
              {m.type === 'video' ? (
                <video src={m.url} className="h-full w-full object-cover" muted />
              ) : (
                <img src={m.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              )}
              {m.type === 'video' && (
                <span className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white">
                  <Video className="h-3 w-3" />
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-black/60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                  className="p-0.5 text-white hover:text-primary disabled:opacity-30"><MoveUp className="h-3 w-3" /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1}
                  className="p-0.5 text-white hover:text-primary disabled:opacity-30"><MoveDown className="h-3 w-3" /></button>
                <button type="button" onClick={() => remove(i)}
                  className="p-0.5 text-white hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
              </div>
              {i === 0 && (
                <span className="absolute top-1 left-1 rounded bg-primary/90 px-1 py-0.5 text-[9px] font-medium text-primary-foreground">Capa</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MediaGalleryField;
