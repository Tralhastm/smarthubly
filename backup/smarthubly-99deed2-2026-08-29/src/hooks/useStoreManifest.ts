// Keeps the manifest same-origin. Chrome is stricter for installed PWAs when
// the manifest is swapped to a cross-origin URL, so every store/admin/driver
// route points to /manifest.json with query params; the Service Worker serves
// the tenant-aware manifest from the same domain.
import { useEffect } from 'react';

interface Options {
  slug: string;
  startPath: string; // e.g. `/loja/${slug}` or `/loja/${slug}/admin`
  scopePath?: string; // defaults to startPath
}

export const useStoreManifest = ({ slug, startPath, scopePath }: Options) => {
  useEffect(() => {
    if (!slug) return;

    const existing = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    const previousHref = existing?.getAttribute('href') || null;
    const href = `/manifest.json?slug=${encodeURIComponent(slug)}&start_path=${encodeURIComponent(startPath)}&scope_path=${encodeURIComponent(scopePath || startPath)}`;

    if (existing) {
      existing.setAttribute('href', href);
      existing.removeAttribute('crossorigin');
    } else {
      const link = document.createElement('link');
      link.rel = 'manifest';
      link.href = href;
      document.head.appendChild(link);
    }

    return () => {
      const link = document.querySelector('link[rel="manifest"]');
      if (link) {
        if (previousHref) {
          link.setAttribute('href', previousHref);
          link.removeAttribute('crossorigin');
        } else link.remove();
      }
    };
  }, [slug, startPath, scopePath]);
};
