import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import SuperAdminLogin from '@/components/super-admin/SuperAdminLogin';
import SuperAdminDashboard from '@/components/super-admin/SuperAdminDashboard';
import SuperAdminTenants from '@/components/super-admin/SuperAdminTenants';
import SuperAdminMetrics from '@/components/super-admin/SuperAdminMetrics';
import SuperAdminFeeRequests from '@/components/super-admin/SuperAdminFeeRequests';
import { LayoutDashboard, Store, BarChart3, LogOut, Percent, Key, Bot, Users, Activity, DollarSign, Receipt, MapPin, Sun, Moon, Sparkles, Gauge, LifeBuoy, Code2 } from 'lucide-react';
import adminLogo from '@/assets/admin-logo.png';
import SuperAdminApiKeys from '@/components/super-admin/SuperAdminApiKeys';
import SuperAdminWorkers from '@/components/super-admin/SuperAdminWorkers';
import SuperAdminUsers from '@/components/super-admin/SuperAdminUsers';
import SuperAdminStoreHealth from '@/components/super-admin/SuperAdminStoreHealth';
import SuperAdminFinancialReport from '@/components/super-admin/SuperAdminFinancialReport';
import SuperAdminBilling from '@/components/super-admin/SuperAdminBilling';
import SuperAdminProspectingHub from '@/components/super-admin/SuperAdminProspectingHub';
import SuperAdminRemoteProspecting from '@/components/super-admin/SuperAdminRemoteProspecting';
import SuperAdminUsageMonitor from '@/components/super-admin/SuperAdminUsageMonitor';
import CindyChat from '@/components/super-admin/CindyChat';
import MarketingPostGenerator from '@/components/shared/MarketingPostGenerator';
import SuperAdminSupport from '@/components/super-admin/SuperAdminSupport';
import SuperAdminAiEditor from '@/components/super-admin/SuperAdminAiEditor';
import { useAuthReady } from '@/hooks/useAuthReady';

type Tab = 'dashboard' | 'tenants' | 'metrics' | 'fee_requests' | 'api_keys' | 'workers' | 'users' | 'health' | 'financial' | 'billing' | 'prospecting' | 'remote_prospecting' | 'marketing' | 'usage' | 'support' | 'ai_editor';

const SuperAdmin = () => {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return (localStorage.getItem('superadmin-theme') as 'light' | 'dark') || 'dark';
  });
  const { isReady, user } = useAuthReady();

  // Aplica tema apenas enquanto o Super Admin está montado.
  // Restaura ao sair pra não afetar a aba do cliente / outras rotas.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('superadmin-theme', theme);
    return () => {
      if (hadDark) root.classList.add('dark');
      else root.classList.remove('dark');
    };
  }, [theme]);

  const checkSuperAdmin = useCallback(async (userId?: string | null) => {
    if (userId) {
      const { data } = await supabase
        .from('platform_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'super_admin')
        .maybeSingle();
      setIsSuperAdmin(!!data);
    } else {
      setIsSuperAdmin(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    void checkSuperAdmin(user?.id ?? null);
  }, [checkSuperAdmin, isReady, user?.id]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsSuperAdmin(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return <SuperAdminLogin onLogin={checkSuperAdmin} />;
  }

  const tabs = [
    { id: 'dashboard' as Tab, label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'tenants' as Tab, label: 'Comércios', icon: <Store className="h-4 w-4" /> },
    { id: 'health' as Tab, label: 'Saúde Lojas', icon: <Activity className="h-4 w-4" /> },
    { id: 'financial' as Tab, label: 'Financeiro', icon: <DollarSign className="h-4 w-4" /> },
    { id: 'billing' as Tab, label: 'Cobranças', icon: <Receipt className="h-4 w-4" /> },
    { id: 'fee_requests' as Tab, label: 'Taxas', icon: <Percent className="h-4 w-4" /> },
    { id: 'metrics' as Tab, label: 'Métricas', icon: <BarChart3 className="h-4 w-4" /> },
    { id: 'api_keys' as Tab, label: 'API Keys', icon: <Key className="h-4 w-4" /> },
    { id: 'workers' as Tab, label: 'Workers IA', icon: <Bot className="h-4 w-4" /> },
    { id: 'users' as Tab, label: 'Usuários', icon: <Users className="h-4 w-4" /> },
    { id: 'prospecting' as Tab, label: 'Prospecção', icon: <MapPin className="h-4 w-4" /> },
    { id: 'remote_prospecting' as Tab, label: 'Prospecção Remota', icon: <Bot className="h-4 w-4" /> },
    { id: 'marketing' as Tab, label: 'Marketing IA', icon: <Sparkles className="h-4 w-4" /> },
    { id: 'usage' as Tab, label: 'Consumo & Margem', icon: <Gauge className="h-4 w-4" /> },
    { id: 'support' as Tab, label: 'Chamados', icon: <LifeBuoy className="h-4 w-4" /> },
    { id: 'ai_editor' as Tab, label: 'Editor IA', icon: <Code2 className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <img src={adminLogo} alt="Logo" className="w-9 h-9 rounded-lg object-contain" />
            <h1 className="font-heading text-lg text-gradient">Super Admin</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex items-center gap-1 rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Alternar tema"
              title={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button onClick={handleLogout} className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-destructive">
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <div className="flex gap-2 overflow-x-auto pb-4 mb-6">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                tab === t.id ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="animate-fade-in" key={tab}>
          {tab === 'dashboard' && <SuperAdminDashboard />}
          {tab === 'tenants' && <SuperAdminTenants />}
          {tab === 'health' && <SuperAdminStoreHealth />}
          {tab === 'financial' && <SuperAdminFinancialReport />}
          {tab === 'billing' && <SuperAdminBilling />}
          {tab === 'fee_requests' && <SuperAdminFeeRequests />}
          {tab === 'metrics' && <SuperAdminMetrics />}
          {tab === 'api_keys' && <SuperAdminApiKeys />}
          {tab === 'workers' && <SuperAdminWorkers />}
          {tab === 'users' && <SuperAdminUsers />}
          {tab === 'prospecting' && <SuperAdminProspectingHub />}
          {tab === 'remote_prospecting' && <SuperAdminRemoteProspecting />}
          {tab === 'marketing' && <MarketingPostGenerator scope="platform" allowImage title="Marketing da plataforma — posts, bio, reels..." defaultAudience="donos de pequenos comércios locais (bares, hambúrguerias, mercadinhos)" />}
          {tab === 'usage' && <SuperAdminUsageMonitor />}
          {tab === 'support' && <SuperAdminSupport />}
          {tab === 'ai_editor' && <SuperAdminAiEditor />}
        </div>
      </div>

      <CindyChat />
    </div>
  );
};

export default SuperAdmin;
