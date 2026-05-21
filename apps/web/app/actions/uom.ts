'use server';

import { z } from 'zod';
import { Prisma } from '@elorae/db';
import { prisma } from '@elorae/db';
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

const updateUOMSchema = uomSchema.extend({ id: z.string().min(1) });

export async function updateUOM(data: z.infer<typeof updateUOMSchema>) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_UOM_MANAGE);

  const validated = updateUOMSchema.parse(data);
  const { id, ...rest } = validated;
  try {
    await prisma.uOM.update({ where: { id }, data: rest });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new Error('A UOM with this code already exists');
    }
    throw e;
  }
  revalidatePath('/backoffice/settings/uom');
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

export async function deleteUOMConversion(id: string) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_UOM_MANAGE);

  const parsed = z.string().min(1).parse(id);
  await prisma.uOMConversion.delete({ where: { id: parsed } });
  revalidatePath('/backoffice/settings/uom');
}

export async function getUOMConversions() {
  const rows = await prisma.uOMConversion.findMany({
    include: {
      fromUom: {
        select: {
          id: true,
          code: true,
          nameId: true,
          nameEn: true,
        },
      },
      toUom: {
        select: {
          id: true,
          code: true,
          nameId: true,
          nameEn: true,
        },
      },
    },
    orderBy: [{ fromUom: { code: 'asc' } }, { toUom: { code: 'asc' } }],
  });
  return rows.map((c) => ({
    id: c.id,
    fromUomId: c.fromUomId,
    toUomId: c.toUomId,
    factor: Number(c.factor),
    isDefault: c.isDefault,
    fromUom: c.fromUom,
    toUom: c.toUom,
  }));
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
