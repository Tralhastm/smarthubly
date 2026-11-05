import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LockKeyhole, Store } from 'lucide-react';

const SetAdminPassword = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tenantSlug = useMemo(() => {
    const value = searchParams.get('tenant') || '';
    return /^[a-z0-9-]+$/i.test(value) ? value : '';
  }, [searchParams]);
  const [sessionReady, setSessionReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setHasSession(Boolean(data.session?.user));
      setSessionReady(true);
    });
    return () => { active = false; };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!tenantSlug) { setError('O convite não identifica uma loja válida. Peça um novo convite ao administrador.'); return; }
    if (password.length < 8) { setError('A senha precisa ter pelo menos 8 caracteres.'); return; }
    if (password !== confirmPassword) { setError('As senhas não coincidem.'); return; }
    if (!hasSession) { setError('O link de convite expirou ou já foi usado. Peça um novo convite ao administrador.'); return; }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) { setError(updateError.message || 'Não foi possível definir a senha. Tente novamente.'); return; }
    navigate(`/loja/${encodeURIComponent(tenantSlug)}/admin`, { replace: true });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><Store className="h-6 w-6" /></div>
          <CardTitle className="font-heading text-2xl text-foreground">Ative seu acesso administrativo</CardTitle>
          <CardDescription>Crie uma senha para entrar no painel da loja.</CardDescription>
        </CardHeader>
        <CardContent>
          {!sessionReady ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Validando seu convite…</p>
          ) : !hasSession ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-destructive">Este convite é inválido, expirou ou já foi usado.</p>
              <p className="text-sm text-muted-foreground">Peça ao administrador da loja para enviar um novo convite.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block space-y-1.5 text-sm text-foreground">
                Nova senha
                <Input type="password" autoComplete="new-password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required placeholder="Pelo menos 8 caracteres" />
              </label>
              <label className="block space-y-1.5 text-sm text-foreground">
                Confirmar senha
                <Input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required placeholder="Digite a senha novamente" />
              </label>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <p className="flex items-start gap-2 text-xs text-muted-foreground"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Seu acesso administrativo é associado ao e-mail para o qual o convite foi enviado.</p>
              <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Salvando…' : 'Criar senha e entrar'}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
};

export default SetAdminPassword;
