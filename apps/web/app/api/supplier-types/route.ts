import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { requirePermission, PERMISSIONS } from '@/lib/rbac';
import { listSupplierTypes } from '@/lib/supplier-types/queries';
import { createSupplierType } from '@/lib/supplier-types/mutations';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';
    const pageParam = searchParams.get('page');
    const pageSizeParam = searchParams.get('pageSize');
    const usePagination = pageParam != null && pageSizeParam != null;

    if (usePagination) {
      const page = Math.max(1, parseInt(pageParam!, 10) || 1);
      const pageSize = Math.max(1, Math.min(100, parseInt(pageSizeParam!, 10) || 20));
      const result = await listSupplierTypes({ page, pageSize, activeOnly });
      return NextResponse.json(result);
    }

    return NextResponse.json(await listSupplierTypes({ activeOnly }));
  } catch (error) {
    console.error('Failed to fetch supplier types:', error);
    return NextResponse.json({ error: 'Failed to fetch supplier types' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    requirePermission(session.user.permissions, PERMISSIONS.SUPPLIER_TYPES_CREATE);

    const body = await req.json();
    const validated = createSchema.parse(body);
    const supplierType = await createSupplierType(validated);
    return NextResponse.json(supplierType, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Failed to create supplier type:', error);
    return NextResponse.json({ error: 'Failed to create supplier type' }, { status: 500 });
  }
}
