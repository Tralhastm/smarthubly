import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProducts, useAddProduct, useUpdateProduct, useDeleteProduct, type Product } from '@/hooks/useProducts';
import { useProductVariants } from '@/hooks/useProductExtras';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useFeeRequests, useCreateFeeRequest } from '@/hooks/useFeeRequests';
import ImageUploadField from '@/components/shared/ImageUploadField';
import MediaGalleryField, { type MediaItem } from '@/components/shared/MediaGalleryField';
import AutoCategorizeButton from '@/components/shared/AutoCategorizeButton';
import ProductExtrasEditor from './ProductExtrasEditor';
import CategoryTreeSelect from './CategoryTreeSelect';
import TenantCategoriesTree from './TenantCategoriesTree';
import { Plus, Edit, Trash2, Check, X, Package, Percent, FileText, Download, Sparkles, Loader2, ImageIcon, Link as LinkIcon, AlertTriangle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { unifiedInvoke } from "@/lib/unifiedInvoke";

type ParsedVariant = { name: string; price: number; cost_price?: number; resale_price?: number; available?: boolean };
type ParsedProduct = { name: string; price: number; cost_price?: number; resale_price?: number; category: string; description: string; variants?: ParsedVariant[]; needs_price_review?: boolean };

const TenantAdminProducts = ({ tenantId, isDropshipping, isAffiliate }: { tenantId: string; isDropshipping?: boolean; isAffiliate?: boolean }) => {
  const { data: products = [], isLoading, refetch } = useProducts(tenantId);
  const queryClient = useQueryClient();
  const { data: suppliers = [] } = useSuppliers(tenantId);
  const { data: feeRequests = [] } = useFeeRequests(tenantId);
  const addMutation = useAddProduct();
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct(tenantId);
  const createFeeReq = useCreateFeeRequest();
  const [editing, setEditing] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [nodesById, setNodesById] = useState<Record<string, { name: string }>>({});

  useEffect(() => {
    let dead = false;
    void (async () => {
      const { data } = await supabase
        .from('product_categories')
        .select('id, name')
        .eq('tenant_id', tenantId);
      if (!dead) setNodesById(Object.fromEntries((data || []).map(n => [n.id, { name: n.name }])));
    })();
    return () => { dead = true; };
  }, [tenantId]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [form, setForm] = useState({ name: '', price: '', original_price: '', category: '', description: '', image: '', in_stock: true, supplier_id: '', stock_quantity: '', affiliate_url: '', affiliate_network: '', item_type: 'product' as 'product' | 'service', duration_minutes: '', max_concurrent: '', availability_mode: 'both' as 'both' | 'delivery_only' | 'pickup_only', affiliate_coupon_code: '', affiliate_coupon_discount_price: '', affiliate_coupon_expires_at: '', kitchen_sector: '' });

  // Affiliate URL import
  const [affiliateImportUrl, setAffiliateImportUrl] = useState('');
  const [importingUrl, setImportingUrl] = useState(false);
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [showBulkDescriptions, setShowBulkDescriptions] = useState(false);
  const [bulkDescriptionRunning, setBulkDescriptionRunning] = useState(false);
  const [bulkDescriptionProgress, setBulkDescriptionProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [bulkDescriptionRules, setBulkDescriptionRules] = useState('Começar com um papo de vendedor específico para este produto, sem frases genéricas. Destacar as principais especificações reais do celular. Não mencionar nota fiscal. Finalizar de forma profissional informando garantia de 30 dias, sem cobertura para mau uso, quedas, líquidos, riscos, tela quebrada ou danos causados pelo cliente.');
  const [bulkDescriptionOverwrite, setBulkDescriptionOverwrite] = useState(false);
  const bulkDescriptionCancelled = useRef(false);

  const escapeHtml = (value: unknown) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const getProductImageUrls = (product: Product) => {
    const extraMedia = Array.isArray((product as any).media) ? (product as any).media : [];
    const urls = [product.image, ...extraMedia.map((item: any) => typeof item === 'string' ? item : item?.url || item?.src || item?.image)]
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
    return [...new Set(urls)];
  };

  const downloadBlob = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const catalogSlug = () => (tenantId || 'catalogo').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'catalogo';
  const money = (value: unknown) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const exportCatalogTxt = () => {
    if (!products.length) { toast.error('Não há produtos para exportar.'); return; }
    const lines = [`CATÁLOGO DE PRODUTOS`, `Gerado em: ${new Date().toLocaleString('pt-BR')}`, `Total de produtos: ${products.length}`, ''];
    products.forEach((product, index) => {
      const p = product as any;
      const images = getProductImageUrls(product);
      lines.push(`${index + 1}. ${product.name}`, `Categoria: ${product.category || 'Geral'}`);
      if (p.subcategory) lines.push(`Subcategoria: ${p.subcategory}`);
      lines.push(`Preço de venda: ${money(product.price)}`, `Preço original/custo: ${money(p.original_price)}`, `Em estoque: ${product.in_stock ? 'Sim' : 'Não'}`);
      if (p.stock_quantity != null) lines.push(`Quantidade: ${p.stock_quantity}`);
      if (p.unidade) lines.push(`Unidade: ${p.unidade}`);
      if (p.item_type && p.item_type !== 'product') lines.push(`Tipo: ${p.item_type}`);
      if (product.description) lines.push(`Descrição: ${product.description}`);
      if (p.affiliate_url) lines.push(`Link: ${p.affiliate_url}`);
      if (p.supplier_id) lines.push(`Fornecedor ID: ${p.supplier_id}`);
      lines.push(`Imagens (${images.length}):`, ...images.map((url: string) => `- ${url}`), '', '---', '');
    });
    downloadBlob(lines.join('\n'), `catalogo-${catalogSlug()}.txt`, 'text/plain;charset=utf-8');
    toast.success('Catálogo TXT exportado.');
  };

  const exportCatalogHtml = () => {
    if (!products.length) { toast.error('Não há produtos para exportar.'); return; }
    const cards = products.map((product, index) => {
      const p = product as any;
      const images = getProductImageUrls(product);
      const imageMarkup = images.length
        ? `<div class="gallery">${images.map((url: string, imageIndex: number) => `<img src="${escapeHtml(url)}" alt="${escapeHtml(product.name)} — imagem ${imageIndex + 1}" loading="lazy">`).join('')}</div>`
        : '<div class="no-image">Sem imagem</div>';
      const stock = product.in_stock ? (p.stock_quantity != null ? `Em estoque · ${escapeHtml(p.stock_quantity)}` : 'Em estoque') : 'Fora de estoque';
      return `<article class="product ${product.in_stock ? '' : 'out'}">${imageMarkup}<div class="content"><div class="eyebrow">${String(index + 1).padStart(2, '0')} · ${escapeHtml(product.category || 'Geral')}</div><h2>${escapeHtml(product.name)}</h2>${p.subcategory ? `<div class="subcategory">${escapeHtml(p.subcategory)}</div>` : ''}${product.description ? `<p>${escapeHtml(product.description)}</p>` : ''}<div class="price">${escapeHtml(money(product.price))}</div>${p.original_price ? `<div class="old-price">Preço original: ${escapeHtml(money(p.original_price))}</div>` : ''}<div class="stock">${stock}</div>${p.unidade ? `<div class="meta">Unidade: ${escapeHtml(p.unidade)}</div>` : ''}${p.affiliate_url ? `<a class="link" href="${escapeHtml(p.affiliate_url)}">Ver produto</a>` : ''}</div></article>`;
    }).join('\n');
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catálogo de Produtos</title><style>:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;background:#eff6ff}*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#eff6ff,#dbeafe);padding:32px}.wrap{max-width:1180px;margin:auto}.header{background:#fff;border-radius:24px;padding:28px 32px;margin-bottom:24px;box-shadow:0 16px 40px #1e3a8a18}.header h1{margin:0 0 8px;font-size:30px;color:#1e3a8a}.header p{margin:0;color:#64748b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}.product{overflow:hidden;background:#fff;border-radius:20px;box-shadow:0 12px 30px #1e3a8a18;border:1px solid #dbeafe}.product.out{opacity:.72}.gallery{height:230px;display:flex;gap:8px;overflow-x:auto;padding:12px;background:#f8fafc}.gallery img{height:206px;min-width:206px;width:206px;object-fit:contain;border-radius:12px;background:white}.no-image{height:230px;display:grid;place-items:center;color:#94a3b8;background:#f8fafc}.content{padding:20px}.eyebrow{text-transform:uppercase;letter-spacing:.08em;color:#2563eb;font-size:11px;font-weight:700}.product h2{font-size:19px;margin:8px 0;color:#0f172a}.subcategory,.meta{color:#64748b;font-size:13px}.product p{color:#475569;line-height:1.5;font-size:14px}.price{font-size:26px;font-weight:800;color:#1d4ed8;margin-top:16px}.old-price{font-size:12px;color:#94a3b8;margin-top:4px}.stock{display:inline-block;margin-top:14px;padding:6px 10px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:700}.link{display:inline-block;margin-top:16px;color:#1d4ed8;font-weight:700;text-decoration:none}@media(max-width:600px){body{padding:16px}.header{padding:22px}.gallery{height:190px}.gallery img{height:166px;min-width:166px;width:166px}}</style></head><body><main class="wrap"><header class="header"><h1>Catálogo de Produtos</h1><p>${products.length} produto(s) · Gerado em ${escapeHtml(new Date().toLocaleString('pt-BR'))}</p></header><section class="grid">${cards}</section></main></body></html>`;
    downloadBlob(html, `catalogo-${catalogSlug()}.html`, 'text/html;charset=utf-8');
    toast.success('Catálogo HTML exportado com todas as imagens disponíveis.');
  };

  const handleRefreshAffiliatePrices = async () => {
    if (refreshingPrices) return;
    setRefreshingPrices(true);
    toast.loading('Atualizando preços via IA... pode levar 1-2 min', { id: 'refresh-aff' });
    try {
      const { data, error } = await unifiedInvoke("affiliate-unified", "refresh", { tenant_id: tenantId, limit: 100 });
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

  const handleBulkDescriptionGeneration = async () => {
    if (bulkDescriptionRunning) return;
    const targets = products.filter(p => bulkDescriptionOverwrite || !p.description?.trim());
    if (targets.length === 0) {
      toast.info(bulkDescriptionOverwrite ? 'Não há produtos para processar.' : 'Todos os produtos já possuem descrição. Ative sobrescrever para gerar novamente.');
      return;
    }
    bulkDescriptionCancelled.current = false;
    setBulkDescriptionRunning(true);
    setBulkDescriptionProgress({ done: 0, total: targets.length, failed: 0 });
    let done = 0;
    let failed = 0;
    toast.info(`Gerando descrições de ${targets.length} produto(s) com pesquisa na internet...`);
    try {
      for (const product of targets) {
        if (bulkDescriptionCancelled.current) break;
        try {
          const { data, error } = await unifiedInvoke('ai-media-unified', 'describe', {
            name: product.name,
            category: product.category,
            currentDescription: product.description || '',
            rules: bulkDescriptionRules.trim(),
            researchWeb: true,
          });
          if (error || data?.error || !data?.description) throw new Error(data?.error || error?.message || 'Descrição não gerada');
          const { error: updateError } = await supabase.from('products').update({ description: data.description }).eq('id', product.id);
          if (updateError) throw updateError;
          done++;
        } catch (e) {
          failed++;
          console.warn('Falha ao gerar descrição', product.name, e);
        }
        setBulkDescriptionProgress({ done, total: targets.length, failed });
        await refetch();
      }
      toast[failed > 0 ? 'warning' : 'success'](`${done} descrição(ões) gerada(s)${failed > 0 ? `; ${failed} falharam` : ''}.`);
    } finally {
      setBulkDescriptionRunning(false);
      bulkDescriptionCancelled.current = false;
      setShowBulkDescriptions(false);
    }
  };

  const cancelBulkDescriptionGeneration = () => {
    bulkDescriptionCancelled.current = true;
    toast.info('A geração será interrompida após o produto atual.');
  };

  // TXT import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStep, setImportStep] = useState<'idle' | 'parsing' | 'preview' | 'importing'>('idle');
  const [parsedProducts, setParsedProducts] = useState<ParsedProduct[]>([]);
  const [generateImages, setGenerateImages] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importCancelled, setImportCancelled] = useState(false);
  const [importRawText, setImportRawText] = useState('');
  const [importFileName, setImportFileName] = useState('');
  // Configuração do catálogo: fornecedor e tipo de preço (config geral, qualquer loja)
  const [importSupplierName, setImportSupplierName] = useState('');
  const [importPriceType, setImportPriceType] = useState<'cost' | 'resale' | 'both'>('resale');
  const [importSupplierId, setImportSupplierId] = useState<string | null>(null);
  const [importProfitMargin, setImportProfitMargin] = useState('20');
  const [importShippingFee, setImportShippingFee] = useState('0');

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
    // Interrompe o import web client-side entre os lotes
    webImportCancelled.current = true;
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
  const [deletingAll, setDeletingAll] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  const handleDeleteAll = async () => {
    if (deletingAll) return;
    if (!confirmAll) {
      // Primeira confirmação: pede digitação de confirmação explícita
      const typed = prompt(`Para apagar TODOS os ${products.length} produtos desta loja, digite a palavra APAGAR TUDO em letras maiúsculas:`);
      if (typed !== 'APAGAR TUDO') {
        toast.info('Operação cancelada — digitação não conferida.');
        return;
      }
      setConfirmAll(true);
      return;
    }
    setDeletingAll(true);
    const toastId = 'del-all';
    toast.loading(`Excluindo todos os ${products.length} produtos...`, { id: toastId });
    try {
      let deleted = 0;
      let failed = 0;
      const chunk = 50;
      const ids = products.map(p => p.id);
      for (let i = 0; i < ids.length; i += chunk) {
        const batch = ids.slice(i, i + chunk);
        const { error } = await supabase
          .from('products')
          .delete()
          .in('id', batch)
          .eq('tenant_id', tenantId);
        if (error) failed += batch.length; else deleted += batch.length;
      }
      toast.success(`Excluídos ${deleted} produtos${failed ? ` · ${failed} falharam` : ''}`, { id: toastId });
      setConfirmAll(false);
      refetch();
    } catch (e) {
      toast.error('Falhou ao excluir', { id: toastId });
    } finally {
      setDeletingAll(false);
    }
  };
  const handleDeleteBulk = useCallback(async (source: 'ai' | 'google') => {
    const label = source === 'ai' ? 'geradas por IA' : 'importadas da web';
    if (!confirm(`Tem certeza? Isso vai apagar TODAS as fotos ${label} desta loja. As outras (uploads manuais e a outra origem) serão mantidas.`)) return;
    if (source === 'ai') setDeletingAi(true); else setDeletingGoogle(true);
    const toastId = `del-${source}`;
    toast.loading(`Excluindo fotos ${label}...`, { id: toastId });
    try {
      const { data, error } = await unifiedInvoke("ai-media-unified", "delete", { tenantId, source });
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
    // Sem jobId real (import web client-side): não faz poll no banco, o próprio loop atualiza
    if (activeJob.id === 'pending') return;
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

  // Resolve (ou cria) o fornecedor informado no import
  const resolveImportSupplier = async (name: string): Promise<string | null> => {
    const clean = name.trim();
    if (!clean) return null;
    const { data: existing } = await supabase
      .from('suppliers')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('name', clean)
      .limit(1)
      .maybeSingle();
    if (existing) return existing.id;
    // Ainda não existe: cria automaticamente na aba Fornecedores
    const { data: created, error } = await supabase
      .from('suppliers')
      .insert({ tenant_id: tenantId, name: clean, address: '', phone: '' })
      .select('id')
      .single();
    if (error || !created) {
      console.warn('Falha ao criar fornecedor automático', error);
      return null;
    }
    toast.success(`Fornecedor "${clean}" cadastrado automaticamente! 🏭`);
    return created.id;
  };

  // Grava o preço de cada produto na tabela do fornecedor (comparação multi-fornecedor)
  // price_types é uma coluna jsonb: ["cost"] | ["resale"] | ["cost","resale"] — preserva o tipo escolhido sem alterar o unique key
  const recordSupplierPrice = async (supplierId: string, productName: string, price: number, priceType: 'cost' | 'resale' | 'both'): Promise<void> => {
    const types = priceType === 'both' ? ['cost', 'resale'] : [priceType];
    const { error } = await supabase
      .from('supplier_product_prices')
      .upsert(
        { supplier_id: supplierId, product_name: productName.toLowerCase(), unit_price: price, price_types: types, available: true },
        { onConflict: 'supplier_id,product_name' },
      );
    if (error) console.warn('Falha ao gravar preço do fornecedor', error);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const isText = file.type === 'text/plain' || file.name.endsWith('.txt');
    const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
    const isImage = file.type.startsWith('image/');

    if (!isText && !isPdf && !isImage) {
      toast.error('Formato não suportado. Use TXT, PDF ou Imagem (PNG/JPG).');
      return;
    }

    setImportFileName(file.name);
    setImportSupplierName('');
    setImportPriceType('resale');
    setImportSupplierId(null);
    setImportCancelled(false);
    
    if (isText) {
      const text = await file.text();
      if (!text.trim()) { toast.error('Arquivo vazio'); return; }
      setImportRawText(text);
      (window as any)._importFile = null;
    } else {
      // Para PDF/Imagem, guardamos o arquivo para upload multipart no step seguinte
      setImportRawText('[Arquivo Binário: PDF/Imagem]');
      (window as any)._importFile = file;
    }

    setImportStep('config');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Prévia → processa o arquivo com IA
  const handleStartParsing = async () => {
    setImportStep('parsing');
    try {
      const file = (window as any)._importFile;
      let result;
      
      if (file) {
        // Fluxo Binário (PDF/Imagem)
        const formData = new FormData();
        formData.append('file', file);
        formData.append('supplierName', importSupplierName);
        formData.append('priceType', importPriceType);
        formData.append('profitMargin', String(importProfitMargin));
        formData.append('shippingFee', String(importShippingFee));
        formData.append('tenantId', tenantId);

        // Usamos a Management API ou endpoint direto para multipart
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-media-unified/catalog`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session?.access_token || ''}` },
          body: formData
        });
        
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Erro no processamento do arquivo' }));
          throw new Error(err.error || `Erro HTTP ${response.status}`);
        }
        result = { data: await response.json() };
      } else {
        // Fluxo TXT original
        result = await unifiedInvoke("ai-media-unified", "parse-txt", { 
          txtContent: importRawText,
          supplierName: importSupplierName,
          priceType: importPriceType,
          profitMargin: parseFloat(importProfitMargin) || 0,
          shippingFee: parseFloat(importShippingFee) || 0,
          tenantId,
        });
      }

      const { data, error } = result;

      if (error) {
        const status = (error as any)?.status;
        let detailedMessage = '';
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === 'function') {
          const errorBody = await ctx.clone().json().catch(() => null);
          detailedMessage = errorBody?.error || '';
        }
        let msg = detailedMessage || (error as any)?.message || '';
        if (status === 401) msg = 'Sessão expirada — faça logout e entre novamente.';
        else if (status === 429) msg = 'Muitas tentativas seguidas — aguarde um momento e tente de novo.';
        else if (!msg) msg = `Falha na IA de leitura (${status ? 'HTTP ' + status : 'rede'}) — verifique sua conexão e tente de novo.`;
        throw new Error(msg);
      }

      if (!data?.products?.length) {
        toast.error('Nenhum produto encontrado no arquivo');
        setImportStep('config');
        return;
      }

      // IA: Se o arquivo veio com fornecedor, associa automaticamente
      // Caso contrário, usa o fornecedor informado no formulário
      const supplierId = await resolveImportSupplier(importSupplierName);
      setImportSupplierId(supplierId);

      // Associa o fornecedor a cada produto parseado para exibição no preview
      const productsWithSupplier = data.products.map((p: any) => ({
        ...p,
        supplier_id: supplierId,
        supplier_name: importSupplierName
      }));

      setParsedProducts(productsWithSupplier);
      setImportStep('preview');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Erro ao processar arquivo');
      setImportStep('config');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const saveImportedVariants = async (productId: string, product: ParsedProduct, baseSalePrice: number, baseCost: number, isCost: boolean, shipping: number, margin: number) => {
    // Se a lista trouxe cores, ela passa a ser a fonte de verdade para este modelo.
    // Quando não trouxe variantes, preservamos as existentes para não apagar dados manualmente cadastrados.
    if (!Array.isArray(product.variants) || product.variants.length === 0) return;

    const { data: existingVariants, error: variantsError } = await supabase.from('product_variants' as any)
      .select('*').eq('product_id', productId).limit(100);
    if (variantsError) throw variantsError;

    const existingByName = new Map<string, any>();
    ((existingVariants || []) as any[]).forEach(existing => {
      existingByName.set(existing.name.trim().toLocaleLowerCase('pt-BR'), existing);
    });
    const incomingNames = new Set<string>();

    for (const [sortOrder, variant] of product.variants.entries()) {
      const name = variant.name?.trim();
      if (!name) continue;
      const key = name.toLocaleLowerCase('pt-BR');
      incomingNames.add(key);

      const variantCost = Number(variant.cost_price || (isCost ? variant.price : 0)) || 0;
      const explicitSale = Number(variant.resale_price || (!isCost ? variant.price : 0)) || 0;
      const calculatedSale = variantCost > 0 ? (variantCost + shipping) * (1 + margin / 100) : 0;
      const variantSale = explicitSale > 0 ? explicitSale : calculatedSale > 0 ? calculatedSale : baseSalePrice;
      if (variantSale <= 0) continue;

      const payload = {
        product_id: productId,
        tenant_id: tenantId,
        name,
        price_delta: variantSale - baseSalePrice,
        cost_price: variantCost > 0 ? variantCost : null,
        suggested_price: variantSale,
        needs_price_review: variantCost > 0 && baseCost > 0 && variantCost > baseCost,
        price_source: variantCost > 0 ? 'lista_diaria' : 'lista_diaria_sem_custo',
        in_stock: variant.available !== false,
        sort_order: sortOrder,
      };
      const existing = existingByName.get(key);
      const result = existing
        ? await supabase.from('product_variants' as any).update(payload).eq('id', existing.id)
        : await supabase.from('product_variants' as any).insert(payload);
      if (result.error) throw result.error;
    }

    // Retira automaticamente cores que deixaram de existir na lista diária.
    for (const existing of (existingVariants || []) as any[]) {
      const key = existing.name.trim().toLocaleLowerCase('pt-BR');
      if (!incomingNames.has(key)) {
        const { error } = await supabase.from('product_variants' as any).delete().eq('id', existing.id);
        if (error) throw error;
      }
    }
  };

  const handleImportConfirm = async () => {
    setImportStep('importing');
    setImportTotal(parsedProducts.length);
    setImportProgress(0);
    setImportCancelled(false);

    const insertedIds: string[] = [];
    
    // Resolve o fornecedor novamente para garantir que o ID esteja disponível no escopo da função
    const currentSupplierId = await resolveImportSupplier(importSupplierName);

    // IA Analítica: Filtra duplicatas na lista parseada antes de começar
    const uniqueParsed = parsedProducts.filter((p, index, self) => 
      index === self.findIndex((t) => t.name.trim().toLowerCase() === p.name.trim().toLowerCase())
    );
    
    setImportTotal(uniqueParsed.length);

    for (let i = 0; i < uniqueParsed.length; i++) {
      if (importCancelled) break;
      const p = uniqueParsed[i];
      try {
        const isCost = importPriceType === 'cost' || importPriceType === 'both';
        const shipping = parseFloat(importShippingFee) || 0;
        const margin = parseFloat(importProfitMargin) || 0;
        
        // Se for custo, calcula a revenda automaticamente com base na margem e frete
        const importedCost = isCost ? Number(p.cost_price || p.price) : 0;
        const original_price = importedCost;
        const calculatedPrice = isCost ? (importedCost + shipping) * (1 + (margin / 100)) : Number(p.resale_price || p.price);
        const price = calculatedPrice;
        
        // Verificação de duplicata no Banco de Dados em tempo real
        const { data: existing } = await supabase
          .from('products')
          .select('id, price, original_price, supplier_id, description, category')
          .eq('tenant_id', tenantId)
          .ilike('name', p.name.trim())
          .maybeSingle();

        if (existing) {
          // Requisito: "valor de revenda N MUDARIA MAS IRIA TER UM ALERTA SOBRE A MARGEM DE LUCRO"
          // Para produtos existentes, não alteramos o 'price' (revenda) da tabela products.
          const updateData: any = {
            updated_at: new Date().toISOString(),
          };
          
          // Se for custo, atualizamos o custo original se for menor (melhor preço)
          const currentCost = existing.original_price || 0;
          if (isCost && (currentCost === 0 || importedCost < currentCost)) {
            updateData.original_price = original_price;
            updateData.supplier_id = currentSupplierId;
            
            // Alerta de margem (apenas log/console por enquanto conforme pedido)
            const currentResale = parseFloat(existing.price?.toString() || '0');
            const newMargin = currentResale > 0 ? ((currentResale - importedCost) / importedCost) * 100 : 0;
            if (newMargin < margin) {
              console.log(`[Import] Margem baixa para ${p.name}: ${newMargin.toFixed(1)}%`);
            }
          }

          await supabase.from('products').update(updateData).eq('id', existing.id);
          await saveImportedVariants(existing.id, p, Number(existing.price) || price, Number(updateData.original_price || existing.original_price) || importedCost, isCost, shipping, margin);
          insertedIds.push(existing.id);
        } else {
          // Produto novo: Insere
          await new Promise<void>((resolve, reject) => {
            addMutation.mutate({
              tenant_id: tenantId,
              name: p.name.trim(),
              price: price,
              original_price: original_price,
              category: p.category || 'Geral',
              description: p.description || '',
              image: '',
              in_stock: true,
              supplier_id: currentSupplierId || null,
            } as any, {
              onSuccess: () => resolve(),
              onError: (e) => reject(e),
            });
          });

          const { data: inserted } = await supabase
            .from('products')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('name', p.name.trim())
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (inserted) {
            await saveImportedVariants(inserted.id, p, price, importedCost, isCost, shipping, margin);
            insertedIds.push(inserted.id);
          }
        }

        // Registra sempre na tabela de comparação multi-fornecedor
        if (currentSupplierId && Number.isFinite(importedCost || p.price) && (importedCost || p.price) > 0) {
          await recordSupplierPrice(currentSupplierId, p.name, importedCost || p.price, importPriceType);
        }
      } catch (err) {
        console.error('Failed to process', p.name, err);
      }
      setImportProgress(i + 1);
    }

    await queryClient.invalidateQueries({ queryKey: ['product-variants'] });
    await refetch();

    const msg = importCancelled
      ? `Importação interrompida — ${insertedIds.length} produtos já importados.`
      : `${insertedIds.length} produtos importados!`;
    toast[importCancelled ? 'info' : 'success'](msg);
    setParsedProducts([]);
    setImportStep('idle');
    setImportRawText('');
    setImportFileName('');
    setImportSupplierName('');
    setImportSupplierId(null);

    if (!importCancelled && generateImages && insertedIds.length > 0) {
      setGenerateImages(false);
      startServerImageGeneration(insertedIds);
    } else {
      setGenerateImages(false);
    }
  };

  const handleCancelImport = () => {
    setImportCancelled(true);
    toast.info('Interrompendo a importação após o item atual...');
  };

  const startServerImageGeneration = async (productIds: string[]) => {
    toast.info(`Gerando ${productIds.length} imagens no servidor... Pode fechar o navegador!`);
    // Otimista: mostra job placeholder enquanto a edge function não retorna o jobId
    setActiveJob({ id: 'pending', total: productIds.length, done: 0, failed: 0, status: 'running', reason: '', message: 'Iniciando…', cooldown_until: null });
    try {
      const { data, error } = await unifiedInvoke("ai-media-unified", "bulk", { productIds, tenantId });
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

  // Import web (client-side): busca cada produto sem imagem na web (Bing/DDG + IA curadoria)
  const webImportCancelled = useRef(false);
  const handleImportImagesFromGoogle = useCallback(async () => {
    const noImage = products.filter(p => !p.image || p.image === '');
    if (noImage.length === 0) { toast.info('Todos os produtos já têm imagem!'); return; }
    webImportCancelled.current = false;
    toast.info(`Buscando ${noImage.length} fotos na web... Pode fechar o navegador!`);
    setActiveJob({ id: 'pending', total: noImage.length, done: 0, failed: 0, status: 'running', reason: '', message: 'Iniciando busca…', cooldown_until: null });
    let done = 0;
    let failed = 0;
    const CONCURRENT = 4;
    const processOne = async (p: Product) => {
      try {
        const query = (p.name || '').trim();
        if (!query) { failed++; return; }
        const { data, error } = await unifiedInvoke("ai-media-unified", "search", { query, tenantId, download: true, curate: true });
        const imgUrl = data?.imageUrl;
        if (error || !imgUrl) {
          failed++;
          const msg = error?.status === 404 ? 'no_usable_image' : (typeof error?.message === 'string' ? error.message.slice(0, 60) : 'erro na busca');
          setActiveJob(prev => prev ? { ...prev, failed, done, message: `${done} encontradas · ${failed} sem foto (${msg})…` } : prev);
          return;
        }
        const { error: upErr } = await supabase.from('products').update({ image: imgUrl }).eq('id', p.id);
        if (upErr) { failed++; console.warn('update image failed', upErr); return; }
        done++;
        setActiveJob(prev => prev ? { ...prev, done, failed, message: `Buscando próximas fotos… (${done}/${noImage.length})` } : prev);
        void refetch();
      } catch {
        failed++;
      }
    };
    try {
      // executa em lotes concorrentes, respeitando interrupção entre lotes
      for (let i = 0; i < noImage.length; i += CONCURRENT) {
        if (webImportCancelled.current) break;
        await Promise.all(noImage.slice(i, i + CONCURRENT).map(processOne));
      }
    } finally {
      webImportCancelled.current = false;
      const total = done + failed;
      setActiveJob(prev => prev ? {
        ...prev,
        done,
        failed,
        status: 'done',
        message: total === noImage.length ? 'Todas as buscas concluídas.' : 'Processo interrompido.',
      } : null);
      void refetch();
      if (done > 0) toast.success(`✅ ${done} fotos importadas da web!${failed > 0 ? ` (${failed} sem foto encontrada)` : ''}`);
      else if (failed > 0) toast.warning(`Nenhuma foto utilizável foi encontrada para ${failed} produto(s).`);
      else toast.info('Busca encerrada sem alterações.');
      setTimeout(() => setActiveJob(null), 4000);
    }
  }, [products, tenantId, refetch]);

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
      subcategory_ids: (form as any).subcategory_ids || null,
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
      const { data, error } = await unifiedInvoke("affiliate-unified", "import", { url: affiliateImportUrl.trim(), useAi });
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
  const normalizedCatalogSearch = catalogSearch.trim().toLowerCase();
  const visibleProducts = normalizedCatalogSearch
    ? products.filter(p => [p.name, p.category, (p as any).subcategory, (p as any).supplier_name]
        .filter(Boolean).join(' ').toLowerCase().includes(normalizedCatalogSearch))
    : products;
  const productsWithGoogleImage = products.filter(p => p.image && p.image.includes('?src=google')).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} placeholder="Localizar produto no catálogo..." aria-label="Buscar produto no catálogo"
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/30" />
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90">
          <Plus className="h-4 w-4" /> Novo Produto
        </button>
        <button onClick={() => fileInputRef.current?.click()} disabled={importStep !== 'idle'}
          className="flex items-center gap-2 rounded-lg bg-secondary text-foreground px-4 py-2 text-sm font-medium hover:bg-secondary/80 disabled:opacity-50"
          title="Importe catálogos em TXT, PDF ou Imagem. A IA extrairá os produtos e preços automaticamente.">
          <FileText className="h-4 w-4" /> Importar Catálogo (IA)
        </button>
        <button onClick={() => setShowBulkDescriptions(true)} disabled={!products.length || bulkDescriptionRunning}
          className="flex items-center gap-2 rounded-lg bg-primary/15 text-primary px-4 py-2 text-sm font-medium hover:bg-primary/25 disabled:opacity-50"
          title="Pesquisa especificações na internet e gera descrições comerciais para vários produtos">
          {bulkDescriptionRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Gerar descrições em massa
        </button>
        <button onClick={exportCatalogHtml} disabled={!products.length}
          className="flex items-center gap-2 rounded-lg bg-primary/15 text-primary px-4 py-2 text-sm font-medium hover:bg-primary/25 disabled:opacity-50"
          title="Baixa um HTML visual com todas as imagens e informações dos produtos">
          <Download className="h-4 w-4" /> Exportar HTML
        </button>
        <button onClick={exportCatalogTxt} disabled={!products.length}
          className="flex items-center gap-2 rounded-lg bg-secondary text-foreground px-4 py-2 text-sm font-medium hover:bg-secondary/80 disabled:opacity-50"
          title="Baixa um TXT com informações, preços e URLs de todas as imagens">
          <FileText className="h-4 w-4" /> Exportar TXT
        </button>
        <button onClick={handleDeleteAll} disabled={deletingAll}
          className="flex items-center gap-2 rounded-lg bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium hover:bg-destructive/90 disabled:opacity-50">
          <Trash2 className="h-4 w-4" /> Apagar Tudo
        </button>
        {importStep === 'importing' && (
          <button onClick={handleCancelImport}
            className="flex items-center gap-2 rounded-lg bg-amber-500 text-white px-4 py-2 text-sm font-medium hover:bg-amber-600 animate-pulse">
            <X className="h-4 w-4" /> Interromper Importação
          </button>
        )}
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
        {products.length > 0 && (
          <button
            onClick={handleDeleteAll}
            disabled={deletingAll}
            className="flex items-center gap-2 rounded-lg bg-destructive/15 text-destructive px-4 py-2 text-sm font-medium hover:bg-destructive/25 disabled:opacity-50"
            title="Apaga TODOS os produtos desta loja (irreversível)"
          >
            {deletingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Apagar todos os produtos ({products.length})
          </button>
        )}
        <input ref={fileInputRef} type="file" accept=".txt,.pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleFileSelect} />
      </div>

      {showBulkDescriptions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-background p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Gerador de descrições em massa</h3>
                <p className="text-xs text-muted-foreground mt-1">A IA pesquisa especificações públicas do produto e salva uma descrição por vez no catálogo administrativo.</p>
              </div>
              {!bulkDescriptionRunning && <button onClick={() => setShowBulkDescriptions(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Regras personalizadas</label>
              <textarea value={bulkDescriptionRules} onChange={e => setBulkDescriptionRules(e.target.value)} rows={7} disabled={bulkDescriptionRunning}
                placeholder="Ex.: Começar com uma abordagem comercial específica; destacar especificações; informar garantia e exclusões..."
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-y disabled:opacity-60" />
              <p className="text-[11px] text-muted-foreground mt-1">A regra será aplicada a todos os produtos selecionados. A IA não deve inventar especificações nem mencionar nota fiscal.</p>
            </div>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" checked={bulkDescriptionOverwrite} onChange={e => setBulkDescriptionOverwrite(e.target.checked)} disabled={bulkDescriptionRunning} className="accent-primary mt-0.5" />
              <span><span className="block">Sobrescrever descrições existentes</span><span className="block text-[11px] text-muted-foreground">Desmarcado: gera apenas para produtos sem descrição.</span></span>
            </label>
            {bulkDescriptionRunning && (
              <div className="space-y-2">
                <Progress value={bulkDescriptionProgress.total ? (bulkDescriptionProgress.done / bulkDescriptionProgress.total) * 100 : 0} className="h-2" />
                <p className="text-xs text-muted-foreground">{bulkDescriptionProgress.done}/{bulkDescriptionProgress.total} concluídos{bulkDescriptionProgress.failed ? ` · ${bulkDescriptionProgress.failed} falharam` : ''}</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              {bulkDescriptionRunning ? (
                <button onClick={cancelBulkDescriptionGeneration} className="rounded-lg bg-destructive/15 text-destructive px-4 py-2 text-sm font-medium">Interromper</button>
              ) : (
                <>
                  <button onClick={() => setShowBulkDescriptions(false)} className="rounded-lg bg-secondary text-foreground px-4 py-2 text-sm font-medium">Cancelar</button>
                  <button onClick={handleBulkDescriptionGeneration} className="rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium"><Sparkles className="inline h-4 w-4 mr-1" />Iniciar geração</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

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

      {/* Configuração do import: fornecedor + tipo de preço */}
      {importStep === 'config' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-background p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Configurar importação{importFileName ? ` — ${importFileName}` : ''}
            </h3>
            <p className="text-xs text-muted-foreground">Os preços deste catálogo pertencem a qual fornecedor e são de custo ou de revenda? Se o fornecedor não existir, ele será cadastrado automaticamente na aba Fornecedores.</p>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Nome do fornecedor</label>
              <input
                list="supplier-suggestions"
                value={importSupplierName}
                onChange={e => setImportSupplierName(e.target.value)}
                placeholder="Ex: Multimais, Celular BH..."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <datalist id="supplier-suggestions">
                {suppliers.map(s => <option key={s.id} value={s.name} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Os preços do arquivo são de:</label>
              <div className="flex gap-2 flex-wrap">
                {([
                  { v: 'cost', label: 'Preço de custo', hint: '(quanto você paga ao fornecedor)' },
                  { v: 'resale', label: 'Preço de revenda', hint: '(quanto você cobra na loja)' },
                  { v: 'both', label: 'Os dois', hint: '(custo = revenda por enquanto)' },
                ] as const).map(opt => (
                  <label key={opt.v} className={`flex-1 min-w-[140px] flex items-start gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${importPriceType === opt.v ? 'border-primary bg-primary/10 text-foreground font-medium' : 'border-border bg-secondary text-muted-foreground'}`}>
                    <input type="radio" name="price-type" checked={importPriceType === opt.v} onChange={() => setImportPriceType(opt.v)} className="accent-primary mt-0.5" />
                    <span>
                      <span className="block">{opt.label}</span>
                      <span className="block text-[10px] opacity-70">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {importPriceType === 'cost' && (
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
                <div>
                  <label className="block text-[10px] font-bold text-primary uppercase mb-1">Margem de Lucro (%)</label>
                  <div className="relative">
                    <input type="number" value={importProfitMargin} onChange={e => setImportProfitMargin(e.target.value)} 
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:ring-primary pr-8" />
                    <span className="absolute right-3 top-2 text-xs text-muted-foreground">%</span>
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-1">Revenda = Custo + %</p>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-primary uppercase mb-1">Frete por item (R$)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-xs text-muted-foreground">R$</span>
                    <input type="number" value={importShippingFee} onChange={e => setImportShippingFee(e.target.value)} 
                      className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-2 text-sm text-foreground focus:ring-primary" />
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-1">Soma ao custo antes da margem</p>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={handleStartParsing} className="flex-1 items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium">
                <Sparkles className="h-4 w-4" /> Analisar com IA
              </button>
              <button onClick={() => { setImportStep('idle'); setImportRawText(''); setImportFileName(''); setImportSupplierName(''); }} className="flex-1 items-center gap-1 rounded-lg bg-secondary text-muted-foreground px-4 py-2 text-sm">
                <X className="h-4 w-4" /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Parsing state */}
      {importStep === 'parsing' && (
        <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-foreground">Analisando arquivo com IA...{importSupplierName ? ` Fornecedor: ${importSupplierName} · Preço: ${importPriceType === 'cost' ? 'custo' : importPriceType === 'resale' ? 'revenda' : 'custo e revenda'}` : ''}</span>
        </div>
      )}

      {/* Preview parsed products */}
      {importStep === 'preview' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-background p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> {parsedProducts.length} produtos encontrados
            </h3>
            {parsedProducts.some(p => p.needs_price_review || (p.variants || []).some(v => Number(v.cost_price || 0) > Number(p.cost_price || 0))) && (
              <p className="text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-600 px-3 py-2">⚠ Há variações com custo diferente. O menor custo será a base; revise os preços sinalizados depois da importação.</p>
            )}
            <div className="max-h-60 overflow-y-auto space-y-2 border rounded-lg p-2">
              {parsedProducts.map((p, i) => (
                <div key={i} className="flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium text-foreground">{p.name}</span>
                    <span className="text-muted-foreground ml-2">· {p.category}</span>
                  </div>
                    <div className="text-right">
                      <span className="text-primary font-medium">R${p.price.toFixed(2)}</span>
                      {(p.variants || []).length > 0 && <div className="text-[10px] text-muted-foreground">{(p.variants || []).map(v => v.name).join(', ')}</div>}
                      {(p.needs_price_review || (p.variants || []).some(v => Number(v.cost_price || 0) > Number(p.cost_price || 0))) && <div className="text-[10px] text-amber-600 font-bold">⚠ revisar variações</div>}
                    </div>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" checked={generateImages} onChange={e => setGenerateImages(e.target.checked)} className="accent-primary" />
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Gerar imagens por IA (no servidor — pode fechar o navegador)
            </label>
            <div className="flex gap-2">
              <button onClick={handleImportConfirm} className="flex-1 items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm">
                <Check className="h-4 w-4" /> Importar {parsedProducts.length} produtos
              </button>
              <button onClick={() => { setImportStep('idle'); setParsedProducts([]); }} className="flex-1 items-center gap-1 rounded-lg bg-secondary text-muted-foreground px-4 py-2 text-sm">
                <X className="h-4 w-4" /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Importing progress */}
      {importStep === 'importing' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-background p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Importando {importProgress}/{importTotal}...{importSupplierName ? ` · ${importSupplierName}` : ''}
              </div>
              {!importCancelled && (
                <button
                  onClick={handleCancelImport}
                  className="text-xs rounded-md bg-destructive/15 text-destructive hover:bg-destructive/25 px-2 py-1 font-medium inline-flex items-center gap-1"
                  title="Interrompe a importação após o item atual"
                >
                  <X className="h-3 w-3" /> Interromper
                </button>
              )}
            </div>
            <Progress value={(importProgress / importTotal) * 100} className="h-2" />
            <p className="text-[10px] text-muted-foreground text-center">Processando itens em segundo plano...</p>
          </div>
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
          <CategoryTreeSelect
            tenantId={tenantId}
            value={(form as any).subcategory_ids || []}
            onChange={(path) => {
              const rootName = path.length ? nodesById[path[0]]?.name || form.category : '';
              setForm({ ...form, category: rootName || form.category, subcategory_ids: path } as any);
            }}
          />
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

      {visibleProducts.map(p => (
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
      {products.length > 0 && visibleProducts.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhum produto encontrado para “{catalogSearch}”.</p>
      )}
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
  const [activeSubTab, setActiveSubTab] = useState<'info' | 'suppliers'>('info');
  const supplierName = suppliers.find(s => s.id === product.supplier_id)?.name;
  const pendingReq = feeRequests.find(r => r.status === 'pending');
  const { data: variants = [] } = useProductVariants(product.id);
  const variantPrices = variants.map(variant => ({
    ...variant,
    salePrice: Number(variant.suggested_price ?? (Number(product.price) + Number(variant.price_delta))) || 0,
    costPrice: Number(variant.cost_price ?? (product as any).original_price) || 0,
  }));

  // Preços de outros fornecedores para este produto
  const [otherPrices, setOtherPrices] = useState<{ supplier_id: string; supplier_name: string; unit_price: number; price_types: string[]; description?: string; variations?: any }[]>([]);
  const [loadingPrices, setLoadingPrices] = useState(false);

  const fetchPrices = useCallback(() => {
    if (!product.name) return;
    setLoadingPrices(true);
    supabase
      .from('supplier_product_prices')
      .select('supplier_id, unit_price, price_types, description, variations, suppliers(name)')
      .ilike('product_name', product.name.trim())
      .eq('available', true)
      .then(({ data }) => {
        setOtherPrices((data || []).map((d: any) => ({
          supplier_id: d.supplier_id,
          supplier_name: d.suppliers?.name || 'Fornecedor',
          unit_price: Number(d.unit_price),
          price_types: Array.isArray(d.price_types) ? d.price_types : [],
          description: d.description,
          variations: d.variations,
        })));
        setLoadingPrices(false);
      });
  }, [product.name]);

  useEffect(() => {
    if (activeSubTab === 'suppliers') fetchPrices();
  }, [activeSubTab, fetchPrices]);

  const handleDissociate = async (supplierId: string) => {
    const { error } = await supabase
      .from('supplier_product_prices')
      .delete()
      .eq('supplier_id', supplierId)
      .ilike('product_name', product.name.trim());
    
    if (error) toast.error('Erro ao desassociar fornecedor');
    else {
      toast.success('Fornecedor desassociado');
      fetchPrices();
    }
  };

  const handleGenerateDesc = async () => {
    if (generatingDesc) return;
    setGeneratingDesc(true);
    try {
      const { data, error } = await unifiedInvoke("ai-media-unified", "describe", {
          name: form.name,
          category: form.category,
          network: (form as any).affiliate_network || null,
          currentDescription: form.description,
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
        
        <div className="flex gap-1 border-b border-border mb-2">
          <button type="button" onClick={() => setActiveSubTab('info')} className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-all ${activeSubTab === 'info' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>Informações</button>
          <button type="button" onClick={() => setActiveSubTab('suppliers')} className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-all ${activeSubTab === 'suppliers' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>Fornecedores</button>
        </div>

        {activeSubTab === 'info' && (
          <>
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
        <div className="space-y-2">
          <CategoryTreeSelect
            tenantId={tenantId}
            value={(form as any).subcategory_ids || []}
            onChange={(path) => {
              // mantém a raiz em `category` (compatibilidade) e o caminho em `subcategory_ids`
              const rootName = path.length ? nodesById[path[0]]?.name || form.category : '';
              setForm({ ...form, category: rootName || form.category, subcategory_ids: path } as any);
            }}
          />
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
          </>
        )}

        {activeSubTab === 'suppliers' && (
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">Fornecedores que possuem este produto cadastrado:</p>
            {loadingPrices ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
            ) : otherPrices.length === 0 ? (
              <div className="text-center py-4 text-xs text-muted-foreground bg-secondary/30 rounded-lg border border-dashed border-border">
                Nenhum fornecedor com este preço cadastrado.
                <br/>Suba um catálogo TXT na aba "Importar" informando o fornecedor.
              </div>
            ) : (
              <div className="space-y-2">
                {otherPrices.sort((a,b) => a.unit_price - b.unit_price).map((op, idx) => (
                  <div key={op.supplier_id} className={`flex items-center justify-between p-2 rounded-lg border ${op.supplier_id === form.supplier_id ? 'bg-primary/10 border-primary/30' : 'bg-secondary border-border'}`}>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-foreground truncate">{op.supplier_name}</p>
                      <p className="text-[10px] text-muted-foreground">{op.price_types.includes('cost') ? 'Preço de custo' : 'Preço de revenda'}</p>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <span className={`text-xs font-mono font-bold ${idx === 0 ? 'text-emerald-400' : 'text-foreground'}`}>R$ {op.unit_price.toFixed(2)}</span>
                      <div className="flex gap-1">
                        {op.supplier_id !== form.supplier_id ? (
                          <button type="button" onClick={() => setForm({ ...form, supplier_id: op.supplier_id, original_price: op.unit_price } as any)} 
                            className="text-[10px] bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-90"
                            title="Definir como fornecedor principal deste produto">Principal</button>
                        ) : (
                          <span className="text-[10px] text-primary font-bold px-2 py-1">⭐</span>
                        )}
                        <button type="button" onClick={() => handleDissociate(op.supplier_id)}
                          className="text-[10px] bg-destructive/10 text-destructive px-2 py-1 rounded hover:bg-destructive/20"
                          title="Remover associação deste fornecedor com este produto">Remover</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="pt-2 border-t border-border">
              <label className="text-[10px] text-muted-foreground block mb-1">Fornecedor principal manual:</label>
              <select value={form.supplier_id || ''} onChange={e => setForm({ ...form, supplier_id: e.target.value || null })} className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
                <option value="">Sem fornecedor</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
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
          <button onClick={() => onSave({ ...form, subcategory_ids: (form as any).subcategory_ids || null, media } as any)} className="flex items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-3 py-1.5 text-sm"><Check className="h-3 w-3" /> Salvar</button>
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
            {(product as any).original_price > 0 && (
              <>
                <span className="text-muted-foreground"> (custo: R${(product as any).original_price.toFixed(2)})</span>
                {(() => {
                  const price = product.price || 0;
                  const cost = (product as any).original_price || 0;
                  const profit = price - cost;
                  const margin = price > 0 ? (profit / price) * 100 : 0;
                  const isLow = margin < 15;
                  return (
                    <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${isLow ? 'bg-destructive/20 text-destructive' : 'bg-green-500/20 text-green-500'}`}>
                      {isLow ? <AlertTriangle className="h-3 w-3 inline mr-1" /> : null}
                      Margem: {margin.toFixed(0)}% (R${profit.toFixed(2)})
                    </span>
                  );
                })()}
              </>
            )}
            {(product as any).platform_fee_percent != null && <span className="text-primary"> · Taxa: {(product as any).platform_fee_percent}%</span>}
            {(product as any).stock_quantity != null && <span className="text-primary"> · Estoque: {(product as any).stock_quantity}</span>}
            {!product.in_stock && <span className="text-destructive"> · Esgotado</span>}
            {supplierName && <span className="text-primary"> · {supplierName}</span>}
            {(product as any).auto_categorize === false && <span className="text-muted-foreground"> · 🚫 IA off</span>}
          </p>
          {variantPrices.length > 0 && (
            <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary/80">Preço por cor</p>
              {variantPrices.map(variant => (
                <p key={variant.id} className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium text-foreground">{variant.name}</span>
                  <span>Custo: {variant.costPrice > 0 ? `R$${variant.costPrice.toFixed(2)}` : '—'}</span>
                  <span className="text-primary">Revenda: R${variant.salePrice.toFixed(2)}</span>
                </p>
              ))}
            </div>
          )}
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

      {/* Editor de variáveis e adicionais — disponível em todos os catálogos */}
      <ProductExtrasEditor productId={product.id} tenantId={tenantId} basePrice={Number(product.price) || 0} />
    </div>
  );
};

export default TenantAdminProducts;
