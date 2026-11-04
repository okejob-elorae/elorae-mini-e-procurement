import { getAccountBalances } from "./balances";
import { buildTrialBalance, type TrialBalance } from "./trial-balance";

/**
 * Neraca Saldo per periode — satu pemuat untuk halaman, cetak, dan Excel
 * supaya ketiganya sepakat.
 *
 * Mutasi periode TANPA jurnal penutup tahun (saldo pendapatan/beban tahun yang
 * ditutup tetap terlihat). Saldo awal = saldo kumulatif sampai sesaat sebelum
 * `from` DENGAN jurnal penutup tahun: akun laba rugi tahun yang sudah ditutup
 * mulai dari nol, laba ditahan membawa labanya. Periode tanpa `from` (sejak
 * awal) tidak punya saldo awal.
 */
export async function muatNeracaSaldo(input: { from?: Date; to: Date; includeZero?: boolean }): Promise<TrialBalance> {
  const [periode, saldoAwal] = await Promise.all([
    getAccountBalances({ from: input.from, to: input.to }),
    input.from
      ? getAccountBalances({ to: new Date(input.from.getTime() - 1) }, { sertakanTutupTahun: true })
      : Promise.resolve([]),
  ]);
  return buildTrialBalance(periode, { includeZero: input.includeZero ?? false, saldoAwal });
}
