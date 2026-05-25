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
} from '@/lib/supplier-types/mutations';

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  return session;
}

export async function listSupplierTypesAction(opts?: {
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
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

export async function createSupplierTypeAction(input: z.infer<typeof createSupplierTypeSchema>) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIER_TYPES_CREATE);
  const row = await createSupplierType(input);
  revalidatePath('/backoffice/suppliers/types');
  return row;
}

export async function updateSupplierTypeAction(
  id: string,
  input: z.infer<typeof updateSupplierTypeSchema>
) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIER_TYPES_EDIT);
  const row = await updateSupplierType(id, input);
  revalidatePath('/backoffice/suppliers/types');
  return row;
}

export async function deleteSupplierTypeAction(id: string) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.SUPPLIER_TYPES_DELETE);
  await deleteSupplierType(id);
  revalidatePath('/backoffice/suppliers/types');
}
