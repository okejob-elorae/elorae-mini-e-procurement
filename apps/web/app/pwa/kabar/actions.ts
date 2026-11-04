"use server";

import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { decodeNotificationCursor, fetchNotificationPage } from "@/lib/notifications/page";
import { susunBarisKabar, type BarisKabar } from "./baris";

export type HasilMuatKabar = { ok: true; baris: BarisKabar[]; kursor: string | null } | { ok: false };

/**
 * "Muat lagi" di layar Kabar: halaman berikutnya dari kotak kabar orang yang masuk, sesudah
 * `kursor` (dari halaman sebelumnya). Barisnya disusun DI SERVER (`susunBarisKabar`), sama dengan
 * halaman pertama — format waktu di klien bisa berbeda dari server.
 *
 * Mengembalikan `{ ok: false }`, tidak melempar: galat aksi server disamarkan di produksi, dan
 * layar cukup menawarkan coba lagi. Kursor yang rusak juga ditolak — ia datang dari peramban.
 */
export async function muatKabarLagi(kursor: string): Promise<HasilMuatKabar> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  if (pwaAccessGuard(session.user.permissions) !== "render") return { ok: false };
  if (typeof kursor !== "string") return { ok: false };
  const posisi = decodeNotificationCursor(kursor);
  if (!posisi) return { ok: false };

  try {
    const halaman = await fetchNotificationPage(session.user.id, posisi);
    return { ok: true, baris: susunBarisKabar(halaman.items, new Date()), kursor: halaman.nextCursor };
  } catch (err) {
    console.error("muatKabarLagi gagal", err);
    return { ok: false };
  }
}
