import { runSerializable } from "@/lib/db/tx-retry";
import { TaxInvoiceError } from "./errors";

type Transition = {
  taxInvoiceId: string;
  userId: string;
  from: Array<"PENDING" | "CREATED" | "NOT_REQUIRED">;
  to: "PENDING" | "CREATED" | "NOT_REQUIRED";
  data: { invoiceNo: string | null; reason: string | null; markedAt: Date | null; markedById: string | null };
  action: string;
};

async function transition(t: Transition): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
    const row = await tx.taxInvoice.findUnique({
      where: { id: t.taxInvoiceId },
      select: { id: true, status: true, invoiceNo: true, reason: true },
    });
    if (!row) throw new TaxInvoiceError("NOT_FOUND");
    if (!t.from.includes(row.status)) throw new TaxInvoiceError("INVALID_STATE");

    const swapped = await tx.taxInvoice.updateMany({
      where: { id: t.taxInvoiceId, status: row.status },
      data: { status: t.to, ...t.data },
    });
    if (swapped.count !== 1) throw new TaxInvoiceError("CONFLICT");

    /**
     * `TaxInvoice.status`, `invoiceNo` and `reason` are all last-write-wins, so every transition
     * overwrites the previous one — mark NOT_REQUIRED with a justification, revert it, mark
     * CREATED with a faktur number, revert again, and both the justification and the number are
     * gone from the row with no trace anywhere. The before/after pair plus the operator's reason
     * is what makes this an audit trail rather than a list of timestamps, and it is written inside
     * the same transaction as the update, exactly as nota-date correction does.
     */
    await tx.auditLog.create({
      data: {
        userId: t.userId,
        action: t.action,
        entityType: "TaxInvoice",
        entityId: t.taxInvoiceId,
        changes: {
          before: { status: row.status, invoiceNo: row.invoiceNo, reason: row.reason },
          after: { status: t.to, invoiceNo: t.data.invoiceNo, reason: t.data.reason },
        },
        reason: t.data.reason,
      },
    });

    return { ok: true };
  });
}

export async function markTaxInvoiceCreated(input: {
  taxInvoiceId: string;
  invoiceNo: string;
  userId: string;
}): Promise<{ ok: true }> {
  const invoiceNo = input.invoiceNo.trim();
  if (invoiceNo === "") throw new TaxInvoiceError("INVALID_REQUEST");
  return transition({
    taxInvoiceId: input.taxInvoiceId,
    userId: input.userId,
    from: ["PENDING"],
    to: "CREATED",
    data: { invoiceNo, reason: null, markedAt: new Date(), markedById: input.userId },
    action: "TAX_INVOICE_CREATED",
  });
}

export async function markTaxInvoiceNotRequired(input: {
  taxInvoiceId: string;
  reason: string;
  userId: string;
}): Promise<{ ok: true }> {
  const reason = input.reason.trim();
  if (reason === "") throw new TaxInvoiceError("INVALID_REQUEST");
  return transition({
    taxInvoiceId: input.taxInvoiceId,
    userId: input.userId,
    from: ["PENDING"],
    to: "NOT_REQUIRED",
    data: { invoiceNo: null, reason, markedAt: new Date(), markedById: input.userId },
    action: "TAX_INVOICE_NOT_REQUIRED",
  });
}

export async function revertTaxInvoiceToPending(input: {
  taxInvoiceId: string;
  reason: string;
  userId: string;
}): Promise<{ ok: true }> {
  const reason = input.reason.trim();
  if (reason === "") throw new TaxInvoiceError("INVALID_REQUEST");
  return transition({
    taxInvoiceId: input.taxInvoiceId,
    userId: input.userId,
    from: ["CREATED", "NOT_REQUIRED"],
    to: "PENDING",
    data: { invoiceNo: null, reason, markedAt: null, markedById: null },
    action: "TAX_INVOICE_REVERTED",
  });
}
