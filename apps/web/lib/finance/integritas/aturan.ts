import type { PostingRole } from "@/lib/constants/journal-roles";

/*
 * Aturan murni halaman Integritas buku besar. Aman untuk klien.
 */

/**
 * Peran yang saldonya boleh berlawanan dengan sisi normal tipe akunnya:
 * kontra-akun (akumulasi penyusutan, retur & potongan penjualan), laba
 * ditahan dan ekuitas saldo awal (rugi menumpuk), selisih persediaan, laba/rugi
 * pelepasan aset, dan penggantian kerugian (pendapatan atau pengurang beban).
 */
export const PERAN_SALDO_BOLEH_TERBALIK: readonly PostingRole[] = [
  "ACCUM_DEPRECIATION",
  "SALES_RETURN",
  "SALES_DISCOUNT",
  "RETAINED_EARNINGS",
  "OPENING_EQUITY",
  "INVENTORY_VARIANCE",
  "ASSET_DISPOSAL_GAIN_LOSS",
  "LOSS_RECOVERY",
];

/** Toleransi sen: saldo −0,004 karena pembulatan bukan "terbalik". */
const TOLERANSI = 0.005;

/**
 * Saldo (bertanda menurut sisi normal tipenya, `signedDelta`) yang negatif
 * berarti terbalik — kecuali akun itu dipetakan ke peran yang boleh dua arah.
 */
export function saldoTerbalik(saldoBertanda: number, peran: readonly PostingRole[]): boolean {
  if (saldoBertanda > -TOLERANSI) return false;
  return !peran.some((p) => PERAN_SALDO_BOLEH_TERBALIK.includes(p));
}
