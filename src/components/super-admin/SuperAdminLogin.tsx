import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Shield, Lock, Eye, EyeOff } from 'lucide-react';

const SuperAdminLogin = ({ onLogin }: { onLogin: (userId?: string | null) => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      setError('Email ou senha incorretos.');
      setLoading(false);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setError('Erro ao iniciar sessão.');
      setLoading(false);
      return;
    }

    const { data: roleData } = await supabase
      .from('platform_roles')
      .select('role')
      .eq('user_id', session.user.id)
      .eq('role', 'super_admin')
      .maybeSingle();

    if (!roleData) {
      setError('Você não tem permissão de super administrador.');
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    onLogin(session.user.id);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mb-4">
            <Shield className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="font-heading text-xl text-gradient">Super Admin</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Acesso restrito à gestão da plataforma
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="admin@plataforma.com"
              className="h-11 bg-secondary"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-muted-foreground">Senha</label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="h-11 bg-secondary pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="gradient-primary flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Lock size={16} />
            {loading ? 'Aguarde...' : 'Entrar'}
          </button>
        </form>

        <a href="/" className="mt-6 block text-center text-sm text-muted-foreground transition-colors hover:text-primary">
          ← Voltar
        </a>
      </div>
    </div>
  );
};

export default SuperAdminLogin;
