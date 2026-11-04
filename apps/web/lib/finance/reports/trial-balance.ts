import type { AccountType } from "@/lib/constants/enums";
import type { BalanceRow } from "./balances";

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  /** Saldo per sisi normal akun SEBELUM periode (0 bila periode sejak awal). */
  opening: number;
  /** Mutasi periode. */
  debit: number;
  credit: number;
  /** Mutasi bersih periode per sisi normal akun. */
  signed: number;
  /** `opening + signed` — saldo per akhir periode. */
  closing: number;
};

export type TrialBalance = {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  /**
   * Pemeriksaan kerusakan data: mutasi periode seimbang (debit = kredit) DAN
   * saldo akhir seimbang antar sisi (aset + HPP + beban = liabilitas + ekuitas
   * + pendapatan). Keduanya pasti benar selama setiap jurnal seimbang.
   */
  isBalanced: boolean;
  /** Ada akun bersaldo awal — periode tidak dimulai sejak awal pembukuan. */
  adaSaldoAwal: boolean;
  /** Jumlah saldo awal per sisi sebenarnya (`sisiSaldo`) — sama bila buku seimbang. */
  totalSaldoAwal: { debit: number; kredit: number };
  /** Jumlah saldo akhir per sisi sebenarnya. */
  totalSaldoAkhir: { debit: number; kredit: number };
};

const cents = (value: number): number => Math.round(Number((value * 100).toFixed(4)));

/** Sisi normal debit: aset, HPP, beban. Lainnya kredit. */
const SISI_DEBIT: ReadonlySet<AccountType> = new Set<AccountType>(["ASET", "HPP", "BEBAN"]);

/**
 * Saldo sebagai besaran + sisi SEBENARNYA ("D" debit / "K" kredit), supaya
 * tanda saldo tidak bergantung pada pembaca tahu sisi normal akunnya: Kas
 * yang minus terbaca "350.000 K", modal "147.000.000 K", piutang "D".
 * Saldo nol tidak bersisi.
 */
export function sisiSaldo(type: AccountType, signed: number): { jumlah: number; sisi: "D" | "K" | null } {
  const sen = cents(signed);
  if (sen === 0) return { jumlah: 0, sisi: null };
  const normalDebit = SISI_DEBIT.has(type);
  const debit = normalDebit ? sen > 0 : sen < 0;
  return { jumlah: Math.abs(sen) / 100, sisi: debit ? "D" : "K" };
}

/**
 * Neraca Saldo per periode: Saldo awal | Debit | Kredit | Saldo akhir.
 *
 * `rows` adalah mutasi periode (`getAccountBalances({ from, to })`).
 * `saldoAwal` adalah saldo kumulatif sampai sesaat sebelum `from` — pemanggil
 * membacanya DENGAN jurnal penutup tahun, supaya akun laba rugi tahun yang
 * sudah ditutup mulai dari nol dan laba ditahan membawa labanya. Tanpa
 * `saldoAwal` (periode sejak awal) saldo awal semua akun nol.
 *
 * Akun tampil bila punya mutasi periode ATAU saldo awal ≠ 0 — sebelumnya akun
 * yang hanya bersaldo awal (modal disetor, peralatan) hilang dan kolom
 * "Saldo" berisi mutasi bersih, sehingga Kas tampak minus (audit G8).
 * `includeZero` juga menampilkan akun daun tanpa saldo maupun mutasi.
 *
 * A `BalanceRow`'s debit/credit come from a per-account `groupBy` in
 * `getAccountBalances`, so each row holds ONLY its own journal lines and never
 * a rollup of its children. Including a parent therefore cannot double-count.
 * Dropping one, on the other hand, would: `postJournal` rejects non-leaf
 * accounts only at post time, and nothing stops an account that already has
 * lines from later gaining a child, so a parent with movement exists in real
 * data. Omitting it would break the `totalDebit === totalCredit` identity, fire
 * the corruption warning falsely, and disagree with Laba Rugi / Neraca, which
 * count every node's own `signed`. Empty parents are still hidden — they are
 * structure, not balances, and the rollup statements render the tree anyway.
 */
export function buildTrialBalance(
  rows: BalanceRow[],
  opts?: { includeZero?: boolean; saldoAwal?: BalanceRow[] },
): TrialBalance {
  const includeZero = opts?.includeZero ?? false;
  const awalPerAkun = new Map((opts?.saldoAwal ?? []).map((r) => [r.accountId, r]));

  /* Gabungan akun dua bacaan: akun nonaktif yang hanya bergerak sebelum periode hanya ada di saldo awal. */
  const semua = new Map<string, BalanceRow>();
  for (const r of rows) semua.set(r.accountId, r);
  for (const r of awalPerAkun.values()) {
    if (!semua.has(r.accountId)) semua.set(r.accountId, { ...r, debit: 0, credit: 0, signed: 0 });
  }
  const urut = [...semua.values()].sort((a, b) => a.code.localeCompare(b.code));

  let totalDebit = 0;
  let totalCredit = 0;
  let selisihSisiSen = 0;
  let adaSaldoAwal = false;
  const sisiSen = { awalD: 0, awalK: 0, akhirD: 0, akhirK: 0 };
  const out: TrialBalanceRow[] = [];

  for (const r of urut) {
    const opening = cents(awalPerAkun.get(r.accountId)?.signed ?? 0) / 100;
    const closing = (cents(opening) + cents(r.signed)) / 100;
    const hasMovement = r.debit !== 0 || r.credit !== 0;
    const bersaldo = cents(opening) !== 0;
    /* Identitas saldo dihitung atas SEMUA akun, juga yang disembunyikan. */
    selisihSisiSen += (SISI_DEBIT.has(r.type) ? 1 : -1) * cents(closing);
    if (bersaldo) adaSaldoAwal = true;

    if (!(hasMovement || bersaldo || (includeZero && !r.hasChildren))) continue;

    totalDebit += r.debit;
    totalCredit += r.credit;
    const awal = sisiSaldo(r.type, opening);
    const akhir = sisiSaldo(r.type, closing);
    if (awal.sisi === "D") sisiSen.awalD += cents(awal.jumlah);
    if (awal.sisi === "K") sisiSen.awalK += cents(awal.jumlah);
    if (akhir.sisi === "D") sisiSen.akhirD += cents(akhir.jumlah);
    if (akhir.sisi === "K") sisiSen.akhirK += cents(akhir.jumlah);
    out.push({
      accountId: r.accountId,
      code: r.code,
      name: r.name,
      type: r.type,
      opening,
      debit: r.debit,
      credit: r.credit,
      signed: r.signed,
      closing,
    });
  }

  return {
    rows: out,
    totalDebit,
    totalCredit,
    isBalanced: cents(totalDebit) === cents(totalCredit) && selisihSisiSen === 0,
    adaSaldoAwal,
    totalSaldoAwal: { debit: sisiSen.awalD / 100, kredit: sisiSen.awalK / 100 },
    totalSaldoAkhir: { debit: sisiSen.akhirD / 100, kredit: sisiSen.akhirK / 100 },
  };
}
