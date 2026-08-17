// FAB da Clara — botão flutuante que abre a consultora empresarial.
// Fica acima da Sofia (bottom-24) pra não sobrepor. Some quando a Clara já está aberta.
// Dispara o mesmo evento global `clara:open-request` que a Sofia usa no handoff,
// então funciona em qualquer página que tenha o <ClaraChat /> escutando.

import { useEffect, useState } from 'react';
import { Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';

const ClaraFab = () => {
  const [claraOpen, setClaraOpen] = useState(
    typeof document !== 'undefined' && document.body.dataset.claraOpen === 'true'
  );
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => setClaraOpen(Boolean((e as CustomEvent).detail));
    window.addEventListener('clara:open', handler);
    return () => window.removeEventListener('clara:open', handler);
  }, []);

  // Mostra o bubble persuasivo só nos primeiros segundos depois que monta,
  // pra chamar atenção sem ficar poluindo pra sempre.
  useEffect(() => {
    const t1 = setTimeout(() => setShowHint(true), 1500);
    const t2 = setTimeout(() => setShowHint(false), 9000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (claraOpen) return null;

  const open = () => window.dispatchEvent(new CustomEvent('clara:open-request'));

  return (
    <div className="fixed bottom-24 right-5 z-50 flex items-end gap-2 max-w-[calc(100vw-1.5rem)]">
      {showHint && (
        <button
          onClick={open}
          className={cn(
            'relative bg-card border border-border rounded-2xl rounded-br-sm px-3 py-2',
            'shadow-lg max-w-[220px] text-left animate-in fade-in slide-in-from-right-2',
            'hover:border-primary/50 transition-colors'
          )}
          aria-label="Conversar com Clara"
        >
          <p className="text-xs leading-snug text-foreground">
            <span className="font-semibold text-primary">Fale com a Clara 💼</span>
            <br />
            <span className="text-muted-foreground">consultora dos seus números</span>
          </p>
          <span className="absolute -bottom-1.5 right-3 w-3 h-3 bg-card border-r border-b border-border rotate-45" />
        </button>
      )}

      <button
        onClick={open}
        aria-label="Abrir chat com Clara"
        className={cn(
          'group flex items-center gap-2 pl-3 pr-4 py-3 rounded-full',
          'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white',
          'shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:scale-105',
          'transition-all duration-200 shrink-0'
        )}
      >
        <div className="relative">
          <Briefcase className="h-5 w-5" />
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-success animate-pulse" />
        </div>
        <span className="font-medium text-sm hidden sm:inline">Clara</span>
      </button>
    </div>
  );
};

export default ClaraFab;
