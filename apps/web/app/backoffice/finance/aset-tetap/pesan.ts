/*
 * Kode penolakan aksi aset tetap → kalimat layar (`asetTetap.err.<KODE>`).
 * Kode yang tidak dikenal tampil sebagai kalimat umum, tidak pernah mentah.
 * `kode.test.ts` menuntut setiap kode punya teks di kedua bahasa.
 */

type Penerjemah = {
  (kunci: string, nilai?: Record<string, string | number>): string;
  has: (kunci: string) => boolean;
};

export function pesanGalatAset(t: Penerjemah, kode: string, peran?: string): string {
  if (kode === "UNMAPPED_ROLE") return t("err.UNMAPPED_ROLE", { peran: peran ?? "" });
  return t.has(`err.${kode}`) ? t(`err.${kode}`) : t("err.GAGAL");
}
