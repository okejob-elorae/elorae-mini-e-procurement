import { Decimal } from "decimal.js";
import { runSerializable } from "@/lib/db/tx-retry";
import { hitungTotalPo } from "./ppn";

/*
 * "Tutup PO" — menutup PO yang barangnya tidak akan dikirim lengkap.
 *
 * Status menjadi CLOSED (sama dengan PO yang lengkap lewat GRN), dan
 * `closedAt`/`closedById`/`closeReason` membedakan penutupan manual ini dari
 * penerimaan lengkap. Penjaga keadaan dan penulisan berjalan di
 * `runSerializable`: dua penutupan serentak, atau penutupan yang bersamaan
 * dengan GRN, tidak bisa sama-sama lolos dari pembacaan yang basi.
 *
 * Yang ditolak:
 * - DRAFT (batalkan saja), CANCELLED, CLOSED, OVER (sudah lengkap);
 * - belum ada barang diterima sama sekali — itu pembatalan, bukan penutupan;
 * - masih ada GRN terima-lebih yang menunggu keputusan pemilik — keputusan itu
 *   menghitung ulang status PO dan akan menimpa penutupan ini.
 *
 * Izin (`purchase_orders:approve`) diperiksa aksinya, bukan di sini.
 */

export type KodeTolakTutupPo =
  | "ALASAN_WAJIB"
  | "TIDAK_DITEMUKAN"
  | "MASIH_DRAF"
  | "DIBATALKAN"
  | "SUDAH_DITUTUP"
  | "SUDAH_LENGKAP"
  | "BELUM_ADA_PENERIMAAN"
  | "GRN_MENUNGGU_PEMILIK";

/** Pesan untuk pemanggil yang hanya bisa melempar (`changePOStatus`). */
export const PESAN_TOLAK_TUTUP_PO: Record<KodeTolakTutupPo, string> = {
  ALASAN_WAJIB: "Tulis alasan penutupan PO.",
  TIDAK_DITEMUKAN: "PO tidak ditemukan.",
  MASIH_DRAF: "PO masih draf. Batalkan PO ini, bukan menutupnya.",
  DIBATALKAN: "PO sudah dibatalkan.",
  SUDAH_DITUTUP: "PO sudah ditutup.",
  SUDAH_LENGKAP: "Semua barang PO ini sudah diterima.",
  BELUM_ADA_PENERIMAAN: "Belum ada barang yang diterima. Batalkan PO ini, bukan menutupnya.",
  GRN_MENUNGGU_PEMILIK: "Masih ada GRN terima-lebih yang menunggu keputusan pemilik. Putuskan GRN itu dulu.",
};

export type SisaBarisPo = {
  itemId: string;
  variantSku: string | null;
  dipesan: number;
  diterima: number;
  sisa: number;
};

export type HasilTutupPo =
  | {
      ok: true;
      docNumber: string;
      statusSebelum: string;
      sisa: SisaBarisPo[];
      /** Σ pcs yang tidak akan datang. */
      qtySisa: number;
      /** Nilai sisa dengan harga PO (+PPN baris "Exclude PPN"). */
      nilaiSisa: number;
    }
  | { ok: false; code: KodeTolakTutupPo };

export const AKSI_JEJAK_TUTUP_PO = "PO_CLOSED_SHORT";

export async function tutupPurchaseOrder(input: {
  poId: string;
  userId: string;
  alasan: string;
}): Promise<HasilTutupPo> {
  const alasan = (input.alasan ?? "").trim();
  if (!alasan) return { ok: false, code: "ALASAN_WAJIB" };

  return runSerializable(async (tx): Promise<HasilTutupPo> => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: input.poId },
      select: {
        id: true,
        docNumber: true,
        status: true,
        ppnRatePercent: true,
        items: { select: { itemId: true, variantSku: true, qty: true, receivedQty: true, price: true, ppnIncluded: true } },
      },
    });
    if (!po) return { ok: false, code: "TIDAK_DITEMUKAN" };
    if (po.status === "DRAFT") return { ok: false, code: "MASIH_DRAF" };
    if (po.status === "CANCELLED") return { ok: false, code: "DIBATALKAN" };
    if (po.status === "CLOSED") return { ok: false, code: "SUDAH_DITUTUP" };
    if (po.status === "OVER") return { ok: false, code: "SUDAH_LENGKAP" };

    const grnMenunggu = await tx.gRN.count({
      where: { poId: po.id, requiresOwnerApproval: true, ownerApprovedAt: null, ownerDeclinedAt: null },
    });
    if (grnMenunggu > 0) return { ok: false, code: "GRN_MENUNGGU_PEMILIK" };

    const adaDiterima = po.items.some((l) => new Decimal(l.receivedQty.toString()).gt(0));
    if (!adaDiterima) return { ok: false, code: "BELUM_ADA_PENERIMAAN" };

    const sisa: SisaBarisPo[] = [];
    const barisNilaiSisa: Array<{ qty: Decimal; price: string; ppnIncluded: boolean }> = [];
    for (const l of po.items) {
      const dipesan = new Decimal(l.qty.toString());
      const diterima = new Decimal(l.receivedQty.toString());
      const kurang = dipesan.minus(diterima);
      if (kurang.lte(0)) continue;
      sisa.push({
        itemId: l.itemId,
        variantSku: l.variantSku,
        dipesan: dipesan.toNumber(),
        diterima: diterima.toNumber(),
        sisa: kurang.toNumber(),
      });
      barisNilaiSisa.push({ qty: kurang, price: l.price.toString(), ppnIncluded: l.ppnIncluded });
    }
    if (sisa.length === 0) return { ok: false, code: "SUDAH_LENGKAP" };

    const tarif = po.ppnRatePercent == null ? null : Number(po.ppnRatePercent);
    const nilaiSisa = hitungTotalPo(barisNilaiSisa, tarif).grandTotal;
    const qtySisa = sisa.reduce((t, s) => t.plus(s.sisa), new Decimal(0)).toNumber();

    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "CLOSED", closedAt: new Date(), closedById: input.userId, closeReason: alasan },
    });
    await tx.pOStatusHistory.create({
      data: {
        poId: po.id,
        status: "CLOSED",
        changedById: input.userId,
        notes: `Ditutup sebelum lengkap: ${alasan}`,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: AKSI_JEJAK_TUTUP_PO,
        entityType: "PurchaseOrder",
        entityId: po.id,
        changes: { before: { status: po.status }, after: { status: "CLOSED" } },
        metadata: { docNumber: po.docNumber, sisa, qtySisa, nilaiSisa },
        reason: alasan,
      },
    });

    return { ok: true, docNumber: po.docNumber, statusSebelum: po.status, sisa, qtySisa, nilaiSisa };
  });
}
