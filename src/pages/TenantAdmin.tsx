import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import TenantAdminCustomerChats from '@/components/tenant/TenantAdminCustomerChats';
import { useStoreOrderChats } from '@/hooks/useOrderChat';
import { supabase } from '@/integrations/supabase/client';
import { useTenantBySlug } from '@/hooks/useTenants';
import { useStoreManifest } from '@/hooks/useStoreManifest';
import TenantAdminLogin from '@/components/tenant/TenantAdminLogin';
import StorefrontEditor from '@/components/tenant/StorefrontEditor';
import TenantAdminDashboard from '@/components/tenant/TenantAdminDashboard';
import TenantAdminOrders from '@/components/tenant/TenantAdminOrders';
import TenantAdminProducts from '@/components/tenant/TenantAdminProducts';
import TenantCategoriesTree from '@/components/tenant/TenantCategoriesTree';
import TenantAdminUsers from '@/components/tenant/TenantAdminUsers';
import TenantFinancialManager from '@/components/tenant/TenantFinancialManager';
// (TenantBusinessPanel agora é renderizado dentro de TenantFinancialManager como sub-aba "🤖 Clara")
import TenantAdminSuppliers from '@/components/tenant/TenantAdminSuppliers';
import TenantAdminDrivers from '@/components/tenant/TenantAdminDrivers';
import TenantAdminShipping from '@/components/tenant/TenantAdminShipping';
import TenantSalesRanking from '@/components/tenant/TenantSalesRanking';
import TenantPromoManager from '@/components/tenant/TenantPromoManager';
import MarketingPostGenerator from '@/components/shared/MarketingPostGenerator';
import TenantAdminCoupons from '@/components/tenant/TenantAdminCoupons';
import TenantAdminCouponsTest from '@/components/tenant/TenantAdminCouponsTest';
import TenantAdminReviews from '@/components/tenant/TenantAdminReviews';
import TenantBillingPanel from '@/components/tenant/TenantBillingPanel';
import TenantAffiliateClicksRanking from '@/components/tenant/TenantAffiliateClicksRanking';
import TenantAffiliateDashboard from '@/components/tenant/TenantAffiliateDashboard';
import TenantAdminPrinter from '@/components/tenant/TenantAdminPrinter';
import TenantAdminScheduling from '@/components/tenant/TenantAdminScheduling';
import TenantAdminQuotes from '@/components/tenant/TenantAdminQuotes';
import TenantPriceIntelligence from '@/components/tenant/TenantPriceIntelligence';
import OnboardingChecklist from '@/components/tenant/OnboardingChecklist';
import { AdminTabsConfigProvider } from '@/lib/admin-subtabs';
import HelpButton from '@/components/tenant/HelpButton';
import InvoiceAlertBanner from '@/components/tenant/InvoiceAlertBanner';
import CreditCardReminder from '@/components/tenant/CreditCardReminder';

import TenantQuickSale from '@/components/tenant/TenantQuickSale';
import TenantAdminTables from '@/components/tenant/TenantAdminTables';
import TenantLiveFloor from '@/components/tenant/TenantLiveFloor';
import TenantWaiterCommissions from '@/components/tenant/TenantWaiterCommissions';
import TenantSellerManagement from '@/components/tenant/TenantSellerManagement';
import TenantAbcCurve from '@/components/tenant/TenantAbcCurve';
import TenantBIDashboard from '@/components/tenant/TenantBIDashboard';
import TenantAdminIntegrations from '@/components/tenant/TenantAdminIntegrations';
import TenantAdminAutomations from '@/components/tenant/TenantAdminAutomations';
import TenantAdminDropshippingWhatsApp from '@/components/tenant/TenantAdminDropshippingWhatsApp';
import TenantAdminAutomationsMonitor from '@/components/tenant/TenantAdminAutomationsMonitor';
import TenantAdminAutomationsDiagnostic from '@/components/tenant/TenantAdminAutomationsDiagnostic';
import TenantAdminEmails from '@/components/tenant/TenantAdminEmails';
import TenantAdminFiscal from '@/components/tenant/TenantAdminFiscal';
import TenantAdminFichaTecnica from '@/components/tenant/TenantAdminFichaTecnica';
import TenantAdminStock from '@/components/tenant/TenantAdminStock';
import TenantAdminFinanceDeep from '@/components/tenant/TenantAdminFinanceDeep';
import TenantAdminReports from '@/components/tenant/TenantAdminReports';
import TenantAdminSupport from '@/components/tenant/TenantAdminSupport';
import SofiaChat from '@/components/SofiaChat';
import SofiaStoreAgent from '@/components/super-admin/SofiaStoreAgent';
import SuperAdminProspecting from '@/components/super-admin/SuperAdminProspecting';
import SuperAdminRemoteProspecting from '@/components/super-admin/SuperAdminRemoteProspecting';
import ClaraChat from '@/components/tenant/ClaraChat';
import ClaraFab from '@/components/tenant/ClaraFab';
import { LayoutDashboard, Package, ShoppingBag, DollarSign, ArrowLeft, LogOut, Users, Store, Factory, Bike, Truck, BarChart3, Palette, Megaphone, Tag, Star, Receipt, MousePointerClick, Printer, CalendarClock, ClipboardList, BookOpen, Settings, Sparkles, Calculator, Plug, Zap, Bot, Activity, Sun, Moon, Wand2, AlertTriangle, CheckCircle2, Mail, Percent, ChefHat, Layers, Radar } from 'lucide-react';
import { contrastWarning } from '@/lib/color-utils';
import { unifiedInvoke } from "@/lib/unifiedInvoke";

type Tab = 'dashboard' | 'orders' | 'quicksale' | 'tables' | 'live-floor' | 'products' | 'categories' | 'financial' | 'users' | 'suppliers' | 'drivers' | 'shipping' | 'sales' | 'clicks' | 'appearance' | 'promo' | 'posts' | 'coupons' | 'coupons-test' | 'reviews' | 'billing' | 'printer' | 'scheduling' | 'quotes' | 'integrations' | 'automations' | 'monitor' | 'diagnostic' | 'emails' | 'customer-chats' | 'consultora' | 'fiscal' | 'ficha' | 'stock' | 'finance-deep' | 'reports' | 'support' | 'commissions' | 'abc' | 'bi' | 'sofia-agent' | 'prospecting' | 'remote-prospecting' | 'price-intelligence' | 'sellers';

type GroupId = 'dashboard' | 'operation' | 'catalog' | 'finance' | 'marketing' | 'settings';

type StoreMode = 'local' | 'delivery' | 'dropshipping' | 'hybrid' | 'affiliate' | 'whatsapp' | 'supermarket';

const TenantAdmin = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: tenant, isLoading: loadingTenant } = useTenantBySlug(slug);
  // Per-store PWA manifest: when admin installs from /loja/{slug}/admin,
  // the home-screen icon shows the store's name + logo (not "Delivery Platform").
  useStoreManifest({
    slug: slug || '',
    startPath: `/loja/${slug}/admin`,
    scopePath: `/loja/${slug}/`,
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(((searchParams.get('tab') as Tab) || 'dashboard'));
  const focusOrderId = searchParams.get('order');
  // sync tab -> URL (without losing other params)
  useEffect(() => {
    const cur = searchParams.get('tab');
    if (tab !== 'dashboard' && cur !== tab) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', tab);
      setSearchParams(next, { replace: true });
    }
  }, [tab]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const { totalUnread: unreadChats } = useStoreOrderChats(tenant?.id);
  // Clara global: aberta por evento `clara:open-request` (disparado pela Sofia
  // quando ela faz handoff de análise empresarial). Funciona em qualquer aba.
  const [globalClaraOpen, setGlobalClaraOpen] = useState(false);
  useEffect(() => {
    const handler = () => setGlobalClaraOpen(true);
    window.addEventListener('clara:open-request', handler);
    return () => window.removeEventListener('clara:open-request', handler);
  }, []);

  // Tema do painel admin (light por padrão; lojista pode optar por dark)
  const themeKey = `admin-theme-${slug}`;
  const [adminTheme, setAdminTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    return (localStorage.getItem(themeKey) as 'light' | 'dark') || 'light';
  });
  useEffect(() => {
    const root = document.documentElement;
    if (adminTheme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
    localStorage.setItem(themeKey, adminTheme);
    return () => { root.classList.remove('dark'); };
  }, [adminTheme, themeKey]);


  const storeMode = ((tenant as any)?.store_mode as StoreMode) || 'delivery';
  const isAffiliate = storeMode === 'affiliate';
  // (isLocalOnly removido — não é mais usado depois da reorganização)
  const hasDropshipping = storeMode === 'dropshipping' || storeMode === 'hybrid';
  // Hybrid agora = Local (retirada) + Delivery; tem motoboy/frete
  const hasDelivery = storeMode === 'delivery' || storeMode === 'hybrid' || storeMode === 'dropshipping' || storeMode === 'supermarket';
  const isDropshipping = hasDropshipping; // backwards-compat alias para componentes filhos
  const isWhatsAppDropshipping = hasDropshipping && (((tenant as any)?.dropshipping_submode as string) === 'whatsapp');

  const checkAdmin = useCallback(async () => {
    if (!tenant) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { data: roleData } = await supabase
        .from('user_roles').select('approved')
        .eq('user_id', session.user.id).eq('tenant_id', tenant.id).eq('role', 'admin').maybeSingle();
      if (roleData?.approved) { setIsAdmin(true); setLoading(false); return; }
      const { data: platformData } = await supabase
        .from('platform_roles').select('role')
        .eq('user_id', session.user.id).eq('role', 'super_admin').maybeSingle();
      if (platformData) { setIsAdmin(true); setLoading(false); return; }
    }
    setIsAdmin(false); setLoading(false);
  }, [tenant]);

  useEffect(() => {
    // Aguarda o React Query terminar (loadingTenant) antes de decidir.
    if (loadingTenant) return;
    // Se a loja não existe, libera o loading pra mostrar a tela "não encontrado".
    if (!tenant) { setLoading(false); return; }
    const timeout = setTimeout(() => setLoading(false), 4000);
    checkAdmin();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { checkAdmin(); });
    return () => { clearTimeout(timeout); subscription.unsubscribe(); };
  }, [checkAdmin, tenant, loadingTenant]);

  // If current tab isn't available in current store mode, fall back to dashboard
  useEffect(() => {
    const hiddenForAffiliate: Tab[] = ['orders', 'drivers', 'shipping', 'coupons', 'sales', 'suppliers', 'printer'];
    if (isAffiliate && hiddenForAffiliate.includes(tab)) setTab('dashboard');
    if (!isAffiliate && tab === 'clicks') setTab('dashboard');
    if (!hasDelivery && (tab === 'drivers' || tab === 'shipping')) setTab('dashboard');
    if (!hasDropshipping && tab === 'suppliers') setTab('dashboard');
  }, [isAffiliate, hasDelivery, hasDropshipping, tab]);

  const handleLogout = async () => { await supabase.auth.signOut(); setIsAdmin(false); };

  if (loadingTenant || loading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  if (!tenant) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Comércio não encontrado.</p></div>;
  if (!isAdmin) return <TenantAdminLogin tenant={tenant} onLogin={checkAdmin} />;

  if ((tenant as any).blocked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center space-y-4">
          <div className="text-5xl">🚫</div>
          <h1 className="text-xl font-bold text-foreground">Loja bloqueada</h1>
          <p className="text-sm text-muted-foreground">
            O acesso ao painel desta loja foi suspenso pela plataforma.
          </p>
          {(tenant as any).blocked_reason && (
            <div className="rounded-lg bg-background/60 border border-border p-3 text-left">
              <p className="text-xs font-semibold text-foreground mb-1">Motivo informado:</p>
              <p className="text-sm text-foreground">{(tenant as any).blocked_reason}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Entre em contato com o suporte para regularizar.</p>
          <button onClick={handleLogout} className="w-full rounded-lg bg-secondary text-foreground px-4 py-2 text-sm font-medium hover:bg-muted">
            Sair
          </button>
        </div>
      </div>
    );
  }


  // Lista mestre de abas com label, ícone e tópico de ajuda. A visibilidade
  // dentro de cada grupo é filtrada pelo modo da loja logo abaixo.
  const allTabs: { id: Tab; label: string; icon: React.ReactNode; group: GroupId }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, group: 'dashboard' },
    { id: 'orders', label: 'Pedidos', icon: <ShoppingBag className="h-4 w-4" />, group: 'operation' },
    { id: 'customer-chats', label: 'Mensagens', icon: <Mail className="h-4 w-4" />, group: 'operation' },
    { id: 'quicksale', label: 'Venda Rápida', icon: <Zap className="h-4 w-4" />, group: 'operation' },
    { id: 'live-floor', label: 'Salão ao Vivo', icon: <Users className="h-4 w-4" />, group: 'operation' },
    { id: 'tables', label: 'Mesas (Garçom)', icon: <Users className="h-4 w-4" />, group: 'operation' },
    { id: 'scheduling', label: 'Agenda', icon: <CalendarClock className="h-4 w-4" />, group: 'operation' },
    { id: 'drivers', label: 'Motoboys', icon: <Bike className="h-4 w-4" />, group: 'operation' },
    { id: 'printer', label: 'Impressora', icon: <Printer className="h-4 w-4" />, group: 'operation' },
    { id: 'products', label: 'Produtos', icon: <Package className="h-4 w-4" />, group: 'catalog' },
    { id: 'categories', label: 'Categorias', icon: <Layers className="h-4 w-4" />, group: 'catalog' },
    { id: 'quotes', label: 'Orçamento', icon: <Calculator className="h-4 w-4" />, group: 'catalog' },
    { id: 'ficha', label: 'Ficha Técnica/CMV', icon: <BookOpen className="h-4 w-4" />, group: 'finance' },
    { id: 'stock', label: 'Estoque', icon: <Package className="h-4 w-4" />, group: 'catalog' },
    { id: 'suppliers', label: 'Fornecedores', icon: <Factory className="h-4 w-4" />, group: 'catalog' },
    { id: 'price-intelligence', label: 'Inteligência de Preços', icon: <Radar className="h-4 w-4" />, group: 'finance' },
    { id: 'consultora', label: 'WhatsApp Consultora', icon: <Mail className="h-4 w-4" />, group: 'operation' },
    { id: 'shipping', label: 'Frete', icon: <Truck className="h-4 w-4" />, group: 'catalog' },
    { id: 'financial', label: 'Empresarial', icon: <DollarSign className="h-4 w-4" />, group: 'finance' },
    { id: 'finance-deep', label: 'Financeiro Avançado', icon: <Receipt className="h-4 w-4" />, group: 'finance' },
    { id: 'reports', label: 'Relatórios Op.', icon: <BarChart3 className="h-4 w-4" />, group: 'finance' },
    { id: 'support', label: 'Suporte & Treino', icon: <LayoutDashboard className="h-4 w-4" />, group: 'settings' },
    { id: 'sales', label: 'Vendas', icon: <BarChart3 className="h-4 w-4" />, group: 'finance' },
    { id: 'commissions', label: 'Comissões', icon: <Percent className="h-4 w-4" />, group: 'finance' },
    { id: 'sellers', label: 'Vendedores', icon: <Users className="h-4 w-4" />, group: 'finance' },
    { id: 'abc', label: 'Curva ABC', icon: <BarChart3 className="h-4 w-4" />, group: 'finance' },
    { id: 'bi', label: 'BI / Previsão', icon: <Activity className="h-4 w-4" />, group: 'finance' },
    { id: 'billing', label: 'Cobranças', icon: <Receipt className="h-4 w-4" />, group: 'finance' },
    { id: 'promo', label: 'Promoção', icon: <Megaphone className="h-4 w-4" />, group: 'marketing' },
    { id: 'sofia-agent', label: '🤖 Sofia Agente', icon: <Sparkles className="h-4 w-4" />, group: 'marketing' },
    { id: 'remote-prospecting', label: 'Prospecção Remota', icon: <Radar className="h-4 w-4" />, group: 'marketing' },
    { id: 'prospecting', label: 'Prospecção', icon: <Radar className="h-4 w-4" />, group: 'marketing' },
    { id: 'posts', label: 'Posts IA', icon: <Sparkles className="h-4 w-4" />, group: 'marketing' },
    { id: 'coupons', label: 'Cupons', icon: <Tag className="h-4 w-4" />, group: 'marketing' },
    { id: 'reviews', label: 'Avaliações', icon: <Star className="h-4 w-4" />, group: 'marketing' },
    { id: 'clicks', label: 'Cliques', icon: <MousePointerClick className="h-4 w-4" />, group: 'marketing' },
    { id: 'emails', label: 'E-mails', icon: <Mail className="h-4 w-4" />, group: 'marketing' },
    { id: 'coupons-test', label: 'Cupons (teste)', icon: <Tag className="h-4 w-4" />, group: 'marketing' },
    { id: 'appearance', label: 'Aparência', icon: <Palette className="h-4 w-4" />, group: 'settings' },
    { id: 'integrations', label: 'Integrações', icon: <Plug className="h-4 w-4" />, group: 'settings' },
    { id: 'fiscal', label: 'Fiscal (NFC-e)', icon: <Receipt className="h-4 w-4" />, group: 'settings' },
    { id: 'automations', label: 'Automações', icon: <Bot className="h-4 w-4" />, group: 'settings' },
    { id: 'monitor', label: 'Monitor', icon: <Activity className="h-4 w-4" />, group: 'settings' },
    { id: 'diagnostic', label: '🩺 Diagnóstico', icon: <Activity className="h-4 w-4" />, group: 'settings' },
    { id: 'users', label: 'Usuários', icon: <Users className="h-4 w-4" />, group: 'settings' },
  ];

  // Config do super admin: { [tabId]: { hidden?: boolean, label?: string } }
  const tabsConfig = (((tenant as any).admin_tabs_config) || {}) as Record<string, { hidden?: boolean; label?: string }>;

  // Filtro por modo da loja (mantém a lógica anterior de hide-by-mode).
  const visibleTabs = allTabs.filter(t => {
    // PRIORIDADE MÁXIMA: Configuração explícita do Super Admin (admin_tabs_config)
    if (tabsConfig[t.id]?.hidden === true) {
      console.log(`[AdminTabs] Ocultando aba ${t.id} por config Super Admin`);
      return false;
    }
    
    // Se não estiver explicitamente escondido, segue a lógica de modo
    if (isAffiliate) {
      const hidden: Tab[] = ['orders', 'quicksale', 'drivers', 'shipping', 'coupons', 'sales', 'suppliers', 'printer', 'scheduling', 'financial'];
      return !hidden.includes(t.id);
    }
    if (t.id === 'clicks') return false;
    if (t.id === 'coupons-test') return false; // só pra afiliados
    if ((t.id === 'drivers' || t.id === 'shipping') && !hasDelivery) return false;
    if (t.id === 'suppliers' && !hasDropshipping) return false;
    if (t.id === 'consultora' && !isWhatsAppDropshipping) return false;
    
    // Features controladas pelo super admin via flags específicas (default: desligadas)
    if (t.id === 'scheduling' && !((tenant as any).scheduling_enabled)) return false;
    if (t.id === 'quotes' && !((tenant as any).quotes_feature_enabled)) return false;
    
    return true;
  }).map(t => (tabsConfig[t.id]?.label ? { ...t, label: tabsConfig[t.id].label as string } : t));


  const groups: { id: GroupId; label: string; icon: React.ReactNode }[] = ([
    { id: 'dashboard' as GroupId, label: 'Início', icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'operation' as GroupId, label: 'Operação', icon: <ClipboardList className="h-4 w-4" /> },
    { id: 'catalog' as GroupId, label: 'Catálogo', icon: <BookOpen className="h-4 w-4" /> },
    { id: 'finance' as GroupId, label: 'Financeiro', icon: <DollarSign className="h-4 w-4" /> },
    { id: 'marketing' as GroupId, label: 'Marketing', icon: <Sparkles className="h-4 w-4" /> },
    { id: 'settings' as GroupId, label: 'Configurações', icon: <Settings className="h-4 w-4" /> },
  ]).filter(g => visibleTabs.some(t => t.group === g.id));

  const currentTab = visibleTabs.find(t => t.id === tab) ?? visibleTabs[0];
  const activeGroup: GroupId = currentTab?.group ?? 'dashboard';
  const subTabs = visibleTabs.filter(t => t.group === activeGroup && t.group !== 'dashboard');

  return (
    <AdminTabsConfigProvider value={tabsConfig}>
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {tenant.logo_url ? (
              <img src={tenant.logo_url} alt="" width={36} height={36} className="rounded-md object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-md gradient-primary flex items-center justify-center">
                <Store className="h-5 w-5 text-primary-foreground" />
              </div>
            )}
            <h1 className="font-heading text-lg text-foreground">{tenant.name} <span className="text-muted-foreground font-normal">- Admin</span></h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAdminTheme(adminTheme === 'dark' ? 'light' : 'dark')}
              title={adminTheme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              className="flex items-center justify-center h-9 w-9 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              {adminTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <a href={`/loja/${slug}/kds`} target="_blank" rel="noreferrer" title="Painel da cozinha (KDS)" className="flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
              <ChefHat className="h-4 w-4" /> <span className="hidden sm:inline">Cozinha</span>
            </a>
            <a href={`/loja/${slug}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors">
              <ArrowLeft className="h-4 w-4" /> Loja
            </a>
            <button onClick={handleLogout} className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-destructive">
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </div>

        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Nível 1: Grupos temáticos (6 botões fixos no máximo) */}
        <div className="flex gap-2 overflow-x-auto pb-3 mb-3">
          {groups.map(g => {
            const isActive = g.id === activeGroup;
            return (
              <button
                key={g.id}
                onClick={() => {
                  // Ao clicar num grupo, vai para a primeira aba dele
                  const first = visibleTabs.find(t => t.group === g.id);
                  if (first) setTab(first.id);
                }}
                className={`relative flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                  isActive ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                {g.icon} {g.label}
                {g.id === 'operation' && unreadChats > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
                    {unreadChats > 9 ? '9+' : unreadChats}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Nível 2: Sub-abas do grupo ativo (escondido se o grupo só tem 1 tela) */}
        {subTabs.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-4 mb-4 border-b border-border">
            {subTabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  tab === t.id ? 'bg-primary/15 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.icon} {t.label}
                {t.id === 'customer-chats' && unreadChats > 0 && (
                  <span className="ml-1 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {unreadChats > 9 ? '9+' : unreadChats}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Cabeçalho da tela atual + botão de ajuda contextual */}
        {currentTab && (
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 text-foreground">
              {currentTab.icon}
              <h2 className="font-heading text-base">{currentTab.label}</h2>
            </div>
            <HelpButton topic={currentTab.id} label="Como usar" />
          </div>
        )}

        {!isAffiliate && <CreditCardReminder tenantId={tenant.id} />}
        <div className="animate-fade-in" key={tab}>
          {tab === 'dashboard' && (
            <>
              {!isAffiliate && <InvoiceAlertBanner tenantId={tenant.id} onOpenBilling={() => setTab('billing')} />}
              {!isAffiliate && <OnboardingChecklist tenantId={tenant.id} tenant={tenant} onNavigate={(t) => {
                const map: Record<string, Tab> = { settings: 'appearance', products: 'products', shipping: 'shipping', orders: 'orders' };
                setTab((map[t] as Tab) || 'dashboard');
              }} />}
              {isAffiliate ? <TenantAffiliateDashboard tenantId={tenant.id} /> : <TenantAdminDashboard tenantId={tenant.id} />}
            </>
          )}
          {tab === 'customer-chats' && (
            <TenantAdminCustomerChats tenantId={tenant.id} focusOrderId={focusOrderId} />
          )}
          {tab === 'orders' && (
            <TenantAdminOrders tenantId={tenant.id} tenantName={tenant.name} />
          )}
          {tab === 'live-floor' && <TenantLiveFloor tenantId={tenant.id} />}
          {tab === 'tables' && <TenantAdminTables tenantId={tenant.id} slug={slug!} />}
          {tab === 'quicksale' && (
            <TenantQuickSale tenantId={tenant.id} printerEnabled={(tenant as any).printer_enabled} />
          )}
          {tab === 'products' && <TenantAdminProducts tenantId={tenant.id} isDropshipping={isDropshipping} isAffiliate={isAffiliate} />}
          {tab === 'categories' && <TenantCategoriesTree tenantId={tenant.id} />}
          {tab === 'suppliers' && <TenantAdminSuppliers tenantId={tenant.id} slug={slug!} />}
          {tab === 'consultora' && <TenantAdminDropshippingWhatsApp tenantId={tenant.id} />}
          {tab === 'drivers' && <TenantAdminDrivers tenantId={tenant.id} slug={slug!} />}
          {tab === 'shipping' && <TenantAdminShipping tenantId={tenant.id} />}
          {tab === 'financial' && <TenantFinancialManager tenantId={tenant.id} />}
          {tab === 'users' && <TenantAdminUsers tenantId={tenant.id} />}
          {tab === 'sales' && <TenantSalesRanking tenantId={tenant.id} />}
          {tab === 'commissions' && <TenantWaiterCommissions tenantId={tenant.id} />}
          {tab === 'sellers' && <TenantSellerManagement tenantId={tenant.id} />}
          {tab === 'abc' && <TenantAbcCurve tenantId={tenant.id} />}
          {tab === 'bi' && <TenantBIDashboard tenantId={tenant.id} />}
          {tab === 'clicks' && <TenantAffiliateClicksRanking tenantId={tenant.id} />}
          {tab === 'promo' && <TenantPromoManager tenantId={tenant.id} niche={(tenant as any).niche} />}
          {tab === 'sofia-agent' && <SofiaStoreAgent tenantId={tenant.id} tenantName={(tenant as any).name || tenant.slug} />}
          {tab === 'prospecting' && <SuperAdminProspecting scope="client" tenantId={tenant.id} label="Prospecção" />}
          {tab === 'remote-prospecting' && <SuperAdminRemoteProspecting scope="client" tenantId={tenant.id} label="Prospecção Remota" />}
          {tab === 'posts' && <MarketingPostGenerator scope="tenant" tenantId={tenant.id} title="Posts do dia (Instagram, Stories, Reels...)" />}
          {tab === 'coupons' && <TenantAdminCoupons tenantId={tenant.id} />}
          {tab === 'coupons-test' && <TenantAdminCouponsTest tenantId={tenant.id} tenantSlug={slug!} />}
          {tab === 'reviews' && <TenantAdminReviews tenantId={tenant.id} />}
          {tab === 'billing' && <TenantBillingPanel tenantId={tenant.id} blockedUntil={(tenant as any).billing_blocked_until} />}
          {tab === 'appearance' && <TenantAppearance tenantId={tenant.id} />}
          {tab === 'printer' && <TenantAdminPrinter tenantId={tenant.id} />}
          {tab === 'integrations' && <TenantAdminIntegrations tenantId={tenant.id} />}
          {tab === 'fiscal' && <TenantAdminFiscal tenantId={tenant.id} />}
          {tab === 'ficha' && <TenantAdminFichaTecnica tenantId={tenant.id} />}
          {tab === 'stock' && <TenantAdminStock tenantId={tenant.id} />}
          {tab === 'price-intelligence' && <TenantPriceIntelligence tenantId={tenant.id} />}
          {tab === 'finance-deep' && <TenantAdminFinanceDeep tenantId={tenant.id} />}
          {tab === 'reports' && <TenantAdminReports tenantId={tenant.id} />}
          {tab === 'support' && <TenantAdminSupport tenantId={tenant.id} />}
          {tab === 'automations' && <TenantAdminAutomations tenantId={tenant.id} />}
          {tab === 'monitor' && <TenantAdminAutomationsMonitor tenantId={tenant.id} />}
          {tab === 'diagnostic' && <TenantAdminAutomationsDiagnostic tenantId={tenant.id} />}
          {tab === 'emails' && <TenantAdminEmails tenantId={tenant.id} />}
          {tab === 'scheduling' && <TenantAdminScheduling tenantId={tenant.id} />}
          {tab === 'quotes' && (
            <TenantAdminQuotes
              tenantId={tenant.id}
              quotesEnabled={(tenant as any).quotes_enabled ?? false}
              quotesIntroText={(tenant as any).quotes_intro_text ?? ''}
              onTenantUpdate={() => window.location.reload()}
            />
          )}
        </div>
      </div>

      {/* Sofia — papel travado: lojista. Backend busca pedidos abertos, status, etc. */}
      <SofiaChat
        role="merchant"
        tenantId={tenant.id}
        greeting={`Oi! Sou a **Sofia** ✨ Sou sua assistente AQUI no painel da **${tenant.name}**. Pergunta onde clicar, como configurar ou resolver qualquer coisa do admin.`}
      />

      {/* Clara global — abre quando a Sofia faz handoff (`clara:open-request`)
          de qualquer aba do admin, não só do painel Empresarial. */}
      <ClaraChat
        tenantId={tenant.id}
        tenantName={tenant.name}
        open={globalClaraOpen}
        onClose={() => setGlobalClaraOpen(false)}
      />
      <ClaraFab />
    </div>
    </AdminTabsConfigProvider>
  );
};

const PRESET_COLORS = [
  { name: 'Branco + Azul confiança', primary: '#2563EB', bg: '#FFFFFF', tip: 'Versátil. Bom pra serviços, varejo, delivery em geral.' },
  { name: 'Branco + Laranja apetite', primary: '#F97316', bg: '#FFFFFF', tip: 'Ideal pra fast food, lanches, bebidas — estimula fome.' },
  { name: 'Branco + Vermelho urgência', primary: '#DC2626', bg: '#FFFFFF', tip: 'Pizzaria, hambúrguer, promoções — ação imediata.' },
  { name: 'Branco + Verde frescor', primary: '#059669', bg: '#FFFFFF', tip: 'Saudável, hortifruti, farmácia, açaí.' },
  { name: 'Creme + Marrom artesanal', primary: '#92400E', bg: '#FAF7F2', tip: 'Cafeteria, padaria, doceria, comida caseira.' },
  { name: 'Branco + Rosa beleza', primary: '#DB2777', bg: '#FFFFFF', tip: 'Salão, estética, manicure, floricultura.' },
  { name: 'Branco + Roxo premium', primary: '#7C3AED', bg: '#FFFFFF', tip: 'Boutique, perfumaria, experiência premium.' },
  { name: 'Areia + Verde sage', primary: '#4D7C0F', bg: '#F5F3EE', tip: 'Wellness, orgânico, vegano.' },
  { name: 'Escuro + Dourado luxo', primary: '#D4A84C', bg: '#0F0F0F', tip: 'Bar noturno, restaurante fine dining, gaming.' },
  { name: 'Escuro + Azul tech', primary: '#3B82F6', bg: '#0F172A', tip: 'Tecnologia, gaming, eletrônicos.' },
];


const TenantAppearance = ({ tenantId }: { tenantId: string }) => {
  const [splashColor, setSplashColor] = useState('#0F172A');
  const [primaryColor, setPrimaryColor] = useState('#3B82F6');
  const [bgColor, setBgColor] = useState('#0F172A');
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [reviewMode, setReviewMode] = useState(false);
  const [isDropshipping, setIsDropshipping] = useState(false);
  const [storeMode, setStoreMode] = useState<StoreMode>('delivery');
  const [dropshippingSubmode, setDropshippingSubmode] = useState<'standard' | 'whatsapp'>('standard');
  const [consultoraPhone, setConsultoraPhone] = useState('');
  const [defaultAddrSrc, setDefaultAddrSrc] = useState<'customer' | 'store'>('customer');
  const [storeAddress, setStoreAddress] = useState('');
  const [storeCep, setStoreCep] = useState('');
  const [pickupEnabled, setPickupEnabled] = useState(true);
  const [whatsappShowPix, setWhatsappShowPix] = useState(false);
  const [pixKey, setPixKey] = useState('');
  const [pixKeyType, setPixKeyType] = useState('');
  const [paymentProvider, setPaymentProvider] = useState<'mercadopago' | 'pagbank' | 'infinitepay' | 'asaas'>('mercadopago');
  const [infinitePayHandle, setInfinitePayHandle] = useState('');
  const [infinitePayDocument, setInfinitePayDocument] = useState('');
  const [infinitePayEnabled, setInfinitePayEnabled] = useState(false);
  const [infinitePayFees, setInfinitePayFees] = useState<Record<string, { percent: string; fixed: string }>>(() => Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), { percent: '', fixed: '' }])));
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [llmKey, setLlmKey] = useState('');
  const [llmSecret, setLlmSecret] = useState('');
  const [llmMarket, setLlmMarket] = useState('BR_SAO');
  const [llmSandbox, setLlmSandbox] = useState(true);
  const [uberEnabled, setUberEnabled] = useState(false);
  const [uberCustomerId, setUberCustomerId] = useState('');
  const [uberClientId, setUberClientId] = useState('');
  const [uberClientSecret, setUberClientSecret] = useState('');
  const [uberSandbox, setUberSandbox] = useState(true);
  const [catalogLayout, setCatalogLayout] = useState<'grid'|'list'|'compact'|'magazine'>('grid');
  const [splashEnabled, setSplashEnabled] = useState(true);
  const [showDescription, setShowDescription] = useState(true);
  const [showTitle, setShowTitle] = useState(true);
  const [description, setDescription] = useState('');
  // Quando não há motoboy online, oferecer retirada na loja (padrão) ou seguir o
  // pedido de delivery cobrando o frete calculado (cliente organiza a própria retirada, ex.: Uber Moto).
  const [pickupAsFallback, setPickupAsFallback] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('tenants').select('splash_bg_color, brand_primary_color, brand_bg_color, is_dropshipping, auto_dropshipping_enabled, dropshipping_review_mode, store_mode, pickup_enabled, pix_key, pix_key_type, lalamove_enabled, lalamove_api_key, lalamove_api_secret, lalamove_market, lalamove_sandbox, uber_direct_enabled, uber_direct_customer_id, uber_direct_client_id, uber_direct_client_secret, uber_direct_sandbox, catalog_layout, product_splash_enabled, whatsapp_show_pix, dropshipping_submode, whatsapp_consultora_phone, whatsapp_default_address_source, whatsapp_store_address, whatsapp_store_cep, show_description, show_title, description, payment_provider, infinitepay_handle, infinitepay_document, infinitepay_enabled, infinitepay_installment_fees').eq('id', tenantId).single().then(({ data }) => {
      if (data) {
        setSplashColor((data as any).splash_bg_color || '#0F172A');
        setPrimaryColor((data as any).brand_primary_color || '#3B82F6');
        setBgColor((data as any).brand_bg_color || '#0F172A');
        setIsDropshipping((data as any).is_dropshipping ?? false);
        setAutoEnabled((data as any).auto_dropshipping_enabled ?? true);
        setReviewMode((data as any).dropshipping_review_mode ?? false);
        setStoreMode(((data as any).store_mode as StoreMode) || 'delivery');
        setPickupEnabled((data as any).pickup_enabled ?? true);
        setWhatsappShowPix((data as any).whatsapp_show_pix ?? false);
        setPixKey((data as any).pix_key || '');
        setPixKeyType((data as any).pix_key_type || '');
        setPaymentProvider(((data as any).payment_provider as any) || 'mercadopago');
        setInfinitePayHandle((data as any).infinitepay_handle || '');
        setInfinitePayDocument((data as any).infinitepay_document || '');
        setInfinitePayEnabled((data as any).infinitepay_enabled ?? false);
        setInfinitePayFees((prev) => ({ ...prev, ...Object.fromEntries(Object.entries((data as any).infinitepay_installment_fees || {}).map(([k, v]: any) => [k, { percent: String(v?.percent ?? ''), fixed: String(v?.fixed ?? '') }])) }));
        setLlmEnabled((data as any).lalamove_enabled ?? false);
        setLlmKey((data as any).lalamove_api_key || '');
        setLlmSecret((data as any).lalamove_api_secret || '');
        setLlmMarket((data as any).lalamove_market || 'BR_SAO');
        setLlmSandbox((data as any).lalamove_sandbox ?? true);
        setUberEnabled((data as any).uber_direct_enabled ?? false);
        setUberCustomerId((data as any).uber_direct_customer_id || '');
        setUberClientId((data as any).uber_direct_client_id || '');
        setUberClientSecret((data as any).uber_direct_client_secret || '');
        setUberSandbox((data as any).uber_direct_sandbox ?? true);
        setCatalogLayout(((data as any).catalog_layout as any) || 'grid');
        setSplashEnabled((data as any).product_splash_enabled !== false);
        setDropshippingSubmode(((data as any).dropshipping_submode as any) || 'standard');
        setConsultoraPhone((data as any).whatsapp_consultora_phone || '');
        setDefaultAddrSrc(((data as any).whatsapp_default_address_source as any) || 'customer');
        setStoreAddress((data as any).whatsapp_store_address || '');
        setStoreCep((data as any).whatsapp_store_cep || '');
        setShowDescription((data as any).show_description !== false);
        setShowTitle((data as any).show_title !== false);
        setDescription((data as any).description || '');
        setPickupAsFallback((data as any).pickup_as_delivery_fallback !== false);
      }
    });
  }, [tenantId]);

  const save = async () => {
    setSaving(true);
    await supabase.from('tenants').update({
      splash_bg_color: splashColor,
      brand_primary_color: primaryColor,
      brand_bg_color: bgColor,
      auto_dropshipping_enabled: autoEnabled,
      dropshipping_review_mode: reviewMode,
      store_mode: storeMode,
      // pickup_enabled só faz sentido no modo "delivery" puro; nos outros forçamos default lógico
      pickup_enabled: storeMode === 'local' ? true : storeMode === 'delivery' ? pickupEnabled : storeMode === 'hybrid' ? true : false,
      pix_key: pixKey.trim(),
      whatsapp_show_pix: whatsappShowPix,
      pix_key_type: pixKeyType,
      payment_provider: paymentProvider,
      infinitepay_handle: infinitePayHandle.trim() || null,
      infinitepay_document: infinitePayDocument.replace(/\D/g, '') || null,
      infinitepay_enabled: infinitePayEnabled,
      infinitepay_installment_fees: Object.fromEntries(Object.entries(infinitePayFees).map(([k, v]) => [k, { percent: Number(v.percent.replace(',', '.')) || 0, fixed: Number(v.fixed.replace(',', '.')) || 0 }])) ,
      lalamove_enabled: llmEnabled,
      lalamove_api_key: llmKey.trim(),
      lalamove_api_secret: llmSecret.trim(),
      lalamove_market: llmMarket,
      lalamove_sandbox: llmSandbox,
      uber_direct_enabled: uberEnabled,
      uber_direct_customer_id: uberCustomerId.trim(),
      uber_direct_client_id: uberClientId.trim(),
      uber_direct_client_secret: uberClientSecret.trim(),
      uber_direct_sandbox: uberSandbox,
      // is_dropshipping = true sempre que houver dropshipping (puro ou híbrido)
      is_dropshipping: storeMode === 'dropshipping' || storeMode === 'hybrid',
      catalog_layout: catalogLayout,
      product_splash_enabled: splashEnabled,
      show_description: showDescription,
      show_title: showTitle,
      description: description.trim(),
      pickup_as_delivery_fallback: pickupAsFallback,
      dropshipping_submode: (storeMode === 'dropshipping' || storeMode === 'hybrid') ? dropshippingSubmode : 'standard',
      whatsapp_consultora_phone: consultoraPhone.trim(),
      whatsapp_default_address_source: defaultAddrSrc,
      whatsapp_store_address: storeAddress.trim(),
      whatsapp_store_cep: storeCep.trim(),
    } as any).eq('id', tenantId);
    setSaving(false);
    import('sonner').then(m => m.toast.success('Configurações salvas! Recarregue a loja para ver.'));
  };

  const applyPreset = (p: typeof PRESET_COLORS[number]) => {
    setPrimaryColor(p.primary);
    setBgColor(p.bg);
    setSplashColor(p.bg);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
          🏪 Tipo da loja
        </h3>
        <p className="text-xs text-muted-foreground">Define como sua loja funciona. Mude com cuidado — afeta o checkout dos clientes.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { id: 'local' as const, label: '🏪 Só Local (Retirada)', desc: 'Sem entrega. Cliente sempre retira na loja. Status: Recebido → Preparando → Pronto p/ Retirada → Entregue.' },
            { id: 'delivery' as const, label: '🛵 Delivery', desc: 'Você (ou fornecedor) entrega com motoboy próprio ou Lalamove. Retirada opcional.' },
            { id: 'dropshipping' as const, label: '📦 Só Dropshipping', desc: 'Pedido vai direto ao fornecedor que cuida da entrega (motoboy próprio ou Lalamove).' },
            { id: 'hybrid' as const, label: '🔀 Local + Delivery', desc: 'Você decide caso a caso: produto retirado na loja OU entregue por você/fornecedor.' },
            { id: 'affiliate' as const, label: '🔗 Afiliado', desc: 'Botão "Comprar" leva pro link do parceiro (Shopee, Amazon, etc).' },
            { id: 'whatsapp' as const, label: '💬 Fechamento no WhatsApp', desc: 'Cliente monta o carrinho e finaliza no WhatsApp com a mensagem pronta. Sem pagamento pelo site.' },
            { id: 'supermarket' as const, label: '🏬 Padrão Supermercado / Distribuidora', desc: 'Site institucional premium (banner, selos, vitrine, sobre, parceiro, contato) com fechamento no WhatsApp. Tudo editável abaixo.' },
          ].map(opt => (
            <button key={opt.id} onClick={() => setStoreMode(opt.id)}
              className={`text-left rounded-lg border p-3 transition-all ${
                storeMode === opt.id ? 'border-primary bg-primary/10' : 'border-border bg-secondary hover:border-primary/50'
              }`}>
              <p className="text-sm font-medium text-foreground">{opt.label}</p>
              <p className="text-xs text-muted-foreground mt-1">{opt.desc}</p>
            </button>
          ))}
        </div>

        {storeMode === 'delivery' && (
          <label className="flex items-center gap-2 mt-2 cursor-pointer rounded-lg border border-border bg-secondary p-3">
            <input type="checkbox" checked={pickupEnabled} onChange={e => setPickupEnabled(e.target.checked)}
              className="w-4 h-4 accent-primary" />
            <div>
              <p className="text-sm text-foreground">Aceitar retirada na loja como opção</p>
              <p className="text-xs text-muted-foreground">Se desligado, cliente só vai conseguir pedir delivery (com endereço).</p>
            </div>
          </label>
        )}

        {(storeMode === 'whatsapp' || storeMode === 'supermarket') && (
          <label className="flex items-center gap-2 mt-2 cursor-pointer rounded-lg border border-border bg-secondary p-3">
            <input type="checkbox" checked={whatsappShowPix} onChange={e => setWhatsappShowPix(e.target.checked)}
              className="w-4 h-4 accent-primary" />
            <div>
              <p className="text-sm text-foreground">Mostrar minha chave Pix no checkout</p>
              <p className="text-xs text-muted-foreground">Ligado: o cliente já vê a chave e pode chegar no WhatsApp com o comprovante. Desligado: você combina o pagamento no chat.</p>
            </div>
          </label>
        )}

      </div>

      {storeMode === 'supermarket' && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
          <h3 className="font-heading text-sm text-foreground">🏬 Site do supermercado / distribuidora</h3>
          <p className="text-xs text-muted-foreground">Todo o conteúdo do site é editável aqui — inclusive a foto de fundo do topo.</p>
          <StorefrontEditor tenantId={tenantId} />
        </div>
      )}

      <BrandColorsPanel
        primaryColor={primaryColor}
        setPrimaryColor={setPrimaryColor}
        bgColor={bgColor}
        setBgColor={setBgColor}
        setSplashColor={setSplashColor}
        applyPreset={applyPreset}
        tenantId={tenantId}
      />

      <CatalogLayoutPanel layout={catalogLayout} setLayout={setCatalogLayout} splashEnabled={splashEnabled} setSplashEnabled={setSplashEnabled} />

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
          ✍️ Texto da loja (vitrine)
        </h3>
        <p className="text-xs text-muted-foreground">O que aparece em cima do texto da sua loja na vitrine pública. Você escolhe o que aparece ou não.</p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={showTitle} onChange={e => setShowTitle(e.target.checked)} className="mt-1 accent-primary" />
          <div>
            <p className="text-sm text-foreground font-medium">Mostrar nome da loja na vitrine</p>
            <p className="text-xs text-muted-foreground">Desligado: a vitrine não mostra o título em cima do texto.</p>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={showDescription} onChange={e => setShowDescription(e.target.checked)} className="mt-1 accent-primary" />
          <div>
            <p className="text-sm text-foreground font-medium">Mostrar texto na vitrine</p>
            <p className="text-xs text-muted-foreground">Desligado: a vitrine mostra só o nome e a logo, sem texto embaixo.</p>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={pickupAsFallback} onChange={e => setPickupAsFallback(e.target.checked)} className="mt-1 accent-primary" />
          <div>
            <p className="text-sm text-foreground font-medium">Oferecer retirada na loja quando não houver motoboy online</p>
            <p className="text-xs text-muted-foreground">Ligado: sem motoboy, o cliente pode retirar na loja (frete grátis). Desligado: o pedido de delivery segue mesmo assim cobrando o frete calculado — o cliente organiza a própria retirada da entrega (ex.: Uber Moto).</p>
          </div>
        </label>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Texto da vitrine</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} maxLength={300}
            placeholder="Ex: Moda contemporânea para ela e para ele — elegância em cada peça."
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground disabled:opacity-50 resize-y" />
          <p className="text-[10px] text-muted-foreground text-right mt-1">{description.length}/300</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="font-heading text-sm text-foreground flex items-center gap-2">💳 Provedor de pagamento</h3>
        <select value={paymentProvider} onChange={e => setPaymentProvider(e.target.value as any)} className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
          <option value="mercadopago">Mercado Pago</option><option value="asaas">Asaas</option><option value="pagbank">PagBank</option><option value="infinitepay">InfinitePay</option>
        </select>
        {paymentProvider === 'infinitepay' && <>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={infinitePayEnabled} onChange={e => setInfinitePayEnabled(e.target.checked)} /> Ativar InfinitePay nesta loja</label>
          <input value={infinitePayHandle} onChange={e => setInfinitePayHandle(e.target.value)} placeholder="Handle InfinitePay" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          <input value={infinitePayDocument} onChange={e => setInfinitePayDocument(e.target.value)} placeholder="CPF/CNPJ do recebedor" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          <p className="text-xs text-muted-foreground">Cartão via InfinitePay Tap fica para pagamento na entrega. Pix online exige confirmação automática.</p>
          <div className="grid grid-cols-3 gap-2">{Array.from({ length: 12 }, (_, i) => { const k = String(i + 1); const row = infinitePayFees[k] || { percent: '', fixed: '' }; return <div key={k} className="rounded border border-border p-2"><b className="text-xs">{k}x</b><input value={row.percent} onChange={e => setInfinitePayFees({ ...infinitePayFees, [k]: { ...row, percent: e.target.value } })} placeholder="%" className="mt-1 w-full rounded border bg-secondary px-1 py-1 text-xs" /><input value={row.fixed} onChange={e => setInfinitePayFees({ ...infinitePayFees, [k]: { ...row, fixed: e.target.value } })} placeholder="R$ fixo" className="mt-1 w-full rounded border bg-secondary px-1 py-1 text-xs" /></div>; })}</div>
        </>}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
          💸 Chave Pix da loja (pagamento na entrega)
        </h3>
        <p className="text-xs text-muted-foreground">Quando o cliente escolher Pix como pagamento na entrega, essa chave aparece pra ele copiar no checkout e também no resumo do pedido pro motoboy.</p>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Tipo da chave</label>
          <select value={pixKeyType} onChange={e => setPixKeyType(e.target.value)}
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
            <option value="">— selecione —</option>
            <option value="CPF">CPF</option>
            <option value="CNPJ">CNPJ</option>
            <option value="E-mail">E-mail</option>
            <option value="Telefone">Telefone</option>
            <option value="Aleatória">Aleatória</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Chave Pix</label>
          <input value={pixKey} onChange={e => setPixKey(e.target.value)}
            placeholder="Ex: 123.456.789-00 ou loja@email.com"
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground font-mono" />
        </div>
        <p className="text-[10px] text-muted-foreground">⚠️ Deixe vazio se não quiser aceitar Pix na entrega — clientes ainda podem pagar via Mercado Pago se estiver configurado.</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
          🏍️ Lalamove (motoboy automático)
        </h3>
        <p className="text-xs text-muted-foreground">
          Quando você não tiver motoboy próprio cadastrado, o sistema chama um motoboy da Lalamove automaticamente ao despachar o pedido. Crie sua conta em{' '}
          <a href="https://developers.lalamove.com/" target="_blank" rel="noreferrer" className="text-primary underline">developers.lalamove.com</a> pra pegar a API Key e o Secret.
        </p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={llmEnabled} onChange={e => setLlmEnabled(e.target.checked)} className="mt-1 accent-primary" />
          <div>
            <p className="text-sm text-foreground font-medium">Ativar Lalamove como fallback</p>
            <p className="text-xs text-muted-foreground">Sem motoboy próprio ativo? Aciona Lalamove sozinho ao avançar pra "Saiu para entrega".</p>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={llmSandbox} onChange={e => setLlmSandbox(e.target.checked)} className="mt-1 accent-primary" />
          <div>
            <p className="text-sm text-foreground font-medium">Modo sandbox (testes)</p>
            <p className="text-xs text-muted-foreground">Use enquanto testa. Desligue só quando tiver chaves de produção da Lalamove.</p>
          </div>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">API Key</label>
            <input value={llmKey} onChange={e => setLlmKey(e.target.value)} placeholder="pk_test_..." disabled={!llmEnabled}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground font-mono disabled:opacity-50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">API Secret</label>
            <input value={llmSecret} onChange={e => setLlmSecret(e.target.value)} placeholder="sk_test_..." type="password" disabled={!llmEnabled}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground font-mono disabled:opacity-50" />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Mercado / cidade</label>
          <select value={llmMarket} onChange={e => setLlmMarket(e.target.value)} disabled={!llmEnabled}
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground disabled:opacity-50">
            <option value="BR_SAO">São Paulo (BR_SAO)</option>
            <option value="BR_RIO">Rio de Janeiro (BR_RIO)</option>
            <option value="BR_BHZ">Belo Horizonte (BR_BHZ)</option>
            <option value="BR_CWB">Curitiba (BR_CWB)</option>
            <option value="BR_FOR">Fortaleza (BR_FOR)</option>
            <option value="BR_SSA">Salvador (BR_SSA)</option>
            <option value="BR_POA">Porto Alegre (BR_POA)</option>
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
          🚗 Uber Direct (entrega Uber)
        </h3>
        <p className="text-xs text-muted-foreground">
          Crie uma conta gratuita em{' '}
          <a href="https://developer.uber.com/" target="_blank" rel="noreferrer" className="text-primary underline">developer.uber.com</a>{' '}
          → crie um app Direct → copie os 3 campos da tela "Chaves de API". Sandbox é grátis pra testar.
          Quando ativo junto com Lalamove, o sistema cota os dois e mostra <strong>a entrega mais barata</strong> pro cliente.
        </p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={uberEnabled} onChange={e => setUberEnabled(e.target.checked)} className="mt-1 accent-primary" />
          <div>
            <p className="text-sm text-foreground font-medium">Ativar Uber Direct</p>
            <p className="text-xs text-muted-foreground">Sistema cota Uber junto com Lalamove e usa a mais barata.</p>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={uberSandbox} onChange={e => setUberSandbox(e.target.checked)} className="mt-1 accent-primary" />
          <div>
            <p className="text-sm text-foreground font-medium">Modo sandbox (testes — gratuito)</p>
            <p className="text-xs text-muted-foreground">Use enquanto testa. Desligue só com credenciais de produção da Uber.</p>
          </div>
        </label>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Customer ID <span className="text-foreground/70">(na Uber: <strong>"ID do usuário"</strong>)</span></label>
          <input value={uberCustomerId} onChange={e => setUberCustomerId(e.target.value)} placeholder="ex: 82710010-3173-5a89-847b-eb09ad79d017" disabled={!uberEnabled}
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground font-mono disabled:opacity-50" />
          <p className="text-[10px] text-muted-foreground mt-1">UUID longo com traços. Aparece logo abaixo de "Nome do app".</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Client ID <span className="text-foreground/70">(na Uber: <strong>"ID de cliente do desenvolvedor"</strong>)</span></label>
            <input value={uberClientId} onChange={e => setUberClientId(e.target.value)} placeholder="ex: A7YaazA-XauI3BRV5aDgf18fwUvSr0WF" disabled={!uberEnabled}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground font-mono disabled:opacity-50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Client Secret <span className="text-foreground/70">(na Uber: <strong>"Client Secret"</strong>)</span></label>
            <input value={uberClientSecret} onChange={e => setUberClientSecret(e.target.value)} placeholder="clique em Mostrar na Uber pra ver" type="password" disabled={!uberEnabled}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground font-mono disabled:opacity-50" />
          </div>
        </div>
      </div>

      {isDropshipping && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
            🤖 Automação Dropshipping
          </h3>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={autoEnabled} onChange={e => setAutoEnabled(e.target.checked)} className="mt-1 accent-primary" />
            <div>
              <p className="text-sm text-foreground font-medium">Automação ligada</p>
              <p className="text-xs text-muted-foreground">Pedido vai direto ao fornecedor + status avança sozinho quando ele abre. Desligue se quiser controlar tudo manualmente.</p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={reviewMode} onChange={e => setReviewMode(e.target.checked)} disabled={!autoEnabled} className="mt-1 accent-primary disabled:opacity-50" />
            <div>
              <p className={`text-sm font-medium ${autoEnabled ? 'text-foreground' : 'text-muted-foreground'}`}>Modo revisar antes</p>
              <p className="text-xs text-muted-foreground">Pedidos novos ficam aguardando você aprovar antes de ir ao fornecedor. Bom pra começar com calma.</p>
            </div>
          </label>
          <p className="text-xs text-muted-foreground border-t border-border pt-2">
            💡 Toda mudança automática é registrada na linha do tempo de cada pedido (aba Pedidos → "Ver linha do tempo").
          </p>

          <div className="border-t border-border pt-3 space-y-3">
            <div>
              <p className="text-sm text-foreground font-medium mb-1">📲 Modo do dropshipping</p>
              <p className="text-xs text-muted-foreground mb-2">Escolha como os pedidos chegam ao fornecedor.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { id: 'standard' as const, label: '⚙️ Padrão', desc: 'Pedido vai pro painel do fornecedor automaticamente (jeito atual).' },
                  { id: 'whatsapp' as const, label: '💬 WhatsApp Consultora', desc: 'Você envia os pedidos via WhatsApp pra uma consultora externa (individual ou em lote).' },
                ].map(opt => (
                  <button key={opt.id} type="button" onClick={() => setDropshippingSubmode(opt.id)}
                    className={`text-left rounded-lg border p-3 transition-all ${
                      dropshippingSubmode === opt.id ? 'border-primary bg-primary/10' : 'border-border bg-secondary hover:border-primary/50'
                    }`}>
                    <p className="text-sm font-medium text-foreground">{opt.label}</p>
                    <p className="text-xs text-muted-foreground mt-1">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {dropshippingSubmode === 'whatsapp' && (
              <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">WhatsApp da consultora (com DDI/DDD, só números)</label>
                  <input value={consultoraPhone} onChange={e => setConsultoraPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="Ex: 5511999998888"
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground font-mono" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Endereço padrão pra envio</label>
                  <select value={defaultAddrSrc} onChange={e => setDefaultAddrSrc(e.target.value as any)}
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
                    <option value="customer">Endereço do cliente (consultora envia direto)</option>
                    <option value="store">Meu endereço (você recebe e repassa)</option>
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-1">Você ainda pode trocar pedido a pedido na aba "WhatsApp Consultora".</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">CEP de origem (pra estimar frete)</label>
                    <input value={storeCep} onChange={e => setStoreCep(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder="Ex: 01310100"
                      className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground font-mono" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Seu endereço (se "Meu endereço")</label>
                    <input value={storeAddress} onChange={e => setStoreAddress(e.target.value)}
                      placeholder="Rua, número, bairro, cidade"
                      className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">💡 Frete é estimado por CEP via ViaCEP (sem cobrança extra). A aba "WhatsApp Consultora" aparece no menu lateral quando esse modo está ativo.</p>
              </div>
            )}
          </div>
        </div>
      )}

      <button onClick={save} disabled={saving}
        className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
        {saving ? 'Salvando...' : 'Salvar todas as configurações'}
      </button>
    </div>
  );
};

export default TenantAdmin;

// ============================================================
// Painel de cores v2: presets por nicho + IA conselheira +
// alerta de contraste em tempo real + preview ao vivo
// ============================================================
type BrandColorsPanelProps = {
  primaryColor: string;
  setPrimaryColor: (v: string) => void;
  bgColor: string;
  setBgColor: (v: string) => void;
  setSplashColor: (v: string) => void;
  applyPreset: (p: typeof PRESET_COLORS[number]) => void;
  tenantId: string;
};

const BrandColorsPanel = ({ primaryColor, setPrimaryColor, bgColor, setBgColor, setSplashColor, applyPreset, tenantId }: BrandColorsPanelProps) => {
  const warning = contrastWarning(primaryColor, bgColor);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiNiche, setAiNiche] = useState('');
  const [aiDesc, setAiDesc] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);

  const askAI = async () => {
    if (!aiNiche.trim()) {
      const { toast } = await import('sonner');
      toast.error('Diga qual é o ramo da sua loja');
      return;
    }
    setAiLoading(true);
    setAiResult(null);
    try {
      const { data, error } = await unifiedInvoke("marketing-unified", "colors", { niche: aiNiche, description: aiDesc, storeName: '' });
      if (error) throw error;
      setAiResult(data);
    } catch (e: any) {
      const { toast } = await import('sonner');
      toast.error(e?.message || 'Erro ao consultar IA');
    } finally {
      setAiLoading(false);
    }
  };

  const applyAI = () => {
    if (!aiResult) return;
    setPrimaryColor(aiResult.primary);
    setBgColor(aiResult.bg);
    setSplashColor(aiResult.bg);
    setAiOpen(false);
  };

  // Texto auto-calculado pra preview (preto ou branco dependendo do fundo)
  const previewTextColor = (() => {
    const m = bgColor.replace('#', '').match(/.{2}/g);
    if (!m) return '#000';
    const [r, g, b] = m.map(x => parseInt(x, 16));
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.55 ? '#0F172A' : '#FFFFFF';
  })();
  const buttonTextColor = (() => {
    const m = primaryColor.replace('#', '').match(/.{2}/g);
    if (!m) return '#fff';
    const [r, g, b] = m.map(x => parseInt(x, 16));
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#0F172A' : '#FFFFFF';
  })();

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" /> Cores da sua loja
        </h3>
        <button
          onClick={() => setAiOpen(o => !o)}
          className="flex items-center gap-1.5 rounded-md bg-primary/10 text-primary border border-primary/30 px-2.5 py-1.5 text-xs font-medium hover:bg-primary/15 transition-colors"
        >
          <Wand2 className="h-3.5 w-3.5" /> Pedir conselho à IA
        </button>
      </div>

      {aiOpen && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 animate-fade-in">
          <p className="text-xs text-foreground font-medium">Me conta sobre seu negócio que eu sugiro a cor perfeita:</p>
          <input
            value={aiNiche}
            onChange={e => setAiNiche(e.target.value)}
            placeholder="Ex: hamburgueria, salão de beleza, açaí..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <input
            value={aiDesc}
            onChange={e => setAiDesc(e.target.value)}
            placeholder="(opcional) Estilo: moderno, rústico, jovem, premium..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <button
            onClick={askAI}
            disabled={aiLoading}
            className="flex items-center gap-1.5 rounded-md gradient-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {aiLoading ? 'Pensando...' : <><Sparkles className="h-3.5 w-3.5" /> Sugerir paleta</>}
          </button>
          {aiResult && (
            <div className="rounded-md border border-border bg-card p-3 space-y-2 mt-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-7 h-7 rounded-full border-2 border-border" style={{ backgroundColor: aiResult.primary }} />
                  <span className="w-7 h-7 rounded-full border-2 border-border" style={{ backgroundColor: aiResult.bg }} />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Sugestão da IA:</p>
                  <p className="text-xs font-mono text-foreground">{aiResult.primary} + {aiResult.bg}</p>
                </div>
                <button onClick={applyAI} className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium">
                  Aplicar
                </button>
              </div>
              {aiResult.reasoning && (
                <p className="text-xs text-muted-foreground italic">"{aiResult.reasoning}"</p>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <p className="text-xs text-muted-foreground mb-2">Temas prontos por nicho (clique pra aplicar):</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PRESET_COLORS.map(p => (
            <button key={p.name} onClick={() => applyPreset(p)}
              className="flex items-center gap-2 rounded-lg border border-border bg-secondary p-2 text-left hover:border-primary transition-colors">
              <div className="flex gap-0.5 shrink-0">
                <span className="w-5 h-5 rounded-l-full border border-border" style={{ backgroundColor: p.primary }} />
                <span className="w-5 h-5 rounded-r-full border border-border" style={{ backgroundColor: p.bg }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{p.tip}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Cor principal (botões, destaques)</label>
          <div className="flex items-center gap-2">
            <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
              className="w-12 h-10 rounded-lg border border-border cursor-pointer" />
            <input type="text" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-secondary px-2 py-2 text-foreground text-xs font-mono uppercase" />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Cor de fundo do site</label>
          <div className="flex items-center gap-2">
            <input type="color" value={bgColor} onChange={e => { setBgColor(e.target.value); setSplashColor(e.target.value); }}
              className="w-12 h-10 rounded-lg border border-border cursor-pointer" />
            <input type="text" value={bgColor} onChange={e => { setBgColor(e.target.value); setSplashColor(e.target.value); }}
              className="flex-1 rounded-lg border border-border bg-secondary px-2 py-2 text-foreground text-xs font-mono uppercase" />
          </div>
        </div>
      </div>

      {/* Alerta de contraste em tempo real */}
      <div className={`rounded-md border p-3 flex items-start gap-2 text-xs ${
        warning.level === 'ok' ? 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300'
        : warning.level === 'low' ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300'
        : 'border-destructive/40 bg-destructive/10 text-destructive'
      }`}>
        {warning.level === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
        <div>
          <p className="font-medium">{warning.message}</p>
          <p className="opacity-80 mt-0.5">Razão de contraste: {warning.ratio.toFixed(2)} (mínimo recomendado: 4.5)</p>
          <p className="opacity-80 mt-0.5">✨ A plataforma <strong>ajusta automaticamente</strong> a cor dos textos pra nunca sumirem no fundo que você escolher.</p>
        </div>
      </div>

      {/* Preview ao vivo com cores reais */}
      <div className="rounded-lg p-4 border border-border space-y-3" style={{ backgroundColor: bgColor, color: previewTextColor }}>
        <p className="text-xs opacity-70">Pré-visualização da sua loja:</p>
        <h4 className="text-lg font-bold" style={{ color: previewTextColor }}>Hambúrguer Especial</h4>
        <p className="text-sm opacity-80">Pão brioche, blend artesanal, queijo cheddar e bacon crocante.</p>
        <div className="flex items-center gap-2">
          <button className="px-4 py-2 rounded-lg text-sm font-medium shadow-sm" style={{ backgroundColor: primaryColor, color: buttonTextColor }}>
            Adicionar ao carrinho
          </button>
          <span className="text-sm font-bold" style={{ color: primaryColor }}>R$ 32,90</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">A cor de fundo também é usada na tela de abertura (splash) da sua loja.</p>
    </div>
  );
};

// ============================================================
// Painel de seleção de layout do cardápio (visual)
// ============================================================
const CatalogLayoutPanel = ({ layout, setLayout, splashEnabled = true, setSplashEnabled }: { layout: 'grid'|'list'|'compact'|'magazine'; setLayout: (l: any) => void; splashEnabled?: boolean; setSplashEnabled?: (v: boolean) => void }) => {
  const options = [
    { id: 'grid', label: 'Grade', desc: 'Cards grandes com foto. Bom pra produtos visuais (lanches, bebidas, moda).', preview: (
      <div className="grid grid-cols-2 gap-1.5">
        {[0,1,2,3].map(i => (
          <div key={i} className="rounded bg-muted/60 p-1.5">
            <div className="aspect-square rounded bg-primary/20 mb-1" />
            <div className="h-1 bg-foreground/40 rounded w-3/4 mb-0.5" />
            <div className="h-1 bg-foreground/20 rounded w-1/2" />
          </div>
        ))}
      </div>
    )},
    { id: 'list', label: 'Lista', desc: 'Linha horizontal com foto pequena. Estilo iFood. Bom pra muitos itens.', preview: (
      <div className="space-y-1.5">
        {[0,1,2].map(i => (
          <div key={i} className="flex gap-1.5 rounded bg-muted/60 p-1.5">
            <div className="w-8 h-8 rounded bg-primary/20 shrink-0" />
            <div className="flex-1 space-y-1 pt-0.5">
              <div className="h-1 bg-foreground/40 rounded w-2/3" />
              <div className="h-1 bg-foreground/20 rounded w-full" />
            </div>
          </div>
        ))}
      </div>
    )},
    { id: 'compact', label: 'Cardápio impresso', desc: 'Sem fotos, foco em nome + preço com pontilhado. Estilo restaurante.', preview: (
      <div className="rounded bg-muted/60 p-2 space-y-1.5">
        {[0,1,2,3].map(i => (
          <div key={i} className="flex items-center gap-1">
            <div className="h-1 bg-foreground/50 rounded w-1/3" />
            <div className="flex-1 border-b border-dashed border-foreground/30" />
            <div className="h-1 bg-primary/60 rounded w-6" />
          </div>
        ))}
      </div>
    )},
    { id: 'magazine', label: 'Revista (bento)', desc: 'Mosaico com destaque grande. Visual moderno, ótimo pra menos itens.', preview: (
      <div className="grid grid-cols-3 gap-1 h-20">
        <div className="col-span-2 row-span-2 rounded bg-primary/30" />
        <div className="rounded bg-primary/20" />
        <div className="rounded bg-primary/20" />
      </div>
    )},
  ] as const;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <h3 className="font-heading text-sm text-foreground flex items-center gap-2">📋 Estilo do cardápio</h3>
        <p className="text-xs text-muted-foreground mt-1">Escolha como seus produtos aparecem pro cliente. Cada negócio tem uma preferência.</p>
      </div>
      {setSplashEnabled && (
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">✨ Splash de produto ao clicar no card</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Quando ativado, tocar no card do produto abre o painel com carrossel de fotos/vídeo, descrição e botão de carrinho. Funciona em qualquer estilo de cardápio.</p>
          </div>
          <button type="button" role="switch" aria-checked={splashEnabled} onClick={() => setSplashEnabled(!splashEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${splashEnabled ? 'bg-primary' : 'bg-muted-foreground/40'}`}>
            <span className={`inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${splashEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </label>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map(opt => (
          <button key={opt.id} type="button" onClick={() => setLayout(opt.id)}
            className={`text-left rounded-lg border p-3 transition-all ${
              layout === opt.id ? 'border-primary bg-primary/10 ring-2 ring-primary/30' : 'border-border bg-secondary hover:border-primary/50'
            }`}>
            <div className="mb-2 h-24 overflow-hidden rounded bg-background/40 p-1.5">{opt.preview}</div>
            <p className="text-sm font-medium text-foreground">{opt.label}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
};
