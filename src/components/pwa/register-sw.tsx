"use client";

import { useEffect } from "react";

/** Registra o service worker do app (PWA) — nunca nas páginas da vitrine pública. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    // vitrine da loja virtual (inclusive em domínio próprio): o app do ERP não se instala nas páginas do cliente final
    if (document.querySelector('meta[name="intercert-storefront"]')) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
