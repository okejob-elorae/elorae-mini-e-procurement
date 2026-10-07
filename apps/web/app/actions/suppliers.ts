'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { PERMISSIONS, hasPermission, requirePermission } from '@/lib/rbac';
import { aktivitasPemasok, type AktivitasBaris } from '@/lib/suppliers/aktivitas-queries';
import { getActorName, notifySupplierCreated, notifySupplierApproved } from '@/app/actions/notifications';
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

/**
 * Ringkasan kerja per pemasok untuk satu halaman daftar (PO terbuka, SPK di
 * penjahit, utang, terakhir order, tautan WhatsApp). Tiap bagian hanya diisi
 * bila penampil memegang izin layar asalnya: PO = `purchase_orders:view`,
 * utang = `supplier_payments:view`, SPK = `work_orders:view`.
 */
export async function getSupplierActivityAction(supplierIds: string[]): Promise<Record<string, AktivitasBaris>> {
  const session = await requireSession();
  const izin = session.user.permissions ?? [];
  requirePermission(izin, PERMISSIONS.SUPPLIERS_VIEW);
  if (!Array.isArray(supplierIds)) return {};
  return aktivitasPemasok(supplierIds, {
    lihatPo: hasPermission(izin, PERMISSIONS.PURCHASE_ORDERS_VIEW),
    lihatUtang: hasPermission(izin, PERMISSIONS.SUPPLIER_PAYMENTS_VIEW),
    lihatSpk: hasPermission(izin, PERMISSIONS.WORK_ORDERS_VIEW),
  });
}

export async function getSupplierByIdAction(id: string) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_VIEW);
  return getSupplierById(id);
}

export async function createSupplierAction(input: z.infer<typeof supplierSchema>) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_CREATE);
  const supplier = await createSupplier(input);
  getActorName(session.user.id)
    .then((triggeredByName) => notifySupplierCreated(supplier.id, supplier.name, triggeredByName))
    .catch(() => {});
  revalidatePath('/backoffice/suppliers');
  return supplier;
}

export async function updateSupplierAction(
  id: string,
  input: z.infer<typeof supplierUpdateSchema>
) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_EDIT);
  const supplier = await updateSupplier(id, input);
  revalidatePath('/backoffice/suppliers');
  revalidatePath(`/backoffice/suppliers/${id}`);
  return supplier;
}

export type DeleteSupplierActionResult =
  | { success: true }
  | { success: false; messageKey: 'cannotDeleteSupplierInUse' | 'failedToDeleteSupplier' }
  /** PIN ditolak; kuncinya ada di namespace `security` (mis. `pinIncorrect`). */
  | { success: false; securityMessageKey: string };

/**
 * Hapus pemasok: butuh `suppliers:delete` DAN PIN pengguna sesi, keduanya
 * diperiksa di sini. Dulu PIN hanya diperiksa browser lewat panggilan terpisah,
 * jadi memanggil aksi ini langsung melewati PIN.
 */
export async function deleteSupplierAction(id: string, pin: string): Promise<DeleteSupplierActionResult> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_DELETE);
  if (typeof pin !== "string" || pin.trim() === "") {
    return { success: false, securityMessageKey: "pinInvalid" };
  }
  const pinResult = await verifyPinForAction(session.user.id, pin, "DELETE_SUPPLIER", undefined, "server-action");
  if (!pinResult.success) {
    return { success: false, securityMessageKey: pinResult.messageKey ?? "pinIncorrect" };
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
