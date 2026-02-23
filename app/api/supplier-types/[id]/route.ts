import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const updateSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nullable().optional(),
});

// GET /api/supplier-types/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supplierType = await prisma.supplierType.findUnique({
      where: { id },
    });

    if (!supplierType) {
      return NextResponse.json(
        { error: 'Supplier type not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(supplierType);
  } catch (error) {
    console.error('Failed to fetch supplier type:', error);
    return NextResponse.json(
      { error: 'Failed to fetch supplier type' },
      { status: 500 }
    );
  }
}

// PUT /api/supplier-types/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const validated = updateSchema.parse(body);

    if (validated.code) {
      const existing = await prisma.supplierType.findFirst({
        where: { code: validated.code, NOT: { id } },
      });
      if (existing) {
        return NextResponse.json(
          { error: 'A supplier type with this code already exists' },
          { status: 409 }
        );
      }
    }

    const supplierType = await prisma.supplierType.update({
      where: { id },
      data: validated,
    });

    return NextResponse.json(supplierType);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Failed to update supplier type:', error);
    return NextResponse.json(
      { error: 'Failed to update supplier type' },
      { status: 500 }
    );
  }
}

// DELETE /api/supplier-types/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const inUse = await prisma.supplier.count({
      where: { typeId: id },
    });
    if (inUse > 0) {
      return NextResponse.json(
        { error: 'Cannot delete supplier type that is in use by one or more suppliers' },
        { status: 400 }
      );
    }

    await prisma.supplierType.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete supplier type:', error);
    return NextResponse.json(
      { error: 'Failed to delete supplier type' },
      { status: 500 }
    );
  }
}
