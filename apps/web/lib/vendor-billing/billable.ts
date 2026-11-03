import { prisma, type Prisma } from "@elorae/db";
import { grnBelumDiproses } from "@/lib/grn/grn-tanpa-po";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { grnLineKey, grnLineSource, invoicedReturnedQty, readGrnLines, readGrnLinesDetail, splitCents } from "./bill-paid-rule";

type Db = Prisma.TransactionClient | typeof prisma;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** An over-receive GRN the owner has neither approved nor declined yet. */
export const PENDING_OWNER_DECISION = { requiresOwnerApproval: true, ownerApprovedAt: null, ownerDeclinedAt: null } as const;

export type BillableGrnItem = {
  grnId: string;
  grnDocNumber: string;
  /** "YYYY-MM-DD" WIB. */
  grnDate: string;
  poId: string | null;
  poDocNumber: string | null;
  /** The PO item this key maps to (first by createdAt, id), so the PO page still lists the line. */
  poItemId: string | null;
  /**
   * Already marked paid (Supplier payments → Pay settled it, or the old toggle did). Still billable:
   * a bill only matches the vendor's invoice to the receipts, and it reads as paid from those
   * payments (`supplier-paid.ts`).
   */
  poPaid: boolean;
  itemId: string;
  itemName: string;
  sku: string;
  variantSku: string | null;
  uomCode: string;
  /** Σ qty of this GRN's lines for the key. */
  receivedQty: number;
  /** Completed vendor returns naming this GRN and key. */
  returnedQty: number;
  /** Live GRN_ITEM bill lines on this GRN and key. */
  billedQty: number;
  /** received − returned − billed: what an invoice may still name. */
  remainingQty: number;
  /** The receipt's recorded base price per unit, before PPN: Σ(qty × (hargaPo ?? unitCost)) ÷ Σ qty. */
  recordedPrice: number;
  /** The PO price when the key maps to a PO item. */
  poPrice: number | null;
  ppnMode: "PPN_MASUKAN" | "PPN_MODAL" | "TANPA";
  /** Why the row cannot be billed yet; null = billable. */
  terhalang: null | "MENUNGGU_PEMILIK" | "MENUNGGU_KONFIRMASI";
};

export type BillableWoStep = {
  woStepId: string;
  woId: string;
  woDocNumber: string;
  sequence: number;
  stepName: string | null;
  qty: number;
  billedQty: number;
  remainingQty: number;
  servicePrice: number;
  servicePpnIncluded: boolean;
  /** The finished-goods receipts that brought the step's pieces in. */
  penerimaan: Array<{ nomor: string; tanggal: string; qty: number }>;
};

/**
 * Qty already on live (non-VOID) GRN_ITEM bill lines, per GRN key (`grnLineSource(grnId, key)`). A
 * legacy PO_ITEM line names no receipt (`grnId` null) and covers nothing.
 */
export async function billedQtyByGrnLine(db: Db, grnIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (grnIds.length === 0) return out;
  const rows = await db.vendorBillLine.groupBy({
    by: ["grnId", "itemId", "variantSku"],
    where: { grnId: { in: [...new Set(grnIds)] }, bill: { status: { not: "VOID" } } },
    _sum: { qty: true },
  });
  for (const r of rows) {
    if (!r.grnId || !r.itemId) continue;
    const k = grnLineSource(r.grnId, grnLineKey(r.itemId, r.variantSku));
    out.set(k, round2((out.get(k) ?? 0) + Number(r._sum.qty ?? 0)));
  }
  return out;
}

/** Qty sent back on COMPLETED vendor returns naming each GRN, per GRN key (`grnLineSource`). */
export async function returnedQtyByGrnLine(db: Db, grnIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (grnIds.length === 0) return out;
  const rows = await db.vendorReturn.findMany({
    where: { grnId: { in: [...new Set(grnIds)] }, status: "COMPLETED" },
    select: { grnId: true, lines: true },
  });
  for (const r of rows) {
    if (!r.grnId) continue;
    for (const l of readGrnLines(r.lines)) {
      const k = grnLineSource(r.grnId, l.key);
      out.set(k, round2((out.get(k) ?? 0) + l.qty));
    }
  }
  return out;
}

/**
 * Invoiced pieces later sent back, per GRN key (`grnLineSource`; keys at zero are absent) — see
 * `invoicedReturnedQty`. The vendor return credits the PO at the PO price only (`kredit-retur-writer.ts`,
 * unchanged), so an invoice price difference on such a key cannot be accepted (`ADA_RETUR`), and one
 * already accepted still counts the returned pieces until its bill is voided and recorded again.
 */
export async function invoicedReturnedQtyByGrnLine(db: Db, grnIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(grnIds)];
  if (ids.length === 0) return out;
  const [grns, billed, returned] = await Promise.all([
    db.gRN.findMany({ where: { id: { in: ids } }, select: { id: true, items: true } }),
    billedQtyByGrnLine(db, ids),
    returnedQtyByGrnLine(db, ids),
  ]);
  for (const g of grns) {
    const received = new Map<string, number>();
    for (const l of readGrnLines(g.items)) received.set(l.key, round2((received.get(l.key) ?? 0) + l.qty));
    for (const [key, qty] of received) {
      const src = grnLineSource(g.id, key);
      const n = invoicedReturnedQty({ received: qty, returned: returned.get(src) ?? 0, billed: billed.get(src) ?? 0 });
      if (n > 0) out.set(src, n);
    }
  }
  return out;
}

/** Qty already on live (non-VOID) bills, per WO step. */
export async function billedQtyByWoStep(db: Db, woStepIds: string[]): Promise<Map<string, number>> {
  if (woStepIds.length === 0) return new Map();
  const rows = await db.vendorBillLine.groupBy({
    by: ["woStepId"],
    where: { woStepId: { in: woStepIds }, bill: { status: { not: "VOID" } } },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.woStepId!, Number(r._sum.qty ?? 0)]));
}

/**
 * Accepted pieces per WO from finished-goods receipts that booked no service payable: received
 * before receipts started booking CMT (`FGReceipt.serviceCost` null, never backfilled). Their step
 * work reaches the books only through a vendor bill (`bill-journal.ts`).
 */
export async function unbookedReceiptQtyByWo(db: Db, woIds: string[]): Promise<Map<string, number>> {
  if (woIds.length === 0) return new Map();
  const rows = await db.fGReceipt.groupBy({
    by: ["woId"],
    where: { woId: { in: woIds }, serviceCost: null },
    _sum: { qtyAccepted: true },
  });
  return new Map(rows.map((r) => [r.woId, Number(r._sum.qtyAccepted ?? 0)]));
}

function linesOf(scope: { poIds: string[]; woStepIds: string[] }): Prisma.VendorBillLineWhereInput[] {
  const or: Prisma.VendorBillLineWhereInput[] = [];
  if (scope.poIds.length > 0) or.push({ poItem: { poId: { in: scope.poIds } } });
  if (scope.woStepIds.length > 0) or.push({ woStepId: { in: scope.woStepIds } });
  return or;
}

const cents = (v: Prisma.Decimal | number) => Math.round(Number(v) * 100);

/**
 * What live vendor payments have paid, in cents: per PO for its PO item lines, per WO step for its
 * step lines. A payment is allocated to a bill, not to a line, so each live bill's live allocations
 * are split over its lines in proportion to their amounts; the parts of one bill add up to what was
 * paid on it, and the vendor payment journal debits AP by those same allocations. The supplier
 * payable sub-ledger reads the PO part as a credit on that PO's receipts
 * (`lib/purchasing/pembayaran-hutang-queries.ts`) and the step part as paid on that step
 * (`daftarHutangJasa`), so it stays equal to the general ledger. The step part also covers payments
 * of step work the bill booked itself (`bill-journal.ts`), whose payable no finished-goods receipt
 * holds; `billBookedByWoStep` gives the sub-ledger that payable. `byPoItem` is the same PO split
 * keyed per PO item, which the payable sub-ledger credits to the GRNs that brought that item in.
 *
 * Vendor payments take no new payments since 2026-11-01 (`payment-writer.ts`); these are the ones
 * made before. Because the sub-ledger counts them as paid, Supplier payments → Pay can settle what
 * they left open and refuses an allocation above it, so nothing they paid is paid again there.
 */
export async function vendorPaidBySource(
  db: Db,
  scope: { poIds: string[]; woStepIds: string[] }
): Promise<{ byPo: Map<string, number>; byPoItem: Map<string, number>; byWoStep: Map<string, number> }> {
  const byPo = new Map<string, number>();
  const byPoItem = new Map<string, number>();
  const byWoStep = new Map<string, number>();
  const or = linesOf(scope);
  if (or.length === 0) return { byPo, byPoItem, byWoStep };
  const bills = await db.vendorBill.findMany({
    where: { status: { not: "VOID" }, lines: { some: { OR: or } }, allocations: { some: { payment: { voidedAt: null } } } },
    select: {
      allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
      lines: { orderBy: { id: "asc" }, select: { amount: true, woStepId: true, poItemId: true, poItem: { select: { poId: true } } } },
    },
  });
  const pos = new Set(scope.poIds);
  const steps = new Set(scope.woStepIds);
  for (const b of bills) {
    const paid = b.allocations.reduce((s, a) => s + cents(a.amount), 0);
    const parts = splitCents(paid, b.lines.map((l) => Math.max(0, cents(l.amount))));
    b.lines.forEach((l, i) => {
      const poId = l.poItem?.poId;
      if (poId && pos.has(poId)) byPo.set(poId, (byPo.get(poId) ?? 0) + parts[i]);
      if (poId && pos.has(poId) && l.poItemId) byPoItem.set(l.poItemId, (byPoItem.get(l.poItemId) ?? 0) + parts[i]);
      if (l.woStepId && steps.has(l.woStepId)) byWoStep.set(l.woStepId, (byWoStep.get(l.woStepId) ?? 0) + parts[i]);
    });
  }
  return { byPo, byPoItem, byWoStep };
}

/** What one bill's standing `VENDOR_BILL` journal booked on one WO step: signed `cents` of AP, and `qty` pieces while it stands. */
export type BillBookedShare = { billId: string; woStepId: string; cents: number; qty: number };

/**
 * The step payable vendor bills booked themselves (`bill-journal.ts`), per bill and WO step. Each
 * bill's amount is its standing `VENDOR_BILL` journal (the AP credit, less a posted
 * `VENDOR_BILL_REVERSAL`), so the parts add up to the general ledger. That journal holds one total per
 * bill, so it is split over the bill's step lines by the share `createVendorBill` booked for each,
 * replayed here: the pieces of the step's WO that no finished-goods receipt booked, less what the
 * step's bills saved earlier and still live at that moment held. When the replay no longer adds up to
 * the journal (data changed since), the journal is split by the replayed shares, or by line amount
 * when none is left. Only rows on the given steps are returned; a bill that books nothing has none.
 */
export async function billBookedShares(db: Db, woStepIds: string[]): Promise<BillBookedShare[]> {
  const result: BillBookedShare[] = [];
  if (woStepIds.length === 0) return result;
  const touching = await db.vendorBillLine.findMany({ where: { woStepId: { in: woStepIds } }, select: { billId: true } });
  const billIds = [...new Set(touching.map((l) => l.billId))];
  if (billIds.length === 0) return result;
  const journals = await db.journal.findMany({
    where: { sourceType: { in: ["VENDOR_BILL", "VENDOR_BILL_REVERSAL"] }, sourceId: { in: billIds }, status: "POSTED" },
    select: { sourceType: true, sourceId: true, lines: { select: { debit: true, credit: true } } },
  });
  // A bill journal credits only AP and its reversal debits only AP, so those sides are the AP amounts.
  const standing = new Map<string, number>();
  for (const j of journals) {
    if (!j.sourceId) continue;
    const ap =
      j.sourceType === "VENDOR_BILL" ? j.lines.reduce((s, l) => s + cents(l.credit), 0) : -j.lines.reduce((s, l) => s + cents(l.debit), 0);
    standing.set(j.sourceId, (standing.get(j.sourceId) ?? 0) + ap);
  }
  const booked = new Set([...standing].filter(([, n]) => n !== 0).map(([id]) => id));
  if (booked.size === 0) return result;

  const stepsOfBooked = await db.vendorBillLine.findMany({
    where: { billId: { in: [...booked] }, woStepId: { not: null } },
    select: { woStepId: true },
  });
  const history = await db.vendorBillLine.findMany({
    where: { woStepId: { in: [...new Set(stepsOfBooked.map((l) => l.woStepId!))] } },
    orderBy: { id: "asc" },
    select: {
      billId: true,
      woStepId: true,
      qty: true,
      price: true,
      amount: true,
      bill: { select: { createdAt: true, voidedAt: true } },
      woStep: { select: { woId: true } },
    },
  });
  const unbooked = await unbookedReceiptQtyByWo(db, [...new Set(history.flatMap((l) => (l.woStep ? [l.woStep.woId] : [])))]);
  const byStep = new Map<string, typeof history>();
  for (const l of history) byStep.set(l.woStepId!, [...(byStep.get(l.woStepId!) ?? []), l]);

  const perBill = new Map<string, Array<{ woStepId: string; qty: number; weight: number; amount: number }>>();
  for (const l of history) {
    if (!booked.has(l.billId)) continue;
    const at = l.bill.createdAt.getTime();
    const held = (byStep.get(l.woStepId!) ?? [])
      .filter((o) => o.billId !== l.billId && o.bill.createdAt.getTime() < at && (o.bill.voidedAt == null || o.bill.voidedAt.getTime() > at))
      .reduce((s, o) => s + Number(o.qty), 0);
    const left = Math.max(0, round2((l.woStep ? unbooked.get(l.woStep.woId) ?? 0 : 0) - held));
    const qty = Math.min(Number(l.qty), left);
    const rows = perBill.get(l.billId) ?? [];
    rows.push({ woStepId: l.woStepId!, qty, weight: cents(round2(qty * Number(l.price))), amount: Math.max(0, cents(l.amount)) });
    perBill.set(l.billId, rows);
  }

  const wanted = new Set(woStepIds);
  for (const [billId, rows] of perBill) {
    const total = standing.get(billId) ?? 0;
    const sum = rows.reduce((s, r) => s + r.weight, 0);
    const parts =
      sum === Math.abs(total) ? rows.map((r) => r.weight) : splitCents(Math.abs(total), sum > 0 ? rows.map((r) => r.weight) : rows.map((r) => r.amount));
    rows.forEach((r, i) => {
      if (!wanted.has(r.woStepId)) return;
      result.push({ billId, woStepId: r.woStepId, cents: Math.sign(total) * parts[i], qty: total > 0 ? r.qty : 0 });
    });
  }
  return result;
}

/**
 * The step payable vendor bills booked themselves, per WO step: `cents` of AP and the `qty` pieces it
 * covers — `billBookedShares` summed over the bills.
 */
export async function billBookedByWoStep(db: Db, woStepIds: string[]): Promise<Map<string, { cents: number; qty: number }>> {
  const result = new Map<string, { cents: number; qty: number }>();
  for (const s of await billBookedShares(db, woStepIds)) {
    const cur = result.get(s.woStepId) ?? { cents: 0, qty: 0 };
    cur.cents += s.cents;
    cur.qty = round2(cur.qty + s.qty);
    result.set(s.woStepId, cur);
  }
  return result;
}

/**
 * Per WO, the bill date of its oldest live bill that booked step work itself (a posted
 * `VENDOR_BILL` journal with no reversal): when that part of the WO's CMT payable was booked. The
 * supplier payable ages a WO's step debt from here or from its first finished-goods receipt that
 * booked CMT, whichever came first (`pembayaran-hutang-queries.ts`).
 */
export async function oldestBookedBillDateByWo(db: Db, woIds: string[]): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  if (woIds.length === 0) return result;
  const lines = await db.vendorBillLine.findMany({
    where: { woStep: { woId: { in: woIds } }, bill: { status: { not: "VOID" } } },
    select: { billId: true, woStep: { select: { woId: true } }, bill: { select: { billDate: true } } },
  });
  if (lines.length === 0) return result;
  const journals = await db.journal.findMany({
    where: { sourceType: { in: ["VENDOR_BILL", "VENDOR_BILL_REVERSAL"] }, sourceId: { in: [...new Set(lines.map((l) => l.billId))] }, status: "POSTED" },
    select: { sourceType: true, sourceId: true },
  });
  const posted = new Set(journals.filter((j) => j.sourceType === "VENDOR_BILL").map((j) => j.sourceId));
  const reversed = new Set(journals.filter((j) => j.sourceType === "VENDOR_BILL_REVERSAL").map((j) => j.sourceId));
  for (const l of lines) {
    if (!l.woStep || !posted.has(l.billId) || reversed.has(l.billId)) continue;
    const cur = result.get(l.woStep.woId);
    if (!cur || l.bill.billDate.getTime() < cur.getTime()) result.set(l.woStep.woId, l.bill.billDate);
  }
  return result;
}


/**
 * What a supplier can still bill (decision 2026-10-29: "admin MEMILIH penerimaan barang mana saja yang
 * ditagih invoice itu"): one row per GRN and item key, and its WO processing steps on live WOs, each
 * less what live bills already name. A GRN row is a PROCESSED receipt: its PO not cancelled (or a GRN
 * without a PO the admin confirmed, P51a) and not declined by the owner; a GRN still awaiting the
 * owner's over-receive decision or the admin's confirmation is listed with `terhalang` and cannot be
 * billed yet. Fully billed rows drop out. A step's `qty` is the accepted pieces of its WO's
 * finished-goods receipts (`receiveFG` stamps it; null before the first receipt), so a step bills
 * only work a receipt has taken in, as a GRN row bills only what that GRN received.
 */
export async function listBillableSources(
  supplierId: string,
  db: Db = prisma
): Promise<{ grnItems: BillableGrnItem[]; woSteps: BillableWoStep[] }> {
  const [grns, woSteps] = await Promise.all([
    db.gRN.findMany({
      where: {
        supplierId,
        ownerDeclinedAt: null,
        OR: [{ poId: null }, { po: { status: { not: "CANCELLED" } } }],
      },
      select: {
        id: true,
        docNumber: true,
        grnDate: true,
        poId: true,
        items: true,
        requiresOwnerApproval: true,
        ownerApprovedAt: true,
        requiresNoPoConfirmation: true,
        noPoConfirmedAt: true,
        po: { select: { docNumber: true, paidAt: true, items: { select: { id: true, itemId: true, variantSku: true, price: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } },
      },
      orderBy: [{ grnDate: "asc" }, { docNumber: "asc" }],
    }),
    db.workOrderStep.findMany({
      where: { supplierId, qty: { gt: 0 }, wo: { status: { not: "CANCELLED" } } },
      select: {
        id: true,
        sequence: true,
        stepName: true,
        qty: true,
        servicePrice: true,
        servicePpnIncluded: true,
        wo: { select: { id: true, docNumber: true, receipts: { select: { docNumber: true, receivedAt: true, qtyAccepted: true }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }] } } },
      },
      orderBy: [{ wo: { docNumber: "asc" } }, { sequence: "asc" }],
    }),
  ]);

  const grnIds = grns.map((g) => g.id);
  const lines = new Map(grns.map((g) => [g.id, readGrnLinesDetail(g.items)]));
  const itemIds = [...new Set([...lines.values()].flatMap((ls) => ls.map((l) => l.itemId)))];
  const [billed, returned, stepBilled, items] = await Promise.all([
    billedQtyByGrnLine(db, grnIds),
    returnedQtyByGrnLine(db, grnIds),
    billedQtyByWoStep(db, woSteps.map((s) => s.id)),
    itemIds.length > 0
      ? db.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, nameId: true, sku: true, uom: { select: { code: true } } } })
      : Promise.resolve([] as Array<{ id: string; nameId: string; sku: string; uom: { code: string } | null }>),
  ]);
  const itemOf = new Map(items.map((i) => [i.id, i]));

  const grnItems: BillableGrnItem[] = [];
  for (const g of grns) {
    const ownerPending = g.requiresOwnerApproval && g.ownerApprovedAt == null;
    const terhalang: BillableGrnItem["terhalang"] = grnBelumDiproses(g) ? "MENUNGGU_KONFIRMASI" : ownerPending ? "MENUNGGU_PEMILIK" : null;
    const perKey = new Map<string, { itemId: string; variantSku: string | null; qty: number; dasar: number; masukan: boolean; modal: boolean }>();
    for (const l of lines.get(g.id) ?? []) {
      const cur = perKey.get(l.key) ?? { itemId: l.itemId, variantSku: l.variantSku, qty: 0, dasar: 0, masukan: false, modal: false };
      cur.qty += l.qty;
      cur.dasar += l.qty * l.hargaDasar;
      cur.masukan = cur.masukan || l.ppnMasukan;
      cur.modal = cur.modal || l.ppnModal;
      perKey.set(l.key, cur);
    }
    for (const [key, k] of perKey) {
      const src = grnLineSource(g.id, key);
      const receivedQty = round2(k.qty);
      const returnedQty = returned.get(src) ?? 0;
      const billedQty = billed.get(src) ?? 0;
      const remainingQty = round2(receivedQty - returnedQty - billedQty);
      if (remainingQty <= 0.005) continue;
      const poItem = g.po?.items.find((p) => grnLineKey(p.itemId, p.variantSku) === key) ?? null;
      const it = itemOf.get(k.itemId);
      grnItems.push({
        grnId: g.id,
        grnDocNumber: g.docNumber,
        grnDate: formatDateOnlyJakarta(g.grnDate),
        poId: g.poId,
        poDocNumber: g.po?.docNumber ?? null,
        poItemId: poItem?.id ?? null,
        poPaid: g.po?.paidAt != null,
        itemId: k.itemId,
        itemName: it?.nameId ?? k.itemId,
        sku: it?.sku ?? "",
        variantSku: k.variantSku,
        uomCode: it?.uom?.code ?? "",
        receivedQty,
        returnedQty,
        billedQty,
        remainingQty,
        recordedPrice: k.qty > 0 ? round2(k.dasar / k.qty) : 0,
        poPrice: poItem ? Number(poItem.price) : null,
        ppnMode: k.masukan ? "PPN_MASUKAN" : k.modal ? "PPN_MODAL" : "TANPA",
        terhalang,
      });
    }
  }

  return {
    grnItems,
    woSteps: woSteps
      .map((s) => {
        const qty = Number(s.qty ?? 0);
        const billedQty = stepBilled.get(s.id) ?? 0;
        return {
          woStepId: s.id,
          woId: s.wo.id,
          woDocNumber: s.wo.docNumber,
          sequence: s.sequence,
          stepName: s.stepName,
          qty,
          billedQty,
          remainingQty: round2(qty - billedQty),
          servicePrice: Number(s.servicePrice),
          servicePpnIncluded: s.servicePpnIncluded,
          penerimaan: s.wo.receipts
            .filter((r) => Number(r.qtyAccepted) > 0)
            .map((r) => ({ nomor: r.docNumber, tanggal: formatDateOnlyJakarta(r.receivedAt), qty: Number(r.qtyAccepted) })),
        };
      })
      .filter((s) => s.remainingQty > 0),
  };
}
