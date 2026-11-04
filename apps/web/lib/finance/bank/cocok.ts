/**
 * Pencocokan mutasi bank dengan baris jurnal akun bank — MURNI, dites.
 *
 * Aturan (rancangan D1): satu baris mutasi ↔ satu baris jurnal, jumlah SAMA
 * PERSIS (sen, bertanda: masuk positif = debit akun bank), tanggal paling jauh
 * ±3 hari. Semua pasangan calon diurut menurut selisih hari (terdekat dulu),
 * lalu tanggal mutasi, tanggal jurnal, dan id — lalu diambil serakah tanpa
 * memakai satu baris dua kali. Hasilnya tidak bergantung pada urutan masukan,
 * dan dua transaksi kembar (jumlah dan tanggal sama) mendapat pasangan yang
 * berbeda.
 */

export const TOLERANSI_HARI_COCOK = 3;

export type BarisMutasiCocok = { id: string; tanggal: string; jumlahSen: number };
export type BarisJurnalCocok = { id: string; tanggal: string; jumlahSen: number };
export type PasanganCocok = { mutasiId: string; jurnalBarisId: string; selisihHari: number };

/** Selisih hari kalender dua tanggal "YYYY-MM-DD" (mutlak). */
export function selisihHari(a: string, b: string): number {
  const ms = (t: string) => Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)));
  return Math.abs(Math.round((ms(a) - ms(b)) / 86_400_000));
}

export function cocokkanOtomatis(
  mutasi: readonly BarisMutasiCocok[],
  jurnal: readonly BarisJurnalCocok[],
  toleransiHari: number = TOLERANSI_HARI_COCOK,
): PasanganCocok[] {
  const perJumlah = new Map<number, BarisJurnalCocok[]>();
  for (const j of jurnal) {
    if (j.jumlahSen === 0) continue;
    const daftar = perJumlah.get(j.jumlahSen) ?? [];
    daftar.push(j);
    perJumlah.set(j.jumlahSen, daftar);
  }
  const calon: Array<PasanganCocok & { tMutasi: string; tJurnal: string }> = [];
  for (const m of mutasi) {
    for (const j of perJumlah.get(m.jumlahSen) ?? []) {
      const h = selisihHari(m.tanggal, j.tanggal);
      if (h <= toleransiHari) calon.push({ mutasiId: m.id, jurnalBarisId: j.id, selisihHari: h, tMutasi: m.tanggal, tJurnal: j.tanggal });
    }
  }
  calon.sort(
    (a, b) =>
      a.selisihHari - b.selisihHari ||
      a.tMutasi.localeCompare(b.tMutasi) ||
      a.tJurnal.localeCompare(b.tJurnal) ||
      a.mutasiId.localeCompare(b.mutasiId) ||
      a.jurnalBarisId.localeCompare(b.jurnalBarisId),
  );
  const mutasiTerpakai = new Set<string>();
  const jurnalTerpakai = new Set<string>();
  const hasil: PasanganCocok[] = [];
  for (const c of calon) {
    if (mutasiTerpakai.has(c.mutasiId) || jurnalTerpakai.has(c.jurnalBarisId)) continue;
    mutasiTerpakai.add(c.mutasiId);
    jurnalTerpakai.add(c.jurnalBarisId);
    hasil.push({ mutasiId: c.mutasiId, jurnalBarisId: c.jurnalBarisId, selisihHari: c.selisihHari });
  }
  return hasil;
}

/** Arah baris jurnal akun bank sebagai jumlah mutasi: debit − kredit, dalam sen. */
export function jumlahSenBarisBank(debit: number | string, kredit: number | string): number {
  return Math.round(Number(debit) * 100) - Math.round(Number(kredit) * 100);
}
