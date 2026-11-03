import { Decimal } from "decimal.js";
import { prisma, usePostgres } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { capNotificationText } from "@/lib/notifications/text";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { assertLinesVariantSkusMatchItemDefinitions } from "@/lib/items/validate-variant-lines";
import { toReceiptRefusal, type ReceiptRefusalCode } from "@/lib/inventory/receipt-refusal";
import { bacaBarisDasarGrn, prosesBarisGrn } from "./grn-proses";

/*
 * Konfirmasi admin atas GRN TANPA PO (keputusan pemilik 2026-11-02, P51a: "tidak usah di hapus, tapi ada
 * konfirmasi dari admin saja"). KHUSUS SERVER, tanpa `@/lib/auth`: izinnya
 * (`goods_receipts:confirm_no_po`) diperiksa aksinya (`putuskanGrnTanpaPoAction`).
 *
 * Satu `runSerializable`: baris tersimpan divalidasi ulang SEBELUM compare-and-swap (barangnya masih ada,
 * varian masih sesuai definisi barang — hari bisa lewat antara dicatat dan dikonfirmasi), lalu
 * `noPoConfirmedAt` di-CAS, lalu pemrosesan yang sama persis dengan GRN ber-PO (`prosesBarisGrn`). Galat
 * pemrosesan sesudah CAS MELEMPAR, jadi CAS-nya ikut dibatalkan (`runSerializable` menyimpan apa pun yang
 * dikembalikan callback). Jejaknya di transaksi yang sama. Jurnal penerimaan dan push stok Jubelio
 * dijalankan aksinya SESUDAH commit, seperti `createGRN`.
 *
 * Menolak GRN tanpa PO BELUM dibangun (menunggu pemilik).
 */

/** Kategori lonceng: GRN tanpa PO menunggu konfirmasi admin → `goods_receipts:confirm_no_po`. */
export const GRN_NO_PO_PENDING = "GRN_NO_PO_PENDING";

export function susunKabarGrnTanpaPo(a: { docNumber: string; namaPemasok: string }): { title: string; message: string } {
  return {
    title: capNotificationText(`GRN ${a.docNumber} tanpa PO menunggu konfirmasi`),
    message: capNotificationText(
      `${a.namaPemasok}: penerimaan ${a.docNumber} dicatat tanpa PO. Barangnya belum masuk stok dan belum menjadi utang sampai dikonfirmasi admin.`,
    ),
  };
}

export type KodeGalatGrnTanpaPo = "TIDAK_DITEMUKAN" | "BUKAN_TANPA_PO" | "SUDAH_DIPUTUSKAN" | "KEPUTUSAN_TIDAK_SAH" | ReceiptRefusalCode;

export type HasilPutuskanGrnTanpaPo = { ok: true; barang: string[]; docNumber: string } | { ok: false; kode: KodeGalatGrnTanpaPo; detail?: string };

class Tolak extends Error {
  constructor(public kode: KodeGalatGrnTanpaPo) {
    super(kode);
  }
}

export async function putuskanGrnTanpaPo(i: { grnId: string; keputusan: unknown; olehUserId: string }): Promise<HasilPutuskanGrnTanpaPo> {
  if (i.keputusan !== "KONFIRMASI") return { ok: false, kode: "KEPUTUSAN_TIDAK_SAH" };
  try {
    return await runSerializable(
      async (tx): Promise<HasilPutuskanGrnTanpaPo> => {
        // Kunci baris GRN dulu (dua konfirmasi serentak, atau konfirmasi vs tagihan yang menyebutnya).
        if (usePostgres()) await tx.$queryRaw`SELECT "id" FROM "GRN" WHERE "id" = ${i.grnId} FOR UPDATE`;
        else await tx.$queryRaw`SELECT \`id\` FROM \`GRN\` WHERE \`id\` = ${i.grnId} FOR UPDATE`;
        const g = await tx.gRN.findUnique({
          where: { id: i.grnId },
          select: { id: true, docNumber: true, poId: true, items: true, requiresNoPoConfirmation: true, noPoConfirmedAt: true },
        });
        if (!g) return { ok: false, kode: "TIDAK_DITEMUKAN" };
        if (g.poId != null || !g.requiresNoPoConfirmation) return { ok: false, kode: "BUKAN_TANPA_PO" };
        if (g.noPoConfirmedAt != null) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
        const baseItems = bacaBarisDasarGrn(g.items);
        // Validasi ulang SEBELUM tulisan pertama: barangnya masih ada dan variannya masih sesuai definisi.
        await assertLinesVariantSkusMatchItemDefinitions(tx.item, baseItems.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku })));

        const kini = new Date();
        const cas = await tx.gRN.updateMany({
          where: { id: g.id, poId: null, requiresNoPoConfirmation: true, noPoConfirmedAt: null },
          data: { noPoConfirmedAt: kini, noPoConfirmedById: i.olehUserId },
        });
        if (cas.count !== 1) throw new Tolak("SUDAH_DIPUTUSKAN");
        await prosesBarisGrn(tx, {
          grn: { id: g.id, docNumber: g.docNumber },
          baseItems,
          unitCostPerLine: baseItems.map((b) => new Decimal(b.unitCost)),
          kenaPpn: new Set(),
          userId: i.olehUserId,
        });
        await catatJejak(tx, {
          userId: i.olehUserId,
          action: JEJAK.GRN_TANPA_PO_DIKONFIRMASI,
          entityType: "GRN",
          entityId: g.id,
          changes: { before: { konfirmasi: "menunggu" }, after: { konfirmasi: "dikonfirmasi", noPoConfirmedAt: kini.toISOString() } },
          metadata: { docNumber: g.docNumber },
        });
        return { ok: true, barang: [...new Set(baseItems.map((b) => b.itemId))], docNumber: g.docNumber };
      },
      { timeout: 30_000 },
    );
  } catch (e) {
    if (e instanceof Tolak) return { ok: false, kode: e.kode };
    const r = toReceiptRefusal(e);
    if (r) return { ok: false, kode: r.code, ...(r.detail ? { detail: r.detail } : {}) };
    throw e;
  }
}

/** Jumlah GRN tanpa PO yang menunggu konfirmasi (baris Beranda `grnNoPoPending`). */
export async function hitungGrnTanpaPoMenunggu(): Promise<number> {
  return prisma.gRN.count({ where: { requiresNoPoConfirmation: true, noPoConfirmedAt: null } });
}
