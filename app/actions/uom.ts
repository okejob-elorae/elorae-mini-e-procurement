'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

const uomSchema = z.object({
  code: z.string().min(1).max(10),
  nameId: z.string().min(1),
  nameEn: z.string().min(1),
  description: z.string().optional(),
});

export async function createUOM(data: z.infer<typeof uomSchema>) {
  const validated = uomSchema.parse(data);
  const uom = await prisma.uOM.create({ 
    data: validated 
  });
  revalidatePath('/backoffice/settings/uom');
  return uom;
}

export async function getUOMs() {
  return prisma.uOM.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' }
  });
}

export async function createUOMConversion(data: {
  fromUomId: string;
  toUomId: string;
  factor: number;
  isDefault?: boolean;
}) {
  await prisma.uOMConversion.create({
    data: {
      fromUomId: data.fromUomId,
      toUomId: data.toUomId,
      factor: data.factor,
      isDefault: data.isDefault || false
    }
  });
  revalidatePath('/backoffice/settings/uom');
}

export async function getUOMConversions() {
  return prisma.uOMConversion.findMany({
    include: {
      fromUom: {
        select: {
          id: true,
          code: true,
          nameId: true,
          nameEn: true
        }
      },
      toUom: {
        select: {
          id: true,
          code: true,
          nameId: true,
          nameEn: true
        }
      }
    },
    orderBy: [
      { fromUom: { code: 'asc' } },
      { toUom: { code: 'asc' } }
    ]
  });
}
