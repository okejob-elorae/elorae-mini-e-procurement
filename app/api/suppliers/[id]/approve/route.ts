import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission, PERMISSIONS } from '@/lib/rbac';

// POST /api/suppliers/[id]/approve - Approve a pending supplier
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    requirePermission(session.user.permissions, PERMISSIONS.SUPPLIERS_APPROVE);

    const { id } = await params;
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
    }
    if (supplier.status !== 'PENDING_APPROVAL') {
      return NextResponse.json(
        { error: 'Supplier is not pending approval' },
        { status: 400 }
      );
    }

    await prisma.supplier.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        approvedById: session.user.id,
        approvedAt: new Date(),
        rejectionReason: null,
      },
    });

    return NextResponse.json({ success: true, status: 'ACTIVE' });
  } catch (error) {
    console.error('Approve supplier:', error);
    return NextResponse.json(
      { error: 'Failed to approve supplier' },
      { status: 500 }
    );
  }
}
