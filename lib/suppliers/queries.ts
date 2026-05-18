import { prisma } from '@/lib/prisma';
import type { Prisma, SupplierStatus } from '@prisma/client';

export type ListSuppliersFilters = {
  search?: string;
  typeId?: string;
  status?: SupplierStatus;
  approvedOnly?: boolean;
};

export type ListSuppliersOpts = {
  page?: number;
  pageSize?: number;
  sync?: boolean;
};

function buildWhere(filters?: ListSuppliersFilters): Prisma.SupplierWhereInput {
  const where: Prisma.SupplierWhereInput = {};
  if (filters?.typeId) where.typeId = filters.typeId;
  if (filters?.status) where.status = filters.status;
  if (filters?.approvedOnly) where.status = 'ACTIVE';
  if (filters?.search) {
    where.OR = [{ name: { contains: filters.search } }, { code: { contains: filters.search } }];
  }
  return where;
}

function maskBank(supplier: { bankAccountEnc?: string | null; [k: string]: unknown }) {
  return {
    ...supplier,
    bankAccountEnc: supplier.bankAccountEnc ? '***ENCRYPTED***' : null,
  };
}

export async function listSuppliers(filters?: ListSuppliersFilters, opts?: ListSuppliersOpts) {
  const where = buildWhere(filters);

  if (opts?.sync) {
    const suppliers = await prisma.supplier.findMany({
      where,
      include: { type: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return suppliers.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      typeId: s.typeId,
      type: s.type ? { id: s.type.id, code: s.type.code, name: s.type.name } : null,
      address: s.address,
      phone: s.phone,
      email: s.email,
      bankName: s.bankName,
      bankAccountName: s.bankAccountName,
      isActive: s.isActive,
    }));
  }

  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 0;
  const usePagination = pageSize > 0;

  if (usePagination) {
    const [suppliers, totalCount] = await Promise.all([
      prisma.supplier.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { type: { select: { id: true, code: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.supplier.count({ where }),
    ]);
    return { data: suppliers.map(maskBank), totalCount };
  }

  const suppliers = await prisma.supplier.findMany({
    where,
    include: { type: { select: { id: true, code: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return suppliers.map(maskBank);
}

export async function getSupplierById(id: string) {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: { type: { select: { id: true, code: true, name: true } } },
  });
  if (!supplier) return null;
  return maskBank(supplier);
}
