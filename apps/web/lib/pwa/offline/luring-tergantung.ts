import { pwaDb } from "./db";

/**
 * Pekerjaan yang terikat check-in tanpa sinyal (`visitClientId`) baru boleh
 * dikirim sesudah check-in itu sampai ke server — sebelum itu server tidak
 * mengenal kunjungannya dan akan menolaknya (`KUNJUNGAN_TIDAK_SAH`), padahal
 * sebabnya hanya urutan.
 *
 * - `kirim`   : tidak terikat check-in di antrean, atau check-in-nya sudah
 *               terkirim (barisnya sudah tidak ada) — kirim seperti biasa.
 * - `tunggu`  : check-in-nya masih di antrean. Biarkan menunggu, tanpa
 *               menghitungnya sebagai percobaan.
 * - `ditolak` : check-in-nya ditolak server. Kunjungannya tidak pernah ada,
 *               jadi pekerjaan ini berhenti dengan alasan yang sama jelasnya
 *               (`KUNJUNGAN_DITOLAK`) — tidak dikirim untuk ditolak lagi.
 *
 * Membaca tabel check-in HANYA bila ada `visitClientId`: antrean lama (dan tes
 * yang menirukan basis data tanpa tabel itu) tidak menyentuhnya sama sekali.
 */
export type KeadaanIkatan = "kirim" | "tunggu" | "ditolak";

export async function keadaanCheckinTertahan(visitClientId: string | null | undefined): Promise<KeadaanIkatan> {
  if (!visitClientId) return "kirim";
  const c = await pwaDb.pendingCheckins.get(visitClientId);
  if (!c) return "kirim";
  return c.syncState === "failed" ? "ditolak" : "tunggu";
}

/**
 * Tanda dikirim untuk mutasi yang AJUANNYA juga dicatat tanpa sinyal: baru
 * boleh dikirim sesudah ajuan itu sampai dan server memberinya id
 * (`transferId`, diisi penyinkron begitu ajuannya terkirim).
 *
 * - `kirim`   : sudah punya id mutasi server.
 * - `tunggu`  : ajuannya masih di antrean.
 * - `ditolak` : ajuannya ditolak server — mutasinya tidak pernah ada.
 * - `hilang`  : tanpa id dan ajuannya tidak ada lagi di HP (dihapus).
 */
export type KeadaanAjuanMutasi = KeadaanIkatan | "hilang";

/** Murni: keadaan ikatan dari baris tanda dikirim dan baris ajuannya (bila ada). */
export function nasibIkatanAjuan(
  kirim: { transferId: string | null; ajuanLocalId: string | null },
  ajuan: { syncState: string } | null | undefined,
): KeadaanAjuanMutasi {
  if (kirim.transferId) return "kirim";
  if (!kirim.ajuanLocalId || !ajuan) return "hilang";
  return ajuan.syncState === "failed" ? "ditolak" : "tunggu";
}

export async function keadaanAjuanMutasi(kirim: { transferId: string | null; ajuanLocalId: string | null }): Promise<KeadaanAjuanMutasi> {
  if (kirim.transferId || !kirim.ajuanLocalId) return nasibIkatanAjuan(kirim, null);
  return nasibIkatanAjuan(kirim, await pwaDb.pendingMutasiAjuan.get(kirim.ajuanLocalId));
}
