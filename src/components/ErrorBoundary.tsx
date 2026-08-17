import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary so a runtime crash never leaves the user staring
 * at a blank black screen. Shows a friendly fallback + reload action.
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the crash so we can debug from console / Sentry later.
    console.error('App crash:', error, info);
  }

  handleReload = () => {
    // Hard reload: clears in-memory state and tries fresh bundle.
    try {
      // Best-effort: also unregister any stale service workers / caches.
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister().catch(() => undefined)));
      }
      if ('caches' in window) {
        caches.keys().then(keys => keys.forEach(k => caches.delete(k).catch(() => undefined)));
      }
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-destructive/15 flex items-center justify-center text-2xl">
            ⚠️
          </div>
          <h1 className="font-heading text-xl mb-2">Algo deu errado</h1>
          <p className="text-sm text-muted-foreground mb-5">
            A tela travou. Atualize a página pra continuar — seus dados não foram perdidos.
          </p>
          <button
            onClick={this.handleReload}
            className="gradient-primary text-primary-foreground rounded-lg px-5 py-2.5 text-sm font-medium hover:opacity-90"
          >
            Recarregar
          </button>
          {this.state.error?.message && (
            <p className="mt-4 text-[11px] text-muted-foreground/70 break-words">
              {this.state.error.message}
            </p>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
