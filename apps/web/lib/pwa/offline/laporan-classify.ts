/**
 * Nasib satu kiriman laporan lapangan (pelunasan atau retur) dari antrean.
 * Murni — tanpa impor server — supaya bisa dites dan dipakai di browser.
 *
 * - `evict`    : tersimpan (atau sudah tersimpan sebelumnya); hapus dari HP.
 * - `terminal` : server menolak isinya. Mengirim ulang hanya akan ditolak lagi,
 *                jadi berhenti dan tunjukkan alasannya ke sales.
 * - `retry`    : belum tentu sampai (sinyal, server sibuk). Coba lagi nanti.
 */
export type NasibKiriman = "evict" | "terminal" | "retry";

/** Hasil aksi server. `GAGAL` adalah galat server yang tak terduga — layak diulang. */
export function nasibLaporan(hasil: { ok: true } | { ok: false; kode: string } | { thrown: true }): NasibKiriman {
  if ("thrown" in hasil) return "retry";
  if (hasil.ok) return "evict";
  return hasil.kode === "GAGAL" ? "retry" : "terminal";
}

/**
 * Galat saat mengunggah foto laporan. `unggahFoto` melempar `Error(kode)` untuk
 * penolakan server, dan `TypeError` dari `fetch` saat jaringan putus.
 */
export function nasibUnggah(err: unknown): NasibKiriman {
  if (!(err instanceof Error) || err instanceof TypeError) return "retry";
  return err.message === "GAGAL" ? "retry" : "terminal";
}
