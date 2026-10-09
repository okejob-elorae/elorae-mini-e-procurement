import { prisma } from '@elorae/db';
import { cariTeks } from "@/lib/db/cari-teks";
import type { Prisma, SupplierStatus } from '@elorae/db';

export type ListSuppliersFilters = {
  search?: string;
  typeId?: string;
  status?: SupplierStatus;
  /** Keaktifan (`Supplier.isActive`); undefined = aktif dan nonaktif. */
  isActive?: boolean;
  /**
   * Pemasok yang boleh dipakai di dokumen BARU (PO, perintah kerja, retur):
   * disetujui DAN aktif — aturan yang sama dengan papan pemasok Lead time.
   */
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
  if (typeof filters?.isActive === 'boolean') where.isActive = filters.isActive;
  if (filters?.approvedOnly) {
    where.status = 'ACTIVE';
    where.isActive = true;
  }
  if (filters?.search) {
    where.OR = [{ name: cariTeks(filters.search) }, { code: cariTeks(filters.search) }];
  }
  return where;
}

function maskBank<T extends { bankAccountEnc?: string | null; npwpEnc?: string | null }>(
  supplier: T,
): Omit<T, "bankAccountEnc" | "npwpEnc"> & { bankAccountEnc: string | null; npwpEnc: string | null } {
  return {
    ...supplier,
    bankAccountEnc: supplier.bankAccountEnc ? '***ENCRYPTED***' : null,
    // NPWP terenkripsi tidak pernah dikirim ke browser; yang tampil cukup npwpLast4.
    npwpEnc: supplier.npwpEnc ? '***ENCRYPTED***' : null,
  };
}

export async function listSuppliers(filters?: ListSuppliersFilters, opts?: ListSuppliersOpts) {
  const where = buildWhere(filters);

  if (opts?.sync) {
    const suppliers = await prisma.supplier.findMany({
      where,
      include: { type: { select: { id: true, code: true, name: true, color: true } } },
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
        include: { type: { select: { id: true, code: true, name: true, color: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.supplier.count({ where }),
    ]);
    return { data: suppliers.map(maskBank), totalCount };
  }

  const suppliers = await prisma.supplier.findMany({
    where,
    include: { type: { select: { id: true, code: true, name: true, color: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return suppliers.map(maskBank);
}

export async function getSupplierById(id: string) {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: { type: { select: { id: true, code: true, name: true, color: true } } },
  });
  if (!supplier) return null;
  return maskBank(supplier);
}
