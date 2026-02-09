import { prisma } from './prisma';

/**
 * Convert a quantity between two UOMs using configured conversion factors.
 * Looks for a direct conversion first, then tries the inverse (divide).
 * Throws if no conversion path exists.
 */
export async function convertQuantity(
  fromUomId: string,
  toUomId: string,
  qty: number
): Promise<number> {
  if (fromUomId === toUomId) return qty;

  const direct = await prisma.uOMConversion.findUnique({
    where: { fromUomId_toUomId: { fromUomId, toUomId } },
  });

  if (direct) {
    const factor = Number(direct.factor);
    return qty * factor;
  }

  const inverse = await prisma.uOMConversion.findUnique({
    where: { fromUomId_toUomId: { fromUomId: toUomId, toUomId: fromUomId } },
  });

  if (inverse) {
    const factor = Number(inverse.factor);
    return qty / factor;
  }

  throw new Error('No conversion factor found for the specified UOMs');
}
