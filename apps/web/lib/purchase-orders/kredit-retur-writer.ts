import type { Prisma } from "@elorae/db";
import { hitungKreditRetur, type BarisReturUntukKredit, type BarisTanpaPadanan } from "./kredit-retur";

/*
 * Penulis kredit retur pemasok: dipanggil DI DALAM transaksi `completeReturn`
 * (PROCESSED → COMPLETED), jadi kredit dan jejaknya commit bersama status
 * retur. Hanya mencatat `VendorReturn.poId` + `poCreditAmount` dan satu baris
 * AuditLog — tidak ada jurnal (GL belum dipersenjatai).
 *
 * PO-nya dari GRN retur. Retur tanpa GRN (dari produksi/WO) atau yang
 * pemasoknya berbeda dari pemasok PO tidak mengurangi utang PO mana pun.
 * Retur yang sudah punya `poId` tidak dihitung ulang (pemanggilan ulang aman).
 */

type Klien = Prisma.TransactionClient;

export const AKSI_JEJAK_KREDIT_RETUR = "VENDOR_RETURN_PO_CREDIT";

export type HasilKreditReturPo =
  | { poId: string; kredit: number; tanpaPadanan: BarisTanpaPadanan[] }
  | { poId: null; kredit: 0; sebab: "TANPA_PO" | "PEMASOK_BERBEDA" | "TANPA_NILAI" };

function bacaBaris(raw: unknown): BarisReturUntukKredit[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const hasil: BarisReturUntukKredit[] = [];
  for (const b of arr as Array<Record<string, unknown>>) {
    if (!b || typeof b.itemId !== "string") continue;
    const qty = typeof b.qty === "number" || typeof b.qty === "string" ? b.qty : null;
    if (qty == null) continue;
    hasil.push({ itemId: b.itemId, variantSku: typeof b.variantSku === "string" ? b.variantSku : null, qty });
  }
  return hasil;
}

export async function catatKreditReturPo(
  tx: Klien,
  input: { returnId: string; userId: string },
): Promise<HasilKreditReturPo> {
  const ret = await tx.vendorReturn.findUnique({
    where: { id: input.returnId },
    select: { id: true, docNumber: true, vendorId: true, grnId: true, lines: true, poId: true, poCreditAmount: true },
  });
  if (!ret) return { poId: null, kredit: 0, sebab: "TANPA_PO" };
  if (ret.poId != null) {
    return { poId: ret.poId, kredit: Number(ret.poCreditAmount ?? 0), tanpaPadanan: [] };
  }
  if (!ret.grnId) return { poId: null, kredit: 0, sebab: "TANPA_PO" };

  const grn = await tx.gRN.findUnique({ where: { id: ret.grnId }, select: { poId: true } });
  if (!grn?.poId) return { poId: null, kredit: 0, sebab: "TANPA_PO" };
  const po = await tx.purchaseOrder.findUnique({
    where: { id: grn.poId },
    select: {
      id: true,
      docNumber: true,
      supplierId: true,
      ppnRatePercent: true,
      items: { select: { itemId: true, variantSku: true, price: true, ppnIncluded: true } },
    },
  });
  if (!po) return { poId: null, kredit: 0, sebab: "TANPA_PO" };
  if (po.supplierId !== ret.vendorId) return { poId: null, kredit: 0, sebab: "PEMASOK_BERBEDA" };

  const tarif = po.ppnRatePercent == null ? null : Number(po.ppnRatePercent);
  const hasil = hitungKreditRetur(po.items, tarif, bacaBaris(ret.lines));
  if (hasil.kredit <= 0) return { poId: null, kredit: 0, sebab: "TANPA_NILAI" };

  await tx.vendorReturn.update({
    where: { id: ret.id },
    data: { poId: po.id, poCreditAmount: hasil.kredit },
  });
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: AKSI_JEJAK_KREDIT_RETUR,
      entityType: "VendorReturn",
      entityId: ret.id,
      changes: { before: { poId: null, poCreditAmount: null }, after: { poId: po.id, poCreditAmount: hasil.kredit } },
      metadata: {
        returnDocNumber: ret.docNumber,
        poId: po.id,
        poDocNumber: po.docNumber,
        kredit: hasil.kredit,
        dasar: hasil.dasar,
        ppn: hasil.ppn,
        ppnRatePercent: tarif,
        rincian: hasil.rincian,
        tanpaPadanan: hasil.tanpaPadanan,
      },
    },
  });
  return { poId: po.id, kredit: hasil.kredit, tanpaPadanan: hasil.tanpaPadanan };
}
