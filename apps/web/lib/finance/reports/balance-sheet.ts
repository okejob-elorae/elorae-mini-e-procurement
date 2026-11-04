import type { BalanceRow } from "./balances";
import { buildRollup, type RollupNode } from "./rollup";

export type BalanceSheet = {
  aset: RollupNode[];
  totalAset: number;
  liabilitas: RollupNode[];
  totalLiabilitas: number;
  ekuitas: RollupNode[];
  totalEkuitas: number;
  unclosedEarnings: number;
  /** Laba (rugi) tahun buku posisi Neraca: 1 Januari s.d. tanggal posisi. Nol untuk tahun yang sudah ditutup per 31 Desember. */
  labaTahunBerjalan: number;
  /** Laba (rugi) tahun-tahun SEBELUMNYA yang belum ditutup (belum dipindah ke laba ditahan). */
  labaTahunLaluBelumDitutup: number;
  totalLiabilitasEkuitas: number;
  isBalanced: boolean;
};

const sumRoots = (nodes: RollupNode[]): number =>
  nodes.reduce((sum, node) => sum + node.subtotal, 0);

const cents = (value: number): number => Math.round(value * 100);

/**
 * Balance sheet as of a date, cumulative since inception.
 *
 * `rows` must INCLUDE year-end closing journals (`getAccountBalances(…,
 * { sertakanTutupTahun: true })`): a closed year's profit then sits in the
 * retained-earnings account (an EKUITAS row, read like any other) and its P&L
 * accounts net to zero. `unclosedEarnings` (Pendapatan − HPP − Beban over the
 * remaining rows) is therefore the profit of years NOT closed yet — split into
 * `labaTahunBerjalan` (the as-of year, passed in by the caller from a
 * 1-January-to-as-of read) and `labaTahunLaluBelumDitutup` (earlier open
 * years). Because every journal is balanced when posted, including it makes
 * the identity hold by construction.
 */
export function buildBalanceSheet(rows: BalanceRow[], opsi: { labaTahunBerjalan?: number } = {}): BalanceSheet {
  const aset = buildRollup(rows, ["ASET"]);
  const liabilitas = buildRollup(rows, ["LIABILITAS"]);
  const ekuitas = buildRollup(rows, ["EKUITAS"]);

  const totalAset = sumRoots(aset);
  const totalLiabilitas = sumRoots(liabilitas);
  const totalEkuitas = sumRoots(ekuitas);

  const totalPendapatan = sumRoots(buildRollup(rows, ["PENDAPATAN"]));
  const totalHpp = sumRoots(buildRollup(rows, ["HPP"]));
  const totalBeban = sumRoots(buildRollup(rows, ["BEBAN"]));
  const unclosedEarnings = totalPendapatan - totalHpp - totalBeban;
  const labaTahunBerjalan = opsi.labaTahunBerjalan ?? unclosedEarnings;
  const labaTahunLaluBelumDitutup = (cents(unclosedEarnings) - cents(labaTahunBerjalan)) / 100;

  const totalLiabilitasEkuitas = totalLiabilitas + totalEkuitas + unclosedEarnings;

  return {
    aset,
    totalAset,
    liabilitas,
    totalLiabilitas,
    ekuitas,
    totalEkuitas,
    unclosedEarnings,
    labaTahunBerjalan,
    labaTahunLaluBelumDitutup,
    totalLiabilitasEkuitas,
    isBalanced: cents(totalAset) === cents(totalLiabilitasEkuitas),
  };
}
