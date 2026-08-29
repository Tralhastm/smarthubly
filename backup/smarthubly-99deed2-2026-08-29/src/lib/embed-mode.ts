/**
 * Detecta se o app está rodando dentro de um iframe (modo "embed").
 * Usado para alternar entre modo "lançar dados" (standalone) e "somente
 * visualizar" (embedado em outro painel — ex: gestor financeiro externo).
 *
 * Detecção dupla:
 *  1) `?embed=1` na query string (explícito, sobrevive a re-renders)
 *  2) `window !== window.parent` (heurística: estamos dentro de um iframe)
 */
export const isEmbedMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('embed') === '1') return true;
  } catch {}
  try {
    return window.self !== window.top;
  } catch {
    // cross-origin acesso a .top pode lançar — se lança, estamos em iframe
    return true;
  }
};
