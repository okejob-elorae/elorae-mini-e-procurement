"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Serwist is disabled in dev (see next.config.ts), so /pwa/sw.js does not exist.
    // Skip registration to avoid a 404 error in the console.
    if (process.env.NODE_ENV === "development") return;
    navigator.serviceWorker
      .register("/pwa/sw.js", { scope: "/pwa/" })
      .catch((err) => {
        console.warn("[pwa] service worker registration failed:", err);
      });
  }, []);
  return null;
}
