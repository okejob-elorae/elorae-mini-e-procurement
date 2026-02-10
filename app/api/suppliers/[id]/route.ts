import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { encryptBankAccount, decryptBankAccount } from '@/lib/encryption';
import { logBankAccountView } from '@/lib/audit';
import { SupplierType } from '@prisma/client';

const supplierSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.nativeEnum(SupplierType).optional(),
  categoryId: z.string().optional().nullable(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankAccountName: z.string().optional(),
  isActive: z.boolean().optional(),
});

const decryptSchema = z.object({
  pin: z.string().min(4),
});

// GET /api/suppliers/[id] - Get supplier
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

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        category: {
          select: {
            id: true,
            nameId: true,
            nameEn: true,
          },
        },
      },
    });

    if (!supplier) {
      return NextResponse.json(
        { error: 'Supplier not found' },
        { status: 404 }
      );
    }

    // Mask bank account
    const maskedSupplier = {
      ...supplier,
      bankAccountEnc: supplier.bankAccountEnc ? '***ENCRYPTED***' : null,
    };

    return NextResponse.json(maskedSupplier);
  } catch (error) {
    console.error('Failed to fetch supplier:', error);
    return NextResponse.json(
      { error: 'Failed to fetch supplier' },
      { status: 500 }
    );
  }
}

// PUT /api/suppliers/[id] - Update supplier
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
    const validated = supplierSchema.parse(body);

    // Encrypt bank account if provided
    let bankAccountEnc = undefined;
    if (validated.bankAccount) {
      bankAccountEnc = encryptBankAccount(validated.bankAccount, 'DEFAULT_PIN');
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        ...validated,
        bankAccountEnc,
      },
    });

    return NextResponse.json(supplier);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Failed to update supplier:', error);
    return NextResponse.json(
      { error: 'Failed to update supplier' },
      { status: 500 }
    );
  }
}

// DELETE /api/suppliers/[id] - Delete supplier
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

    // Check if supplier has purchase orders
    const poCount = await prisma.purchaseOrder.count({
      where: { supplierId: id },
    });

    if (poCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete supplier with existing purchase orders' },
        { status: 400 }
      );
    }

    await prisma.supplier.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete supplier:', error);
    return NextResponse.json(
      { error: 'Failed to delete supplier' },
      { status: 500 }
    );
  }
}

// POST /api/suppliers/[id]/decrypt - Decrypt bank account
export async function POST(
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
    const { pin } = decryptSchema.parse(body);

    // Verify PIN
    const { verifyPin } = await import('@/lib/auth');
    const isValid = await verifyPin(session.user.id, pin);

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid PIN' },
        { status: 403 }
      );
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id },
    });

    if (!supplier || !supplier.bankAccountEnc) {
      return NextResponse.json(
        { error: 'Bank account not found' },
        { status: 404 }
      );
    }

    // Decrypt bank account
    const bankAccount = decryptBankAccount(supplier.bankAccountEnc, 'DEFAULT_PIN');

    // Log audit
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';
    await logBankAccountView(session.user.id, id, {
      ip,
      userAgent,
    });

    return NextResponse.json({ bankAccount });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Failed to decrypt bank account:', error);
    return NextResponse.json(
      { error: 'Failed to decrypt bank account' },
      { status: 500 }
    );
  }
}
