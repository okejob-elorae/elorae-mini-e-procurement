import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

/** Aggregate variant-level inventory to one item-level object. */
function aggregateInventory(
  rows: Array<{ qtyOnHand: unknown; totalValue: unknown }> | null | undefined
): { qtyOnHand: number; avgCost: number; totalValue: number } | null {
  if (!rows?.length) return null;
  let qty = 0;
  let totalValue = 0;
  for (const r of rows) {
    qty += toNum(r.qtyOnHand) ?? 0;
    totalValue += toNum(r.totalValue) ?? 0;
  }
  return {
    qtyOnHand: qty,
    avgCost: qty > 0 ? totalValue / qty : 0,
    totalValue,
  };
}

/** Serialize item for client (no Prisma Decimal) */
function serializeItem(item: {
  reorderPoint?: unknown;
  inventoryValues?: Array<{ qtyOnHand: unknown; totalValue: unknown; avgCost?: unknown }>;
  [k: string]: unknown;
}) {
  const inv = aggregateInventory(
    item.inventoryValues as Array<{ qtyOnHand: unknown; totalValue: unknown }> | undefined
  );
  return {
    ...item,
    reorderPoint: item.reorderPoint != null ? toNum(item.reorderPoint) : null,
    inventoryValue: inv,
  };
}

// GET /api/items - List items (for client and for offline sync)
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const sync = searchParams.get('sync') === 'true';
    const type = searchParams.get('type');
    const isActive = searchParams.get('isActive');
    const search = searchParams.get('search');

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
      where.OR = [
        { sku: { contains: search } },
        { nameId: { contains: search } },
        { nameEn: { contains: search } },
      ];
    }

    const items = await prisma.item.findMany({
      where,
      include: {
        uom: { select: { id: true, code: true, nameId: true, nameEn: true } },
        inventoryValues: {
          select: { qtyOnHand: true, totalValue: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (sync) {
      return NextResponse.json(
        items.map((i) => ({
          id: i.id,
          sku: i.sku,
          nameId: i.nameId,
          nameEn: i.nameEn,
          type: i.type,
          uomId: i.uomId,
          uomCode: i.uom?.code,
          isActive: i.isActive,
        }))
      );
    }

    return NextResponse.json(items.map(serializeItem));
  } catch (error) {
    console.error('Failed to fetch items:', error);
    return NextResponse.json(
      { error: 'Failed to fetch items' },
      { status: 500 }
    );
  }
}
