import { z } from 'zod';
import { prisma } from '@/lib/prisma';

export const createSupplierTypeSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional(),
});

export const updateSupplierTypeSchema = createSupplierTypeSchema.partial();

export async function createSupplierType(input: z.infer<typeof createSupplierTypeSchema>) {
  const validated = createSupplierTypeSchema.parse(input);
  const existing = await prisma.supplierType.findUnique({ where: { code: validated.code } });
  if (existing) throw new Error('A supplier type with this code already exists');
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
  const validated = updateSupplierTypeSchema.parse(input);
  if (validated.code) {
    const existing = await prisma.supplierType.findFirst({
      where: { code: validated.code, id: { not: id } },
    });
    if (existing) throw new Error('A supplier type with this code already exists');
  }
  return prisma.supplierType.update({ where: { id }, data: validated });
}

export async function deleteSupplierType(id: string) {
  const inUse = await prisma.supplier.count({ where: { typeId: id } });
  if (inUse > 0) throw new Error('Cannot delete supplier type in use');
  await prisma.supplierType.delete({ where: { id } });
}
