"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { assertActor } from "@/lib/auth/assert-actor";
import { requirePermission, PERMISSIONS } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { listBillableSources } from "@/lib/vendor-billing/billable";
import { createVendorBill, voidVendorBill, VendorBillError } from "@/lib/vendor-billing/bill-writer";
import { listVendorBills, listBillLinesForPo, listBillLinesForWo } from "@/lib/vendor-billing/queries";
import { createVendorPayment, voidVendorPayment } from "@/lib/vendor-billing/payment-writer";
import { listOpenBills, listVendorPayments } from "@/lib/vendor-billing/payment-queries";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** A user-facing refusal comes back as `{ ok: false }`; anything else still throws. */
async function guard<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof VendorBillError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: e.issues.map((i) => i.message).join("; ") };
    throw e;
  }
}

async function session(permission: string, userId?: string) {
  const s = await auth();
  if (!s) throw new Error("Unauthorized");
  requirePermission(s.user.permissions, permission);
  if (userId !== undefined) assertActor(s.user.id, userId);
  return s;
}

const idSchema = z.string().min(1);
const statusSchema = z.enum(["UNPAID", "PARTIAL", "PAID", "VOID"]).optional();

export async function getVendorBills(filters: { supplierId?: string; status?: string; from?: string; to?: string; search?: string }) {
  await session(PERMISSIONS.VENDOR_BILLS_VIEW);
  return listVendorBills({
    supplierId: filters.supplierId || undefined,
    status: statusSchema.parse(filters.status || undefined),
    from: filters.from ? parseDateOnly(filters.from) : undefined,
    to: filters.to ? parseDateOnlyEnd(filters.to) : undefined,
    search: filters.search?.slice(0, 100),
  });
}

export async function getBillableSources(supplierId: string) {
  await session(PERMISSIONS.VENDOR_BILLS_MANAGE);
  return listBillableSources(idSchema.parse(supplierId));
}

const createSchema = z.object({
  supplierId: idSchema,
  vendorInvoiceNo: z.string(),
  billDate: z.string().min(1),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(z.object({ type: z.enum(["PO_ITEM", "WO_STEP"]), sourceId: idSchema, qty: z.number(), price: z.number() })),
});

export async function createVendorBillAction(input: z.input<typeof createSchema>, userId: string) {
  const s = await session(PERMISSIONS.VENDOR_BILLS_MANAGE, userId);
  const data = createSchema.parse(input);
  const billDate = parseDateOnly(data.billDate);
  if (!billDate) return { ok: false as const, error: "Tanggal tagihan tidak valid" };
  const res = await guard(() =>
    createVendorBill(
      {
        supplierId: data.supplierId,
        vendorInvoiceNo: data.vendorInvoiceNo,
        billDate,
        dueDate: data.dueDate ? parseDateOnly(data.dueDate) : null,
        notes: data.notes,
        lines: data.lines,
      },
      s.user.id
    )
  );
  if (res.ok) {
    await logAudit({
      userId: s.user.id,
      action: "CREATE",
      entityType: "VendorBill",
      entityId: res.id,
      changes: { after: { docNumber: res.docNumber, supplierId: data.supplierId, vendorInvoiceNo: data.vendorInvoiceNo } },
    });
    revalidatePath("/backoffice/vendor-bills");
  }
  return res;
}

export async function voidVendorBillAction(billId: string, reason: string, userId: string) {
  const s = await session(PERMISSIONS.VENDOR_BILLS_MANAGE, userId);
  const id = idSchema.parse(billId);
  const res = await guard(() => voidVendorBill(id, reason, s.user.id));
  if (res.ok) {
    await logAudit({ userId: s.user.id, action: "UPDATE", entityType: "VendorBill", entityId: id, changes: { after: { status: "VOID", reason } } });
    revalidatePath("/backoffice/vendor-bills");
    revalidatePath(`/backoffice/vendor-bills/${id}`);
  }
  return res;
}

export async function getBillLinesForPo(poId: string) {
  await session(PERMISSIONS.PURCHASE_ORDERS_VIEW);
  return listBillLinesForPo(idSchema.parse(poId));
}

export async function getBillLinesForWo(woId: string) {
  await session(PERMISSIONS.WORK_ORDERS_VIEW);
  return listBillLinesForWo(idSchema.parse(woId));
}

// --- Vendor bill payments (reuse the supplier payment permissions) ---

export async function getVendorPayments(filters: { supplierId?: string; from?: string; to?: string; search?: string }) {
  await session(PERMISSIONS.SUPPLIER_PAYMENTS_VIEW);
  return listVendorPayments({
    supplierId: filters.supplierId || undefined,
    from: filters.from ? parseDateOnly(filters.from) : undefined,
    to: filters.to ? parseDateOnlyEnd(filters.to) : undefined,
    search: filters.search?.slice(0, 100),
  });
}

export async function getOpenBills(supplierId: string) {
  await session(PERMISSIONS.SUPPLIER_PAYMENTS_CREATE);
  return listOpenBills(idSchema.parse(supplierId));
}

const paymentSchema = z.object({
  supplierId: idSchema,
  paidAt: z.string().min(1),
  method: z.enum(["BANK", "CASH"]),
  reference: z.string().optional(),
  notes: z.string().optional(),
  allocations: z.array(z.object({ billId: idSchema, amount: z.number() })),
});

export async function createVendorPaymentAction(input: z.input<typeof paymentSchema>, userId: string) {
  const s = await session(PERMISSIONS.SUPPLIER_PAYMENTS_CREATE, userId);
  const data = paymentSchema.parse(input);
  const paidAt = parseDateOnly(data.paidAt);
  if (!paidAt) return { ok: false as const, error: "Tanggal bayar tidak valid" };
  const res = await guard(() => createVendorPayment({ ...data, paidAt }, s.user.id));
  if (res.ok) {
    await logAudit({
      userId: s.user.id,
      action: "CREATE",
      entityType: "VendorPayment",
      entityId: res.id,
      changes: { after: { docNumber: res.docNumber, supplierId: data.supplierId, allocations: data.allocations } },
    });
    revalidatePath("/backoffice/vendor-payments");
    revalidatePath("/backoffice/vendor-bills");
  }
  return res;
}

export async function voidVendorPaymentAction(paymentId: string, reason: string, userId: string) {
  const s = await session(PERMISSIONS.SUPPLIER_PAYMENTS_CREATE, userId);
  const id = idSchema.parse(paymentId);
  const res = await guard(() => voidVendorPayment(id, reason, s.user.id));
  if (res.ok) {
    await logAudit({ userId: s.user.id, action: "UPDATE", entityType: "VendorPayment", entityId: id, changes: { after: { voided: true, reason } } });
    revalidatePath("/backoffice/vendor-payments");
    revalidatePath(`/backoffice/vendor-payments/${id}`);
    revalidatePath("/backoffice/vendor-bills");
  }
  return res;
}
