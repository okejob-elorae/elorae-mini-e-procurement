'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { notifySupplierCreated, notifySupplierApproved } from '@/lib/notifications/events';
import { getActorName } from "@/lib/notifications/actor-name";
import { verifyPinForAction } from '@/app/actions/security/pin-auth';
import {
  listSuppliers,
  getSupplierById,
  type ListSuppliersFilters,
} from '@/lib/suppliers/queries';
import {
  createSupplier,
  updateSupplier,
  deleteSupplier,
  approveSupplier,
  rejectSupplier,
  decryptSupplierBankAccount,
  supplierSchema,
  supplierUpdateSchema,
  SUPPLIER_DELETE_BLOCKED,
} from '@/lib/suppliers/mutations';

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  return session;
}

export type GetSuppliersForSelectOpts = {
  approvedOnly?: boolean;
  sync?: boolean;
  search?: string;
  typeId?: string;
};

export type SupplierSelectRow = {
  id: string;
  code: string;
  name: string;
  typeId?: string;
  type?: { id: string; code: string; name: string } | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  paymentTermsDays?: number | null;
  isActive?: boolean;
};

/** Shared supplier list for dropdowns (replaces fetch('/api/suppliers')). */
export async function getSuppliersForSelect(
  opts: GetSuppliersForSelectOpts = {}
): Promise<SupplierSelectRow[]> {
  await requireSession();
  const filters: ListSuppliersFilters = {
    approvedOnly: opts.approvedOnly,
    search: opts.search,
    typeId: opts.typeId,
  };
  const result = await listSuppliers(filters, { sync: opts.sync ?? true });
  return Array.isArray(result) ? (result as SupplierSelectRow[]) : [];
}

export async function listSuppliersAction(
  filters?: ListSuppliersFilters & { page?: number; pageSize?: number; sync?: boolean }
) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_VIEW);
  const { page, pageSize, sync, ...rest } = filters ?? {};
  return listSuppliers(rest, { page, pageSize, sync });
}

/** Paginated admin list (suppliers page). */
export async function getSuppliers(
  filters?: ListSuppliersFilters,
  opts?: { page?: number; pageSize?: number }
) {
  return listSuppliersAction({ ...filters, ...opts });
}

export async function getSupplierByIdAction(id: string) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_VIEW);
  return getSupplierById(id);
}

export async function createSupplierAction(input: z.infer<typeof supplierSchema>) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_CREATE);
  const supplier = await createSupplier(input, session.user.id);
  getActorName(session.user.id)
    .then((triggeredByName) => notifySupplierCreated(supplier.id, supplier.name, triggeredByName))
    .catch(() => {});
  revalidatePath('/backoffice/suppliers');
  return tanpaSandi(supplier);
}

/** Kolom terenkripsi (rekening, NPWP) tidak pernah dikirim balik ke browser. */
function tanpaSandi<T extends { bankAccountEnc: string | null; npwpEnc: string | null }>(s: T): T {
  return {
    ...s,
    bankAccountEnc: s.bankAccountEnc ? '***ENCRYPTED***' : null,
    npwpEnc: s.npwpEnc ? '***ENCRYPTED***' : null,
  };
}

export async function updateSupplierAction(
  id: string,
  input: z.infer<typeof supplierUpdateSchema>
) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_EDIT);
  const supplier = await updateSupplier(id, input, session.user.id);
  revalidatePath('/backoffice/suppliers');
  revalidatePath(`/backoffice/suppliers/${id}`);
  return tanpaSandi(supplier);
}

export type DeleteSupplierActionResult =
  | { success: true }
  | {
      success: false;
      reason?: undefined;
      securityMessageKey?: undefined;
      messageKey: 'cannotDeleteSupplierInUse' | 'failedToDeleteSupplier';
    }
  /** PIN ditolak; `securityMessageKey` = kunci namespace `security` (mis. `pinIncorrect`). */
  | { success: false; reason: 'PIN'; messageKey?: string; message?: string; securityMessageKey: string };

/**
 * Hapus pemasok: butuh `suppliers:delete` DAN PIN pengguna sesi, keduanya
 * diperiksa di sini. Dulu PIN hanya diperiksa browser lewat panggilan terpisah,
 * jadi memanggil aksi ini langsung melewati PIN.
 */
export async function deleteSupplierAction(id: string, pin: string): Promise<DeleteSupplierActionResult> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_DELETE);
  if (typeof pin !== "string" || pin.trim() === "") {
    return { success: false, reason: 'PIN', messageKey: "pinInvalid", securityMessageKey: "pinInvalid" };
  }
  const pinResult = await verifyPinForAction(session.user.id, pin, "DELETE_SUPPLIER");
  if (!pinResult.success) {
    return {
      success: false,
      reason: 'PIN',
      messageKey: pinResult.messageKey,
      message: pinResult.message,
      securityMessageKey: pinResult.messageKey ?? "pinIncorrect",
    };
  }
  try {
    await deleteSupplier(id);
    revalidatePath('/backoffice/suppliers');
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.message === SUPPLIER_DELETE_BLOCKED) {
      return { success: false, messageKey: 'cannotDeleteSupplierInUse' };
    }
    return { success: false, messageKey: 'failedToDeleteSupplier' };
  }
}

export async function approveSupplierAction(id: string) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_APPROVE);
  const supplier = await approveSupplier(id, session.user.id);
  getActorName(session.user.id)
    .then((triggeredByName) => notifySupplierApproved(id, supplier.name, triggeredByName))
    .catch(() => {});
  revalidatePath('/backoffice/suppliers');
  return { success: true, status: 'ACTIVE' as const };
}

export async function rejectSupplierAction(id: string, reason: string) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_APPROVE);
  if (!reason?.trim()) throw new Error('Reason is required');
  await rejectSupplier(id, session.user.id, reason.trim());
  revalidatePath('/backoffice/suppliers');
  return { success: true, status: 'REJECTED' as const };
}

export async function decryptSupplierBankAction(id: string, pin: string) {
  const session = await requireSession();
  // Izin dulu, baru PIN: tanpa `suppliers:view` tidak ada tebakan PIN yang dihitung.
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_VIEW);
  const pinResult = await verifyPinForAction(
    session.user.id,
    pin,
    'VIEW_BANK_ACCOUNT',
    'User requested bank account view',
    'server-action'
  );
  if (!pinResult.success) {
    throw new Error(pinResult.messageKey ?? pinResult.message ?? 'Invalid PIN');
  }
  const bankAccount = await decryptSupplierBankAccount(id, session.user.id, {
    ip: 'server-action',
    userAgent: 'server-action',
  });
  return { bankAccount };
}
