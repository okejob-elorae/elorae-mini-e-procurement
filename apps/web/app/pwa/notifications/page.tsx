import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Layar Notifikasi lama di HP. Kotak kabar HP sekarang satu, Kabar (`/pwa/kabar`, keputusan
 * pemilik 2026-11-01): alamat ini tetap ada hanya untuk tautan dan pemberitahuan lama yang masih
 * menunjuk ke sini. Kabar sendiri memeriksa sesi dan izin HP.
 */
export default function PwaNotificationsPage(): never {
  redirect("/pwa/kabar");
}
