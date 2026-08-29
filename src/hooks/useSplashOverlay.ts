import { useEffect } from 'react';

/**
 * Hook global: quando o splash de detalhes do produto abre, adiciona a classe
 * `splash-open` no <body>. O CSS global (index.css) usa essa classe para ocultar
 * os botões flutuantes (carrinho, WhatsApp/Contato, chat do assistente e tema)
 * que sobrepõem o texto do produto no splash.
 */
export function useSplashOverlay() {
  useEffect(() => {
    const handler = (e: Event) => {
      const isOpen = (e as CustomEvent).detail === true;
      document.body.classList.toggle('splash-open', isOpen);
      document.documentElement.classList.toggle('splash-open', isOpen);
      document.querySelectorAll<HTMLElement>('[data-splash-header="true"]').forEach((header) => {
        header.style.display = isOpen ? 'none' : '';
        header.setAttribute('aria-hidden', String(isOpen));
      });
    };
    window.addEventListener('splash:open', handler);
    return () => window.removeEventListener('splash:open', handler);
  }, []);
}
