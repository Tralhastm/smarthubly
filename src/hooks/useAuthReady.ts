import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

const AUTH_READY_TIMEOUT_MS = 8000;

export const useAuthReady = () => {
  const [isReady, setIsReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let active = true;

    const timeoutId = window.setTimeout(() => {
      // O painel deve sair do spinner mesmo se a API estiver indisponível.
      if (active) setIsReady(true);
    }, AUTH_READY_TIMEOUT_MS);

    void supabase.auth.getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session ?? null);
        setUser(data.session?.user ?? null);
      })
      .catch(() => {
        // Sem sessão é um estado válido para a tela de login.
      })
      .finally(() => {
        if (!active) return;
        window.clearTimeout(timeoutId);
        setIsReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession ?? null);
      setUser(nextSession?.user ?? null);
      setIsReady(true);
    });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  return { isReady, session, user };
};
