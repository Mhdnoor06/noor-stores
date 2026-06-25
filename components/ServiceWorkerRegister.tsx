"use client";

import { useEffect } from "react";

// Registers the service worker that makes the app installable and
// offline-capable. No-op during dev where it can interfere with HMR.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // In dev, a service worker left over from a production build / PWA install
    // serves stale cache-first chunks and breaks HMR with
    // "Cannot read properties of undefined (reading 'call')". Proactively
    // remove any registration and its caches during development.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
      if (typeof caches !== "undefined") {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
      }
      return;
    }

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.error("SW registration failed:", err));
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
