'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { listSupplierTypes, getSupplierTypeById } from '@/lib/supplier-types/queries';
import {
  createSupplierType,
  updateSupplierType,
  deleteSupplierType,
  createSupplierTypeSchema,
  updateSupplierTypeSchema,
  SupplierTypeError,
} from '@/lib/supplier-types/mutations';

/**
 * Hasil tulis untuk layar: kode, bukan lemparan — pesan galat aksi server
 * disamarkan jadi digest di produksi, jadi "kode sudah dipakai" tidak akan
 * pernah sampai ke layar kalau dilempar.
 */
export type HasilJenisPemasok =
  | { ok: true }
  | { ok: false; code: 'DUPLICATE_CODE' | 'IN_USE' | 'UNKNOWN_PANTONE'; count?: number }
  | { ok: false; code: 'FAILED' };

function keHasil(e: unknown): HasilJenisPemasok {
  if (e instanceof SupplierTypeError) return { ok: false, code: e.code, count: e.count };
  console.error(e);
  return { ok: false, code: 'FAILED' };
}

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  return session;
}

export async function listSupplierTypesAction(opts?: {
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
  withUsage?: boolean;
}) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIER_TYPES_VIEW);
  return listSupplierTypes(opts);
}

export const getSupplierTypes = listSupplierTypesAction;

export async function getSupplierTypeByIdAction(id: string) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIER_TYPES_VIEW);
  return getSupplierTypeById(id);
}

export async function createSupplierTypeAction(
  input: z.infer<typeof createSupplierTypeSchema>,
): Promise<HasilJenisPemasok> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIER_TYPES_CREATE);
  try {
    await createSupplierType(input);
  } catch (e) {
    return keHasil(e);
  }
  revalidatePath('/backoffice/suppliers/types');
  revalidatePath('/backoffice/suppliers');
  return { ok: true };
}

export async function updateSupplierTypeAction(
  id: string,
  input: z.infer<typeof updateSupplierTypeSchema>
): Promise<HasilJenisPemasok> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIER_TYPES_EDIT);
  try {
    await updateSupplierType(id, input);
  } catch (e) {
    return keHasil(e);
  }
  revalidatePath('/backoffice/suppliers/types');
  // Warna jenis tampil di daftar pemasok (lencana, galeri, papan).
  revalidatePath('/backoffice/suppliers');
  return { ok: true };
}

export async function deleteSupplierTypeAction(id: string): Promise<HasilJenisPemasok> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIER_TYPES_DELETE);
  try {
    await deleteSupplierType(id);
  } catch (e) {
    return keHasil(e);
  }
  revalidatePath('/backoffice/suppliers/types');
  return { ok: true };
}
