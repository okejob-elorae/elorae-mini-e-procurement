/**
 * Kode tolak kas & bank / rekonsiliasi → kalimat `financeKas.err.<KODE>`.
 * Kode yang tidak dikenal jatuh ke `err.GAGAL`. Murni.
 */

type Penerjemah = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

export function pesanGalatKas(t: Penerjemah, r: { kode: string; peran?: string; baris?: number }): string {
  if (r.kode === "UNMAPPED_ROLE") return t("err.UNMAPPED_ROLE", { peran: r.peran ?? "" });
  const kunci = `err.${r.kode}`;
  const dasar = t.has(kunci) ? t(kunci) : t("err.GAGAL");
  return r.baris ? `${dasar} ${t("err.barisKe", { baris: r.baris })}` : dasar;
}
