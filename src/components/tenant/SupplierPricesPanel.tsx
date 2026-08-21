import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Tag, Plus, RefreshCw, X, Upload, FileText, Image as ImageIcon, File, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { unifiedInvoke } from '@/lib/unifiedInvoke';

type PriceRow = {
  id: string;
  supplier_id: string;
  product_name: string;
  unit_price: number;
  available: boolean;
  updated_at: string;
};

type Props = {
  supplierId: string;
};

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type ExtractedItem = { name?: string; product_name?: string; price?: number; unit_price?: number; preco?: number; available?: boolean };

const SupplierPricesPanel = ({ supplierId }: Props) => {
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [productName, setProductName] = useState('');
  const [price, setPrice] = useState('');
  // Upload de catálogo com IA
  const [uploading, setUploading] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedItem[] | null>(null);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [merge, setMerge] = useState(true);
  const [fileReady, setFileReady] = useState<{ name: string; kind: 'pdf' | 'image' | 'txt'; content: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('supplier_product_prices')
      .select('*')
      .eq('supplier_id', supplierId)
      .order('updated_at', { ascending: false });
    setRows(((data as PriceRow[]) || []).map(r => ({ ...r, unit_price: Number(r.unit_price) })));
    setLoading(false);
  }, [supplierId]);

  useEffect(() => {
    load();
  }, [load]);

  const addPrice = async () => {
    const name = productName.trim();
    const p = parseFloat(price.replace(',', '.'));
    if (!name) {
      toast.error('Informe o nome do produto');
      return;
    }
    if (Number.isNaN(p) || p <= 0) {
      toast.error('Informe um preço válido');
      return;
    }
    const { error } = await supabase.from('supplier_product_prices').upsert(
      { supplier_id: supplierId, product_name: name.toLowerCase(), unit_price: p },
      { onConflict: 'supplier_id,product_name' },
    );
    if (error) {
      toast.error('Erro ao salvar: ' + error.message);
      return;
    }
    toast.success('Preço salvo');
    setProductName('');
    setPrice('');
    await load();
  };

  const setAvailability = async (row: PriceRow, available: boolean) => {
    const { error } = await supabase
      .from('supplier_product_prices')
      .update({ available })
      .eq('id', row.id);
    if (error) {
      toast.error('Erro ao atualizar');
      return;
    }
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, available } : r)));
    toast.success(available ? 'Produto marcado como disponível' : 'Produto marcado como indisponível');
  };

  const remove = async (row: PriceRow) => {
    if (!confirm(`Remover o preço de "${row.product_name}"?`)) return;
    const { error } = await supabase.from('supplier_product_prices').delete().eq('id', row.id);
    if (error) {
      toast.error('Erro ao remover');
      return;
    }
    setRows(prev => prev.filter(r => r.id !== row.id));
    toast.success('Preço removido');
  };

  // ===== Upload de catálogo com IA =====
  const readFileAsContent = (file: File): Promise<{ name: string; kind: 'pdf' | 'image' | 'txt'; content: string }> =>
    new Promise((resolve, reject) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const kind: 'pdf' | 'image' | 'txt' = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? 'image' : ext === 'pdf' ? 'pdf' : 'txt';
      const reader = new FileReader();
      if (kind === 'txt') {
        reader.onload = () => resolve({ name: file.name, kind, content: String(reader.result || '') });
        reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
        reader.readAsText(file);
      } else {
        reader.onload = () => {
          const b64 = String(reader.result || '').split(',')[1] || '';
          resolve({ name: file.name, kind, content: b64 });
        };
        reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
        reader.readAsDataURL(file);
      }
    });

  const onPickCatalogFile = async (file?: File) => {
    const f = file || (document.getElementById('catalog-file-input') as HTMLInputElement)?.files?.[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) {
      toast.error('Arquivo muito grande (máx. 8 MB). Envie páginas menores ou em texto.');
      return;
    }
    try {
      setExtracted(null);
      setUploadWarnings([]);
      setFileReady(await readFileAsContent(f));
      toast.info(`${f.name} carregado. Clique em "Extrair com IA" para ler os preços.`);
    } catch {
      toast.error('Falha ao ler o arquivo');
    }
  };

  const extractCatalog = async () => {
    if (!fileReady) return;
    setUploading(true);
    setExtracted(null);
    setUploadWarnings([]);
    try {
      const { data, error } = await unifiedInvoke('ai-media-unified', 'catalog', {
        supplierId,
        kind: fileReady.kind,
        content: fileReady.content,
        merge,
      });
      if (error || data?.error) {
        if (data?.error === 'pdf_no_text') {
          toast.error('PDF escaneado sem texto. Envie as páginas como imagens (fotos) para a IA ler.');
        } else if (data?.error === 'no_items_extracted') {
          toast.warning('A IA não identificou produtos com preço neste catálogo. Confira o arquivo.');
        } else {
          toast.error(data?.detail || data?.error || 'Falha na extração');
        }
        return;
      }
      setExtracted(data.items || []);
      setUploadWarnings(data.warnings || []);
      toast.success(`IA extraiu ${data.total ?? 0} itens do catálogo`);
    } catch {
      toast.error('Falha ao chamar a IA');
    } finally {
      setUploading(false);
    }
  };

  const applyExtracted = async () => {
    // A extração já gravou os preços no banco (via Edge Function).
    // Este passo apenas confirma o resultado e recarrega a tabela.
    const good = (extracted || []).filter(it => {
      const name = String(it.name || it.product_name || '').trim();
      const p = Number(it.price ?? it.unit_price ?? it.preco ?? NaN);
      return name && Number.isFinite(p) && p > 0;
    });
    
    // As variações e descrições agora são processadas pela IA e salvas na tabela
    // supplier_product_prices para permitir o matching inteligente durante o pedido.
    toast.success(`${good.length} itens processados com detalhes de variação (cor/memória).`);
    setExtracted(null);
    setFileReady(null);
    setUploadWarnings([]);
    await load();
  };

  const fileKindLabel = { pdf: 'PDF', image: 'Imagem', txt: 'Texto' } as const;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-3 space-y-2">
        <p className="text-sm font-medium text-foreground flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" /> Tabelar preço por produto
        </p>
        <p className="text-xs text-muted-foreground">
          Cadastre seu preço por produto. As lojas revendedoras usarão essa tabela para montar
          pedidos de compra escolhendo automaticamente o fornecedor mais barato de cada item
          (seletor de melhor preço).
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={productName}
            onChange={e => setProductName(e.target.value)}
            placeholder="Ex: iphone 16 128gb"
            className="flex-1 min-w-[160px] rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70"
          />
          <input
            value={price}
            onChange={e => setPrice(e.target.value)}
            placeholder="Preço (R$)"
            inputMode="decimal"
            className="w-28 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70"
          />
          <button
            onClick={addPrice}
            className="flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Salvar
          </button>
        </div>

        {/* Upload de catálogo com IA */}
        <div className="rounded-lg border border-dashed border-primary/40 bg-secondary/50 p-3 space-y-2">
          <p className="text-sm font-medium text-foreground flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" /> Subir catálogo com IA (PDF, imagem ou TXT)
          </p>
          <p className="text-xs text-muted-foreground">
            Envie o catálogo do fornecedor — a IA lê os produtos e preços e preenche sua tabela
            automaticamente. Aceita PDF com texto, fotos/imagens de tabela de preços e listas em TXT.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors">
              <FileText className="h-4 w-4 text-primary" />
              Escolher arquivo (PDF/IMG/TXT)
              <input
                id="catalog-file-input"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
                className="hidden"
                onChange={e => onPickCatalogFile(e.target.files?.[0])}
              />
            </label>
            {fileReady && !extracted && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <File className="h-3.5 w-3.5" /> {fileReady.name} ({fileKindLabel[fileReady.kind]})
              </span>
            )}
            {fileReady && !extracted && (
              <>
                <label className="inline-flex items-center gap-1.5 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={merge}
                    onChange={e => setMerge(e.target.checked)}
                    className="rounded border-border"
                  />
                  Mesclar (mantém itens manuais fora do catálogo)
                </label>
                <button
                  onClick={extractCatalog}
                  disabled={uploading}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                  {uploading ? 'Lendo catálogo...' : 'Extrair com IA'}
                </button>
              </>
            )}
          </div>

          {extracted && (
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                IA encontrou {extracted.length} produto(s) com preço — revise e importe
              </p>
              {uploadWarnings.length > 0 && (
                <p className="text-xs text-amber-400 flex items-start gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {uploadWarnings.join(' · ')}
                </p>
              )}
              <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {extracted.map((it, i) => {
                  const name = String(it.name || it.product_name || '').trim();
                  const p = Number(it.price ?? it.unit_price ?? it.preco ?? 0);
                  return (
                    <div key={i} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                      <span className="flex-1 text-foreground truncate">{name || <em className="text-muted-foreground">(sem nome)</em>}</span>
                      <span className="font-semibold text-primary">R$ {Number.isFinite(p) ? p.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={applyExtracted}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90"
                >
                  <CheckCircle2 className="h-4 w-4" /> Confirmar
                </button>
                <button
                  onClick={() => { setExtracted(null); setFileReady(null); setUploadWarnings([]); }}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" /> Descartar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Nenhum preço tabelado ainda. Cadastre acima.
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map(row => (
            <div
              key={row.id}
              className={`rounded-lg border bg-card p-3 flex items-center gap-3 flex-wrap ${
                row.available ? 'border-border' : 'border-red-500/30 opacity-70'
              }`}
            >
              <span className="flex-1 min-w-[140px] text-sm font-medium text-foreground">
                {row.product_name}
              </span>
              <span className="text-sm font-bold text-primary">R$ {fmtBRL(row.unit_price)}</span>
              <button
                onClick={() => setAvailability(row, !row.available)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  row.available
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                }`}
              >
                {row.available ? 'Disponível' : 'Indisponível'}
              </button>
              <button
                onClick={() => remove(row)}
                className="rounded-md p-1 text-muted-foreground hover:text-destructive transition-colors"
                title="Remover"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={load}
          className="flex items-center gap-1 rounded-md bg-secondary px-3 py-1.5 text-xs text-foreground hover:bg-secondary/70"
        >
          <RefreshCw className="h-3 w-3" /> Atualizar
        </button>
      </div>
    </div>
  );
};

export default SupplierPricesPanel;
