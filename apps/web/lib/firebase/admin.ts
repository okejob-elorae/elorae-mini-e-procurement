import * as admin from 'firebase-admin';
import { createPrivateKey } from "node:crypto";

let messaging: admin.messaging.Messaging | null = null;

function getPrivateKey(): string | undefined {
  const key = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!key) return undefined;
  // Env stores often wrap the PEM in quotes and escape newlines as \n.
  return key.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
}

function kunciPrivatSah(pem: string): boolean {
  try {
    createPrivateKey(pem);
    return true;
  } catch {
    return false;
  }
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
  // Kunci contoh/rusak (mis. .env lokal berisi "-----BEGIN PRIVATE KEY-----\n...\n-----END…"):
  // jangan sampai initializeApp melempar galat di setiap halaman. Di produksi tetap console.error
  // karena itu salah konfigurasi sungguhan; di laptop cukup peringatan.
  if (!kunciPrivatSah(privateKey)) {
    const pesan = "Firebase Admin tidak aktif: FIREBASE_ADMIN_PRIVATE_KEY bukan kunci privat yang sah — notifikasi push (FCM) tidak terkirim.";
    if (process.env.NODE_ENV === "production") console.error(pesan);
    else console.warn(pesan);
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
