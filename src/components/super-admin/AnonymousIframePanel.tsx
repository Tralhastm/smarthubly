import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ExternalLink, RotateCcw, X, Minimize2, Maximize2 } from 'lucide-react';

export type IframeTool = {
  id: string;            // chave estável da ferramenta (ex: "gmail", "lovable")
  label: string;
  url: string;
};

type Session = { sessionId: string; tool: IframeTool };

type Props = {
  open: boolean;
  tools: IframeTool[];          // ferramentas abertas (mantidas vivas)
  activeId: string | null;      // qual está visível
  onActivate: (id: string) => void;
  onCloseTool: (id: string) => void;
  onClosePanel: () => void;
};

/**
 * Painel de iframes "anônimo-like" com abas:
 *  - Cada ferramenta aberta fica MONTADA (display:none) preservando sessão
 *  - "Nova" gera novo sessionId (key muda) → iframe é destruído e recriado vazio,
 *    como abrir uma nova guia anônima
 *  - Sandbox com allow-same-origin para storage funcionar no partition de terceiros
 *  - Fallback "abrir em nova aba" se o site bloquear via X-Frame-Options
 */
const AnonymousIframePanel = ({ open, tools, activeId, onActivate, onCloseTool, onClosePanel }: Props) => {
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Garante uma sessão para cada ferramenta aberta
  useEffect(() => {
    setSessions((prev) => {
      const next = { ...prev };
      for (const t of tools) {
        if (!next[t.id]) next[t.id] = { sessionId: crypto.randomUUID(), tool: t };
      }
      // remove sessões de ferramentas fechadas
      for (const id of Object.keys(next)) {
        if (!tools.find((t) => t.id === id)) delete next[id];
      }
      return next;
    });
  }, [tools]);

  const resetSession = (id: string) => {
    setSessions((prev) => ({
      ...prev,
      [id]: { ...prev[id], sessionId: crypto.randomUUID() },
    }));
  };

  if (!open || tools.length === 0) return null;
  const active = tools.find((t) => t.id === activeId) || tools[0];

  return (
    <div
      className={`fixed z-[60] bg-background border border-border shadow-2xl rounded-lg flex flex-col overflow-hidden ${
        minimized
          ? 'bottom-4 right-4 w-80 h-12'
          : expanded
          ? 'inset-4'
          : 'bottom-4 right-4 w-[min(900px,calc(100vw-2rem))] h-[min(700px,calc(100vh-2rem))]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-card">
        {/* Tabs */}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          {tools.map((t) => {
            const isActive = t.id === active.id;
            const sess = sessions[t.id];
            return (
              <div
                key={t.id}
                className={`group flex items-center gap-1 px-2 py-1 rounded-md text-xs cursor-pointer flex-shrink-0 ${
                  isActive ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => onActivate(t.id)}
              >
                <span className="font-medium truncate max-w-[140px]">{t.label}</span>
                <span className="text-[9px] opacity-60">{sess?.sessionId.slice(0, 4)}</span>
                <button
                  className="opacity-50 hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); onCloseTool(t.id); }}
                  title="Fechar aba"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        <Button size="sm" variant="ghost" title="Nova sessão anônima nesta aba (apaga storage)" onClick={() => resetSession(active.id)}>
          <RotateCcw className="h-3 w-3 mr-1" /> Nova
        </Button>
        <a href={active.url} target="_blank" rel="noopener noreferrer" className="px-1.5 text-muted-foreground hover:text-foreground" title="Abrir em nova aba">
          <ExternalLink className="h-3 w-3" />
        </a>
        <Button size="sm" variant="ghost" onClick={() => setMinimized((m) => !m)} title="Minimizar">
          <Minimize2 className="h-3 w-3" />
        </Button>
        {!minimized && (
          <Button size="sm" variant="ghost" onClick={() => setExpanded((e) => !e)} title="Expandir">
            <Maximize2 className="h-3 w-3" />
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClosePanel} title="Esconder painel (sessões continuam vivas)">
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Iframes — todos montados, só o ativo visível */}
      {!minimized && (
        <div className="relative flex-1 bg-secondary/20">
          {Object.values(sessions).map((s) => {
            const isActive = s.tool.id === active.id;
            return (
              <iframe
                key={`${s.tool.id}-${s.sessionId}`}
                src={s.tool.url}
                title={s.tool.label}
                sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-storage-access-by-user-activation allow-modals allow-downloads"
                allow="clipboard-read; clipboard-write"
                className={`absolute inset-0 w-full h-full border-0 bg-background ${isActive ? 'block' : 'hidden'}`}
              />
            );
          })}
          <div className="absolute bottom-1 left-2 right-2 text-[10px] text-muted-foreground bg-background/80 rounded px-2 py-0.5 pointer-events-none">
            Se o site bloquear iframe (X-Frame-Options) use <ExternalLink className="inline h-2.5 w-2.5" /> p/ abrir em aba.
          </div>
        </div>
      )}
    </div>
  );
};

export default AnonymousIframePanel;
