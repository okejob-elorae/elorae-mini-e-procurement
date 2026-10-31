// Pendaftaran sumber sapuan "dokumen tanpa jurnal" untuk voucher kas & bank
// (`CASH_VOUCHER`). Diimpor oleh `lib/finance/sapuan/semua.ts`.

import { Prisma, sqlId } from "@elorae/db";
import { daftarkanSumberSapuan, type DokumenTanpaJurnal, type OpsiCariSapuan } from "@/lib/finance/sapuan/registri";
import { cariTanpaJurnalSql } from "@/lib/finance/sapuan/sql";
import { SUMBER_VOUCHER_KAS } from "./aturan";
import { postingUlangJurnalVoucher } from "./voucher-writer";

/**
 * Voucher BERLAKU bernilai bukan nol tanpa jurnal `CASH_VOUCHER`. Voucher
 * menulis jurnalnya di transaksi yang sama, jadi sumber ini biasanya kosong —
 * ia jaring pengaman untuk baris yang dipulihkan/diimpor di luar penulisnya.
 */
export function cariVoucherTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]> {
  return cariTanpaJurnalSql({
    tabel: "CashVoucher",
    sourceType: SUMBER_VOUCHER_KAS,
    tanggal: Prisma.sql`d.${sqlId("date")}`,
    kolomLabel: "docNumber",
    syarat: Prisma.sql`AND d.${sqlId("status")} = ${"POSTED"} AND d.${sqlId("totalAmount")} >= 0.01`,
    opsi,
  });
}

daftarkanSumberSapuan({
  sourceType: SUMBER_VOUCHER_KAS,
  label: "Voucher kas & bank",
  cariTanpaJurnal: cariVoucherTanpaJurnal,
  posting: (id, olehUserId) => postingUlangJurnalVoucher(id, olehUserId),
});
