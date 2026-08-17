import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  let isRefreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (isRefreshing) return;
    isRefreshing = true;
    window.location.reload();
  });

  // Register the service worker on every page so the browser considers the
  // app installable as a real PWA (not just a home-screen shortcut). We skip
  // when running inside an iframe (Lovable preview) to avoid stale-cache
  // issues during development.
  let isInIframe = false;
  try { isInIframe = window.self !== window.top; } catch { isInIframe = true; }

  if (!isInIframe) {
    void navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.update().catch(() => undefined))
      .catch(() => undefined);
  } else {
    // In preview/iframe: clean up any previously-registered SWs to avoid
    // serving stale content.
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((r) => r.unregister().catch(() => undefined))))
      .catch(() => undefined);
  }
}

createRoot(document.getElementById("root")!).render(<App />);
