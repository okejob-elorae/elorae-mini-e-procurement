import { z } from 'zod';
import { prisma } from '@elorae/db';

export const createSupplierTypeSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional(),
});

export const updateSupplierTypeSchema = createSupplierTypeSchema.partial();

/**
 * Penolakan yang bisa dijelaskan ke pengguna. Pesannya tetap bahasa Inggris
 * seperti sebelumnya (dipakai rute API); layar membaca `code`, karena pesan
 * galat aksi server disamarkan jadi digest di produksi.
 */
export class SupplierTypeError extends Error {
  constructor(
    readonly code: "DUPLICATE_CODE" | "IN_USE",
    message: string,
    readonly count = 0,
  ) {
    super(message);
    this.name = "SupplierTypeError";
  }
}

/** Kode selalu huruf besar tanpa spasi tepi — "fabric " dan "FABRIC" adalah jenis yang sama. */
function rapikanKode(code: string): string {
  return code.trim().toUpperCase();
}

export async function createSupplierType(input: z.infer<typeof createSupplierTypeSchema>) {
  const validated = createSupplierTypeSchema.parse({ ...input, code: rapikanKode(input.code ?? "") });
  const existing = await prisma.supplierType.findUnique({ where: { code: validated.code } });
  if (existing) throw new SupplierTypeError("DUPLICATE_CODE", "A supplier type with this code already exists");
  return prisma.supplierType.create({
    data: {
      code: validated.code,
      name: validated.name,
      isActive: validated.isActive,
      sortOrder: validated.sortOrder,
    },
  });
}

export async function updateSupplierType(
  id: string,
  input: z.infer<typeof updateSupplierTypeSchema>
) {
  const validated = updateSupplierTypeSchema.parse(
    input.code === undefined ? input : { ...input, code: rapikanKode(input.code) },
  );
  if (validated.code) {
    const existing = await prisma.supplierType.findFirst({
      where: { code: validated.code, id: { not: id } },
    });
    if (existing) throw new SupplierTypeError("DUPLICATE_CODE", "A supplier type with this code already exists");
  }
  return prisma.supplierType.update({ where: { id }, data: validated });
}

export async function deleteSupplierType(id: string) {
  const inUse = await prisma.supplier.count({ where: { typeId: id } });
  if (inUse > 0) throw new SupplierTypeError("IN_USE", "Cannot delete supplier type in use", inUse);
  await prisma.supplierType.delete({ where: { id } });
}
