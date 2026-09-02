import { Prisma } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";
import { runSerializable } from "@/lib/db/tx-retry";
import { TaxInvoiceError } from "./errors";

type Status = "PENDING" | "CREATED" | "SENT_TO_STORE" | "NOT_REQUIRED";

type TransitionData = Partial<{
  invoiceNo: string | null;
  buyerNpwp: string | null;
  taxableAmount: Prisma.Decimal | null;
  ppnAmount: Prisma.Decimal | null;
  reason: string | null;
  markedAt: Date | null;
  markedById: string | null;
}>;

type Transition = {
  taxInvoiceId: string;
  userId: string;
  from: Status[];
  to: Status;
  data: TransitionData;
  action: string;
};

/**
 * `data` is a PARTIAL update — only the keys present are written, so a transition that must not
 * touch a field (e.g. `markTaxInvoiceSentToStore` preserving `invoiceNo`/`buyerNpwp`/the amounts/
 * `markedAt`/`markedById`) simply omits it, rather than every caller having to re-state every
 * field on every transition.
 */
async function transition(t: Transition): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
    const row = await tx.taxInvoice.findUnique({
      where: { id: t.taxInvoiceId },
      select: {
        id: true,
        status: true,
        invoiceNo: true,
        buyerNpwp: true,
        taxableAmount: true,
        ppnAmount: true,
        reason: true,
      },
    });
    if (!row) throw new TaxInvoiceError("NOT_FOUND");
    if (!t.from.includes(row.status as Status)) throw new TaxInvoiceError("INVALID_STATE");

    const swapped = await tx.taxInvoice.updateMany({
      where: { id: t.taxInvoiceId, status: row.status },
      data: { status: t.to, ...t.data },
    });
    if (swapped.count !== 1) throw new TaxInvoiceError("CONFLICT");

    /**
     * `TaxInvoice`'s value fields are all last-write-wins, so every transition overwrites the
     * previous one — mark CREATED with a faktur number and NPWP, revert it, and both are gone
     * from the row with no trace anywhere. The before/after pair plus the operator's reason is
     * what makes this an audit trail rather than a list of timestamps, written inside the same
     * transaction as the update, exactly as nota-date correction does. `after` is built by
     * spreading `t.data` over `before` so a field this transition did NOT touch (e.g.
     * `markTaxInvoiceSentToStore` never sets `invoiceNo`) shows its unchanged value in `after`,
     * honestly, rather than `undefined`.
     */
    const before = {
      status: row.status,
      invoiceNo: row.invoiceNo,
      buyerNpwp: row.buyerNpwp,
      taxableAmount: row.taxableAmount,
      ppnAmount: row.ppnAmount,
      reason: row.reason,
    };
    const after = { ...before, status: t.to, ...t.data };

    await tx.auditLog.create({
      data: {
        userId: t.userId,
        action: t.action,
        entityType: "TaxInvoice",
        entityId: t.taxInvoiceId,
        changes: { before, after },
        reason: t.data.reason ?? null,
      },
    });

    return { ok: true };
  });
}

export async function markTaxInvoiceCreated(input: {
  taxInvoiceId: string;
  invoiceNo: string;
  buyerNpwp: string;
  taxableAmount: number;
  ppnAmount: number;
  userId: string;
}): Promise<{ ok: true }> {
  const invoiceNo = input.invoiceNo.trim();
  const buyerNpwp = input.buyerNpwp.trim();
  if (invoiceNo === "") throw new TaxInvoiceError("INVALID_REQUEST");
  if (buyerNpwp === "") throw new TaxInvoiceError("INVALID_REQUEST");
  if (!Number.isFinite(input.taxableAmount) || input.taxableAmount < 0) throw new TaxInvoiceError("INVALID_REQUEST");
  if (!Number.isFinite(input.ppnAmount) || input.ppnAmount < 0) throw new TaxInvoiceError("INVALID_REQUEST");

  return transition({
    taxInvoiceId: input.taxInvoiceId,
    userId: input.userId,
    from: ["PENDING"],
    to: "CREATED",
    data: {
      invoiceNo,
      buyerNpwp,
      taxableAmount: new Prisma.Decimal(roundCents(input.taxableAmount)),
      ppnAmount: new Prisma.Decimal(roundCents(input.ppnAmount)),
      reason: null,
      markedAt: new Date(),
      markedById: input.userId,
    },
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

/**
 * A handover, not a re-issue — deliberately does NOT include `invoiceNo`, `buyerNpwp`,
 * `taxableAmount`, `ppnAmount`, `markedAt` or `markedById` in `data`, so `transition()` leaves
 * every one of them exactly as they were. Copying `markTaxInvoiceCreated`'s `data` block here
 * would silently reassign authorship of every sent faktur to whoever clicked "Sent to store".
 * `reason` is optional, unlike `markTaxInvoiceNotRequired`/`revertTaxInvoiceToPending` — sending
 * a faktur to a store is the expected happy path, and demanding a justification for it is noise.
 */
export async function markTaxInvoiceSentToStore(input: {
  taxInvoiceId: string;
  reason?: string | null;
  userId: string;
}): Promise<{ ok: true }> {
  const reason = input.reason?.trim() || null;
  return transition({
    taxInvoiceId: input.taxInvoiceId,
    userId: input.userId,
    from: ["CREATED"],
    to: "SENT_TO_STORE",
    data: { reason },
    action: "TAX_INVOICE_SENT_TO_STORE",
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
    from: ["CREATED", "SENT_TO_STORE", "NOT_REQUIRED"],
    to: "PENDING",
    data: {
      invoiceNo: null,
      buyerNpwp: null,
      taxableAmount: null,
      ppnAmount: null,
      reason,
      markedAt: null,
      markedById: null,
    },
    action: "TAX_INVOICE_REVERTED",
  });
}
