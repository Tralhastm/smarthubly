import { useEffect, useRef, useState } from 'react';
import { ExternalLink, MapPin, AlertTriangle } from 'lucide-react';

interface Props {
  url: string;
  provider?: string | null;
}

/**
 * Tenta exibir o link de rastreio (Uber Entrega, 99, etc.) em iframe.
 * A maioria dos provedores envia X-Frame-Options/CSP que bloqueia iframe —
 * detectamos isso por timeout (sem evento `load` em 4s) e mostramos botão
 * "Abrir em nova aba" como fallback.
 */
const ExternalTrackingEmbed = ({ url, provider }: Props) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'blocked'>('loading');

  useEffect(() => {
    setState('loading');
    const timer = setTimeout(() => {
      setState((s) => (s === 'loading' ? 'blocked' : s));
    }, 4000);
    return () => clearTimeout(timer);
  }, [url]);

  const label = provider || 'serviço de entrega';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Rastreio via <strong className="text-foreground">{label}</strong>
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> Abrir em nova aba
        </a>
      </div>

      {state === 'blocked' ? (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 text-center space-y-3">
          <AlertTriangle className="h-6 w-6 text-yellow-500 mx-auto" />
          <div>
            <p className="text-sm text-foreground font-medium">{label} não permite exibir aqui dentro</p>
            <p className="text-xs text-muted-foreground mt-1">
              Por segurança, alguns serviços bloqueiam o rastreio dentro de outros sites.
              Toque no botão abaixo pra abrir o mapa oficial.
            </p>
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-500 text-white px-4 py-2.5 text-sm font-medium hover:bg-orange-600 transition w-full"
          >
            <MapPin className="h-4 w-4" /> Acompanhar no {label}
          </a>
        </div>
      ) : (
        <div className="relative rounded-lg overflow-hidden border border-border bg-card" style={{ height: 380 }}>
          {state === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-card/80 backdrop-blur-sm z-10">
              <p className="text-xs text-muted-foreground animate-pulse">Carregando rastreio…</p>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={url}
            title={`Rastreio ${label}`}
            className="absolute inset-0 w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            onLoad={() => setState('loaded')}
            onError={() => setState('blocked')}
          />
        </div>
      )}
    </div>
  );
};

export default ExternalTrackingEmbed;
