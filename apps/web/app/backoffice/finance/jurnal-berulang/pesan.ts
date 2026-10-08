/*
 * Kode penolakan aksi jurnal berulang → kalimat layar
 * (`jurnalBerulang.err.<KODE>`). Kode yang tidak dikenal tampil sebagai
 * kalimat umum, tidak pernah mentah.
 */

type Penerjemah = {
  (kunci: string, nilai?: Record<string, string | number>): string;
  has: (kunci: string) => boolean;
};

export function pesanGalatBerulang(t: Penerjemah, kode: string, baris?: number): string {
  if (baris && t.has(`err.${kode}`)) return t("errBaris", { n: baris, pesan: t(`err.${kode}`) });
  return t.has(`err.${kode}`) ? t(`err.${kode}`) : t("err.GAGAL");
}
