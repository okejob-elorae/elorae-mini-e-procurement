/*
 * Jurnal penutup tahun — bagian MURNI (tanpa Prisma).
 *
 * Saldo setiap akun laba rugi (Pendapatan, HPP, Beban) tahun itu dinolkan dan
 * selisih bersihnya dipindah ke akun peran `RETAINED_EARNINGS` (laba ditahan)
 * per 31 Desember. Sesudahnya Neraca membaca laba tahun-tahun yang ditutup
 * dari akun laba ditahan sungguhan, dan "laba tahun berjalan" hanya dari tahun
 * yang masih terbuka.
 *
 * Semua angka dalam sen (bilangan bulat) supaya jurnal seimbang persis.
 */

export const TIPE_LABA_RUGI = ["PENDAPATAN", "HPP", "BEBAN"] as const;

export type SaldoLabaRugi = {
  accountId: string;
  type: string;
  debit: number;
  credit: number;
};

export type BarisPenutup = { chartAccountId: string; debit: number; credit: number; memo?: string };

const sen = (n: number): number => Math.round((Number(n) || 0) * 100);

/**
 * Baris jurnal penutup. Akun laba rugi bersaldo debit dikredit sebesar
 * saldonya (dan sebaliknya); laba ditahan menampung sisanya — dikredit bila
 * tahun itu laba, didebit bila rugi. Akun bersaldo nol tidak muncul.
 * Mengembalikan `labaBersih` (pendapatan − HPP − beban) dalam rupiah.
 */
export function susunJurnalTutupTahun(
  saldo: SaldoLabaRugi[],
  akunLabaDitahan: string,
): { baris: BarisPenutup[]; labaBersih: number } {
  const baris: BarisPenutup[] = [];
  let bersihSen = 0; // debit − kredit seluruh akun laba rugi
  const urut = [...saldo]
    .filter((s) => (TIPE_LABA_RUGI as readonly string[]).includes(s.type))
    .sort((a, b) => a.accountId.localeCompare(b.accountId));

  for (const s of urut) {
    const netSen = sen(s.debit) - sen(s.credit);
    if (netSen === 0) continue;
    bersihSen += netSen;
    baris.push(
      netSen > 0
        ? { chartAccountId: s.accountId, debit: 0, credit: netSen / 100 }
        : { chartAccountId: s.accountId, debit: -netSen / 100, credit: 0 },
    );
  }

  // Laba (kredit bersih, bersihSen < 0) → laba ditahan DIKREDIT; rugi → didebit.
  if (bersihSen < 0) baris.push({ chartAccountId: akunLabaDitahan, debit: 0, credit: -bersihSen / 100, memo: "RETAINED_EARNINGS" });
  else if (bersihSen > 0) baris.push({ chartAccountId: akunLabaDitahan, debit: bersihSen / 100, credit: 0, memo: "RETAINED_EARNINGS" });

  return { baris, labaBersih: bersihSen === 0 ? 0 : -bersihSen / 100 };
}

/** Baris pembalik: debit ↔ kredit. */
export function balikBaris<T extends { debit: number; credit: number }>(baris: T[]): T[] {
  return baris.map((b) => ({ ...b, debit: b.credit, credit: b.debit }));
}

/** sourceId jurnal penutup generasi ke-n tahun itu (generasi 1 = tahun saja). */
export function sumberIdPenutup(tahun: number, generasi: number): string {
  return generasi <= 1 ? `${tahun}` : `${tahun}#${generasi}`;
}

/** sourceId jurnal pembalik dari jurnal penutup ber-sourceId itu. */
export function sumberIdPembalik(sumberIdPenutupnya: string): string {
  return `${sumberIdPenutupnya}#balik`;
}

/** Apakah sourceId (sourceType YEAR_END_CLOSE) milik tahun ini — "2025", "2025#2", "2025#2#balik". */
export function sumberIdMilikTahun(sourceId: string | null | undefined, tahun: number): boolean {
  if (!sourceId) return false;
  return sourceId === `${tahun}` || sourceId.startsWith(`${tahun}#`);
}
