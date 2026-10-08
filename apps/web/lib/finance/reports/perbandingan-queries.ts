import { formatDateOnlyJakarta, parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { getAccountBalances, getEarliestJournal, type BalanceRow } from "./balances";
import { buildBalanceSheet } from "./balance-sheet";
import { buildIncomeStatement } from "./income-statement";
import { periodeBanding, posisiBanding, type RentangTanggal } from "./periode-banding";
import { rollupBanyak, type SimpulNilai } from "./tampil-pohon";

/*
 * Laporan perbandingan Laba Rugi dan Neraca: tiga kolom — periode/posisi ini,
 * sebelumnya, dan tahun lalu (aturan `periode-banding.ts`). Pohon akunnya satu
 * (`rollupBanyak`, gabungan akun ketiga kolom), dibaca dengan aturan yang SAMA
 * dengan laporan tunggalnya: Laba Rugi tanpa jurnal penutup tahun; Neraca
 * kumulatif dengan jurnal penutup tahun dan laba tahun berjalan dari 1 Januari
 * (`muatNeraca`).
 */

export type PerbandinganLabaRugi = {
  kolom: [RentangTanggal, RentangTanggal, RentangTanggal];
  pendapatan: SimpulNilai[];
  hpp: SimpulNilai[];
  beban: SimpulNilai[];
  total: {
    pendapatan: number[];
    hpp: number[];
    labaKotor: number[];
    beban: number[];
    labaBersih: number[];
  };
  /** Ada mutasi laba rugi di salah satu kolom. */
  adaMutasi: boolean;
};

export async function muatPerbandinganLabaRugi(periode: RentangTanggal): Promise<PerbandinganLabaRugi> {
  const { sebelumnya, tahunLalu } = periodeBanding(periode.dari, periode.sampai);
  const kolom: [RentangTanggal, RentangTanggal, RentangTanggal] = [periode, sebelumnya, tahunLalu];
  const baca = (r: RentangTanggal) => getAccountBalances({ from: parseDateOnly(r.dari)!, to: parseDateOnlyEnd(r.sampai)! });
  const saldo = await Promise.all(kolom.map(baca));
  const laporan = saldo.map(buildIncomeStatement);
  const ambil = (k: (l: (typeof laporan)[number]) => number) => laporan.map(k);

  const labaRugi = (r: BalanceRow) => r.type === "PENDAPATAN" || r.type === "HPP" || r.type === "BEBAN";
  return {
    kolom,
    pendapatan: rollupBanyak(saldo, ["PENDAPATAN"]),
    hpp: rollupBanyak(saldo, ["HPP"]),
    beban: rollupBanyak(saldo, ["BEBAN"]),
    total: {
      pendapatan: ambil((l) => l.totalPendapatan),
      hpp: ambil((l) => l.totalHpp),
      labaKotor: ambil((l) => l.labaKotor),
      beban: ambil((l) => l.totalBeban),
      labaBersih: ambil((l) => l.labaBersih),
    },
    adaMutasi: saldo.some((rows) => rows.some((r) => labaRugi(r) && (r.debit !== 0 || r.credit !== 0))),
  };
}

export type PerbandinganNeraca = {
  kolom: [string, string, string];
  aset: SimpulNilai[];
  liabilitas: SimpulNilai[];
  ekuitas: SimpulNilai[];
  total: {
    aset: number[];
    liabilitas: number[];
    ekuitas: number[];
    labaTahunLalu: number[];
    labaTahunBerjalan: number[];
    liabilitasEkuitas: number[];
  };
  seimbang: boolean[];
  /** Posisi yang sudah punya jurnal (sebelum jurnal pertama, kolomnya kosong). */
  adaJurnal: boolean[];
};

async function bacaPosisi(tanggal: string): Promise<{ rows: BalanceRow[]; laporan: ReturnType<typeof buildBalanceSheet> }> {
  const asOf = parseDateOnlyEnd(tanggal)!;
  const tahun = formatDateOnlyJakarta(asOf).slice(0, 4);
  const [kumulatif, berjalan] = await Promise.all([
    getAccountBalances({ to: asOf }, { sertakanTutupTahun: true }),
    getAccountBalances({ from: parseDateOnly(`${tahun}-01-01`)!, to: asOf }, { sertakanTutupTahun: true }),
  ]);
  return { rows: kumulatif, laporan: buildBalanceSheet(kumulatif, { labaTahunBerjalan: buildIncomeStatement(berjalan).labaBersih }) };
}

export async function muatPerbandinganNeraca(tanggal: string): Promise<PerbandinganNeraca> {
  const { sebelumnya, tahunLalu } = posisiBanding(tanggal);
  const kolom: [string, string, string] = [tanggal, sebelumnya, tahunLalu];
  const [posisi, pertama] = await Promise.all([Promise.all(kolom.map(bacaPosisi)), getEarliestJournal()]);
  const saldo = posisi.map((p) => p.rows);
  const lap = posisi.map((p) => p.laporan);
  return {
    kolom,
    aset: rollupBanyak(saldo, ["ASET"]),
    liabilitas: rollupBanyak(saldo, ["LIABILITAS"]),
    ekuitas: rollupBanyak(saldo, ["EKUITAS"]),
    total: {
      aset: lap.map((l) => l.totalAset),
      liabilitas: lap.map((l) => l.totalLiabilitas),
      ekuitas: lap.map((l) => l.totalEkuitas),
      labaTahunLalu: lap.map((l) => l.labaTahunLaluBelumDitutup),
      labaTahunBerjalan: lap.map((l) => l.labaTahunBerjalan),
      liabilitasEkuitas: lap.map((l) => l.totalLiabilitasEkuitas),
    },
    seimbang: lap.map((l) => l.isBalanced),
    adaJurnal: kolom.map((t) => pertama != null && pertama.date.getTime() <= parseDateOnlyEnd(t)!.getTime()),
  };
}
