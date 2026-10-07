"use client";

import { useEffect } from "react";
import { registerFcmToken } from "@/components/notifications/fcm-client";

/**
 * Refreshes this device's FCM token on every PWA load once push is enabled, against the `/pwa/`
 * service worker that shows the pushes. Never prompts: permission is asked for only from the
 * explicit button on the notifications screen (`EnablePushCard`), the one place iOS allows it.
 */
export function PwaPushRegistrar() {
  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    let cancelled = false;
    void registerFcmToken({ serviceWorkerScope: "/pwa/", isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
