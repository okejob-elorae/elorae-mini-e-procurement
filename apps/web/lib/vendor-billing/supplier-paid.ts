import { prisma, type Prisma } from "@elorae/db";
import { SARING_PEMBAYARAN_DOKUMEN } from "@/lib/purchasing/pembayaran-dokumen-po";
import { bacaLunasPemasokPerGrn } from "@/lib/purchasing/pembayaran-hutang-queries";
import { daftarHutangJasa } from "@/lib/production/hutang-jasa-queries";
import {
  allocateSupplierPaid,
  grnLineKey,
  lineRooms,
  paidFraction,
  paidPiecesByPoItem,
  readGrnLines,
  type GrnPaidPieces,
  type PoItemSlot,
  type SupplierPaidLine,
} from "./bill-paid-rule";
import { deriveBillStatus, type VendorBillStatus } from "./status";

/*
 * What Supplier payments → Pay has paid on vendor bills. Since 2026-11-01 that page is the only
 * payment path (owner decision: Vendor Billing records and matches invoices, it no longer takes
 * payments), so a bill's stored `paidAmount`/`status` — written by the old vendor payment writers
 * only — would leave a bill paid there reading "Unpaid" for good. The Vendor Billing screens read
 * both paths through `withSupplierPaid` instead; the stored columns keep meaning "paid through
 * Vendor Billing", so nothing is counted twice. The split rule is `bill-paid-rule.ts`: settled
 * PIECES per PO item or WO step, handed to the bill lines on it oldest saved bill first.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const cents = (v: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
const round2 = (n: number) => Math.round(n * 100) / 100;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** The pool key of a bill line: its PO item for a PO item line, its WO step for a step line. */
export const poItemSource = (poItemId: string) => `PO_ITEM:${poItemId}`;
export const stepSource = (woStepId: string) => `WO_STEP:${woStepId}`;

function sourceOf(l: { woStepId: string | null; poItemId: string | null }): string | null {
  if (l.woStepId) return stepSource(l.woStepId);
  return l.poItemId ? poItemSource(l.poItemId) : null;
}

/**
 * Pieces Supplier payments settled per source, every scoped source present (0 when none):
 * - a PO item: of each GRN of its PO, the GRN's settled share — document allocations to it plus its
 *   part of the old "Tandai lunas" toggle, over its booked payable, both as the supplier payable
 *   sub-ledger reads them (`bacaLunasPemasokPerGrn`) — of the pieces of this item that GRN brought in
 *   (`paidPiecesByPoItem`, matched on `GRN.items` the way `createGRN` matches PO items);
 * - a WO step: allocations to it (`targetType` "WO_STEP") over its booked payable, of its booked
 *   pieces (`daftarHutangJasa`).
 * The payable is the receipt's own, PPN included, so a receipt paid only its DPP is not settled.
 */
export async function supplierPaidPiecesBySource(db: Db, scope: { poItemIds: string[]; woStepIds: string[] }): Promise<Map<string, number>> {
  const itemIds = [...new Set(scope.poItemIds)];
  const stepIds = [...new Set(scope.woStepIds)];
  const pool = new Map<string, number>();
  for (const id of itemIds) pool.set(poItemSource(id), 0);
  for (const id of stepIds) pool.set(stepSource(id), 0);

  const poIds = new Set<string>();
  for (const ids of chunk(itemIds, 500)) {
    for (const it of await db.pOItem.findMany({ where: { id: { in: ids } }, select: { poId: true } })) poIds.add(it.poId);
  }
  for (const ids of chunk([...poIds], 200)) {
    // Every item of the PO, not only the asked ones: items sharing a key share that key's pieces.
    const items = await db.pOItem.findMany({
      where: { poId: { in: ids } },
      select: { id: true, poId: true, itemId: true, variantSku: true, receivedQty: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const grns = await db.gRN.findMany({ where: { poId: { in: ids } }, select: { id: true, poId: true, items: true } });
    const settled = await bacaLunasPemasokPerGrn(ids, db);
    const grnsOf = new Map<string, GrnPaidPieces[]>();
    for (const g of grns) {
      const s = settled.get(g.id);
      if (!g.poId || !s) continue;
      const list = grnsOf.get(g.poId) ?? [];
      list.push({ fraction: paidFraction(s.lunasPemasokSen, s.hutangSen), lines: readGrnLines(g.items) });
      grnsOf.set(g.poId, list);
    }
    const slotsOf = new Map<string, PoItemSlot[]>();
    for (const it of items) {
      const list = slotsOf.get(it.poId) ?? [];
      list.push({ id: it.id, key: grnLineKey(it.itemId, it.variantSku), receivedQty: Number(it.receivedQty) });
      slotsOf.set(it.poId, list);
    }
    for (const [poId, slots] of slotsOf) {
      for (const [id, pieces] of paidPiecesByPoItem(grnsOf.get(poId) ?? [], slots)) {
        if (pool.has(poItemSource(id))) pool.set(poItemSource(id), pieces);
      }
    }
  }

  if (stepIds.length > 0) {
    const woIds = new Set<string>();
    for (const ids of chunk(stepIds, 500)) {
      for (const s of await db.workOrderStep.findMany({ where: { id: { in: ids } }, select: { woId: true } })) woIds.add(s.woId);
    }
    const booked = new Map<string, { payableCents: number; qty: number }>();
    for (const ids of chunk([...woIds], 500)) {
      for (const p of await daftarHutangJasa({ woIds: ids }, db)) {
        for (const l of p.langkah) booked.set(l.stepId, { payableCents: cents(l.hutang), qty: l.qtyTerhutang });
      }
    }
    const paid = new Map<string, number>();
    for (const ids of chunk(stepIds, 500)) {
      const rows = await db.supplierPaymentAllocation.findMany({
        where: { targetType: "WO_STEP", targetId: { in: ids }, payment: SARING_PEMBAYARAN_DOKUMEN },
        select: { targetId: true, amount: true },
      });
      for (const r of rows) if (r.targetId) paid.set(r.targetId, (paid.get(r.targetId) ?? 0) + cents(r.amount));
    }
    for (const id of stepIds) {
      const b = booked.get(id);
      if (b) pool.set(stepSource(id), paidFraction(paid.get(id) ?? 0, b.payableCents) * b.qty);
    }
  }
  return pool;
}

/**
 * Cents Supplier payments have paid on each of the given live bills (`bill-paid-rule.ts`). The
 * settled pieces of a source are shared by EVERY live bill on it, not only the ones asked about, so
 * those are read too, oldest saved first. A bill nothing reached is absent; a voided bill never takes
 * a share, so voiding one hands its share to the next bill on the same receipt.
 */
export async function supplierPaidByBill(db: Db, billIds: string[]): Promise<Map<string, number>> {
  const wanted = new Set(billIds);
  const result = new Map<string, number>();
  if (wanted.size === 0) return result;

  const poItemIds = new Set<string>();
  const woStepIds = new Set<string>();
  for (const ids of chunk([...wanted], 500)) {
    const own = await db.vendorBillLine.findMany({
      where: { billId: { in: ids }, bill: { status: { not: "VOID" } } },
      select: { woStepId: true, poItemId: true },
    });
    for (const l of own) {
      if (l.woStepId) woStepIds.add(l.woStepId);
      else if (l.poItemId) poItemIds.add(l.poItemId);
    }
  }
  if (poItemIds.size === 0 && woStepIds.size === 0) return result;

  const pool = await supplierPaidPiecesBySource(db, { poItemIds: [...poItemIds], woStepIds: [...woStepIds] });
  if (![...pool.values()].some((n) => n > 0)) return result;

  const or: Prisma.VendorBillLineWhereInput[] = [];
  if (poItemIds.size > 0) or.push({ poItemId: { in: [...poItemIds] } });
  if (woStepIds.size > 0) or.push({ woStepId: { in: [...woStepIds] } });
  const bills = await db.vendorBill.findMany({
    where: { status: { not: "VOID" }, lines: { some: { OR: or } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
      lines: { orderBy: { id: "asc" }, select: { qty: true, amount: true, woStepId: true, poItemId: true } },
    },
  });

  const lines: SupplierPaidLine[] = [];
  for (const b of bills) {
    const vendorPaid = b.allocations.reduce((s, a) => s + cents(a.amount), 0);
    const amounts = b.lines.map((l) => Math.max(0, cents(l.amount)));
    const rooms = lineRooms(vendorPaid, amounts);
    b.lines.forEach((l, i) => {
      const source = sourceOf(l);
      if (source && pool.has(source)) lines.push({ billId: b.id, source, qty: Number(l.qty), amountCents: amounts[i], roomCents: rooms[i] });
    });
  }
  for (const [billId, n] of allocateSupplierPaid(lines, pool)) if (wanted.has(billId)) result.set(billId, n);
  return result;
}

export type BillPaidInput = { id: string; total: number; paidAmount: number; status: VendorBillStatus };

export type BillPaidFigures = {
  /** Paid through both paths. */
  paidAmount: number;
  /** Paid through the old Vendor Billing payments (the stored `VendorBill.paidAmount`). */
  vendorPaidAmount: number;
  /** Paid through Supplier payments → Pay, on this bill's share of its receipts. */
  supplierPaidAmount: number;
  status: VendorBillStatus;
};

/** Bill rows with what both payment paths paid on them, and the status that follows. */
export async function withSupplierPaid<T extends BillPaidInput>(rows: T[], db: Db = prisma): Promise<Array<T & BillPaidFigures>> {
  const supplier = await supplierPaidByBill(
    db,
    rows.filter((r) => r.status !== "VOID").map((r) => r.id)
  );
  return rows.map((r) => {
    const supplierPaidAmount = r.status === "VOID" ? 0 : (supplier.get(r.id) ?? 0) / 100;
    const paidAmount = round2(r.paidAmount + supplierPaidAmount);
    const status: VendorBillStatus = r.status === "VOID" ? "VOID" : deriveBillStatus(r.total, paidAmount, false);
    return { ...r, vendorPaidAmount: r.paidAmount, supplierPaidAmount, paidAmount, status };
  });
}
