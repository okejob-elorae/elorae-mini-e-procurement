import { z } from "zod";
import { runSerializable } from "@/lib/db/tx-retry";
import { journalRefusal, VendorBillError } from "./bill-writer";
import { postVendorPaymentReversalJournal } from "./payment-journal";
import { deriveBillStatus } from "./status";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `VendorBillError.code` of the refusal below. */
export const VENDOR_PAYMENTS_CLOSED = "VENDOR_PAYMENTS_CLOSED";

export const VENDOR_PAYMENTS_CLOSED_MESSAGE =
  "Pembayaran lewat Vendor Billing sudah ditutup. Bayar tagihan vendor, termasuk ongkos jahit lama, lewat Pembelian → Pembayaran pemasok.";

/**
 * Vendor payments take no new payments (owner decision 2026-11-01): every vendor bill, goods and
 * old CMT alike, is paid through Supplier payments → Pay (`lib/purchasing/pembayaran-writer.ts`),
 * which withholds PPh 23/21/4(2) unless an SKB covers the payment date, takes a giro, a chosen
 * account and a proof photo, and records the withholding as tax payable — none of which this path
 * had. Vendor Billing stays for recording invoices and matching them to receipts, and reads what
 * Supplier payments paid on each bill (`supplier-paid.ts`). Payments made here before stay in the
 * history and can still be voided (`voidVendorPayment`); the supplier payable sub-ledger keeps
 * counting them as paid, so Supplier payments never pays that part again.
 */
export async function createVendorPayment(): Promise<{ id: string; docNumber: string }> {
  throw new VendorBillError(VENDOR_PAYMENTS_CLOSED_MESSAGE, VENDOR_PAYMENTS_CLOSED);
}

/**
 * Voids a payment made before vendor payments closed: hands each allocation back to its bill and
 * reverses the journal. What it paid becomes payable again in Supplier payments → Pay.
 */
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
