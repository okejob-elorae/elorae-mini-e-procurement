import { z } from "zod";
import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import { journalRefusal, VendorBillError } from "./bill-writer";
import { postVendorPaymentJournal, postVendorPaymentReversalJournal } from "./payment-journal";
import { deriveBillStatus } from "./status";

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.005;

export const createVendorPaymentSchema = z
  .object({
    supplierId: z.string().min(1),
    paidAt: z.coerce.date(),
    method: z.enum(["BANK", "CASH"]),
    reference: z.string().trim().max(100).nullish(),
    notes: z.string().trim().max(2000).nullish(),
    allocations: z.array(z.object({ billId: z.string().min(1), amount: z.number().positive() })).min(1).max(100),
  })
  .refine((d) => new Set(d.allocations.map((a) => a.billId)).size === d.allocations.length, {
    message: "Satu tagihan hanya boleh sekali per pembayaran",
    path: ["allocations"],
  });

export type CreateVendorPaymentInput = z.input<typeof createVendorPaymentSchema>;

/**
 * One payment over any number of open bills of one supplier. Each bill's paidAmount moves by a
 * compare-and-swap on the value read here, so two payments racing for one bill cannot both land;
 * the journal (Dr AP / Cr BANK or CASH) posts in the same serializable transaction and a refusal
 * rolls the whole payment back.
 */
export async function createVendorPayment(input: CreateVendorPaymentInput, userId: string) {
  const parsed = createVendorPaymentSchema.parse(input);
  // Round each allocation once so header, rows, bill balances and journal all add up to the same cents.
  const allocations = parsed.allocations.map((a) => ({ ...a, amount: round2(a.amount) })).filter((a) => a.amount >= 0.01);
  if (allocations.length === 0) throw new VendorBillError("Isi alokasi minimal Rp 0,01");
  const data = { ...parsed, allocations };
  return runSerializable(
    async (tx) => {
      const bills = await tx.vendorBill.findMany({
        where: { id: { in: data.allocations.map((a) => a.billId) } },
        select: { id: true, docNumber: true, supplierId: true, status: true, total: true, paidAmount: true },
      });
      const byId = new Map(bills.map((b) => [b.id, b]));
      for (const a of data.allocations) {
        const b = byId.get(a.billId);
        if (!b) throw new VendorBillError("Tagihan tidak ditemukan, muat ulang halaman");
        if (b.supplierId !== data.supplierId) throw new VendorBillError(`${b.docNumber} bukan milik supplier ini`);
        if (b.status !== "UNPAID" && b.status !== "PARTIAL") throw new VendorBillError(`${b.docNumber} tidak bisa dibayar (status ${b.status})`);
        const outstanding = round2(Number(b.total) - Number(b.paidAmount));
        if (a.amount > outstanding + EPS) {
          throw new VendorBillError(`Alokasi ${b.docNumber} melebihi sisa tagihan (${outstanding})`);
        }
      }

      const amount = round2(data.allocations.reduce((s, a) => s + a.amount, 0));
      const docNumber = await generateDocNumber("VENDOR_PAYMENT", tx);
      const payment = await tx.vendorPayment.create({
        data: {
          docNumber,
          supplierId: data.supplierId,
          paidAt: data.paidAt,
          method: data.method,
          reference: data.reference || null,
          notes: data.notes || null,
          amount,
          createdById: userId,
          allocations: { create: data.allocations.map((a) => ({ billId: a.billId, amount: a.amount })) },
        },
        select: { id: true, docNumber: true },
      });

      for (const a of data.allocations) {
        const b = byId.get(a.billId)!;
        const paid = round2(Number(b.paidAmount) + a.amount);
        const moved = await tx.vendorBill.updateMany({
          where: { id: b.id, paidAmount: b.paidAmount },
          data: { paidAmount: paid, status: deriveBillStatus(Number(b.total), paid, false) },
        });
        if (moved.count !== 1) throw new VendorBillError("Tagihan berubah, muat ulang");
      }

      const res = await postVendorPaymentJournal(payment.id, userId, tx);
      if (!res.ok) throw journalRefusal(res);
      return payment;
    },
    { timeout: 20_000 }
  );
}

/** Voids a payment: hands each allocation back to its bill and reverses the journal. */
export async function voidVendorPayment(paymentId: string, reason: string, userId: string) {
  const why = z.string().trim().min(1).max(500).parse(reason);
  return runSerializable(
    async (tx) => {
      const payment = await tx.vendorPayment.findUnique({
        where: { id: paymentId },
        select: {
          docNumber: true,
          voidedAt: true,
          allocations: { select: { amount: true, bill: { select: { id: true, total: true, paidAmount: true, status: true } } } },
        },
      });
      if (!payment) throw new VendorBillError("Pembayaran tidak ditemukan");
      const flipped = await tx.vendorPayment.updateMany({
        where: { id: paymentId, voidedAt: null },
        data: { voidedAt: new Date(), voidReason: why },
      });
      if (flipped.count !== 1) throw new VendorBillError(`${payment.docNumber} sudah dibatalkan`);

      for (const a of payment.allocations) {
        const b = a.bill;
        const paid = Math.max(0, round2(Number(b.paidAmount) - Number(a.amount)));
        const moved = await tx.vendorBill.updateMany({
          where: { id: b.id, paidAmount: b.paidAmount },
          data: { paidAmount: paid, status: deriveBillStatus(Number(b.total), paid, b.status === "VOID") },
        });
        if (moved.count !== 1) throw new VendorBillError("Tagihan berubah, muat ulang");
      }

      const res = await postVendorPaymentReversalJournal(paymentId, userId, tx);
      if (!res.ok && res.code !== "NOTHING_TO_POST") throw journalRefusal(res);
      return { id: paymentId, docNumber: payment.docNumber };
    },
    { timeout: 20_000 }
  );
}
