'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';

/**
 * Registers the current device for Firebase Cloud Messaging (FCM) when the user is logged in.
 * Requests notification permission, gets the FCM token, and sends it to the backend so the server
 * can send push notifications via Firebase Admin. Renders nothing.
 */
export function FcmRegistration() {
  const { data: session, status } = useSession();
  const registered = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user || registered.current) return;

    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
    const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
    const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

    if (!vapidKey || !apiKey || !projectId || !appId) return;

    let cancelled = false;

    async function register() {
      try {
        const { getApp, getApps, initializeApp } = await import('firebase/app');
        const { getMessaging, getToken, isSupported } = await import('firebase/messaging');

        const supported = await isSupported();
        if (!supported || cancelled) return;

        const app =
          getApps().length > 0
            ? getApp()
            : initializeApp({
                apiKey,
                authDomain: authDomain ?? `${projectId}.firebaseapp.com`,
                projectId,
                storageBucket: storageBucket ?? `${projectId}.appspot.com`,
                messagingSenderId,
                appId,
              });

        const messaging = getMessaging(app);
        const token = await getToken(messaging, { vapidKey });
        if (!token || cancelled) return;

        const res = await fetch('/api/notifications/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          registered.current = true;
        }
      } catch (_) {
        // Permission denied or FCM not available; ignore
      }
    }

    register();
    return () => {
      cancelled = true;
    };
  }, [status, session?.user]);

  return null;
}
