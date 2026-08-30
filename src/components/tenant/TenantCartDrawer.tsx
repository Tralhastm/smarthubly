import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart, getCartLineUnitPrice } from '@/contexts/CartContext';
import { useAddOrder } from '@/hooks/useOrders';
import { useCreateAppointment } from '@/hooks/useAppointments';
import { buildWhatsAppMessage, sanitizeWhatsAppNumber } from '@/lib/store';
import { productMatchKey } from '@/lib/product-match';
import { PENDING_PAYMENT_STATUS } from '@/lib/order-status';
import { supabase } from '@/integrations/supabase/client';
import { logOrderEvent } from '@/lib/order-events';
import { validateCoupon, incrementCouponUse, incrementSellerCodeUse, type Coupon } from '@/hooks/useCoupons';

import CepAddressInput from './CepAddressInput';
import { estimateFreight, type FreightEstimate } from '@/lib/freight-viacep';
import SchedulingSlotPicker from './SchedulingSlotPicker';
import type { Tenant } from '@/hooks/useTenants';
import { ShoppingCart, X, Plus, Minus, Trash2, MessageCircle, CreditCard, MapPin, Loader2, ExternalLink, Tag, CheckCircle2, CalendarClock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { unifiedInvoke } from "@/lib/unifiedInvoke";

type SupplierShipping = {
  id: string;
  address: string;
  shipping_base_fee: number;
  shipping_base_radius_km: number;
  shipping_per_km_fee: number;
  shipping_max_fee?: number | null;
  delivery_max_radius_km?: number;
};

const TenantCartDrawer = ({ tenant }: { tenant: Tenant }) => {
  const { items, removeFromCart, updateQuantity, clearCart, total, itemCount, decrementStock } = useCart();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'cart' | 'checkout'>('cart');
  // Modo da loja determina se aceita delivery e/ou pickup
  const storeMode = ((tenant as any).store_mode as string) || 'delivery';
  const pickupEnabledFlag = (tenant as any).pickup_enabled ?? true;
  // Retirada quando não há motoboy: o lojista pode desativar o fallback de retirada.
  // Quando desativado, o pedido de delivery segue mesmo sem motoboy online
  // (cliente organiza a própria entrega, ex.: Uber Moto) — o frete calculado é cobrado.
  const pickupAsFallback = (tenant as any).pickup_as_delivery_fallback ?? true;
  const isLocalOnly = storeMode === 'local';
  const isAffiliate = storeMode === 'affiliate';
  const isDropshipping = storeMode === 'dropshipping';
  // Modo WhatsApp: pedido é fechado pelo WhatsApp, sem pagamento no site
  const isWhatsAppMode = storeMode === 'whatsapp' || storeMode === 'supermarket';
  // Número de contato oficial da loja (config do storefront tem prioridade), já limpo pro wa.me
  const waNumber = sanitizeWhatsAppNumber(
    ((tenant as any).storefront_config?.contact_whatsapp as string) || tenant.whatsapp || (tenant as any).phone
  );
  const showPixToCustomer = isWhatsAppMode && !!(tenant as any).whatsapp_show_pix && !!(tenant as any).pix_key;
  const [waConfirm, setWaConfirm] = useState(false);
  // delivery permitido em todos os modos exceto 'local' e 'affiliate'
  const allowsDelivery = !isLocalOnly && !isAffiliate;
  // pickup permitido em 'local', 'hybrid' sempre; em 'delivery' depende do flag; em 'dropshipping' nunca
  const allowsPickup = isLocalOnly || storeMode === 'hybrid' || isWhatsAppMode || (storeMode === 'delivery' && pickupEnabledFlag);
  const [deliveryType, setDeliveryType] = useState<'delivery' | 'pickup'>(isLocalOnly || !allowsDelivery ? 'pickup' : 'delivery');
  const [distance, setDistance] = useState<number | null>(null);
  const [originDistances, setOriginDistances] = useState<Record<string, number>>({});
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [_calculatingDistance, _setCalculatingDistance] = useState(false);
  const [creatingPayment, setCreatingPayment] = useState(false);
  const [distanceError, setDistanceError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('pix');
  const [changeFor, setChangeFor] = useState('');
  // Pagamento online (MercadoPago ou PagBank) — flag derivada da view pública (não expõe o token).
  const hasOnlinePayment = !isWhatsAppMode && !!((tenant as any).has_online_payment ?? (tenant as any).mercadopago_token ?? (tenant as any).pagbank_token);

  
  const [name, setName] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lastCustomer:' + tenant.slug) || '{}')?.name || ''; } catch { return ''; }
  });
  const [phone, setPhone] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lastCustomer:' + tenant.slug) || '{}')?.phone || ''; } catch { return ''; }
  });
  const [email, setEmail] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lastCustomer:' + tenant.slug) || '{}')?.email || ''; } catch { return ''; }
  });
  const [address, setAddress] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lastCustomer:' + tenant.slug) || '{}')?.address || ''; } catch { return ''; }
  });
  // Persiste os dados do cliente a cada alteração (lembrar dados do checkout)
  useEffect(() => {
    if (!name && !phone && !email && !address) return;
    try { localStorage.setItem('lastCustomer:' + tenant.slug, JSON.stringify({ name, phone, email, address })); } catch { /* ignore */ }
  }, [name, phone, email, address, tenant.slug]);
  const requireEmail = !!(tenant as any).require_customer_email;
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [couponMsg, setCouponMsg] = useState('');
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  // ===== Cotação dinâmica de entrega (Lalamove → motoboy → retirada) =====
  const [deliveryCheck, setDeliveryCheck] = useState<{
    has_delivery: boolean;
    pickup_address: string;
    lalamove_failed: boolean;
    driver_offline: boolean;
    options: Array<{ method: string; fee: number; available: boolean; label: string; eta?: string; origin?: string }>;
  } | null>(null);
  const [checkingDelivery, setCheckingDelivery] = useState(false);
  const [showPickupOnlyModal, setShowPickupOnlyModal] = useState(false);
  const [pickupOnlyConfirmed, setPickupOnlyConfirmed] = useState(false);
  // Estimativa ViaCEP (apenas modo dropshipping)
  const [freightEstimate, setFreightEstimate] = useState<FreightEstimate | null>(null);
  // Agendamento: data/hora escolhida pro serviço
  const [scheduledStart, setScheduledStart] = useState<Date | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const addOrderMutation = useAddOrder();
  const createAppointmentMutation = useCreateAppointment();
  const [cartSessionId, setCartSessionId] = useState<string | null>(null);

  // ===== Tracking de carrinho abandonado (#4) =====
  // Faz upsert da sessão do carrinho quando há telefone + itens, debounced.
  // Marca converted_order_id após sucesso pra não enviar cupom.
  useEffect(() => {
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10 || items.length === 0 || total <= 0) return;
    if (!(tenant as any).auto_abandon_coupon) return;
    const t = setTimeout(async () => {
      try {
        const itemsSummary = items.map(i => ({ name: i.product.name, qty: i.quantity, price: getCartLineUnitPrice(i) }));
        if (cartSessionId) {
          await supabase.from('cart_sessions').update({
            customer_name: name || '',
            items: itemsSummary as any,
            total,
            last_activity_at: new Date().toISOString(),
          }).eq('id', cartSessionId);
        } else {
          const { data, error } = await supabase.from('cart_sessions').insert({
            tenant_id: tenant.id,
            customer_phone: phoneDigits,
            customer_name: name || '',
            items: itemsSummary as any,
            total,
          }).select('id').single();
          if (!error && data?.id) setCartSessionId(data.id);
        }
      } catch (e) { /* tracking falha em silêncio, não bloqueia checkout */ }
    }, 4000);
    return () => clearTimeout(t);
  }, [phone, name, items, total, tenant.id, cartSessionId]);

  // ===== Detecta itens agendáveis (serviços) e soma duração =====
  const serviceItems = useMemo(
    () => items.filter(i => (i.product as any).item_type === 'service'),
    [items],
  );
  const hasServices = serviceItems.length > 0;
  const totalServiceDuration = useMemo(
    () => serviceItems.reduce((sum, i) => {
      const dur = (i.product as any).duration_minutes ?? 0;
      return sum + dur * i.quantity;
    }, 0),
    [serviceItems],
  );
  const schedulingConfig = {
    scheduling_enabled: (tenant as any).scheduling_enabled ?? false,
    scheduling_open_days: (tenant as any).scheduling_open_days,
    scheduling_open_time: (tenant as any).scheduling_open_time,
    scheduling_close_time: (tenant as any).scheduling_close_time,
    scheduling_slot_minutes: (tenant as any).scheduling_slot_minutes,
    scheduling_capacity: (tenant as any).scheduling_capacity ?? 1,
  };
  const needsScheduling = hasServices && schedulingConfig.scheduling_enabled && totalServiceDuration > 0;
  // Quando há mais de 1 serviço diferente, ignoramos o limite por-serviço (usa só teto da loja).
  // Quando há um único serviço (caso comum: cliente está marcando UMA coisa), aplicamos o max_concurrent dele.
  const singleService = serviceItems.length === 1 ? (serviceItems[0].product as any) : null;
  const slotServiceMaxConcurrent: number | null = singleService?.max_concurrent ?? null;
  const slotServiceProductId: string | null = singleService?.id ?? null;

  // Calculate platform fee
  const tenantFeePercent = (tenant as any).platform_fee_percent ?? 0;
  const feeMode = (tenant as any).fee_mode ?? 'margin';
  const feeSplitStorePercent = (tenant as any).fee_split_store_percent ?? 50;
  const billingMode = (tenant as any).billing_mode ?? 'per_order';
  const isMonthlyFixed = billingMode === 'monthly_fixed';
  const isDonated = (tenant as any).is_donated === true;

  // Lojas em mensalidade fixa OU doadas NÃO pagam taxa por pedido.
  // Calcula taxa sobre o preço unitário da linha (já inclui variante + adicionais).
  const platformFee = (isMonthlyFixed || isDonated) ? 0 : items.reduce((sum, item) => {
    const lineTotal = getCartLineUnitPrice(item) * item.quantity;
    const productFee = (item.product as any).platform_fee_percent;
    if (productFee != null && productFee > 0) {
      return sum + (lineTotal * productFee / 100);
    }
    if (tenantFeePercent > 0) {
      return sum + (lineTotal * tenantFeePercent / 100);
    }
    return total > 0 ? sum + (lineTotal / total * tenant.platform_fee) : sum;
  }, 0);

  // Customer-visible fee based on fee_mode
  const customerFee = feeMode === 'margin' ? 0
    : feeMode === 'price' ? platformFee
    : platformFee * (100 - feeSplitStorePercent) / 100;

  const shippingEnabled = (tenant as any).shipping_enabled ?? false;
  // Carrega dados de frete dos fornecedores envolvidos no carrinho (dropshipping)
  // Declarado antes de productNeedsShipping para que ele possa consultar a tabela do fornecedor
  const [supplierShippings, setSupplierShippings] = useState<Record<string, SupplierShipping>>({});
  const [resolvedSupplierIds, setResolvedSupplierIds] = useState<Record<string, string>>({});

  // Um produto só entra no frete quando foi marcado manualmente no admin.
  // A tabela do fornecedor continua sendo usada apenas para calcular o valor,
  // mas não para ativar o frete sozinha.
  const productNeedsShipping = (product: any): boolean => {
    // PostgREST pode entregar booleanos legados como strings; "false" não
    // pode ser tratado como true pelo operador !!.
    return product.has_shipping === true || product.has_shipping === 1 || product.has_shipping === 'true';
  };

  const hasShippingItems = shippingEnabled && items.some(i => productNeedsShipping(i.product));
  const allItemsHaveShipping = shippingEnabled && items.length > 0 && items.every(i => productNeedsShipping(i.product));

  // Carrega dados de frete dos fornecedores envolvidos no carrinho (dropshipping)
  useEffect(() => {
    if (items.length === 0) { setSupplierShippings({}); setResolvedSupplierIds({}); return; }
    let cancelled = false;
    (async () => {
      // Busca fornecedores da própria loja e resolve ofertas mesmo quando o
      // produto importado ainda não possui supplier_id preenchido.
      const { data: tenantSuppliers } = await (supabase as any)
        .from('suppliers_public')
        .select('id, tenant_id')
        .eq('tenant_id', tenant.id);
      const tenantSupplierIds = (tenantSuppliers || []).map((s: any) => s.id).filter(Boolean);
      const { data: prices } = tenantSupplierIds.length > 0
        ? await (supabase as any).from('supplier_product_prices').select('supplier_id, product_name, unit_price').in('supplier_id', tenantSupplierIds).eq('available', true)
        : { data: [] };
      const best = new Map<string, { supplier_id: string; unit_price: number }>();
      (prices || []).forEach((p: any) => {
        const key = productMatchKey(p.product_name);
        const current = best.get(key);
        if (!current || Number(p.unit_price) < current.unit_price) best.set(key, { supplier_id: p.supplier_id, unit_price: Number(p.unit_price) });
      });
      const resolved: Record<string, string> = {};
      items.forEach(i => {
        const explicit = (i.product as any).supplier_id;
        const chosen = explicit || best.get(productMatchKey(i.product.name))?.supplier_id;
        if (chosen) resolved[productMatchKey(i.product.name)] = chosen;
      });
      const ids = Array.from(new Set([...Object.values(resolved), ...items.map(i => (i.product as any).supplier_id).filter(Boolean)]));
      const { data } = ids.length > 0 ? await (supabase as any)
        .from('suppliers_public')
        .select('id, address, shipping_base_fee, shipping_base_radius_km, shipping_per_km_fee, shipping_max_fee, delivery_max_radius_km')
        .in('id', ids) : { data: [] };
      if (cancelled || !data) return;
      setResolvedSupplierIds(resolved);
      const map: Record<string, SupplierShipping> = {};
      (data as any[]).forEach(s => {
        map[s.id] = {
          id: s.id,
          address: s.address || '',
          shipping_base_fee: Number(s.shipping_base_fee ?? 0),
          shipping_base_radius_km: Number(s.shipping_base_radius_km ?? 5),
          shipping_per_km_fee: Number(s.shipping_per_km_fee ?? 0),
          shipping_max_fee: s.shipping_max_fee != null ? Number(s.shipping_max_fee) : null,
          delivery_max_radius_km: Number(s.delivery_max_radius_km ?? 0),
        } as any;
      });
      setSupplierShippings(map);
    })();
    return () => { cancelled = true; };
  }, [items]);

  const getProductOrigin = (product: any): string => {
    // Prioridade: override explícito > endereço do fornecedor > origem da loja > endereço da loja
    if (product.shipping_origin_override) return product.shipping_origin_override;
    const supplierId = product.supplier_id || resolvedSupplierIds[productMatchKey(product.name)];
    if (supplierId && supplierShippings[supplierId]?.address) {
      return supplierShippings[supplierId].address;
    }
    return (tenant as any).shipping_origin_address || tenant.address;
  };
  const primaryShippingOrigin = isDropshipping
    ? getProductOrigin(items.find(i => productNeedsShipping(i.product))?.product || {})
    : ((tenant as any).shipping_origin_address || tenant.address);

  // Compute shipping using per-product origin distances + tabela do fornecedor (se houver)
  const computeShippingFee = (): number => {
    if (!hasShippingItems || deliveryType !== 'delivery') return 0;
    // No dropshipping, o frete já é colocado em deliveryFee após a estimativa
    // CEP→CEP. Não somar novamente a tabela aqui.
    if (isDropshipping) return 0;
    const tenantBaseFee = (tenant as any).shipping_base_fee ?? 0;
    const tenantBaseRadius = (tenant as any).shipping_base_radius_km ?? 5;
    const tenantPerKmFee = (tenant as any).shipping_per_km_fee ?? 0;
    const tenantMaxFee = (tenant as any).shipping_max_fee ?? null;

    let totalShipping = 0;
    items.forEach(i => {
      if (!productNeedsShipping(i.product)) return;
      const override = (i.product as any).shipping_fee_override;
      if (override != null && override > 0) {
        totalShipping += override * i.quantity;
        return;
      }
      const supplierId = (i.product as any).supplier_id || resolvedSupplierIds[productMatchKey(i.product.name)];
      const sup = supplierId ? supplierShippings[supplierId] : null;
      const baseFee = sup ? sup.shipping_base_fee : tenantBaseFee;
      const baseRadius = sup ? sup.shipping_base_radius_km : tenantBaseRadius;
      const perKmFee = sup ? sup.shipping_per_km_fee : tenantPerKmFee;

      if (baseFee <= 0 && perKmFee <= 0) return;

      const origin = getProductOrigin(i.product);
      const distKm = originDistances[origin] ?? distance ?? 0;
      let fee = distKm <= baseRadius ? baseFee : baseFee + (distKm - baseRadius) * perKmFee;
      // Aplica teto opcional: fornecedor tem prioridade, senão usa o da loja
      const supMax = (sup as any)?.shipping_max_fee ?? null;
      const cap = supMax != null ? Number(supMax) : (tenantMaxFee != null ? Number(tenantMaxFee) : null);
      if (cap != null && cap > 0 && fee > cap) fee = cap;
      totalShipping += fee * i.quantity;
    });
    return totalShipping;
  };

  // Cotação courier externo (Lalamove ou Uber Direct) em tempo real (porta a porta).
  // O frete do fornecedor (tabela base + por km) é o que ELE cobra pelo
  // manuseio/origem — sempre soma, independente de quem leva. Courier é só
  // transporte; não substitui o frete cobrado pelo fornecedor.
  const courierQuote = isDropshipping ? null : deliveryCheck?.options?.find(o => (o.method === 'lalamove' || o.method === 'uber_direct') && o.available);
  const useLalamoveQuote = !!courierQuote && deliveryType === 'delivery';
  const shippingFee = computeShippingFee();
  const effectiveDeliveryFee = useLalamoveQuote
    ? (courierQuote!.fee || 0)
    : (allItemsHaveShipping ? 0 : deliveryFee);
  const subtotalForCoupon = total + (deliveryType === 'delivery' ? effectiveDeliveryFee : 0) + customerFee + shippingFee;
  const discountAmount = appliedCoupon
    ? (appliedCoupon.discount_type === 'percent'
        ? Math.min(subtotalForCoupon * appliedCoupon.discount_value / 100, subtotalForCoupon)
        : Math.min(appliedCoupon.discount_value, subtotalForCoupon))
    : 0;
  const finalTotal = Math.max(0, subtotalForCoupon - discountAmount);

  const applyCoupon = async () => {
    setCouponMsg('');
    setValidatingCoupon(true);
    try {
      const res = await validateCoupon(tenant.id, couponInput, total);
      if (!res.valid) {
        setAppliedCoupon(null);
        setCouponMsg(res.reason || 'Cupom inválido');
      } else {
        setAppliedCoupon(res.coupon!);
        setCouponMsg(`✅ Cupom aplicado: -R$${res.discount.toFixed(2)}`);
      }
    } finally {
      setValidatingCoupon(false);
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
    setCouponInput('');
    setCouponMsg('');
  };

  // Extrai a parte do endereço que realmente afeta distância (rua/número/bairro/cidade/cep).
  // Ignora "Ref:" — assim o cliente pode digitar a referência depois de calcular
  // a taxa sem perder o cálculo nem o botão "Finalizar".
  const distanceKey = (full: string) => full.replace(/\s*-\s*Ref:.*$/i, '').trim();

  const handleAddressChange = useCallback((val: string) => {
    setAddress(prev => {
      if (distanceKey(prev) === distanceKey(val)) return val; // só mudou Ref → preserva cálculo
      setDistance(null);
      setOriginDistances({});
      setDeliveryFee(0);
      setDeliveryCheck(null);
      setDistanceError('');
      setFreightEstimate(null);
      return val;
    });
  }, []);

  const handleDistanceError = useCallback((err: string) => {
    setDistanceError(err);
    setDistance(null);
    setOriginDistances({});
    setDeliveryCheck(null);
    setDeliveryFee(0);
  }, []);

  const handleDistanceCalculated = useCallback(async (distanceKm: number, fee: number, calculatedAddress: string) => {
    setAddress(calculatedAddress);
    setDistance(distanceKm);
    setOriginDistances({});
    setDeliveryFee(fee);
    setDistanceError('');
    setDeliveryCheck(null);
    setPickupOnlyConfirmed(false);

    const tenantOrigin = (tenant as any).shipping_origin_address || tenant.address;
    const uniqueOrigins = new Set<string>();
    items.forEach(i => {
      if (!productNeedsShipping(i.product)) return;
      const origin = getProductOrigin(i.product);
      if (origin && origin !== tenantOrigin) uniqueOrigins.add(origin);
    });

    const distances: Record<string, number> = { [tenantOrigin]: distanceKm };

    if (!isDropshipping && uniqueOrigins.size > 0) {
      _setCalculatingDistance(true);
      const results = await Promise.allSettled(
        Array.from(uniqueOrigins).map(async (origin) => {
          const { data } = await unifiedInvoke("delivery-unified", "distance", { address: calculatedAddress, origin });
          if (data && !data.error) {
            distances[origin] = data.distance_km;
          }
          return { origin, ok: !!(data && !data.error) };
        })
      );
      _setCalculatingDistance(false);
      const anyOk = results.some(r => r.status === 'fulfilled' && (r.value as any).ok);
      if (!anyOk && uniqueOrigins.size > 0) {
        setDistanceError('Não foi possível calcular distância até o fornecedor. Verifique o endereço cadastrado.');
      }
    }
    setOriginDistances(distances);

    setCheckingDelivery(true);
    try {
      // ===== Modo Dropshipping: cotação CEP→CEP via ViaCEP (sem motoboy) =====
      if (isDropshipping) {
        // Em dropshipping, IGNORA a taxa local (per-km) calculada pelo CepAddressInput
        // — o frete real vem do estimate ViaCEP. Zera pra não vazar valor.
        setDeliveryFee(0);
        setFreightEstimate(null);
        const extractCep = (s: string) => {
          const m = (s || '').match(/\d{5}-?\d{3}/);
          return m ? m[0] : '';
        };
        const destCep = extractCep(calculatedAddress);
        // Em dropshipping, a origem cadastrada no fornecedor deve prevalecer
        // sobre a origem da loja (cada produto pode sair de um endereço distinto).
        const supplierOrigin = items
          .filter(i => productNeedsShipping(i.product))
          .map(i => getProductOrigin(i.product))
          .find(Boolean) || '';
        let originCep = extractCep(supplierOrigin);
        // O cliente pode clicar imediatamente após abrir o checkout, antes do
        // carregamento assíncrono de supplierShippings terminar. Nesse caso,
        // busca a origem segura diretamente na view pública para não exibir
        // falsamente "Loja sem CEP".
        if (!originCep && isDropshipping) {
          const { data: fallbackSuppliers } = await (supabase as any)
            .from('suppliers_public')
            .select('id, address')
            .eq('tenant_id', tenant.id);
          const fallbackOrigin = (fallbackSuppliers || []).map((s: any) => s.address || '').find((a: string) => extractCep(a));
          originCep = extractCep(fallbackOrigin || '');
        }
        const tenantCep = (tenant as any).whatsapp_store_cep || extractCep((tenant as any).shipping_origin_address || tenant.address || '');
        const sourceCep = originCep || tenantCep;
        if (destCep && sourceCep) {
          const est = await estimateFreight(sourceCep, destCep);
          if (est) {
            const supplierProduct = items.find(i => productNeedsShipping(i.product));
            const supplierId = supplierProduct
              ? ((supplierProduct.product as any).supplier_id || resolvedSupplierIds[productMatchKey(supplierProduct.product.name)])
              : null;
            const supplierConfig = supplierId ? supplierShippings[supplierId] : null;
            const baseFee = supplierConfig?.shipping_base_fee ?? 0;
            const baseRadius = supplierConfig?.shipping_base_radius_km ?? 0;
            const perKm = supplierConfig?.shipping_per_km_fee ?? 0;
            const maxFee = supplierConfig?.shipping_max_fee;
            const tableFee = supplierConfig && baseFee > 0
              ? Math.min(
                  maxFee != null && maxFee > 0 ? maxFee : Number.POSITIVE_INFINITY,
                  est.distanceKm <= baseRadius ? baseFee : baseFee + (est.distanceKm - baseRadius) * perKm,
                )
              : est.pac;
            setFreightEstimate(est);
            setDeliveryFee(Math.round(tableFee * 100) / 100);
            setDeliveryCheck(null);
            setDistanceError('');
          } else {
            setDistanceError('Não foi possível estimar o frete pra esse CEP. Tente novamente.');
          }
        } else if (!sourceCep) {
          setDistanceError('Loja sem CEP de origem cadastrado. Avise o vendedor.');
        } else if (!destCep) {
          setDistanceError('CEP de destino inválido.');
        }
      } else {
        const supplierIds = Array.from(new Set(
          items
            .filter(i => productNeedsShipping(i.product))
            .map(i => (i.product as any).supplier_id || resolvedSupplierIds[productMatchKey(i.product.name)])
            .filter(Boolean)
        ));
        const { data, error } = await unifiedInvoke("delivery-unified", "quote", { tenantId: tenant.id, customerAddress: calculatedAddress, supplierIds });
        if (!error && data && !data.error) {
          setDeliveryCheck(data);
          const courierOpt = data.options?.find((o: any) => (o.method === 'lalamove' || o.method === 'uber_direct') && o.available);
          const driverOpt = data.options?.find((o: any) => o.method === 'driver' && o.available);
          if (courierOpt && typeof courierOpt.fee === 'number') {
            setDeliveryFee(courierOpt.fee);
          } else if (driverOpt && typeof driverOpt.fee === 'number') {
            setDeliveryFee(driverOpt.fee);
            if (typeof driverOpt.distance_km === 'number') {
              setDistance(driverOpt.distance_km);
            }
          }
          if (data.has_delivery === false) {
            if (pickupAsFallback) setShowPickupOnlyModal(true);
            else if (typeof distance !== 'number') {
              // Sem motoboy e sem distância calculada: usar a distância do cálculo como estimativa
              setDistance((data as any).distance_km ?? null);
            }
          }
        }
      }
    } catch { /* fallback silencioso pra não bloquear o checkout */ }
    finally { setCheckingDelivery(false); }
  }, [items, tenant, isDropshipping]);

  const submitOrder = async (viaWhatsApp: boolean, payOnline = false, simulateApproved = false, waAlreadySent = false) => {
    if (deliveryType === 'delivery' && checkingDelivery) {
      toast({ title: 'Aguarde o cálculo do frete', description: 'Estamos validando a disponibilidade de motoboys para calcular o valor correto.', variant: 'destructive' });
      return;
    }
    const needsDistance = deliveryType === 'delivery' && !isDropshipping;
    if (!name || !phone || (deliveryType === 'delivery' && !address) || (needsDistance && distance === null)) {
      toast({ title: needsDistance && distance === null ? 'Calcule a distância primeiro' : 'Preencha todos os campos', variant: 'destructive' });
      return;
    }
    // Valida agendamento se o pedido contém serviços
    if (needsScheduling && !scheduledStart) {
      toast({ title: 'Escolha um horário', description: 'Selecione data e hora pro seu serviço.', variant: 'destructive' });
      return;
    }
    // Valida telefone: precisa ter DDD + 9 dígitos (10 ou 11 dígitos no total)
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      toast({ title: 'Telefone inválido', description: 'Digite o telefone com DDD. Ex: (31) 99999-9999', variant: 'destructive' });
      return;
    }
    if (requireEmail) {
      const emailTrim = email.trim();
      if (!emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
        toast({ title: 'E-mail obrigatório', description: 'Esta loja exige um e-mail válido para enviar atualizações do pedido.', variant: 'destructive' });
        return;
      }
    }

    // Bloqueia delivery fora do raio máximo configurado pela loja ou pelos fornecedores
    if (deliveryType === 'delivery' && distance != null) {
      const tenantMaxRadius = Number((tenant as any).delivery_max_radius_km ?? 0);
      if (tenantMaxRadius > 0 && distance > tenantMaxRadius) {
        toast({
          title: 'Endereço fora da área de entrega',
          description: `Esta loja entrega até ${tenantMaxRadius} km. Seu endereço está a ${distance.toFixed(1)} km. Escolha "Retirar na loja" ou outro endereço.`,
          variant: 'destructive',
        });
        return;
      }
      // Valida raio de cada fornecedor envolvido
      for (const it of items) {
        const supId = (it.product as any).supplier_id;
        if (!supId) continue;
        const sup = supplierShippings[supId];
        if (!sup) continue;
        const supMaxRadius = Number(sup.delivery_max_radius_km ?? 0);
        if (supMaxRadius <= 0) continue;
        const origin = getProductOrigin(it.product);
        const distToSup = originDistances[origin] ?? distance ?? 0;
        if (distToSup > supMaxRadius) {
          toast({
            title: `Fora do raio do fornecedor`,
            description: `O produto "${it.product.name}" só é entregue até ${supMaxRadius} km do fornecedor (você está a ${distToSup.toFixed(1)} km). Remova o item ou escolha outro endereço.`,
            variant: 'destructive',
          });
          return;
        }
      }
    }

    // Bloqueia delivery se sistema confirmou que não há motoboy/Lalamove disponíveis
    // (a menos que o cliente já tenha confirmado mudar pra retirada)
    // Quando o lojista desativa o fallback de retirada (pickup_as_delivery_fallback=false),
    // o pedido segue como delivery mesmo sem motoboy — cliente organiza a própria retirada.
    if (pickupAsFallback && deliveryType === 'delivery' && deliveryCheck && !deliveryCheck.has_delivery && !pickupOnlyConfirmed) {
      setShowPickupOnlyModal(true);
      return;
    }

    // Fluxo WhatsApp em 2 etapas: primeiro abre a conversa com o pedido pronto
    // (window.open precisa ser SÍNCRONO no clique, senão o navegador bloqueia),
    // depois o cliente confirma que enviou e só então o pedido é registrado.
    if (viaWhatsApp && !waAlreadySent) {
      if (!waNumber) {
        toast({ title: 'WhatsApp da loja não configurado', variant: 'destructive' });
        return;
      }
      const preMsg = buildWhatsAppMessage(items, finalTotal, deliveryType === 'delivery' ? (effectiveDeliveryFee + shippingFee) : 0, address, deliveryType, paymentMethod, tenant.name, name);
      window.open(`https://wa.me/${waNumber}?text=${preMsg}`, '_blank');
      setWaConfirm(true);
      return;
    }


    // Block orders if tenant is suspended for unpaid invoices
    const blockedUntil = (tenant as any).billing_blocked_until;
    if (blockedUntil && new Date(blockedUntil) > new Date()) {
      toast({ title: 'Loja temporariamente indisponível', description: 'Esta loja está em regularização. Tente novamente em breve.', variant: 'destructive' });
      return;
    }

    try {
      // Atribui supplier_id sempre que houver produto vinculado a um fornecedor.
      // Assim o pedido cai no painel do fornecedor responsável.
      // Lógica de Fragmentação Inteligente (Best Price):
      // O sistema agora verifica se os itens do carrinho podem ser atendidos por fornecedores diferentes
      // com base no menor custo detectado na tabela de inteligência de preços.
      // --- Lógica de Fragmentação por Menor Preço ---
      const { data: tenantSuppliers } = await (supabase as any)
        .from('suppliers_public')
        .select('id')
        .eq('tenant_id', tenant.id);
      const supplierIds = (tenantSuppliers || []).map((s: any) => s.id).filter(Boolean);
      const { data: supplierPrices } = supplierIds.length > 0
        ? await supabase
          .from('supplier_product_prices')
          .select('supplier_id, product_name, unit_price')
          .in('supplier_id', supplierIds)
          .eq('available', true)
        : { data: [] as any[] };

      const bestSuppliers = new Map<string, { supplier_id: string; price: number }>();
      (supplierPrices || []).forEach((sp: any) => {
        const name = productMatchKey(sp.product_name);
        // Prioriza menor preço de custo para fragmentação operacional
        const cur = bestSuppliers.get(name);
        if (!cur || Number(sp.unit_price) < cur.price) {
          bestSuppliers.set(name, { supplier_id: sp.supplier_id, price: Number(sp.unit_price) });
        }
      });

      const fragments = new Map<string, string[]>();
      items.forEach(item => {
        const best = bestSuppliers.get(productMatchKey(item.product.name));
        const targetSupplierId = best?.supplier_id || (item.product as any).supplier_id;
        if (targetSupplierId) {
          const list = fragments.get(targetSupplierId) || [];
          list.push(item.product.name);
          fragments.set(targetSupplierId, list);
        }
      });

      const supplierIdsInCart = Array.from(fragments.keys());
      const needsFragmentation = supplierIdsInCart.length > 1;
      const autoSupplierId = supplierIdsInCart[0] || null;

      const initialStatus = simulateApproved
        ? 'received'
        : payOnline
          ? PENDING_PAYMENT_STATUS
          : ((tenant as any).dropshipping_review_mode ? 'pending_review' : 'received');

      const orderResult = await addOrderMutation.mutateAsync({
        order: {
          tenant_id: tenant.id,
          total: finalTotal,
          platform_fee: platformFee,
          delivery_type: deliveryType,
          delivery_fee: deliveryType === 'delivery' ? (effectiveDeliveryFee + shippingFee) : 0,
          payment_method: payOnline ? 'mercadopago' : paymentMethod,
          customer_name: name,
          customer_phone: phone.replace(/\D/g, ''),
          customer_email: email.trim() || null,
          customer_address: address,
          status: initialStatus,
          distance: distance ?? 0,
          delivery_status_note: '',
          driver_id: null,
          supplier_id: autoSupplierId,
          coupon_code: appliedCoupon?.code ?? null,
          discount_amount: discountAmount,
          seller_id: appliedCoupon?.seller_id ?? null,
          seller_code_id: appliedCoupon?.seller_code_id ?? null,
          change_for: !payOnline && paymentMethod === 'dinheiro' && changeFor ? parseFloat(changeFor.replace(',', '.')) || 0 : 0,
          metadata: { 
            needs_fragmentation: needsFragmentation,
            supplier_ids: supplierIdsInCart,
            fragmentation_map: Object.fromEntries(fragments.entries())
          }
        } as any,
        items: items.map(i => ({
          product_name: i.product.name,
          product_price: getCartLineUnitPrice(i),
          quantity: i.quantity,
          variant_name: i.variantName || null,
          addons: (i.addons && i.addons.length > 0) ? (i.addons as any) : null,
          notes: i.notes || null,
        })),
      });

      // Cria appointments pra cada item de serviço (sequencial dentro do horário escolhido)
      // Cria fragmentos operacionais se o pedido for fragmentado (#4)
      if (orderResult?.id && needsFragmentation) {
        try {
          for (const [supplierId, productNames] of fragments.entries()) {
            const fragmentItems = items.filter(i => productNames.includes(i.product.name));
            const fragmentTotal = fragmentItems.reduce((sum, i) => sum + (getCartLineUnitPrice(i) * i.quantity), 0);
            
            await supabase.from('order_fragments').insert({
              order_id: orderResult.id,
              tenant_id: tenant.id,
              supplier_id: supplierId,
              status: initialStatus,
              total: fragmentTotal,
              items: fragmentItems.map(i => ({
                product_name: i.product.name,
                product_price: getCartLineUnitPrice(i),
                quantity: i.quantity,
                variant_name: i.variantName || null,
                addons: i.addons || null,
                notes: i.notes || null
              }))
            });
          }
        } catch (e) {
          console.error('Erro ao criar fragmentos operacionais:', e);
        }
      }

      if (orderResult?.id && needsScheduling && scheduledStart) {
        let cursor = new Date(scheduledStart);
        for (const it of serviceItems) {
          const dur = ((it.product as any).duration_minutes ?? 0) * it.quantity;
          if (dur <= 0) continue;
          try {
            await createAppointmentMutation.mutateAsync({
              tenant_id: tenant.id,
              order_id: orderResult.id,
              product_id: it.product.id,
              product_name: it.product.name,
              customer_name: name,
              customer_phone: phone.replace(/\D/g, ''),
              scheduled_start: cursor.toISOString(),
              planned_duration_minutes: dur,
              status: ((tenant as any).scheduling_auto_confirm ?? true) ? 'scheduled' : 'scheduled',
            });
          } catch (e) { console.error('appointment error', e); }
          cursor = new Date(cursor.getTime() + dur * 60 * 1000);
        }
      }

      // Marca cart_session como convertido (#4)
      if (orderResult?.id && cartSessionId) {
        try {
          await supabase.from('cart_sessions').update({ converted_order_id: orderResult.id }).eq('id', cartSessionId);
        } catch { /* noop */ }
      }

      if (orderResult?.id) {
        if (appliedCoupon?.seller_id && appliedCoupon?.seller_code_id) {
          const grossSubtotal = items.reduce((sum, item) => sum + getCartLineUnitPrice(item) * item.quantity, 0);
          const sellerRows = items.map((item) => {
            const gross = getCartLineUnitPrice(item) * item.quantity;
            const itemDiscount = grossSubtotal > 0 ? discountAmount * gross / grossSubtotal : 0;
            const net = Math.max(0, gross - itemDiscount);
            const commissionPercent = Number((appliedCoupon as any).seller_commission_percent || 0);
            return { tenant_id: tenant.id, order_id: orderResult.id, seller_id: appliedCoupon.seller_id, seller_code_id: appliedCoupon.seller_code_id, product_name: item.product.name, quantity: item.quantity, unit_price_before_discount: getCartLineUnitPrice(item), unit_price_after_discount: item.quantity ? net / item.quantity : 0, discount_amount: itemDiscount, line_total: net, commission_percent: commissionPercent, commission_amount: net * commissionPercent / 100 };
          });
          try { await (supabase as any).from('seller_order_items').insert(sellerRows); } catch (e) { console.error('seller commission error', e); }
          await incrementSellerCodeUse(appliedCoupon.seller_code_id, appliedCoupon.uses_count);
        }
        await logOrderEvent({
          order_id: orderResult.id,
          tenant_id: tenant.id,
          event_type: 'created',
          to_status: initialStatus,
          actor: 'customer',
          actor_id: name,
          description: `Pedido criado por ${name} via ${payOnline ? 'Mercado Pago' : viaWhatsApp ? 'WhatsApp' : 'site'}${appliedCoupon ? ` (cupom ${appliedCoupon.code})` : ''}`,
          metadata: { items_count: items.length, total: finalTotal, coupon: appliedCoupon?.code, discount: discountAmount },
        });
        if (autoSupplierId) {
          await logOrderEvent({
            order_id: orderResult.id,
            tenant_id: tenant.id,
            event_type: 'auto_assign_supplier',
            actor: 'system',
            description: `Fornecedor atribuído automaticamente`,
            metadata: { supplier_id: autoSupplierId },
          });
        }
        if (appliedCoupon) {
          await incrementCouponUse(appliedCoupon.id, appliedCoupon.uses_count);
        }
        // #21 — Anti-fraude (fire-and-forget; bloqueia pedido se score muito alto)
        try {
          supabase.functions.invoke('fraud-check', { body: { orderId: orderResult.id } }).catch(() => {});
        } catch { /* noop */ }
      }

      if (simulateApproved && orderResult?.id) {
        // 🧪 MODO TESTE: simula pagamento online aprovado sem ir ao MP.
        // O pedido já foi criado como 'received' + payment_method='mercadopago'.
        toast({ title: '🧪 Pagamento simulado aprovado!', description: 'Pedido criado como pago online (teste).' });
        clearCart(); setStep('cart'); setOpen(false);
        return;
      }

      if (payOnline && orderResult?.id) {
        // 🔁 Em vez de chamar create-payment AQUI e redirecionar direto pro Mercado Pago
        // (que abre o app no Android automaticamente e quebra a UX), vamos pra uma
        // página intermediária que:
        //   1) Mostra um GUIA visual do pagamento (incluindo o aviso do e-mail pro Pix)
        //   2) Cria a preferência via Edge Function
        //   3) Só redireciona pro MP após CLIQUE explícito (gesture) → evita auto-launch do app
        //   4) Faz polling e avisa quando pagamento for aprovado
        clearCart(); setStep('cart'); setOpen(false);
        toast({ title: 'Pedido criado! Vamos te guiar pelo pagamento.' });
        navigate(`/loja/${tenant.slug}/pagar/${orderResult.id}`);
      } else if (viaWhatsApp) {
        // A conversa já foi aberta e o cliente confirmou o envio; aqui só registramos.
        await decrementStock(); clearCart(); setStep('cart'); setOpen(false);
        toast({ title: '✅ Pedido registrado!', description: 'Acompanhe o status em tempo real.' });
        if (orderResult?.id) navigate(`/loja/${tenant.slug}/pedido/${orderResult.id}`);
      } else if (orderResult?.id) {
        // Pedido sem WhatsApp / sem pagamento online → vai direto pra página de status
        await decrementStock(); clearCart(); setStep('cart'); setOpen(false);
        toast({ title: '✅ Pedido realizado!', description: 'Acompanhe o status em tempo real.' });
        navigate(`/loja/${tenant.slug}/pedido/${orderResult.id}`);
      }
    } catch {
      toast({ title: 'Erro ao registrar pedido', variant: 'destructive' });
    }

  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full gradient-primary px-5 py-3 text-primary-foreground font-medium shadow-lg hover-glow">
        <ShoppingCart className="h-5 w-5" />
        {itemCount > 0 && <span className="min-w-[20px] rounded-full bg-background text-foreground text-xs font-bold px-1.5 py-0.5">{itemCount}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={() => { setOpen(false); setStep('cart'); }} />
          <div className="relative w-full max-w-md bg-card border-l border-border h-full overflow-y-auto animate-fade-in">
            <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
              <h2 className="font-heading text-xl text-foreground">{step === 'cart' ? 'Carrinho' : 'Finalizar Pedido'}</h2>
              <button onClick={() => { setOpen(false); setStep('cart'); }} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-4 space-y-4">
              {step === 'cart' ? (
                <>
                  {items.length === 0 ? (
                    <p className="text-center text-muted-foreground py-12">Carrinho vazio</p>
                  ) : (
                    <>
                      {items.map(item => {
                        const unit = getCartLineUnitPrice(item);
                        return (
                        <div key={item.key} className="flex items-start gap-3 p-3 rounded-lg bg-secondary">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground text-sm truncate">{item.product.name}</p>
                            {item.variantName && (
                              <p className="text-[11px] text-muted-foreground">Opção: {item.variantName}</p>
                            )}
                            {item.addons && item.addons.length > 0 && (
                              <p className="text-[11px] text-muted-foreground">
                                + {item.addons.map(a => `${a.quantity}x ${a.name}`).join(', ')}
                              </p>
                            )}
                            {item.notes && (
                              <p className="text-[11px] text-muted-foreground italic truncate">📝 {item.notes}</p>
                            )}
                            <p className="text-primary text-sm font-bold mt-0.5">R${(unit * item.quantity).toFixed(2)}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => updateQuantity(item.key, item.quantity - 1)} className="rounded-md bg-muted p-1 text-muted-foreground hover:text-foreground"><Minus className="h-3 w-3" /></button>
                            <span className="text-sm font-medium text-foreground w-6 text-center">{item.quantity}</span>
                            <button onClick={() => updateQuantity(item.key, item.quantity + 1)} className="rounded-md bg-muted p-1 text-muted-foreground hover:text-foreground"><Plus className="h-3 w-3" /></button>
                            <button onClick={() => removeFromCart(item.key)} className="rounded-md p-1 text-destructive hover:bg-destructive/10"><Trash2 className="h-3 w-3" /></button>
                          </div>
                        </div>
                        );
                      })}
                      <div className="border-t border-border pt-4">
                        <div className="flex justify-between text-sm text-muted-foreground mb-1">
                          <span>Subtotal:</span><span>R${total.toFixed(2)}</span>
                        </div>
                        {customerFee > 0 && (
                          <div className="flex justify-between text-sm text-muted-foreground mb-1">
                            <span>Taxa operacional:</span><span>R${customerFee.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-lg font-bold text-foreground">
                          <span>Total:</span><span className="text-primary">R${(total + customerFee).toFixed(2)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">+ entrega calculada após informar o endereço</p>
                      </div>
                      <button onClick={() => setStep('checkout')} className="w-full gradient-primary text-primary-foreground py-3 rounded-lg font-medium hover:opacity-90 transition-opacity">
                        Finalizar Pedido
                      </button>
                    </>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-foreground">Nome</label>
                    <input value={name} onChange={e => setName(e.target.value)} className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-foreground text-sm" placeholder="Seu nome" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">Telefone</label>
                    <input value={phone} onChange={e => setPhone(e.target.value)} className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-foreground text-sm" placeholder="(00) 00000-0000" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      E-mail {requireEmail ? <span className="text-destructive">*</span> : <span className="text-muted-foreground text-xs">(opcional — receba atualizações do pedido)</span>}
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-foreground text-sm"
                      placeholder="seu@email.com"
                    />
                  </div>

                  {/* ===== Agendamento de serviços ===== */}
                  {hasServices && !schedulingConfig.scheduling_enabled && (
                    <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-400">
                      ⚠️ Esta loja tem serviços no carrinho mas ainda não habilitou agendamentos. Seu pedido será registrado sem horário marcado — combine com a loja depois.
                    </div>
                  )}
                  {needsScheduling && (
                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                      <p className="text-sm font-medium text-foreground flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-primary" />
                        Agendamento do serviço
                      </p>
                      <SchedulingSlotPicker
                        tenantId={tenant.id}
                        config={schedulingConfig}
                        durationMinutes={totalServiceDuration}
                        value={scheduledStart}
                        onChange={setScheduledStart}
                        serviceMaxConcurrent={slotServiceMaxConcurrent}
                        serviceProductId={slotServiceProductId}
                      />
                    </div>
                  )}

                  {(allowsDelivery && allowsPickup) && (
                    <div>
                      <label className="text-sm font-medium text-foreground">Entrega</label>
                      <div className="flex gap-2 mt-1">
                        <button onClick={() => setDeliveryType('delivery')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${deliveryType === 'delivery' ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                          <MapPin className="h-4 w-4 inline mr-1" /> Entrega
                        </button>
                        <button onClick={() => setDeliveryType('pickup')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${deliveryType === 'pickup' ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                          Retirada
                        </button>
                      </div>
                    </div>
                  )}
                  {isLocalOnly && (
                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-foreground">
                      🏪 Esta loja só trabalha com <strong>retirada no balcão</strong>. Você passa aqui pra buscar quando estiver pronto.
                    </div>
                  )}
                  {!allowsPickup && allowsDelivery && (
                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-foreground">
                      🛵 Esta loja só faz <strong>entrega</strong>. Informe o endereço abaixo.
                    </div>
                  )}

                  {deliveryType === 'delivery' && (
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">Endereço de entrega</label>
                      <CepAddressInput
                        value={address}
                        onChange={handleAddressChange}
                        onCalculated={handleDistanceCalculated}
                        onError={handleDistanceError}
                        tenantAddress={primaryShippingOrigin}
                        skipDistanceCalculation={isDropshipping || (tenant as any).is_dropshipping === true}
                        displayFeeOverride={effectiveDeliveryFee + shippingFee}
                        displayFeeLabel={
                          useLalamoveQuote
                            ? `Taxa ${courierQuote?.method === 'uber_direct' ? 'Uber' : 'Lalamove'} + frete fornecedor:`
                            : 'Taxa de entrega:'
                        }
                        displayDistanceOverride={
                          Math.max(
                            distance ?? 0,
                            ...Object.values(originDistances)
                          )
                        }
                      />
                      {distanceError && <p className="text-xs text-destructive mt-1">{distanceError}</p>}
                      {/* Status de disponibilidade real de entrega */}
                      {checkingDelivery && (
                        <div className="mt-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs space-y-1">
                          <p className="font-medium text-yellow-700 dark:text-yellow-400 flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> Calculando frete...
                          </p>
                          <p className="text-muted-foreground">
                            Espere validarmos a disponibilidade de motoboys para prosseguir com o cálculo correto do frete.
                          </p>
                        </div>
                      )}
                      {deliveryCheck && deliveryCheck.has_delivery && (() => {
                        // Mostra apenas o método que será efetivamente usado (courier externo tem
                        // prioridade sobre motoboy próprio). O fee exibido é o REAL.
                        const courierOpt = deliveryCheck.options.find(o => (o.method === 'lalamove' || o.method === 'uber_direct') && o.available);
                        const driverOpt = deliveryCheck.options.find(o => o.method === 'driver' && o.available);
                        const chosen = courierOpt || driverOpt;
                        if (!chosen) return null;
                        const totalFreteExibido = (allItemsHaveShipping ? 0 : effectiveDeliveryFee) + shippingFee;
                        return (
                          <div className="mt-2 rounded-lg border border-green-500/30 bg-green-500/5 p-2 text-xs text-green-600 dark:text-green-400 space-y-0.5">
                            <p className="font-medium">✓ Entrega disponível!</p>
                            <p className="text-muted-foreground">
                              {chosen.label} {totalFreteExibido > 0 ? `· R$${totalFreteExibido.toFixed(2)}` : '· grátis'} {chosen.eta ? `· ${chosen.eta}` : ''}
                            </p>
                          </div>
                        );
                      })()}
                      {deliveryCheck && !deliveryCheck.has_delivery && (
                        <div className="mt-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs space-y-1">
                          <p className="font-medium text-yellow-700 dark:text-yellow-400">⚠️ Sem entrega disponível agora</p>
                          <p className="text-muted-foreground">
                            {deliveryCheck.lalamove_failed && 'A cotação Lalamove falhou. '}
                            {deliveryCheck.driver_offline && 'Nenhum motoboy da loja está online. '}
                            {pickupAsFallback ? (
                              <>Você pode retirar na loja: <strong className="text-foreground">{deliveryCheck.pickup_address}</strong></>
                            ) : (
                              <>Seu pedido será preparado e você organiza a retirada da entrega (ex.: Uber Moto). O frete calculado é cobrado normalmente.</>
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Forma de pagamento</label>
                    {hasOnlinePayment && (
                      <div className="rounded-lg border-2 border-primary/40 bg-primary/10 p-3 text-xs text-foreground mb-3">
                        ✅ <strong>Pagamento online disponível.</strong><br/>
                        Para pagar agora com Pix instantâneo ou Cartão (aprovação automática), use o <strong>botão verde "Pagar agora (Mercado Pago)"</strong> mais abaixo. Você não precisa preencher nada aqui.
                      </div>
                    )}
                    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-2 mb-2 text-[11px] text-yellow-700 dark:text-yellow-400">
                      ⚠️ Se preferir pagar <strong>{deliveryType === 'pickup' ? 'no balcão ao retirar' : 'na hora da entrega'}</strong>, escolha a forma abaixo:
                    </div>
                    <label className="text-xs font-medium text-muted-foreground">
                      {deliveryType === 'pickup' ? 'Forma na retirada/balcão' : 'Forma na entrega'}
                    </label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      {[
                        { value: 'pix', label: 'Pix (manual)' },
                        { value: 'dinheiro', label: 'Dinheiro' },
                        { value: 'débito', label: 'Débito' },
                        { value: 'crédito', label: 'Crédito' },
                      ].map(m => (
                        <button key={m.value} onClick={() => setPaymentMethod(m.value)}
                          className={`py-2 rounded-lg text-sm font-medium transition-all ${paymentMethod === m.value ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                          <CreditCard className="h-3 w-3 inline mr-1" />{m.label}
                        </button>
                      ))}
                    </div>
                    {paymentMethod === 'pix' && waNumber ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        💚 Pix manual (chave da loja). Após pagar, envie o comprovante pelo WhatsApp da loja para confirmarmos. Para Pix com aprovação automática, use <strong>Pagar agora (Mercado Pago)</strong>.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">
                        Você paga ao {deliveryType === 'pickup' ? 'retirar' : 'receber'} o pedido.
                      </p>
                    )}

                    {paymentMethod === 'dinheiro' && (
                      <div className="mt-2">
                        <label className="text-xs font-medium text-foreground">Troco para quanto? <span className="text-muted-foreground">(opcional)</span></label>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-sm text-muted-foreground">R$</span>
                          <input type="text" inputMode="decimal" value={changeFor} onChange={e => setChangeFor(e.target.value.replace(/[^\d.,]/g, ''))}
                            placeholder="Ex: 50,00" className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-foreground text-sm" />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">Deixe vazio se vai pagar com o valor exato.</p>
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-border bg-secondary/50 p-3 space-y-2">
                    <label className="text-xs font-medium text-foreground flex items-center gap-1"><Tag className="h-3 w-3 text-primary" /> Cupom de desconto</label>
                    {appliedCoupon ? (
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-green-500/10 border border-green-500/30 p-2">
                        <div className="flex items-center gap-2 text-sm text-green-400">
                          <CheckCircle2 className="h-4 w-4" /> <span className="font-mono font-bold">{appliedCoupon.code}</span>
                          <span className="text-xs">−R${discountAmount.toFixed(2)}</span>
                        </div>
                        <button onClick={removeCoupon} className="text-xs text-destructive hover:underline">remover</button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <input value={couponInput} onChange={e => setCouponInput(e.target.value.toUpperCase())}
                          placeholder="DIGITE O CÓDIGO" maxLength={30}
                          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-foreground text-sm font-mono uppercase" />
                        <button onClick={applyCoupon} disabled={validatingCoupon || !couponInput.trim()}
                          className="rounded-lg gradient-primary text-primary-foreground px-3 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                          {validatingCoupon ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Aplicar'}
                        </button>
                      </div>
                    )}
                    {couponMsg && !appliedCoupon && <p className="text-xs text-destructive">{couponMsg}</p>}
                  </div>

                  <div className="border-t border-border pt-3 space-y-1">
                    <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal:</span><span>R${total.toFixed(2)}</span></div>
                    {customerFee > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>Taxa operacional:</span><span>R${customerFee.toFixed(2)}</span></div>}
                    {effectiveDeliveryFee > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>{isDropshipping ? `Frete estimado (PAC${freightEstimate ? ` · ${freightEstimate.toCity}` : ''}):` : useLalamoveQuote ? 'Entrega Lalamove:' : 'Entrega (distância):'}</span><span>R${effectiveDeliveryFee.toFixed(2)}</span></div>}
                    {isDropshipping && freightEstimate && (
                      <div className="text-xs text-muted-foreground italic px-1">
                        Estimativa CEP→CEP via ViaCEP. Sedex aprox. R${freightEstimate.sedex.toFixed(2)} · ~{freightEstimate.distanceKm}km. Valor final pode variar conforme transportadora.
                      </div>
                    )}
                    {shippingFee > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>Frete (produtos):</span><span>R${shippingFee.toFixed(2)}</span></div>}
                    {discountAmount > 0 && <div className="flex justify-between text-sm text-green-400"><span>Cupom ({appliedCoupon?.code}):</span><span>−R${discountAmount.toFixed(2)}</span></div>}
                    <div className="flex justify-between text-lg font-bold text-foreground"><span>Total:</span><span className="text-primary">R${finalTotal.toFixed(2)}</span></div>
                  </div>

                  {isWhatsAppMode && showPixToCustomer && (
                    <div className="rounded-lg border border-primary/40 bg-primary/10 p-3 space-y-1">
                      <p className="text-xs font-semibold text-foreground">💚 Pix da loja — pague e mande o comprovante</p>
                      <p className="text-[11px] text-muted-foreground">{(tenant as any).pix_key_type || 'Chave'}</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-sm font-mono text-foreground break-all">{(tenant as any).pix_key}</code>
                        <button onClick={() => { navigator.clipboard.writeText(String((tenant as any).pix_key || '')); }}
                          className="rounded-lg bg-secondary px-2 py-1 text-xs text-foreground">Copiar</button>
                      </div>
                    </div>
                  )}


                  {/* SEMPRE mostra o botão online quando disponível, pra evitar
                      qualquer ambiguidade de estado. O usuário escolhe pelo botão clicado. */}
                  {hasOnlinePayment && (
                    <>
                      <button onClick={() => submitOrder(false, true)} disabled={addOrderMutation.isPending || creatingPayment}
                        className="w-full py-4 rounded-lg font-bold text-base text-primary-foreground gradient-primary hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg ring-2 ring-primary/40">
                        {creatingPayment ? <Loader2 className="h-5 w-5 animate-spin" /> : <ExternalLink className="h-5 w-5" />}
                        {creatingPayment ? 'Gerando pagamento...' : `💳 Pagar R$${finalTotal.toFixed(2)} agora (Mercado Pago)`}
                      </button>
                      {!!(tenant as any).demo_payment_enabled && (
                        <button onClick={() => submitOrder(false, true, true)} disabled={addOrderMutation.isPending || creatingPayment}
                          className="w-full py-3 rounded-lg font-bold text-sm bg-yellow-400 hover:bg-yellow-500 text-black disabled:opacity-50 flex items-center justify-center gap-2">
                          🧪 SIMULAR pagamento online aprovado (TESTE)
                        </button>
                      )}
                      <div className="flex items-center gap-2 my-1">
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">ou pagar depois</span>
                        <div className="flex-1 h-px bg-border" />
                      </div>
                    </>
                  )}
                  {isWhatsAppMode ? (
                    <button onClick={() => submitOrder(true)} disabled={addOrderMutation.isPending || !waNumber || creatingPayment}
                      className="w-full py-4 rounded-lg font-bold text-base text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50 bg-[hsl(142,71%,30%)] hover:bg-[hsl(142,71%,35%)] shadow-lg">
                      <MessageCircle className="h-5 w-5" />
                      {addOrderMutation.isPending ? 'Registrando...' : 'Enviar pedido no WhatsApp'}
                    </button>
                  ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => submitOrder(false)} disabled={addOrderMutation.isPending || creatingPayment} className={`py-3 rounded-lg font-medium text-sm disabled:opacity-50 ${hasOnlinePayment ? 'bg-secondary text-foreground hover:bg-muted border border-border' : 'gradient-primary text-primary-foreground hover:opacity-90'}`}>
                      {addOrderMutation.isPending ? 'Enviando...' : `Pagar ${deliveryType === 'pickup' ? 'no balcão' : 'na entrega'}`}
                    </button>
                    <button onClick={() => submitOrder(true)} disabled={addOrderMutation.isPending || !waNumber || creatingPayment}
                      className="py-3 rounded-lg font-medium text-sm text-foreground transition-colors flex items-center justify-center gap-1 disabled:opacity-50 bg-[hsl(142,71%,30%)] hover:bg-[hsl(142,71%,35%)]">
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </button>
                  </div>
                  )}

                  <button onClick={() => setStep('cart')} className="w-full text-sm text-muted-foreground hover:text-foreground py-2">
                    ← Voltar ao carrinho
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmação do envio no WhatsApp — o pedido só é registrado depois disso */}
      {waConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 space-y-4 animate-fade-in">
            <div className="text-center space-y-1">
              <p className="text-3xl">💬</p>
              <h3 className="font-heading text-lg text-foreground">Você enviou o pedido no WhatsApp?</h3>
              <p className="text-xs text-muted-foreground">
                Abrimos a conversa da loja com o pedido pronto. Toque em <strong>enviar</strong> lá e volte aqui para confirmar — só assim o pedido entra no sistema.
              </p>
            </div>
            <div className="grid gap-2">
              <button
                onClick={async () => { setWaConfirm(false); await submitOrder(true, false, false, true); }}
                disabled={addOrderMutation.isPending}
                className="py-3 rounded-lg text-sm font-bold text-white bg-[hsl(142,71%,30%)] hover:bg-[hsl(142,71%,35%)] disabled:opacity-50"
              >
                ✅ Sim, já enviei — confirmar pedido
              </button>
              <button
                onClick={() => {
                  const preMsg = buildWhatsAppMessage(items, finalTotal, deliveryType === 'delivery' ? (effectiveDeliveryFee + shippingFee) : 0, address, deliveryType, paymentMethod, tenant.name, name);
                  window.open(`https://wa.me/${waNumber}?text=${preMsg}`, '_blank');
                }}
                className="py-2.5 rounded-lg text-sm font-medium bg-secondary text-foreground hover:bg-muted"
              >
                Reabrir WhatsApp
              </button>
              <button onClick={() => setWaConfirm(false)} className="py-2 text-xs text-muted-foreground hover:text-foreground">
                Ainda não enviei
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Modal de bloqueio: força cliente a aceitar retirada quando não há entrega disponível */}
      {showPickupOnlyModal && deliveryCheck && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 space-y-4 animate-fade-in">
            <div className="text-center space-y-1">
              <p className="text-3xl">📦</p>
              <h3 className="font-heading text-lg text-foreground">Sem entrega disponível agora</h3>
              <p className="text-xs text-muted-foreground">
                {deliveryCheck.lalamove_failed && 'A cotação Lalamove falhou. '}
                {deliveryCheck.driver_offline && 'Nenhum motoboy da loja está online. '}
              </p>
            </div>
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <p className="font-medium text-foreground mb-1">📍 Retire na loja (frete grátis):</p>
              <p className="text-muted-foreground text-xs">{deliveryCheck.pickup_address}</p>
            </div>
            <div className={pickupAsFallback ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}>
              {!pickupAsFallback ? (
                <button
                  onClick={() => {
                    setPickupOnlyConfirmed(true);
                    setShowPickupOnlyModal(false);
                    toast({ title: 'Frete confirmado', description: 'Pedido seguirá com o valor calculado. Organize a retirada da entrega (ex.: Uber Moto).' });
                  }}
                  className="py-2.5 rounded-lg text-sm font-medium gradient-primary text-primary-foreground hover:opacity-90"
                >
                  Entender, seguir com entrega
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { setShowPickupOnlyModal(false); }}
                    className="py-2.5 rounded-lg text-sm font-medium bg-secondary text-foreground hover:bg-muted"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => {
                      setDeliveryType('pickup');
                      setPickupOnlyConfirmed(true);
                      setShowPickupOnlyModal(false);
                      toast({ title: 'Modo retirada ativado', description: 'Frete zerado. Confirme o pedido.' });
                    }}
                    className="py-2.5 rounded-lg text-sm font-medium gradient-primary text-primary-foreground hover:opacity-90"
                  >
                    Aceitar retirada
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default TenantCartDrawer;
