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
      select: { id: true, status: true },
    });
    if (!row) throw new TaxInvoiceError("NOT_FOUND");
    if (!t.from.includes(row.status)) throw new TaxInvoiceError("INVALID_STATE");

    const swapped = await tx.taxInvoice.updateMany({
      where: { id: t.taxInvoiceId, status: row.status },
      data: { status: t.to, ...t.data },
    });
    if (swapped.count !== 1) throw new TaxInvoiceError("CONFLICT");

    await tx.auditLog.create({
      data: {
        userId: t.userId,
        action: t.action,
        entityType: "TaxInvoice",
        entityId: t.taxInvoiceId,
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
