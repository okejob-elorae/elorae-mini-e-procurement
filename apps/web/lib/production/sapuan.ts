// Pendaftaran sumber sapuan "dokumen tanpa jurnal" untuk penerimaan barang
// jadi (`FG_RECEIPT`). Diimpor oleh `lib/finance/sapuan/semua.ts`.

import { Prisma, sqlId } from "@elorae/db";
import { daftarkanSumberSapuan, type DokumenTanpaJurnal, type OpsiCariSapuan } from "@/lib/finance/sapuan/registri";
import { cariTanpaJurnalSql } from "@/lib/finance/sapuan/sql";
import { postFgReceiptJournalAman } from "./fg-receipt-journal-aman";

/** Sama dengan `SUMBER_JURNAL_PENERIMAAN_FG` (`./fg-receipt-journal.ts`); ditulis ulang supaya tes yang meniru penulis jurnal tidak memutus pendaftaran ini. */
const SUMBER_JURNAL_PENERIMAAN_FG = "FG_RECEIPT";

/**
 * Penerimaan barang jadi bertanggal di [sejak, sampai] yang memasukkan barang
 * ke stok dengan nilai bukan nol tetapi belum punya jurnal `FG_RECEIPT` —
 * syaratnya meniru `postFgReceiptJournal` (qty lolos > 0, nilai persediaan
 * ≥ Rp0,01). Lantai tanggal mulai buku besar diterapkan runner sapuan.
 */
export function cariPenerimaanFgTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]> {
  return cariTanpaJurnalSql({
    tabel: "FGReceipt",
    sourceType: SUMBER_JURNAL_PENERIMAAN_FG,
    tanggal: Prisma.sql`d.${sqlId("receivedAt")}`,
    kolomLabel: "docNumber",
    syarat: Prisma.sql`AND d.${sqlId("qtyAccepted")} > 0 AND d.${sqlId("totalCostValue")} >= 0.01`,
    opsi,
  });
}

daftarkanSumberSapuan({
  sourceType: SUMBER_JURNAL_PENERIMAAN_FG,
  label: "Penerimaan barang jadi",
  cariTanpaJurnal: cariPenerimaanFgTanpaJurnal,
  async posting(id, olehUserId) {
    // Berhasil → tanda tertundanya selesai; gagal → JOURNAL_PENDING (sama
    // dengan receiveFG dan tombol "Post journal" di halaman WO).
    const hasil = await postFgReceiptJournalAman(id, olehUserId);
    if (hasil.ok) return hasil;
    // Akun tidak bisa diposting / galat tak terduga: JOURNAL_PENDING-nya sudah
    // ditulis; dilempar ke runner seperti sumber lain (`sumber-lama.ts`).
    if ("pesan" in hasil || hasil.code === "NON_POSTABLE_ACCOUNT" || hasil.code === "ERROR") {
      throw new Error(`Jurnal penerimaan barang jadi gagal (${hasil.code}${"pesan" in hasil && hasil.pesan ? `: ${hasil.pesan}` : ""})`);
    }
    return { ok: false, code: hasil.code, ...("role" in hasil && hasil.role ? { role: hasil.role } : {}) };
  },
});
