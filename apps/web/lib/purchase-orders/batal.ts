import { Decimal } from "decimal.js";
import { runSerializable } from "@/lib/db/tx-retry";

/*
 * Pembatalan PO. Penjaga "belum ada barang diterima" dan penulisan CANCELLED
 * berjalan dalam SATU `runSerializable`: dulu penjaganya dibaca di luar
 * transaksi, jadi "batal memeriksa → GRN commit → batal menulis" menghasilkan
 * PO batal yang punya GRN (stok sudah masuk, hutang terjurnal). GRN menulis
 * baris PO di transaksinya sendiri, jadi salah satu pihak konflik dan diulang
 * dengan keadaan baru.
 *
 * Izin dan PIN diperiksa aksinya, bukan di sini.
 */

export type KodeTolakBatalPo = "TIDAK_DITEMUKAN" | "SUDAH_DIBATALKAN" | "SUDAH_ADA_PENERIMAAN";

/** Pesan untuk pemanggil yang hanya bisa melempar (`changePOStatus`, `cancelPO`). */
export const PESAN_TOLAK_BATAL_PO: Record<KodeTolakBatalPo, string> = {
  TIDAK_DITEMUKAN: "PO tidak ditemukan.",
  SUDAH_DIBATALKAN: "PO ini sudah dibatalkan.",
  SUDAH_ADA_PENERIMAAN:
    "PO ini tidak bisa dibatalkan karena sudah ada barang yang diterima (GRN). Gunakan Tutup PO bila sisa barang tidak akan datang.",
};

export type HasilBatalPo =
  | { ok: true; docNumber: string; statusSebelum: string }
  | { ok: false; code: KodeTolakBatalPo };

export async function batalkanPurchaseOrder(input: {
  poId: string;
  userId: string;
  alasan?: string | null;
}): Promise<HasilBatalPo> {
  const catatan = (input.alasan ?? "").trim() || "PO Cancelled";

  return runSerializable(async (tx): Promise<HasilBatalPo> => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: input.poId },
      select: {
        id: true,
        docNumber: true,
        status: true,
        grns: { select: { id: true }, take: 1 },
        items: { select: { receivedQty: true } },
      },
    });
    if (!po) return { ok: false, code: "TIDAK_DITEMUKAN" };
    if (po.status === "CANCELLED") return { ok: false, code: "SUDAH_DIBATALKAN" };

    // GRN tertaut ATAU qty diterima di baris PO (penerimaan lama bisa tak bertaut).
    const adaDiterima = po.items.some((l) => new Decimal(l.receivedQty.toString()).gt(0));
    if (po.grns.length > 0 || adaDiterima) return { ok: false, code: "SUDAH_ADA_PENERIMAAN" };

    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "CANCELLED" } });
    await tx.pOStatusHistory.create({
      data: { poId: po.id, status: "CANCELLED", changedById: input.userId, notes: catatan },
    });

    return { ok: true, docNumber: po.docNumber, statusSebelum: po.status };
  });
}
