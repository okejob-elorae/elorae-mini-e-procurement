import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import { listSuppliers } from '@/lib/suppliers/queries';
import { createSupplier, supplierSchema } from '@/lib/suppliers/mutations';
import { getActorName, notifySupplierCreated } from '@/app/actions/notifications';

export const dynamic = 'force-dynamic';

// GET /api/suppliers - List suppliers
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') ?? undefined;
    const sync = searchParams.get('sync') === 'true';
    const approvedOnly = searchParams.get('approvedOnly') === 'true';
    const typeId = searchParams.get('typeId') ?? undefined;
    const statusParam = searchParams.get('status');
    const status =
      statusParam && ['PENDING_APPROVAL', 'ACTIVE', 'REJECTED'].includes(statusParam)
        ? (statusParam as 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED')
        : undefined;

    const pageParam = searchParams.get('page');
    const pageSizeParam = searchParams.get('pageSize');
    const usePagination = pageParam != null && pageSizeParam != null;
    const page = usePagination ? Math.max(1, parseInt(pageParam!, 10) || 1) : 1;
    const pageSize = usePagination
      ? Math.max(1, Math.min(100, parseInt(pageSizeParam!, 10) || 20))
      : 0;

    const result = await listSuppliers(
      { search, approvedOnly, typeId, status },
      { sync, page: usePagination ? page : undefined, pageSize: usePagination ? pageSize : undefined }
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch suppliers:', error);
    return NextResponse.json({ error: 'Failed to fetch suppliers' }, { status: 500 });
  }
}

// POST /api/suppliers - Create supplier
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_CREATE);

    const body = await req.json();
    const validated = supplierSchema.parse(body);
    const supplier = await createSupplier(validated);

    getActorName(session.user.id)
      .then((triggeredByName) => notifySupplierCreated(supplier.id, supplier.name, triggeredByName))
      .catch(() => {});

    return NextResponse.json(supplier, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to create supplier';
    const status = message.includes('already exists') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
