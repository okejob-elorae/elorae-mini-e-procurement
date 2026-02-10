import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/uoms - List UOMs (for offline sync and client use)
export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const uoms = await prisma.uOM.findMany({
      where: { isActive: true },
      select: { id: true, code: true, nameId: true, nameEn: true },
      orderBy: { code: 'asc' },
    });

    return NextResponse.json(uoms);
  } catch (error) {
    console.error('Failed to fetch UOMs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch UOMs' },
      { status: 500 }
    );
  }
}
