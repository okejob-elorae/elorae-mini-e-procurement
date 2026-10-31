import type { NasibKiriman } from "./laporan-classify";

/**
 * Nasib satu bukti terima dari antrean HP. Murni — tanpa impor server.
 *
 * Sama seperti laporan lapangan lain, kecuali satu: `WAKTU_DI_MASA_DEPAN`
 * diulang, bukan dihentikan. Jam terimanya diambil dari jam HP; HP yang jamnya
 * lebih cepat dari server ditolak sekarang tapi diterima begitu jam server
 * menyusul — menghentikannya memaksa salesman mengetik ulang bukti yang benar.
 *
 * `SUDAH_DITERIMA` dihentikan (bukan dibuang diam-diam): kantor sudah mencatat
 * pengiriman ini lebih dulu, mungkin dengan isi lain, dan salesman perlu tahu.
 */
export function nasibBuktiTerima(
  hasil: { ok: true; ulangan?: boolean } | { ok: false; kode: string } | { thrown: true },
): NasibKiriman {
  if ("thrown" in hasil) return "retry";
  if (hasil.ok) return "evict";
  return hasil.kode === "GAGAL" || hasil.kode === "WAKTU_DI_MASA_DEPAN" ? "retry" : "terminal";
}

/**
 * Awalan galat UNGGAH gambar di kolom `error` antrean. Sengaja bukan `FOTO_`:
 * penulis sendiri punya kode `FOTO_WAJIB`/`FOTO_TIDAK_SAH`/`FOTO_TIDAK_DITEMUKAN`,
 * dan awalan yang sama membuat dua asal galat tidak bisa dibedakan.
 */
export const AWALAN_UNGGAH = "UNGGAH_";

/**
 * Di mana teks alasan sebuah kode antrean tinggal: penolakan unggah di ruang
 * nama `foto` (`err<KODE>`), selebihnya di `buktiTerima.err` (`<KODE>`).
 */
export function letakAlasanBuktiTerima(kode: string | undefined): { ruang: "foto" | "buktiTerima"; kunci: string } {
  if (!kode) return { ruang: "buktiTerima", kunci: "GAGAL" };
  if (kode.startsWith(AWALAN_UNGGAH)) return { ruang: "foto", kunci: `err${kode.slice(AWALAN_UNGGAH.length)}` };
  return { ruang: "buktiTerima", kunci: kode };
}
