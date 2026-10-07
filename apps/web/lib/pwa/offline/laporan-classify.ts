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

/** Awalan galat UNGGAH foto laporan di kolom `error` antrean (sama dengan bukti terima). */
export const AWALAN_UNGGAH_LAPORAN = "UNGGAH_";

/**
 * Kode penolakan PENULIS yang kebetulan berawalan `FOTO_`. Teksnya di ruang nama
 * laporannya, bukan di `foto` — baris antrean lama menyimpan galat unggah
 * sebagai `FOTO_<kode>`, jadi awalan itu saja tidak cukup membedakan.
 */
const KODE_FOTO_PENULIS: ReadonlySet<string> = new Set(["FOTO_WAJIB", "FOTO_BUKAN_MILIK", "FOTO_SUDAH_DIPAKAI"]);

/** Di mana teks alasan sebuah kode antrean laporan tinggal: `foto` (`err<KODE>`) atau ruang nama laporannya. */
export function letakAlasanLaporan(kode: string): { ruang: "foto" | "laporan"; kunci: string } {
  if (kode.startsWith(AWALAN_UNGGAH_LAPORAN)) return { ruang: "foto", kunci: `err${kode.slice(AWALAN_UNGGAH_LAPORAN.length)}` };
  if (KODE_FOTO_PENULIS.has(kode)) return { ruang: "laporan", kunci: `err${kode}` };
  // Baris lama: galat unggah dulu disimpan berawalan `FOTO_`.
  if (kode.startsWith("FOTO_")) return { ruang: "foto", kunci: `err${kode.slice(5)}` };
  return { ruang: "laporan", kunci: `err${kode}` };
}
