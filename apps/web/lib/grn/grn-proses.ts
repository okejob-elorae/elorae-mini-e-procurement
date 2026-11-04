import { Decimal } from "decimal.js";
import type { Prisma, StockLedgerRefType } from "@elorae/db";
import { calculateMovingAverage } from "@/lib/inventory/costing";
import { kunciBarisPpn } from "@/lib/finance/pajak/grn-ppn";
import { fabricRollCode } from "./roll-code";

/*
 * Pemrosesan baris GRN — DIPINDAH APA ADANYA dari pass 2 `createGRN` (`app/actions/grn.ts`): harga
 * rata-rata bergerak per baris (kartu stok ber-ref `GRN`), `GRN.items` ditambal dengan harga rata-rata
 * sebelum/sesudah, dan roll kain. Dipakai `createGRN` untuk GRN ber-PO dan `putuskanGrnTanpaPo` saat admin
 * mengonfirmasi GRN tanpa PO (keputusan pemilik 2026-11-02, P51a) — jadi penerimaan yang dikonfirmasi
 * diproses PERSIS seperti penerimaan ber-PO hari ini. Berurutan (bukan Promise.all): skema tidak
 * melarang itemId yang sama dua kali dalam satu kiriman, dan await yang bersilang pada barang yang belum
 * pernah distok bisa membuat baris InventoryValue kembar.
 */

export type BarisDasarGrn = {
  itemId: string;
  /** Kunci varian mentah (tidak dipangkas) untuk hitung biaya / gerak stok, seperti aslinya. */
  variantKey: string | null;
  variantSku: string | null;
  qty: number;
  unitCost: number;
  hargaPo?: number;
  ppnDikapitalisasi?: number;
  itemType: string;
  uomId: string;
  overReceiveThreshold: number | null;
  rolls: Array<{ rollRef?: string; length: number; notes?: string | null }>;
  totalCost: number;
};

export type BarisGrnDiproses = Omit<BarisDasarGrn, "variantKey"> & {
  prevAvgCost: number;
  newAvgCost: number;
  prevQty: number;
  newQty: number;
  ppnIncluded?: false;
};

export async function prosesBarisGrn(
  tx: Prisma.TransactionClient,
  a: {
    grn: { id: string; docNumber: string };
    baseItems: readonly BarisDasarGrn[];
    /** Harga per unit tepat (harga PO + bagian PPN dikapitalisasi), urutan sama dengan `baseItems`. */
    unitCostPerLine: readonly (Decimal | undefined)[];
    /** Baris PO "Exclude PPN" yang PPN masukannya tersimpan di `GRN.ppnAmount` (`kunciBarisPpn`). */
    kenaPpn: ReadonlySet<string>;
    userId: string;
  },
): Promise<{ processedItems: BarisGrnDiproses[]; itemsJson: string }> {
  const processedItems: BarisGrnDiproses[] = [];
  for (const [idxBaris, item] of a.baseItems.entries()) {
    const qty = new Decimal(item.qty);
    const unitCost = a.unitCostPerLine[idxBaris] ?? new Decimal(item.unitCost);
    const costCalc = await calculateMovingAverage(item.itemId, qty, unitCost, tx, item.variantKey, {
      refType: "GRN" satisfies StockLedgerRefType,
      refId: a.grn.id,
      refDocNumber: a.grn.docNumber,
      createdById: a.userId,
    });

    processedItems.push({
      itemId: item.itemId,
      variantSku: item.variantSku,
      qty: item.qty,
      unitCost: item.unitCost,
      itemType: item.itemType,
      uomId: item.uomId,
      overReceiveThreshold: item.overReceiveThreshold,
      rolls: item.rolls,
      totalCost: item.totalCost,
      ...(item.ppnDikapitalisasi !== undefined ? { hargaPo: item.hargaPo, ppnDikapitalisasi: item.ppnDikapitalisasi } : {}),
      prevAvgCost: costCalc.previousAvgCost.toNumber(),
      newAvgCost: costCalc.newAvgCost.toNumber(),
      prevQty: costCalc.previousQty.toNumber(),
      newQty: costCalc.newQty.toNumber(),
    });
  }

  const itemsTersimpan = processedItems.map((p) => (a.kenaPpn.has(kunciBarisPpn(p.itemId, p.variantSku)) ? { ...p, ppnIncluded: false as const } : p));
  const itemsJson = JSON.stringify(itemsTersimpan);
  await tx.gRN.update({ where: { id: a.grn.id }, data: { items: itemsJson } });

  const totalRolls = processedItems.reduce((sum, item) => (item.itemType === "FABRIC" && Array.isArray(item.rolls) ? sum + item.rolls.length : sum), 0);
  let rollSeq = 0;
  const rollCreates: Array<{
    grnId: string;
    itemId: string;
    rollCode: string;
    rollRef: string;
    initialLength: number;
    remainingLength: number;
    uomId: string;
    notes: string | null;
  }> = [];
  for (const item of processedItems) {
    if (item.itemType !== "FABRIC" || !Array.isArray(item.rolls) || item.rolls.length === 0) continue;
    for (let index = 0; index < item.rolls.length; index++) {
      rollSeq += 1;
      const roll = item.rolls[index];
      rollCreates.push({
        grnId: a.grn.id,
        itemId: item.itemId,
        rollCode: fabricRollCode(a.grn.docNumber, rollSeq, totalRolls),
        rollRef: roll.rollRef || `ROLL-${index + 1}`,
        initialLength: roll.length,
        remainingLength: roll.length,
        uomId: item.uomId,
        notes: roll.notes ?? null,
      });
    }
  }
  if (rollCreates.length > 0) {
    await tx.fabricRoll.createMany({ data: rollCreates });
  }
  return { processedItems, itemsJson };
}

/** Baris dasar tersimpan GRN yang menunggu konfirmasi (`GRN.items` saat dibuat), dibaca untuk diproses. */
export function bacaBarisDasarGrn(raw: unknown): BarisDasarGrn[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: BarisDasarGrn[] = [];
  for (const l of arr) {
    if (typeof l !== "object" || l === null) continue;
    const r = l as Record<string, unknown>;
    if (typeof r.itemId !== "string") continue;
    out.push({
      itemId: r.itemId,
      variantKey: typeof r.variantKey === "string" ? r.variantKey : typeof r.variantSku === "string" ? r.variantSku : null,
      variantSku: typeof r.variantSku === "string" && r.variantSku.trim() ? r.variantSku.trim() : null,
      qty: Number(r.qty),
      unitCost: Number(r.unitCost),
      ...(r.ppnDikapitalisasi != null ? { hargaPo: Number(r.hargaPo), ppnDikapitalisasi: Number(r.ppnDikapitalisasi) } : {}),
      itemType: typeof r.itemType === "string" ? r.itemType : "",
      uomId: typeof r.uomId === "string" ? r.uomId : "",
      overReceiveThreshold: r.overReceiveThreshold == null ? null : Number(r.overReceiveThreshold),
      rolls: Array.isArray(r.rolls) ? (r.rolls as BarisDasarGrn["rolls"]) : [],
      totalCost: Number(r.totalCost),
    });
  }
  return out;
}
