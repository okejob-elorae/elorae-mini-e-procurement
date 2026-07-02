"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/pwa/sw.js", { scope: "/pwa/" })
      .catch((err) => {
        console.warn("[pwa] service worker registration failed:", err);
      });
  }, []);
  return null;
}
