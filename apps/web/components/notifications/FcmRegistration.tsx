'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { NOTIFICATION_RECEIVED_EVENT } from '@/components/notifications/NotificationIcon';
import { registerFcmToken } from "@/components/notifications/fcm-client";

/**
 * Registers the current device for Firebase Cloud Messaging (FCM) when the user is logged in,
 * through `registerFcmToken` with no service worker scope (the Firebase SDK's default worker).
 * Listens for foreground messages and dispatches an event so the notification inbox can refetch.
 * Renders nothing.
 */
export function FcmRegistration() {
  const { data: session, status } = useSession();
  const registered = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user || registered.current) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void registerFcmToken({
      isCancelled: () => cancelled,
      /* When a message is received in foreground, notify the notification inbox to refetch. */
      onForegroundMessage: () => window.dispatchEvent(new Event(NOTIFICATION_RECEIVED_EVENT)),
    }).then((result) => {
      if (cancelled) {
        result.unsubscribe?.();
        return;
      }
      unsubscribe = result.unsubscribe;
      if (result.outcome === "registered") registered.current = true;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [status, session?.user]);

  return null;
}
