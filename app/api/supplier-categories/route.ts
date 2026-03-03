import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/supplier-categories - List supplier categories for filter dropdown
export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const categories = await prisma.supplierCategory.findMany({
      select: {
        id: true,
        code: true,
        nameId: true,
        nameEn: true,
      },
      orderBy: [{ code: 'asc' }],
    });

    return NextResponse.json(categories);
  } catch (error) {
    console.error('GET /api/supplier-categories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch supplier categories' },
      { status: 500 }
    );
  }
}
