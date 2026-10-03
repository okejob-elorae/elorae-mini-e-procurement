/**
 * Pemberitahuan di HP (push) untuk aplikasi salesman dan SPG.
 *
 * Token FCM dibuat di atas service worker aplikasi HP yang SUDAH ada
 * (`/pwa/sw.js`, cakupan `/pwa/`) — bukan `firebase-messaging-sw.js`, yang
 * tidak ada di proyek ini dan akan bertabrakan dengan service worker Serwist.
 * `app/pwa/sw.ts` sendiri yang menampilkan pesannya (`push`) dan membuka
 * halaman yang tepat saat diketuk (`notificationclick`).
 *
 * Service worker itu hanya ada di build produksi, jadi di `next dev` hasilnya
 * selalu `TANPA_SW`. iPhone hanya mengizinkan push untuk aplikasi yang sudah
 * dipasang ke layar utama (iOS 16.4+), dan izinnya WAJIB diminta dari ketukan.
 */

export type HasilPush = "AKTIF" | "TIDAK_DIDUKUNG" | "TANPA_KONFIGURASI" | "TANPA_SW" | "IZIN_DITOLAK" | "GAGAL";

function konfigurasi() {
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!vapidKey || !apiKey || !projectId || !appId) return null;
  return {
    vapidKey,
    app: {
      apiKey,
      projectId,
      appId,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    },
  };
}

export function pushDidukung(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

/**
 * Daftarkan HP ini. `minta = true` hanya dari ketukan tombol (syarat iPhone);
 * `minta = false` dipakai untuk menyegarkan token diam-diam saat izin SUDAH ada.
 */
export async function daftarkanPush({ minta }: { minta: boolean }): Promise<HasilPush> {
  if (!pushDidukung()) return "TIDAK_DIDUKUNG";
  const k = konfigurasi();
  if (!k) return "TANPA_KONFIGURASI";

  let izin = Notification.permission;
  if (izin === "default" && minta) izin = await Notification.requestPermission();
  if (izin !== "granted") return "IZIN_DITOLAK";

  const reg = await navigator.serviceWorker.getRegistration("/pwa/");
  if (!reg) return "TANPA_SW";

  try {
    const { getApp, getApps, initializeApp } = await import("firebase/app");
    const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
    if (!(await isSupported())) return "TIDAK_DIDUKUNG";
    const app = getApps().length > 0 ? getApp() : initializeApp(k.app);
    const token = await getToken(getMessaging(app), { vapidKey: k.vapidKey, serviceWorkerRegistration: reg });
    if (!token) return "GAGAL";
    const res = await fetch("/api/notifications/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return res.ok ? "AKTIF" : "GAGAL";
  } catch {
    return "GAGAL";
  }
}
