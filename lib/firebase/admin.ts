import * as admin from 'firebase-admin';

let messaging: admin.messaging.Messaging | null = null;

function getPrivateKey(): string | undefined {
  const key = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!key) return undefined;
  return key.replace(/\\n/g, '\n');
}

function initFirebaseAdmin(): void {
  if (admin.apps.length > 0) {
    messaging = admin.messaging();
    return;
  }
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = getPrivateKey();
  if (!projectId || !clientEmail || !privateKey) {
    return;
  }
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
    messaging = admin.messaging();
  } catch (err) {
    console.error('Firebase Admin init failed:', err);
  }
}

initFirebaseAdmin();

export { messaging };
