import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { encryptBankAccount } from '@/lib/encryption';
import { generateSupplierCode } from '@/lib/docNumber';

const supplierSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1),
  typeId: z.string().min(1),
  categoryId: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankAccountName: z.string().optional(),
});

// GET /api/suppliers - List suppliers
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');
    const categoryId = searchParams.get('categoryId');
    const search = searchParams.get('search');
    const sync = searchParams.get('sync') === 'true';

    const where: any = {};
    const typeId = searchParams.get('typeId');
    if (typeId) where.typeId = typeId;
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }

    const suppliers = await prisma.supplier.findMany({
      where,
      include: {
        type: { select: { id: true, code: true, name: true } },
        category: {
          select: {
            id: true,
            nameId: true,
            nameEn: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // For sync requests, return simplified data
    if (sync) {
      return NextResponse.json(
        suppliers.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          typeId: s.typeId,
          type: s.type ? { id: s.type.id, code: s.type.code, name: s.type.name } : null,
          categoryId: s.categoryId,
          address: s.address,
          phone: s.phone,
          email: s.email,
          bankName: s.bankName,
          bankAccountName: s.bankAccountName,
          isActive: s.isActive,
        }))
      );
    }

    // Mask bank accounts for regular requests
    const maskedSuppliers = suppliers.map((s) => ({
      ...s,
      bankAccountEnc: s.bankAccountEnc ? '***ENCRYPTED***' : null,
    }));

    return NextResponse.json(maskedSuppliers);
  } catch (error) {
    console.error('Failed to fetch suppliers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch suppliers' },
      { status: 500 }
    );
  }
}

// POST /api/suppliers - Create supplier
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const validated = supplierSchema.parse(body);

    let code: string;
    if (validated.code?.trim()) {
      code = validated.code.trim();
      const existing = await prisma.supplier.findUnique({ where: { code } });
      if (existing) {
        return NextResponse.json(
          { error: 'Supplier code already exists' },
          { status: 400 }
        );
      }
    } else {
      code = await generateSupplierCode();
    }

    // Encrypt bank account if provided
    let bankAccountEnc = null;
    if (validated.bankAccount) {
      bankAccountEnc = encryptBankAccount(validated.bankAccount, 'DEFAULT_PIN');
    }

    const supplier = await prisma.supplier.create({
      data: {
        code,
        name: validated.name,
        typeId: validated.typeId,
        categoryId: validated.categoryId,
        address: validated.address,
        phone: validated.phone,
        email: validated.email,
        bankName: validated.bankName,
        bankAccountEnc,
        bankAccountName: validated.bankAccountName,
      },
    });

    return NextResponse.json(supplier, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Failed to create supplier:', error);
    return NextResponse.json(
      { error: 'Failed to create supplier' },
      { status: 500 }
    );
  }
}
