import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission, PERMISSIONS } from '@/lib/rbac';
import { z } from 'zod';

const rejectSchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
});

// POST /api/suppliers/[id]/reject - Reject a pending supplier
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
    const body = await req.json().catch(() => ({}));
    const { reason } = rejectSchema.parse(body);

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
        status: 'REJECTED',
        approvedById: session.user.id,
        approvedAt: new Date(),
        rejectionReason: reason,
      },
    });

    return NextResponse.json({ success: true, status: 'REJECTED' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? 'Validation error' },
        { status: 400 }
      );
    }
    console.error('Reject supplier:', error);
    return NextResponse.json(
      { error: 'Failed to reject supplier' },
      { status: 500 }
    );
  }
}
