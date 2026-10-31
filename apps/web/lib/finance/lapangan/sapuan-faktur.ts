import { Prisma, sqlId } from "@elorae/db";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { daftarkanSumberSapuan, type DokumenTanpaJurnal, type OpsiCariSapuan } from "@/lib/finance/sapuan/registri";
import { cariTanpaJurnalSql } from "@/lib/finance/sapuan/sql";
import { AWALAN_PENANDA_BEBAN } from "@/lib/receivables/penanda-beban";
import { SUMBER_LAPANGAN } from "./aturan";
import { postingJurnalLapanganAman } from "./tertunda";

/*
 * Sumber sapuan "dokumen tanpa jurnal" untuk faktur piutang manual/impor
 * (`STORE_INVOICE`, uji akuntansi 2 bug 5). Diimpor `lib/finance/sapuan/semua.ts`.
 *
 * Syaratnya cermin `fakturDijurnalSendiri` + `nilaiFakturDijurnal` (aturan.ts):
 * bukan nota pengiriman, bukan faktur beban retur, bukan toko konsinyasi, dan
 * masih bernilai sesudah dikurangi yang dibayar sebelum impor. Tidak pernah
 * menyapu sebelum tanggal mulai buku besar (faktur sebelum itu = saldo awal),
 * dan kosong bila tanggal mulai belum ditetapkan.
 */

export async function cariFakturTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]> {
  const mulai = await readGlCutover();
  if (!mulai || opsi.batas <= 0) return [];
  const sejak = opsi.sejak.getTime() < mulai.getTime() ? mulai : opsi.sejak;
  if (sejak.getTime() > opsi.sampai.getTime()) return [];
  return cariTanpaJurnalSql({
    tabel: "Receivable",
    sourceType: SUMBER_LAPANGAN.FAKTUR,
    tanggal: Prisma.sql`d.${sqlId("invoiceDate")}`,
    kolomLabel: "invoiceNo",
    syarat: Prisma.sql`
      AND d.${sqlId("source")} <> 'DELIVERY'
      AND d.${sqlId("deliveryId")} IS NULL
      AND (d.${sqlId("note")} IS NULL OR d.${sqlId("note")} NOT LIKE ${`%${AWALAN_PENANDA_BEBAN}%`})
      AND d.${sqlId("amount")} - d.${sqlId("paidBeforeImport")} >= 0.01
      AND EXISTS (
        SELECT 1 FROM ${sqlId("Store")} s
        WHERE s.${sqlId("id")} = d.${sqlId("storeId")} AND s.${sqlId("termsType")} <> 'KONSI'
      )`,
    opsi: { ...opsi, sejak },
  });
}

/**
 * Hasil untuk registri sapuan. Kegagalan tanpa kode di `GenerateAutoJournalResult`
 * sudah dicatat `JOURNAL_PENDING` oleh `postingJurnalLapanganAman`, lalu
 * dilempar supaya runner mencatatnya per dokumen.
 */
async function postingFaktur(id: string, olehUserId: string): Promise<GenerateAutoJournalResult> {
  const r = await postingJurnalLapanganAman(SUMBER_LAPANGAN.FAKTUR, id, olehUserId);
  if (r.ok) return r.journalId ? { ok: true, journalId: r.journalId, created: r.created } : { ok: false, code: "NOTHING_TO_POST" };
  switch (r.code) {
    case "UNMAPPED_ROLE":
      return { ok: false, code: "UNMAPPED_ROLE", ...(r.role ? { role: r.role } : {}) };
    case "UNBALANCED":
      return { ok: false, code: "UNBALANCED" };
    case "NOTHING_TO_POST":
    case "BELUM_BERLAKU":
    case "GL_CUTOVER_NOT_CONFIGURED":
      return { ok: false, code: "NOTHING_TO_POST" };
    default:
      throw new Error(`Jurnal faktur piutang ${id} gagal: ${r.code}${r.detail ? ` (${r.detail})` : ""}`);
  }
}

daftarkanSumberSapuan({
  sourceType: SUMBER_LAPANGAN.FAKTUR,
  label: "Faktur piutang manual/impor",
  cariTanpaJurnal: cariFakturTanpaJurnal,
  posting: postingFaktur,
});
