import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tenant } from '@/hooks/useTenants';
import { Input } from '@/components/ui/input';
import { Lock, Eye, EyeOff, UserPlus, Store } from 'lucide-react';

const TenantAdminLogin = ({ tenant, onLogin }: { tenant: Tenant; onLogin: () => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSignup, setIsSignup] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    if (isSignup) {
      // Fluxo simplificado: só email. Cria solicitação server-side via RPC, sem precisar logar.
      // Se a conta ainda não existir, ele cria a senha depois (no login normal) — a solicitação fica pendente pelo email.
      const { data, error: rpcError } = await supabase.rpc('request_admin_role_by_email', {
        _email: email.trim(),
        _tenant_id: tenant.id,
      });
      if (rpcError) {
        setError('Erro ao solicitar acesso. Tente novamente.');
        setLoading(false);
        return;
      }
      const result = data as { ok?: boolean; has_account?: boolean; already_pending?: boolean } | null;
      if (result?.already_pending) {
        setSuccess('Você já tem uma solicitação pendente. Aguarde a aprovação.');
      } else if (result?.has_account) {
        setSuccess('Solicitação enviada! Aguarde aprovação do administrador. Quando aprovado, faça login com a senha da sua conta.');
      } else {
        setSuccess('Solicitação enviada! O administrador vai te aprovar e te avisar para criar sua senha.');
      }
      setIsSignup(false);
      setPassword('');
    } else {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) {
        if (authError.message?.includes('Email not confirmed')) {
          setError('Email não confirmado. Verifique sua caixa de entrada.');
        } else {
          setError('Email ou senha incorretos.');
        }
        setLoading(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setError('Erro ao iniciar sessão.'); setLoading(false); return; }

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('approved')
        .eq('user_id', session.user.id)
        .eq('tenant_id', tenant.id)
        .eq('role', 'admin')
        .maybeSingle();

      // Also check super admin
      const { data: platformData } = await supabase
        .from('platform_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (!roleData && !platformData) {
        setError('Você não tem permissão.');
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }
      if (roleData && !roleData.approved && !platformData) {
        setError('Aguardando aprovação.');
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }
      onLogin();
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {tenant.logo_url ? (
            <img src={tenant.logo_url} alt="" className="mx-auto mb-4 h-16 w-16 rounded-xl object-cover" />
          ) : (
            <div className="mx-auto mb-4 w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center">
              <Store className="h-8 w-8 text-primary-foreground" />
            </div>
          )}
          <h1 className="font-heading text-xl text-foreground">{tenant.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isSignup ? 'Solicite acesso administrativo' : 'Painel Administrativo'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">Email</label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="admin@email.com" className="h-11 bg-secondary" />
          </div>
          {!isSignup && (
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Senha</label>
              <div className="relative">
                <Input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required={!isSignup} placeholder="••••••••" className="h-11 bg-secondary pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}
          {isSignup && (
            <p className="text-xs text-muted-foreground">
              Vamos enviar a solicitação para o dono da loja. Você só precisa do email — sem senha agora.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-primary">{success}</p>}

          <button type="submit" disabled={loading}
            className="gradient-primary flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {isSignup ? <UserPlus size={16} /> : <Lock size={16} />}
            {loading ? 'Aguarde...' : isSignup ? 'Solicitar Acesso' : 'Entrar'}
          </button>
        </form>

        <button onClick={() => { setIsSignup(!isSignup); setError(''); setSuccess(''); }}
          className="mt-6 block w-full text-center text-sm text-muted-foreground hover:text-primary">
          {isSignup ? 'Já tem conta? Fazer login' : 'Não tem acesso? Solicitar cadastro'}
        </button>
        <a href={`/loja/${tenant.slug}`} className="mt-4 block text-center text-sm text-muted-foreground hover:text-primary">← Voltar para a loja</a>
      </div>
    </div>
  );
};

export default TenantAdminLogin;
