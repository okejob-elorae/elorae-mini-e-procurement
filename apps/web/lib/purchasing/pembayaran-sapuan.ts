// Pendaftaran sumber sapuan "dokumen tanpa jurnal" untuk pembayaran pemasok
// (dokumen BYR/…, `SUPPLIER_PAYMENT_DOC`). Diimpor oleh `lib/finance/sapuan/semua.ts`.

import { Prisma, sqlId } from "@elorae/db";
import { daftarkanSumberSapuan, type DokumenTanpaJurnal, type OpsiCariSapuan } from "@/lib/finance/sapuan/registri";
import { cariTanpaJurnalSql } from "@/lib/finance/sapuan/sql";
import { AWALAN_KUNCI_TANDAI_LUNAS, SUMBER_PEMBAYARAN_PEMASOK } from "./pembayaran-aturan";
import { postingUlangJurnalPembayaran } from "./pembayaran-writer";

/**
 * Pembayaran BERLAKU bernilai bukan nol tanpa jurnal `SUPPLIER_PAYMENT_DOC`.
 * Cermin tombol lama "Tandai lunas" (`tandai-lunas:…`) dikecualikan: jurnalnya
 * bersumber `SUPPLIER_PAYMENT` milik tombol itu sendiri.
 */
export function cariPembayaranTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]> {
  return cariTanpaJurnalSql({
    tabel: "SupplierPayment",
    sourceType: SUMBER_PEMBAYARAN_PEMASOK,
    tanggal: Prisma.sql`d.${sqlId("date")}`,
    kolomLabel: "docNumber",
    syarat: Prisma.sql`AND d.${sqlId("status")} = ${"POSTED"} AND d.${sqlId("grossAmount")} >= 0.01 AND (d.${sqlId("idempotencyKey")} IS NULL OR d.${sqlId("idempotencyKey")} NOT LIKE ${`${AWALAN_KUNCI_TANDAI_LUNAS}%`})`,
    opsi,
  });
}

daftarkanSumberSapuan({
  sourceType: SUMBER_PEMBAYARAN_PEMASOK,
  label: "Pembayaran pemasok",
  cariTanpaJurnal: cariPembayaranTanpaJurnal,
  posting: (id, olehUserId) => postingUlangJurnalPembayaran(id, olehUserId),
});
