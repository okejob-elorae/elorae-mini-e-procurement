import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const createSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional(),
});

// GET /api/supplier-types - List supplier types
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    const where = activeOnly ? { isActive: true } : {};

    const types = await prisma.supplierType.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });

    return NextResponse.json(types);
  } catch (error) {
    console.error('Failed to fetch supplier types:', error);
    return NextResponse.json(
      { error: 'Failed to fetch supplier types' },
      { status: 500 }
    );
  }
}

// POST /api/supplier-types - Create supplier type
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const validated = createSchema.parse(body);

    const existing = await prisma.supplierType.findUnique({
      where: { code: validated.code },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'A supplier type with this code already exists' },
        { status: 409 }
      );
    }

    const supplierType = await prisma.supplierType.create({
      data: {
        code: validated.code,
        name: validated.name,
        isActive: validated.isActive,
        sortOrder: validated.sortOrder,
      },
    });

    return NextResponse.json(supplierType, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Failed to create supplier type:', error);
    return NextResponse.json(
      { error: 'Failed to create supplier type' },
      { status: 500 }
    );
  }
}
