import { useState, useRef, useEffect, useCallback } from 'react';
import { useProducts, useAddProduct, useUpdateProduct, useDeleteProduct, type Product } from '@/hooks/useProducts';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useFeeRequests, useCreateFeeRequest } from '@/hooks/useFeeRequests';
import ImageUploadField from '@/components/shared/ImageUploadField';
import MediaGalleryField, { type MediaItem } from '@/components/shared/MediaGalleryField';
import AutoCategorizeButton from '@/components/shared/AutoCategorizeButton';
import ProductExtrasEditor from './ProductExtrasEditor';
import { Plus, Edit, Trash2, Check, X, Package, Percent, FileText, Sparkles, Loader2, ImageIcon, Link as LinkIcon, AlertTriangle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';

type ParsedProduct = { name: string; price: number; category: string; description: string };

const TenantAdminProducts = ({ tenantId, isDropshipping, isAffiliate }: { tenantId: string; isDropshipping?: boolean; isAffiliate?: boolean }) => {
  const { data: products = [], isLoading, refetch } = useProducts(tenantId);
  const { data: suppliers = [] } = useSuppliers(tenantId);
  const { data: feeRequests = [] } = useFeeRequests(tenantId);
  const addMutation = useAddProduct();
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct(tenantId);
  const createFeeReq = useCreateFeeRequest();
  const [editing, setEditing] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [form, setForm] = useState({ name: '', price: '', original_price: '', category: '', description: '', image: '', in_stock: true, supplier_id: '', stock_quantity: '', affiliate_url: '', affiliate_network: '', item_type: 'product' as 'product' | 'service', duration_minutes: '', max_concurrent: '', availability_mode: 'both' as 'both' | 'delivery_only' | 'pickup_only', affiliate_coupon_code: '', affiliate_coupon_discount_price: '', affiliate_coupon_expires_at: '', kitchen_sector: '' });

  // Affiliate URL import
  const [affiliateImportUrl, setAffiliateImportUrl] = useState('');
  const [importingUrl, setImportingUrl] = useState(false);
  const [refreshingPrices, setRefreshingPrices] = useState(false);

  const handleRefreshAffiliatePrices = async () => {
    if (refreshingPrices) return;
    setRefreshingPrices(true);
    toast.loading('Atualizando preços via IA... pode levar 1-2 min', { id: 'refresh-aff' });
    try {
      const { data, error } = await supabase.functions.invoke('refresh-affiliate-prices', {
        body: { tenant_id: tenantId, limit: 100 },
      });
      if (error) throw error;
      toast.success(
        `${data.updated} atualizados, ${data.unchanged} sem mudança, ${data.soldOut} esgotados, ${data.failed} falharam`,
        { id: 'refresh-aff', duration: 6000 },
      );
      refetch();
    } catch (e: any) {
      toast.error(`Falhou: ${e.message || e}`, { id: 'refresh-aff' });
    } finally {
      setRefreshingPrices(false);
    }
  };

  // TXT import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStep, setImportStep] = useState<'idle' | 'parsing' | 'preview' | 'importing'>('idle');
  const [parsedProducts, setParsedProducts] = useState<ParsedProduct[]>([]);
  const [generateImages, setGenerateImages] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);

  // Image generation job tracking (read from image_generation_jobs table)
  type ImageJob = {
    id: string;
    total: number;
    done: number;
    failed: number;
    status: 'running' | 'cooling_down' | 'done' | 'failed' | 'cancelled';
    reason: string;
    message: string;
    cooldown_until: string | null;
  };
  const [activeJob, setActiveJob] = useState<ImageJob | null>(null);
  const [cooldownLeftSec, setCooldownLeftSec] = useState(0);

  const cancelImageGeneration = useCallback(async () => {
    const job = activeJob;
    setActiveJob(null);
    setCooldownLeftSec(0);
    if (job?.id && job.id !== 'pending') {
      try {
        await supabase
          .from('image_generation_jobs')
          .update({
            status: 'cancelled',
            message: 'Interrompido pelo usuário.',
            finished_at: new Date().toISOString(),
            cooldown_until: null,
          } as any)
          .eq('id', job.id);
        toast.success('Processo interrompido.');
      } catch (e) {
        console.warn('Failed to mark job cancelled', e);
      }
    }
  }, [activeJob]);

  const [deletingAi, setDeletingAi] = useState(false);
  const [deletingGoogle, setDeletingGoogle] = useState(false);
  const handleDeleteBulk = useCallback(async (source: 'ai' | 'google') => {
    const label = source === 'ai' ? 'geradas por IA' : 'importadas da web';
    if (!confirm(`Tem certeza? Isso vai apagar TODAS as fotos ${label} desta loja. As outras (uploads manuais e a outra origem) serão mantidas.`)) return;
    if (source === 'ai') setDeletingAi(true); else setDeletingGoogle(true);
    const toastId = `del-${source}`;
    toast.loading(`Excluindo fotos ${label}...`, { id: toastId });
    try {
      const { data, error } = await supabase.functions.invoke('delete-bulk-images', {
        body: { tenantId, source },
      });
      if (error) throw error;
      toast.success(`${data?.productsCleared ?? 0} produtos limpos · ${data?.storageDeleted ?? 0} arquivos removidos`, { id: toastId, duration: 5000 });
      refetch();
    } catch (e: any) {
      toast.error(`Falhou: ${e.message || e}`, { id: toastId });
    } finally {
      if (source === 'ai') setDeletingAi(false); else setDeletingGoogle(false);
    }
  }, [tenantId, refetch]);

  // On mount: rehydrate active job (if any) so user reloading the page still sees progress
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('image_generation_jobs')
        .select('id, total, done, failed, status, reason, message, cooldown_until')
        .eq('tenant_id', tenantId)
        .in('status', ['running', 'cooling_down'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && data) setActiveJob(data as ImageJob);
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  // Poll job status while active
  useEffect(() => {
    if (!activeJob) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('image_generation_jobs')
        .select('id, total, done, failed, status, reason, message, cooldown_until')
        .eq('id', activeJob.id)
        .maybeSingle();
      if (!data) return;
      const job = data as ImageJob;
      setActiveJob(job);
      // Sempre que dá um avanço, atualiza grade de produtos
      if (job.done > activeJob.done) refetch();
      if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
        if (job.status === 'done') toast.success(`Concluído: ${job.done} imagens geradas!`);
        else if (job.status === 'cancelled') toast.info('Processo interrompido.');
        else if (job.failed > 0) toast.warning(`Geração parou com ${job.failed} pendentes.`);
        refetch();
        setTimeout(() => setActiveJob(null), 3500);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [activeJob, refetch]);

  // Cooldown countdown
  useEffect(() => {
    if (!activeJob?.cooldown_until) { setCooldownLeftSec(0); return; }
    const target = new Date(activeJob.cooldown_until).getTime();
    const tick = () => setCooldownLeftSec(Math.max(0, Math.round((target - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeJob?.cooldown_until]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.txt')) { toast.error('Selecione um arquivo .txt'); return; }

    const text = await file.text();
    if (!text.trim()) { toast.error('Arquivo vazio'); return; }

    setImportStep('parsing');
    try {
      const { data, error } = await supabase.functions.invoke('parse-products-txt', { body: { txtContent: text } });

      if (error) {
        let detailedMessage = '';
        const response = (error as any)?.context;
        if (response?.json) {
          const errorBody = await response.clone().json().catch(() => null);
          detailedMessage = errorBody?.error || '';
        }
        throw new Error(detailedMessage || (error as any)?.message || 'Erro ao processar arquivo');
      }

      if (!data?.products?.length) {
        toast.error('Nenhum produto encontrado no arquivo');
        setImportStep('idle');
        return;
      }

      setParsedProducts(data.products);
      setImportStep('preview');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Erro ao processar arquivo');
      setImportStep('idle');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImportConfirm = async () => {
    setImportStep('importing');
    setImportTotal(parsedProducts.length);
    setImportProgress(0);

    const insertedIds: string[] = [];

    for (let i = 0; i < parsedProducts.length; i++) {
      const p = parsedProducts[i];
      try {
        await new Promise<void>((resolve, reject) => {
          addMutation.mutate({
            tenant_id: tenantId,
            name: p.name,
            price: p.price,
            original_price: 0,
            category: p.category || 'Geral',
            description: p.description || '',
            image: '',
            in_stock: true,
            supplier_id: null,
          } as any, {
            onSuccess: () => resolve(),
            onError: (e) => reject(e),
          });
        });

        const { data: inserted } = await supabase
          .from('products')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('name', p.name)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (inserted) insertedIds.push(inserted.id);
      } catch (err) {
        console.error('Failed to add', p.name, err);
      }
      setImportProgress(i + 1);
    }

    toast.success(`${insertedIds.length} produtos importados!`);
    setParsedProducts([]);
    setImportStep('idle');

    // Kick off server-side image generation
    if (generateImages && insertedIds.length > 0) {
      setGenerateImages(false);
      startServerImageGeneration(insertedIds);
    } else {
      setGenerateImages(false);
    }
  };

  const startServerImageGeneration = async (productIds: string[]) => {
    toast.info(`Gerando ${productIds.length} imagens no servidor... Pode fechar o navegador!`);
    // Otimista: mostra job placeholder enquanto a edge function não retorna o jobId
    setActiveJob({ id: 'pending', total: productIds.length, done: 0, failed: 0, status: 'running', reason: '', message: 'Iniciando…', cooldown_until: null });
    try {
      const { data, error } = await supabase.functions.invoke('batch-generate-images', {
        body: { productIds, tenantId },
      });
      if (error) throw error;
      if (data?.jobId) {
        setActiveJob((prev) => prev ? { ...prev, id: data.jobId } : prev);
      }
    } catch (err) {
      console.error('Failed to start batch generation:', err);
      toast.error('Erro ao iniciar geração de imagens');
      cancelImageGeneration();
    }
  };

  // Manual regenerate for products without images
  const handleRegenerateImages = useCallback(async () => {
    const noImage = products.filter(p => !p.image || p.image === '');
    if (noImage.length === 0) { toast.info('Todos os produtos já têm imagem!'); return; }
    startServerImageGeneration(noImage.map(p => p.id));
  }, [products, tenantId]);

  const handleImportImagesFromGoogle = useCallback(async () => {
    const noImage = products.filter(p => !p.image || p.image === '');
    if (noImage.length === 0) { toast.info('Todos os produtos já têm imagem!'); return; }
    toast.info(`Buscando ${noImage.length} fotos na web... Pode fechar o navegador!`);
    setActiveJob({ id: 'pending', total: noImage.length, done: 0, failed: 0, status: 'running', reason: '', message: 'Iniciando busca…', cooldown_until: null });
    try {
      const { data, error } = await supabase.functions.invoke('batch-search-google-images', {
        body: { productIds: noImage.map(p => p.id), tenantId },
      });
      if (error) throw error;
      if (data?.jobId) setActiveJob((prev) => prev ? { ...prev, id: data.jobId } : prev);
    } catch (err) {
      console.error('Failed to start Google import:', err);
      toast.error('Erro ao iniciar importação');
      cancelImageGeneration();
    }
  }, [products, tenantId]);

  const handleAdd = () => {
    if (!form.name || !form.price) return;
    if (isDropshipping && suppliers.filter(s => s.active).length > 0 && !form.supplier_id) {
      toast.error('Esta loja é dropshipping — selecione um fornecedor para o produto.');
      return;
    }
    if (isAffiliate && !form.affiliate_url) {
      toast.error('Loja em modo Afiliado — informe o link de afiliado do produto.');
      return;
    }
    addMutation.mutate({
      tenant_id: tenantId,
      name: form.name,
      price: parseFloat(form.price),
      original_price: parseFloat(form.original_price) || 0,
      category: form.category || 'Geral',
      description: form.description,
      image: form.image,
      media: media,
      in_stock: form.in_stock,
      supplier_id: form.supplier_id || null,
      stock_quantity: form.stock_quantity ? parseInt(form.stock_quantity) : null,
      affiliate_url: form.affiliate_url || null,
      affiliate_network: form.affiliate_network || null,
      affiliate_coupon_code: form.affiliate_coupon_code ? form.affiliate_coupon_code.trim().toUpperCase() : null,
      affiliate_coupon_discount_price: form.affiliate_coupon_discount_price ? parseFloat(form.affiliate_coupon_discount_price) : null,
      affiliate_coupon_expires_at: form.affiliate_coupon_expires_at ? new Date(form.affiliate_coupon_expires_at).toISOString() : null,
      item_type: form.item_type,
      duration_minutes: form.item_type === 'service' && form.duration_minutes ? parseInt(form.duration_minutes) : null,
      max_concurrent: form.item_type === 'service' && form.max_concurrent ? parseInt(form.max_concurrent) : null,
      availability_mode: form.availability_mode,
      kitchen_sector: form.kitchen_sector || null,
    } as any);
    setForm({ name: '', price: '', original_price: '', category: '', description: '', image: '', in_stock: true, supplier_id: '', stock_quantity: '', affiliate_url: '', affiliate_network: '', item_type: 'product', duration_minutes: '', max_concurrent: '', availability_mode: 'both', affiliate_coupon_code: '', affiliate_coupon_discount_price: '', affiliate_coupon_expires_at: '', kitchen_sector: '' });
    setMedia([]);
    setShowAdd(false);
  };

  const handleImportFromUrl = async (useAi: boolean) => {
    if (!affiliateImportUrl.trim()) return;
    setImportingUrl(true);
    try {
      const { data, error } = await supabase.functions.invoke('import-affiliate-product', {
        body: { url: affiliateImportUrl.trim(), useAi },
      });
      if (error) throw error;
      if (!data || data.error) { toast.error(data?.error || 'Erro ao importar'); return; }
      setForm(f => ({
        ...f,
        name: data.name || f.name,
        price: data.price ? String(data.price) : f.price,
        category: data.category || f.category,
        description: data.description || f.description,
        image: data.image || f.image,
        affiliate_url: data.affiliate_url || affiliateImportUrl.trim(),
        affiliate_network: data.affiliate_network || '',
      }));
      setShowAdd(true);
      setAffiliateImportUrl('');
      if (data.warning) toast.warning(data.warning);
      else if (useAi && data.ai_used) toast.success('Produto importado pela IA! Revise e salve.');
      else toast.success('Link pronto. Preencha os campos e salve.');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao importar do link');
    } finally {
      setImportingUrl(false);
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  const productsWithoutImage = products.filter(p => !p.image || p.image === '').length;
  const productsWithAiImage = products.filter(p => p.image && p.image.includes('?ai=1')).length;
  const productsWithGoogleImage = products.filter(p => p.image && p.image.includes('?src=google')).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90">
          <Plus className="h-4 w-4" /> Novo Produto
        </button>
        <button onClick={() => fileInputRef.current?.click()} disabled={importStep !== 'idle'}
          className="flex items-center gap-2 rounded-lg bg-secondary text-foreground px-4 py-2 text-sm font-medium hover:bg-secondary/80 disabled:opacity-50">
          <FileText className="h-4 w-4" /> Importar TXT
        </button>
        {productsWithoutImage > 0 && !activeJob && (
          <>
            <button onClick={handleRegenerateImages}
              className="flex items-center gap-2 rounded-lg bg-primary/20 text-primary px-4 py-2 text-sm font-medium hover:bg-primary/30"
              title="Gera fotos artificiais com IA usando referência visual real do Google">
              <ImageIcon className="h-4 w-4" /> Gerar {productsWithoutImage} imagens (IA + referência)
            </button>
            <button onClick={handleImportImagesFromGoogle}
              className="flex items-center gap-2 rounded-lg bg-secondary text-foreground px-4 py-2 text-sm font-medium hover:bg-secondary/80"
              title="Busca várias fotos na web e a IA escolhe a melhor (resolução, nitidez, fundo)">
              <Search className="h-4 w-4" /> Importar {productsWithoutImage} fotos da web
            </button>
          </>
        )}
        {productsWithAiImage > 0 && !activeJob && (
          <button onClick={() => handleDeleteBulk('ai')} disabled={deletingAi}
            className="flex items-center gap-2 rounded-lg bg-destructive/15 text-destructive px-4 py-2 text-sm font-medium hover:bg-destructive/25 disabled:opacity-50"
            title="Remove em massa todas as fotos geradas por IA. Mantém fotos da web e uploads manuais.">
            {deletingAi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Excluir {productsWithAiImage} fotos de IA
          </button>
        )}
        {productsWithGoogleImage > 0 && !activeJob && (
          <button onClick={() => handleDeleteBulk('google')} disabled={deletingGoogle}
            className="flex items-center gap-2 rounded-lg bg-destructive/15 text-destructive px-4 py-2 text-sm font-medium hover:bg-destructive/25 disabled:opacity-50"
            title="Remove em massa todas as fotos importadas do Google/web. Mantém fotos de IA e uploads manuais.">
            {deletingGoogle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Excluir {productsWithGoogleImage} fotos do Google
          </button>
        )}
        <AutoCategorizeButton
          items={products.map(p => ({ id: p.id, name: p.name, description: p.description, auto_categorize: (p as any).auto_categorize }))}
          context="Produtos do catálogo da loja"
          onResults={async (results) => {
            for (const r of results) {
              await supabase.from('products').update({ category: r.category, subcategory: r.subcategory } as any).eq('id', r.id);
            }
            refetch();
          }}
          label="Categorizar tudo com IA"
        />
        <input ref={fileInputRef} type="file" accept=".txt" className="hidden" onChange={handleFileSelect} />
      </div>

      {/* Affiliate URL importer (only in affiliate mode) */}
      {isAffiliate && (
        <div className="rounded-lg border border-primary/30 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <LinkIcon className="h-4 w-4 text-primary" /> Importar de link de afiliado
            </div>
            <button onClick={handleRefreshAffiliatePrices} disabled={refreshingPrices}
              className="flex items-center gap-1.5 rounded-lg bg-secondary text-foreground px-3 py-1.5 text-xs font-medium hover:bg-secondary/80 disabled:opacity-50">
              {refreshingPrices ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {refreshingPrices ? 'Atualizando...' : 'Atualizar preços agora'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Cole o link de afiliado (Shopee, Amazon, Mercado Livre, AliExpress, Magalu, Shopify, Hotmart etc). A IA categoriza e escreve a descrição automaticamente.</p>
          <input value={affiliateImportUrl} onChange={e => setAffiliateImportUrl(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => handleImportFromUrl(true)} disabled={importingUrl || !affiliateImportUrl.trim()}
              className="flex items-center gap-1.5 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {importingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {importingUrl ? 'Importando com IA...' : 'Importar com IA'}
            </button>
            <button onClick={() => handleImportFromUrl(false)} disabled={importingUrl || !affiliateImportUrl.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-secondary text-foreground px-4 py-2 text-sm font-medium hover:bg-secondary/80 disabled:opacity-50">
              <LinkIcon className="h-4 w-4" />
              Apenas extrair (sem IA)
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">💡 Com IA: categoriza automaticamente e escreve uma descrição vendedora. Sem IA: só lê os dados crus da página.</p>
        </div>
      )}

      {/* Server-side image generation progress (job-tracked) */}
      {activeJob && (() => {
        const cooling = activeJob.status === 'cooling_down';
        const failedFinal = activeJob.status === 'failed';
        const success = activeJob.status === 'done';
        const borderClass = failedFinal
          ? 'border-destructive/50 bg-destructive/5'
          : cooling
          ? 'border-amber-500/50 bg-amber-500/5'
          : success
          ? 'border-emerald-500/50 bg-emerald-500/5'
          : 'border-primary/30 bg-card animate-pulse-slow';
        const Icon = failedFinal ? AlertTriangle : Sparkles;
        const iconClass = failedFinal
          ? 'text-destructive'
          : cooling
          ? 'text-amber-500'
          : success
          ? 'text-emerald-500'
          : 'text-primary animate-spin';
        const title = success
          ? 'Imagens geradas!'
          : failedFinal
          ? 'Geração interrompida'
          : cooling
          ? 'Aguardando providers'
          : 'Gerando imagens no servidor';
        const pct = activeJob.total > 0 ? (activeJob.done / activeJob.total) * 100 : 0;
        return (
          <div className={`rounded-lg border p-4 space-y-3 ${borderClass}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-foreground min-w-0">
                <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} />
                <span className="font-medium truncate">{title}</span>
                <span className="text-muted-foreground shrink-0">({activeJob.done}/{activeJob.total})</span>
              </div>
              {!success && (
                <button
                  onClick={cancelImageGeneration}
                  className="text-xs rounded-md bg-destructive/15 text-destructive hover:bg-destructive/25 px-2 py-1 font-medium shrink-0 inline-flex items-center gap-1"
                  title="Interrompe o processo no servidor"
                >
                  <X className="h-3 w-3" /> Interromper
                </button>
              )}
            </div>
            <Progress value={pct} className="h-2" />
            <p className={`text-xs ${failedFinal ? 'text-destructive' : cooling ? 'text-amber-500' : 'text-muted-foreground'}`}>
              {activeJob.message || (success ? '✅ Concluído!' : '✅ Pode fechar o navegador — continua no servidor.')}
              {cooling && cooldownLeftSec > 0 && (
                <span className="ml-1 font-mono">({Math.floor(cooldownLeftSec / 60)}:{String(cooldownLeftSec % 60).padStart(2, '0')})</span>
              )}
            </p>
          </div>
        );
      })()}

      {/* Parsing state */}
      {importStep === 'parsing' && (
        <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-foreground">Analisando arquivo com IA...</span>
        </div>
      )}

      {/* Preview parsed products */}
      {importStep === 'preview' && (
        <div className="rounded-lg border border-primary/30 bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> {parsedProducts.length} produtos encontrados
          </h3>
          <div className="max-h-60 overflow-y-auto space-y-2">
            {parsedProducts.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-foreground">{p.name}</span>
                  <span className="text-muted-foreground ml-2">· {p.category}</span>
                </div>
                <span className="text-primary font-medium">R${p.price.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={generateImages} onChange={e => setGenerateImages(e.target.checked)} className="accent-primary" />
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Gerar imagens por IA (no servidor — pode fechar o navegador)
          </label>
          <div className="flex gap-2">
            <button onClick={handleImportConfirm} className="flex items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm">
              <Check className="h-4 w-4" /> Importar {parsedProducts.length} produtos
            </button>
            <button onClick={() => { setImportStep('idle'); setParsedProducts([]); }} className="flex items-center gap-1 rounded-lg bg-secondary text-muted-foreground px-4 py-2 text-sm">
              <X className="h-4 w-4" /> Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Importing progress */}
      {importStep === 'importing' && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Importando {importProgress}/{importTotal}...
          </div>
          <Progress value={(importProgress / importTotal) * 100} className="h-2" />
        </div>
      )}

      {showAdd && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          {/* Tipo do item: produto ou serviço (agendável) */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Tipo de item</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setForm({ ...form, item_type: 'product' })}
                className={`py-2 rounded-lg text-sm font-medium transition-all border ${form.item_type === 'product' ? 'gradient-primary text-primary-foreground border-transparent' : 'bg-secondary text-muted-foreground border-border hover:border-primary/40'}`}>
                📦 Produto
              </button>
              <button type="button" onClick={() => setForm({ ...form, item_type: 'service' })}
                className={`py-2 rounded-lg text-sm font-medium transition-all border ${form.item_type === 'service' ? 'gradient-primary text-primary-foreground border-transparent' : 'bg-secondary text-muted-foreground border-border hover:border-primary/40'}`}>
                🗓️ Serviço (agendável)
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {form.item_type === 'service'
                ? 'Cliente verá botão "Agendar". Defina a duração estimada para o sistema calcular horários disponíveis.'
                : 'Cliente verá botão de compra normal (varia conforme nicho da loja).'}
            </p>
          </div>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nome" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Preço de venda (R$)</label>
              <input value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="Preço" type="number" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Preço original/custo (R$)</label>
              <input value={form.original_price} onChange={e => setForm({ ...form, original_price: e.target.value })} placeholder="Custo" type="number" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            </div>
          </div>
          {form.item_type === 'service' && (
            <>
              <div>
                <label className="text-xs text-muted-foreground">Duração estimada (minutos)</label>
                <input value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: e.target.value })}
                  placeholder="Ex: 30" type="number" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
                <p className="text-[10px] text-muted-foreground mt-1">Ex: corte 30min, mecânica 120min. Usado quando o agendamento estiver ativo.</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Limite simultâneo deste serviço (opcional)</label>
                <input value={form.max_concurrent} onChange={e => setForm({ ...form, max_concurrent: e.target.value })}
                  placeholder="Deixe vazio = usa capacidade da loja" type="number" min={1} className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
                <p className="text-[10px] text-muted-foreground mt-1">Ex: loja faz 5 atendimentos ao mesmo tempo, mas só 2 barbas em paralelo → coloque 2 aqui.</p>
              </div>
            </>
          )}
          <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Categoria" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          <select value={form.kitchen_sector} onChange={e => setForm({ ...form, kitchen_sector: e.target.value })} className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
            <option value="">Setor de produção (opcional)</option>
            <option value="cozinha">Cozinha</option>
            <option value="bar">Bar</option>
            <option value="pizza">Pizza</option>
            <option value="sobremesa">Sobremesa</option>
            <option value="outro">Outro</option>
          </select>
          {isDropshipping && suppliers.filter(s => s.active).length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground">Fornecedor <span className="text-destructive">*</span></label>
              <select value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })} className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
                <option value="">— Selecione um fornecedor —</option>
                {suppliers.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <ImageUploadField value={form.image} onChange={url => setForm({ ...form, image: url })} tenantId={tenantId} searchQuery={[form.name, form.category].filter(Boolean).join(' ')} />
          <MediaGalleryField value={media} onChange={setMedia} tenantId={tenantId} label="Galeria do produto" />
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descrição" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          {isAffiliate && (
            <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-2">
              <label className="text-xs text-muted-foreground flex items-center gap-1"><LinkIcon className="h-3 w-3 text-primary" /> Link de afiliado <span className="text-destructive">*</span></label>
              <input value={form.affiliate_url} onChange={e => setForm({ ...form, affiliate_url: e.target.value })}
                placeholder="https://..." className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
              <input value={form.affiliate_network} onChange={e => setForm({ ...form, affiliate_network: e.target.value })}
                placeholder="Rede (shopee, amazon...) — opcional" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
              <div className="pt-2 mt-2 border-t border-primary/20">
                <p className="text-[11px] font-semibold text-primary mb-1.5">🎟️ Cupom de desconto (opcional)</p>
                <div className="grid grid-cols-2 gap-2">
                  <input value={form.affiliate_coupon_code} onChange={e => setForm({ ...form, affiliate_coupon_code: e.target.value.toUpperCase() })}
                    placeholder="Código (ACHADINHO50)" maxLength={30}
                    className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground font-mono uppercase" />
                  <input value={form.affiliate_coupon_discount_price} onChange={e => setForm({ ...form, affiliate_coupon_discount_price: e.target.value })}
                    placeholder="Preço com cupom (R$)" type="number" step="0.01" min="0"
                    className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
                </div>
                <label className="text-[10px] text-muted-foreground mt-2 block">Expira em</label>
                <input value={form.affiliate_coupon_expires_at} onChange={e => setForm({ ...form, affiliate_coupon_expires_at: e.target.value })}
                  type="datetime-local"
                  className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
                <p className="text-[10px] text-muted-foreground mt-1">Quando expirar, o cupom some e volta o preço normal.</p>
              </div>
            </div>
          )}
          {!isAffiliate && (
            <div>
              <label className="text-xs text-muted-foreground">Quantidade em estoque (vazio = ilimitado)</label>
              <input value={form.stock_quantity} onChange={e => setForm({ ...form, stock_quantity: e.target.value })} placeholder="Ex: 50" type="number" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            </div>
          )}
          {/* Availability mode: entrega, balcão ou ambos */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Disponibilidade</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: 'both', label: '🚚 Ambos', hint: 'Entrega e balcão' },
                { id: 'delivery_only', label: '🛵 Só entrega', hint: 'Não retira' },
                { id: 'pickup_only', label: '🏪 Só balcão', hint: 'Sem entrega' },
              ] as const).map(opt => (
                <button key={opt.id} type="button"
                  onClick={() => setForm({ ...form, availability_mode: opt.id })}
                  className={`py-2 px-2 rounded-lg text-xs font-medium transition-all border ${form.availability_mode === opt.id ? 'gradient-primary text-primary-foreground border-transparent' : 'bg-secondary text-muted-foreground border-border hover:border-primary/40'}`}>
                  <div>{opt.label}</div>
                  <div className="text-[9px] opacity-75 mt-0.5">{opt.hint}</div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Define se o cliente pode pedir entrega, só retirar no balcão, ou as duas opções.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} className="flex items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm"><Check className="h-4 w-4" /> Salvar</button>
            <button onClick={() => setShowAdd(false)} className="flex items-center gap-1 rounded-lg bg-secondary text-muted-foreground px-4 py-2 text-sm"><X className="h-4 w-4" /> Cancelar</button>
          </div>
        </div>
      )}

      {products.map(p => (
        <EditableProduct key={p.id} product={p} isEditing={editing === p.id} isDropshipping={isDropshipping} isAffiliate={isAffiliate}
          suppliers={suppliers.filter(s => s.active)} tenantId={tenantId}
          feeRequests={feeRequests.filter(r => r.product_id === p.id)}
          onRequestFee={(productId, percent) => {
            createFeeReq.mutate({ tenant_id: tenantId, product_id: productId, requested_percent: percent }, {
              onSuccess: () => toast.success('Solicitação de taxa enviada! Aguarde aprovação.'),
              onError: () => toast.error('Erro ao enviar solicitação.'),
            });
          }}
          onEdit={() => setEditing(p.id)} onSave={(prod) => { updateMutation.mutate(prod); setEditing(null); }}
          onCancel={() => setEditing(null)} onDelete={() => deleteMutation.mutate(p.id)} />
      ))}
    </div>
  );
};

const EditableProduct = ({ product, isEditing, isDropshipping, isAffiliate, suppliers, tenantId, feeRequests, onRequestFee, onEdit, onSave, onCancel, onDelete }: {
  product: Product; isEditing: boolean; isDropshipping?: boolean; isAffiliate?: boolean;
  suppliers: { id: string; name: string }[];
  tenantId: string;
  feeRequests: { id: string; requested_percent: number; status: string }[];
  onRequestFee: (productId: string, percent: number) => void;
  onEdit: () => void; onSave: (p: Product) => void; onCancel: () => void; onDelete: () => void;
}) => {
  const [form, setForm] = useState(product);
  const [media, setMedia] = useState<MediaItem[]>((product as any).media || []);
  const [feePercent, setFeePercent] = useState('');
  const [showFeeInput, setShowFeeInput] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const supplierName = suppliers.find(s => s.id === product.supplier_id)?.name;
  const pendingReq = feeRequests.find(r => r.status === 'pending');

  const handleGenerateDesc = async () => {
    if (generatingDesc) return;
    setGeneratingDesc(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-product-description', {
        body: {
          name: form.name,
          category: form.category,
          network: (form as any).affiliate_network || null,
          currentDescription: form.description,
        },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); return; }
      if (data?.description) {
        setForm(f => ({ ...f, description: data.description }));
        toast.success('Descrição gerada!');
      }
    } catch (e: any) {
      toast.error(`Falhou: ${e.message || 'erro'}`);
    } finally {
      setGeneratingDesc(false);
    }
  };


  if (isEditing) {
    return (
      <div className="rounded-lg border border-primary/30 bg-card p-4 space-y-3">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Preço venda</label>
            <input value={form.price} onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} type="number" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Preço custo</label>
            <input value={(form as any).original_price ?? 0} onChange={e => setForm({ ...form, original_price: parseFloat(e.target.value) || 0 } as any)} type="number" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Categoria" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          <input value={(form as any).subcategory ?? ''} onChange={e => setForm({ ...form, subcategory: e.target.value } as any)} placeholder="Subcategoria" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
        </div>
        <select value={(form as any).kitchen_sector ?? ''} onChange={e => setForm({ ...form, kitchen_sector: e.target.value || null } as any)} className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
          <option value="">Setor de produção (KDS / impressão) — opcional</option>
          <option value="cozinha">Cozinha</option>
          <option value="bar">Bar</option>
          <option value="pizza">Pizza</option>
          <option value="sobremesa">Sobremesa</option>
          <option value="outro">Outro</option>
        </select>
        {isDropshipping && (
          <select value={form.supplier_id || ''} onChange={e => setForm({ ...form, supplier_id: e.target.value || null })} className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
            <option value="">Sem fornecedor</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
          <ImageUploadField value={form.image} onChange={url => setForm({ ...form, image: url })} tenantId={tenantId} searchQuery={[form.name, form.category].filter(Boolean).join(' ')} />
          <MediaGalleryField value={media} onChange={setMedia} tenantId={tenantId} label="Galeria do produto" />
        {/* Tipo do item na edição */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Tipo de item</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setForm({ ...form, item_type: 'product' } as any)}
              className={`py-2 rounded-lg text-xs font-medium transition-all border ${(form as any).item_type !== 'service' ? 'gradient-primary text-primary-foreground border-transparent' : 'bg-secondary text-muted-foreground border-border'}`}>
              📦 Produto
            </button>
            <button type="button" onClick={() => setForm({ ...form, item_type: 'service' } as any)}
              className={`py-2 rounded-lg text-xs font-medium transition-all border ${(form as any).item_type === 'service' ? 'gradient-primary text-primary-foreground border-transparent' : 'bg-secondary text-muted-foreground border-border'}`}>
              🗓️ Serviço
            </button>
          </div>
        </div>
        {(form as any).item_type === 'service' && (
          <>
            <div>
              <label className="text-xs text-muted-foreground">Duração (min)</label>
              <input value={(form as any).duration_minutes ?? ''} onChange={e => setForm({ ...form, duration_minutes: e.target.value === '' ? null : parseInt(e.target.value) } as any)}
                type="number" placeholder="Ex: 30" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Limite simultâneo (opcional)</label>
              <input value={(form as any).max_concurrent ?? ''} onChange={e => setForm({ ...form, max_concurrent: e.target.value === '' ? null : parseInt(e.target.value) } as any)}
                type="number" min={1} placeholder="Vazio = usa capacidade da loja" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
              <p className="text-[10px] text-muted-foreground mt-1">Ex: loja faz 5 ao mesmo tempo, mas só 2 desse serviço em paralelo.</p>
            </div>
          </>
        )}
        {isAffiliate && (
          <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-2">
            <label className="text-xs text-muted-foreground">Link de afiliado</label>
            <input value={(form as any).affiliate_url ?? ''} onChange={e => setForm({ ...form, affiliate_url: e.target.value } as any)}
              placeholder="https://..." className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            <input value={(form as any).affiliate_network ?? ''} onChange={e => setForm({ ...form, affiliate_network: e.target.value } as any)}
              placeholder="Rede (shopee, amazon...)" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            <div className="pt-2 mt-2 border-t border-primary/20">
              <p className="text-[11px] font-semibold text-primary mb-1.5">🎟️ Cupom de desconto</p>
              <div className="grid grid-cols-2 gap-2">
                <input value={(form as any).affiliate_coupon_code ?? ''}
                  onChange={e => setForm({ ...form, affiliate_coupon_code: e.target.value.toUpperCase() } as any)}
                  placeholder="Código" maxLength={30}
                  className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground font-mono uppercase" />
                <input value={(form as any).affiliate_coupon_discount_price ?? ''}
                  onChange={e => setForm({ ...form, affiliate_coupon_discount_price: e.target.value === '' ? null : parseFloat(e.target.value) } as any)}
                  placeholder="Preço c/ cupom" type="number" step="0.01" min="0"
                  className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
              </div>
              <label className="text-[10px] text-muted-foreground mt-2 block">Expira em</label>
              <input
                value={(form as any).affiliate_coupon_expires_at ? new Date((form as any).affiliate_coupon_expires_at).toISOString().slice(0, 16) : ''}
                onChange={e => setForm({ ...form, affiliate_coupon_expires_at: e.target.value ? new Date(e.target.value).toISOString() : null } as any)}
                type="datetime-local"
                className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
              {(form as any).affiliate_coupon_expires_at && new Date((form as any).affiliate_coupon_expires_at) < new Date() && (
                <p className="text-[10px] text-destructive mt-1">⚠️ Cupom expirado — clientes verão preço normal.</p>
              )}
            </div>
          </div>
        )}
        {/* Disponibilidade na edição */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Disponibilidade</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'both', label: '🚚 Ambos' },
              { id: 'delivery_only', label: '🛵 Só entrega' },
              { id: 'pickup_only', label: '🏪 Só balcão' },
            ] as const).map(opt => (
              <button key={opt.id} type="button"
                onClick={() => setForm({ ...form, availability_mode: opt.id } as any)}
                className={`py-2 px-2 rounded-lg text-xs font-medium transition-all border ${((form as any).availability_mode || 'both') === opt.id ? 'gradient-primary text-primary-foreground border-transparent' : 'bg-secondary text-muted-foreground border-border hover:border-primary/40'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-muted-foreground">Descrição</label>
            <button type="button" onClick={handleGenerateDesc} disabled={generatingDesc || !form.name}
              className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50 disabled:no-underline">
              {generatingDesc ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {generatingDesc ? 'Gerando...' : 'Gerar com IA'}
            </button>
          </div>
          <textarea value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })}
            rows={3} placeholder="Descrição do produto..."
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none" />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={form.in_stock} onChange={e => setForm({ ...form, in_stock: e.target.checked })} className="accent-primary" /> Em estoque
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground" title="Quando você clicar em 'Categorizar tudo com IA', este produto será ignorado">
          <input type="checkbox" checked={(form as any).auto_categorize !== false} onChange={e => setForm({ ...form, auto_categorize: e.target.checked } as any)} className="accent-primary" />
          Incluir na categorização automática por IA
        </label>
        <div>
          <label className="text-xs text-muted-foreground">Qtd em estoque (vazio = ilimitado)</label>
          <div className="flex items-center gap-2">
            <button onClick={() => { const q = ((form as any).stock_quantity ?? 0); if (q > 0) setForm({ ...form, stock_quantity: q - 1 } as any); }}
              className="rounded-md bg-secondary px-2 py-1 text-sm text-foreground hover:bg-primary/20">-</button>
            <input value={(form as any).stock_quantity ?? ''} onChange={e => setForm({ ...form, stock_quantity: e.target.value === '' ? null : parseInt(e.target.value) } as any)}
              type="number" placeholder="∞" className="w-20 text-center rounded-lg border border-border bg-secondary px-2 py-1 text-sm text-foreground" />
            <button onClick={() => setForm({ ...form, stock_quantity: ((form as any).stock_quantity ?? 0) + 1 } as any)}
              className="rounded-md bg-secondary px-2 py-1 text-sm text-foreground hover:bg-primary/20">+</button>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onSave({ ...form, media } as any)} className="flex items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-3 py-1.5 text-sm"><Check className="h-3 w-3" /> Salvar</button>
          <button onClick={onCancel} className="flex items-center gap-1 rounded-lg bg-secondary text-muted-foreground px-3 py-1.5 text-sm"><X className="h-3 w-3" /> Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-md bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
          {product.image ? <img src={product.image} alt="" className="h-full w-full object-cover" /> : <Package className="h-6 w-6 text-primary/40" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground text-sm truncate">
            {product.name}
            {(product as any).item_type === 'service' && (
              <span className="ml-2 text-[10px] bg-primary/20 text-primary rounded-full px-2 py-0.5">
                🗓️ Serviço{(product as any).duration_minutes ? ` · ${(product as any).duration_minutes}min` : ''}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {product.category}{(product as any).subcategory ? ` › ${(product as any).subcategory}` : ''} · R${product.price.toFixed(2)}
            {(product as any).original_price > 0 && <span> (custo: R${(product as any).original_price.toFixed(2)})</span>}
            {(product as any).platform_fee_percent != null && <span className="text-primary"> · Taxa: {(product as any).platform_fee_percent}%</span>}
            {(product as any).stock_quantity != null && <span className="text-primary"> · Estoque: {(product as any).stock_quantity}</span>}
            {!product.in_stock && <span className="text-destructive"> · Esgotado</span>}
            {supplierName && <span className="text-primary"> · {supplierName}</span>}
            {(product as any).auto_categorize === false && <span className="text-muted-foreground"> · 🚫 IA off</span>}
          </p>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="rounded-md p-2 text-muted-foreground hover:text-primary hover:bg-primary/10"><Edit className="h-4 w-4" /></button>
          <button onClick={onDelete} className="rounded-md p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Fee request section */}
      <div className="flex items-center gap-2 flex-wrap">
        {pendingReq && (
          <span className="text-xs bg-yellow-500/20 text-yellow-400 rounded-full px-2 py-0.5">
            ⏳ Solicitação pendente: {pendingReq.requested_percent}%
          </span>
        )}
        {!pendingReq && !showFeeInput && (
          <button onClick={() => setShowFeeInput(true)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors">
            <Percent className="h-3 w-3" /> Solicitar taxa personalizada
          </button>
        )}
        {showFeeInput && (
          <div className="flex items-center gap-2">
            <input value={feePercent} onChange={e => setFeePercent(e.target.value)} type="number" placeholder="Ex: 8" className="w-20 rounded-lg border border-border bg-secondary px-2 py-1 text-xs text-foreground" />
            <button onClick={() => { 
              if (feePercent) { onRequestFee(product.id, parseFloat(feePercent)); setShowFeeInput(false); setFeePercent(''); }
            }} className="text-xs text-primary hover:underline">Enviar</button>
            <button onClick={() => { setShowFeeInput(false); setFeePercent(''); }} className="text-xs text-muted-foreground hover:underline">Cancelar</button>
          </div>
        )}
      </div>

      {/* Editor de variantes e adicionais */}
      {!isAffiliate && <ProductExtrasEditor productId={product.id} tenantId={tenantId} />}
    </div>
  );
};

export default TenantAdminProducts;
