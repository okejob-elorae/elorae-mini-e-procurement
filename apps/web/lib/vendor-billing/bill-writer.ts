import { z } from "zod";
import type { Prisma } from "@elorae/db";
import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { billedQtyByPoItem, billedQtyByWoStep, PENDING_OWNER_DECISION, unbookedReceiptQtyByWo } from "./billable";
import { postVendorBillJournal, postVendorBillReversalJournal } from "./bill-journal";
import { stepsOverpaidByVoid } from "./void-guard";

/** A refusal the user can act on; its message is shown as-is. `code` names the refusal for a caller that branches on it. */
export class VendorBillError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.005;

const lineSchema = z.object({
  type: z.enum(["PO_ITEM", "WO_STEP"]),
  sourceId: z.string().min(1),
  qty: z.number().positive(),
  price: z.number().min(0),
});

export const createVendorBillSchema = z
  .object({
    supplierId: z.string().min(1),
    vendorInvoiceNo: z.string().trim().min(1).max(64),
    billDate: z.coerce.date(),
    dueDate: z.coerce.date().nullish(),
    notes: z.string().trim().max(2000).nullish(),
    lines: z.array(lineSchema).min(1).max(200),
  })
  .refine((d) => new Set(d.lines.map((l) => `${l.type}:${l.sourceId}`)).size === d.lines.length, {
    message: "Satu baris sumber hanya boleh sekali per tagihan",
    path: ["lines"],
  });

export type CreateVendorBillInput = z.input<typeof createVendorBillSchema>;

export function journalRefusal(res: Extract<GenerateAutoJournalResult, { ok: false }>): VendorBillError {
  if (res.code === "UNMAPPED_ROLE") return new VendorBillError(`Petakan akun untuk ${res.role} di Pemetaan Akun dulu`);
  return new VendorBillError(`Jurnal tagihan gagal diposting (${res.code})`);
}

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

/**
 * Saves a vendor bill against received PO items and WO steps of one supplier. The caps and the
 * supplier match are re-read inside the serializable transaction, so two bills racing for the same
 * remaining qty cannot both pass. A PO already marked paid is billable: the bill only matches the
 * vendor's invoice to its receipts, and it reads as paid from the payments that settled them
 * (`supplier-paid.ts`) — Vendor Billing takes no payment of its own any more, so there is no second
 * payment to guard against. A PO line posts nothing: the GRN
 * booked its payable. A step line posts nothing for pieces a finished-goods receipt booked; pieces
 * from receipts that booked none (`unbookedReceiptQtyByWo`) are booked here, in the same
 * transaction (see `bill-journal.ts`). Those pieces go to the step's live bills first come, first
 * served: what earlier live bills already hold is taken from the unbooked pieces before this bill's
 * share. The rule can only under-book, never book a piece twice: when an earlier bill is voided
 * while a later one stands, the later one still counts as holding the voided bill's unbooked
 * pieces, so a new bill does not book them.
 */
export async function createVendorBill(input: CreateVendorBillInput, userId: string) {
  const data = createVendorBillSchema.parse(input);
  const poLines = data.lines.filter((l) => l.type === "PO_ITEM");
  const stepLines = data.lines.filter((l) => l.type === "WO_STEP");

  return runSerializable(
    async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: data.supplierId }, select: { paymentTermsDays: true } });
      if (!supplier) throw new VendorBillError("Supplier tidak ditemukan");
      // Unique among live bills only, so a voided bill's number can be entered again. The read
      // joins this serializable transaction, so two saves of one number cannot both pass.
      const clash = await tx.vendorBill.count({
        where: { supplierId: data.supplierId, vendorInvoiceNo: data.vendorInvoiceNo, status: { not: "VOID" } },
      });
      if (clash > 0) throw new VendorBillError("Nomor invoice vendor sudah dipakai untuk supplier ini");

      const lineRows: Prisma.VendorBillLineCreateWithoutBillInput[] = [];
      const poTerms: number[] = [];
      let unbookedAmount = 0;

      if (poLines.length > 0) {
        // Lock each sourced PO (id order, no deadlock), the lock updatePO takes before rebuilding items.
        const sourcePos = await tx.pOItem.findMany({ where: { id: { in: poLines.map((l) => l.sourceId) } }, select: { poId: true } });
        for (const poId of [...new Set(sourcePos.map((p) => p.poId))].sort()) {
          await tx.$queryRaw`SELECT \`id\` FROM \`PurchaseOrder\` WHERE \`id\` = ${poId} FOR UPDATE`;
        }
        const items = await tx.pOItem.findMany({
          where: { id: { in: poLines.map((l) => l.sourceId) } },
          select: {
            id: true,
            price: true,
            receivedQty: true,
            item: { select: { nameId: true } },
            po: {
              select: {
                supplierId: true,
                status: true,
                docNumber: true,
                paymentTermsDays: true,
                grns: { where: PENDING_OWNER_DECISION, select: { id: true } },
              },
            },
          },
        });
        const byId = new Map(items.map((i) => [i.id, i]));
        const billed = await billedQtyByPoItem(tx, items.map((i) => i.id));
        for (const l of poLines) {
          const it = byId.get(l.sourceId);
          if (!it) throw new VendorBillError("Baris PO tidak ditemukan, muat ulang halaman");
          const where = `${it.item.nameId} (${it.po.docNumber})`;
          if (it.po.supplierId !== data.supplierId) throw new VendorBillError(`${where} bukan milik supplier ini`);
          if (it.po.status === "CANCELLED") throw new VendorBillError(`${it.po.docNumber} sudah dibatalkan`);
          // A declined over-receive reverses its AP and received qty, which a PO line (no journal) cannot follow.
          if (it.po.grns.length > 0) {
            throw new VendorBillError(`${it.po.docNumber}: ada penerimaan lebih yang menunggu keputusan owner; tagih setelah disetujui atau ditolak.`);
          }
          const remaining = round2(Number(it.receivedQty) - (billed.get(it.id) ?? 0));
          if (l.qty > remaining + EPS) {
            throw new VendorBillError(`Qty tagihan ${where} melebihi sisa yang diterima dan belum ditagih (${remaining})`);
          }
          if (it.po.paymentTermsDays != null) poTerms.push(it.po.paymentTermsDays);
          lineRows.push({
            type: "PO_ITEM",
            poItem: { connect: { id: it.id } },
            qty: l.qty,
            price: l.price,
            amount: round2(l.qty * l.price),
            refPrice: Number(it.price),
          });
        }
      }

      if (stepLines.length > 0) {
        const steps = await tx.workOrderStep.findMany({
          where: { id: { in: stepLines.map((l) => l.sourceId) } },
          select: {
            id: true,
            supplierId: true,
            sequence: true,
            stepName: true,
            qty: true,
            servicePrice: true,
            wo: { select: { id: true, docNumber: true, status: true } },
          },
        });
        const byId = new Map(steps.map((s) => [s.id, s]));
        const billed = await billedQtyByWoStep(tx, steps.map((s) => s.id));
        const unbooked = await unbookedReceiptQtyByWo(tx, [...new Set(steps.map((s) => s.wo.id))]);
        for (const l of stepLines) {
          const st = byId.get(l.sourceId);
          if (!st) throw new VendorBillError("Step WO tidak ditemukan, muat ulang halaman");
          const where = `${st.wo.docNumber} step ${st.sequence}${st.stepName ? ` ${st.stepName}` : ""}`;
          if (st.supplierId !== data.supplierId) throw new VendorBillError(`${where} bukan milik supplier ini`);
          if (st.wo.status === "CANCELLED") throw new VendorBillError(`${st.wo.docNumber} sudah dibatalkan`);
          const remaining = round2(Number(st.qty ?? 0) - (billed.get(st.id) ?? 0));
          if (l.qty > remaining + EPS) {
            throw new VendorBillError(`Qty tagihan ${where} melebihi sisa yang belum ditagih (${remaining})`);
          }
          // Pieces no finished-goods receipt booked; the step's earlier live bills hold them first.
          const unbookedLeft = Math.max(0, round2((unbooked.get(st.wo.id) ?? 0) - (billed.get(st.id) ?? 0)));
          const share = Math.min(l.qty, unbookedLeft);
          if (share > 0) unbookedAmount = round2(unbookedAmount + round2(share * l.price));
          lineRows.push({
            type: "WO_STEP",
            woStep: { connect: { id: st.id } },
            qty: l.qty,
            price: l.price,
            amount: round2(l.qty * l.price),
            refPrice: Number(st.servicePrice),
          });
        }
      }

      const terms = poTerms.length > 0 ? Math.max(...poTerms) : supplier.paymentTermsDays ?? 0;
      const total = round2(lineRows.reduce((s, l) => s + Number(l.amount), 0));
      const docNumber = await generateDocNumber("VENDOR_BILL", tx);
      const bill = await tx.vendorBill.create({
        data: {
          docNumber,
          supplierId: data.supplierId,
          vendorInvoiceNo: data.vendorInvoiceNo,
          billDate: data.billDate,
          dueDate: data.dueDate ?? addDays(data.billDate, terms),
          total,
          status: total < EPS ? "PAID" : "UNPAID",
          notes: data.notes || null,
          createdById: userId,
          lines: { create: lineRows },
        },
        select: { id: true, docNumber: true },
      });

      if (unbookedAmount >= 0.01) {
        const res = await postVendorBillJournal(bill.id, unbookedAmount, userId, tx);
        if (!res.ok && res.code !== "NOTHING_TO_POST") throw journalRefusal(res);
      }
      return bill;
    },
    { timeout: 20_000 }
  );
}

/** Refusal code: voiding would leave a WO step paid above its payable (`stepsOverpaidByVoid`). */
export const VOID_WOULD_OVERPAY = "VOID_WOULD_OVERPAY";

/**
 * Voids a bill and mirrors the journal it posted, if any. Refused while an old vendor payment is live
 * on it (that payment is allocated to this bill), and when the bill booked old CMT itself and
 * Supplier payments already paid its steps beyond what they would still owe without it
 * (`stepsOverpaidByVoid`, read in this transaction): the reversal would leave AP debited below zero.
 * Anything else voids even when Supplier payments paid its receipts — the bill only matched an
 * invoice, voiding it moves no payable, and the payment then reads against the receipt's other bills,
 * so a wrongly entered invoice can be voided and entered again.
 */
export async function voidVendorBill(billId: string, reason: string, userId: string) {
  const why = z.string().trim().min(1).max(500).parse(reason);
  return runSerializable(
    async (tx) => {
      const bill = await tx.vendorBill.findUnique({
        where: { id: billId },
        select: { status: true, docNumber: true, allocations: { where: { payment: { voidedAt: null } }, select: { id: true } } },
      });
      if (!bill) throw new VendorBillError("Tagihan tidak ditemukan");
      if (bill.status === "VOID") throw new VendorBillError(`${bill.docNumber} sudah dibatalkan`);
      if (bill.allocations.length > 0) {
        throw new VendorBillError(`${bill.docNumber} masih punya pembayaran Vendor Billing yang berlaku; batalkan pembayarannya dulu`);
      }
      const overpaid = await stepsOverpaidByVoid(tx, billId);
      if (overpaid.length > 0) {
        throw new VendorBillError(
          `${bill.docNumber} belum bisa dibatalkan: tagihan ini membukukan ongkos jahit lama di ${overpaid.map((s) => s.label).join(", ")}, ` +
            "dan pembayaran pemasok atas langkah itu melebihi hutang yang tersisa tanpa tagihan ini. Batalkan pembayaran pemasoknya dulu.",
          VOID_WOULD_OVERPAY
        );
      }
      const flipped = await tx.vendorBill.updateMany({
        where: { id: billId, status: { not: "VOID" } },
        data: { status: "VOID", voidedAt: new Date(), voidReason: why },
      });
      if (flipped.count !== 1) throw new VendorBillError(`${bill.docNumber} sudah dibatalkan`);
      const res = await postVendorBillReversalJournal(billId, userId, tx);
      if (!res.ok && res.code !== "NOTHING_TO_POST") throw journalRefusal(res);
      return { id: billId, docNumber: bill.docNumber };
    },
    { timeout: 20_000 }
  );
}
