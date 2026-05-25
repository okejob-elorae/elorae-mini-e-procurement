import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listItems, listItemsForSync, aggregateInventoryValues } from '@/lib/items/queries';

export const dynamic = 'force-dynamic';

const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

function serializeItemForApi(item: {
  reorderPoint?: unknown;
  inventoryValues?: Array<{ qtyOnHand: unknown; totalValue: unknown }>;
  uom?: { id: string; code: string; nameId: string; nameEn: string } | null;
  variants?: unknown;
  [k: string]: unknown;
}) {
  const inv = aggregateInventoryValues(item.inventoryValues);
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
    const type = searchParams.get('type') ?? undefined;
    const isActiveParam = searchParams.get('isActive');
    const isActive = isActiveParam !== null ? isActiveParam === 'true' : undefined;
    const search = searchParams.get('search') ?? undefined;

    if (sync) {
      const items = await listItemsForSync({ type, isActive, search });
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
          variants: Array.isArray(i.variants) ? i.variants : undefined,
        }))
      );
    }

    const items = await listItemsForSync({ type, isActive, search });
    return NextResponse.json(items.map(serializeItemForApi));
  } catch (error) {
    console.error('Failed to fetch items:', error);
    return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 });
  }
}
