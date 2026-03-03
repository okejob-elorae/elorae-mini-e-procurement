'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requirePermission, PERMISSIONS } from '@/lib/rbac';
import { auth } from '@/lib/auth';

const uomSchema = z.object({
  code: z.string().min(1).max(10),
  nameId: z.string().min(1),
  nameEn: z.string().min(1),
  description: z.string().optional(),
});

export async function createUOM(data: z.infer<typeof uomSchema>) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_UOM_MANAGE);
  
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

/** Get item's base UOM and all conversions that involve it (for stock adjustment UOM selector). */
export async function getItemUomAndConversions(itemId: string) {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { uomId: true, uom: { select: { id: true, code: true, nameId: true, nameEn: true } } },
  });
  if (!item) return null;
  const conversions = await prisma.uOMConversion.findMany({
    where: {
      OR: [
        { fromUomId: item.uomId },
        { toUomId: item.uomId },
      ],
    },
    include: {
      fromUom: { select: { id: true, code: true, nameId: true, nameEn: true } },
      toUom: { select: { id: true, code: true, nameId: true, nameEn: true } },
    },
  });
  return {
    baseUom: item.uom,
    conversions: conversions.map((c) => ({
      fromUomId: c.fromUomId,
      toUomId: c.toUomId,
      factor: Number(c.factor),
      fromUom: c.fromUom,
      toUom: c.toUom,
    })),
  };
}
