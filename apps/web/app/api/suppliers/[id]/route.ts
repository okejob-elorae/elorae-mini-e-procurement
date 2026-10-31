import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { prisma } from '@elorae/db';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { verifyPin } from '@/lib/security/pin';
import {
  decryptSupplierBankAccount,
  deleteSupplier,
  SUPPLIER_DELETE_BLOCKED,
  supplierUpdateSchema,
  updateSupplier,
} from '@/lib/suppliers/mutations';

/*
 * Izin dan PIN di sini SAMA dengan aksinya (`app/actions/suppliers.ts`):
 * hapus = `suppliers:delete` + PIN, buka rekening = `suppliers:view` + PIN, dan
 * PIN selalu lewat penjaga yang dibatasi percobaannya. Dulu DELETE tanpa PIN,
 * jadi rute ini adalah jalan memutar di sekitar penjaga aksinya.
 */
const pinSchema = z.object({
  pin: z.string().min(4),
});

/** 403 bila izin kurang — DI LUAR try, supaya tidak tertelan menjadi 500. */
function tolakTanpaIzin(permissions: string[] | undefined, kode: string): NextResponse | null {
  if (hasPermission(permissions ?? [], kode)) return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/** PIN ditolak: kuncian → 429, selain itu 403. Kuncinya dari namespace `security`. */
function tolakanPin(messageKey: string | undefined): NextResponse {
  const status = messageKey === 'tooManyAttempts' ? 429 : 403;
  return NextResponse.json({ error: messageKey ?? 'pinIncorrect' }, { status });
}

function ipDari(req: NextRequest): string {
  return req.headers.get('x-forwarded-for') || 'unknown';
}

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
    const tanpaIzin = tolakTanpaIzin(session.user.permissions, PERMISSIONS.SUPPLIERS_VIEW);
    if (tanpaIzin) return tanpaIzin;

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        type: { select: { id: true, code: true, name: true, color: true } },
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
      npwpEnc: supplier.npwpEnc ? '***ENCRYPTED***' : null,
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
    const tanpaIzin = tolakTanpaIzin(session.user.permissions, PERMISSIONS.SUPPLIERS_EDIT);
    if (tanpaIzin) return tanpaIzin;

    const body = await req.json();
    const validated = supplierUpdateSchema.parse(body);

    let supplier;
    try {
      supplier = await updateSupplier(id, validated);
    } catch (error) {
      if (error instanceof Error && error.message === 'Supplier code already exists') {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

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

// DELETE /api/suppliers/[id] - Hapus pemasok (body: { pin })
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
    // Izin dulu, baru PIN: tanpa `suppliers:delete` tidak ada tebakan PIN yang dihitung.
    const tanpaIzin = tolakTanpaIzin(session.user.permissions, PERMISSIONS.SUPPLIERS_DELETE);
    if (tanpaIzin) return tanpaIzin;

    const isian = pinSchema.safeParse(await req.json().catch(() => null));
    if (!isian.success) {
      return NextResponse.json({ error: 'pinInvalid' }, { status: 400 });
    }

    const pinResult = await verifyPin(session.user.id, isian.data.pin, 'DELETE_SUPPLIER', {
      ipAddress: ipDari(req),
    });
    if (!pinResult.success) return tolakanPin(pinResult.messageKey);

    try {
      await deleteSupplier(id);
    } catch (error) {
      if (error instanceof Error && error.message === SUPPLIER_DELETE_BLOCKED) {
        return NextResponse.json(
          { error: 'This supplier cannot be deleted because it is still linked to existing records.' },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete supplier:', error);
    return NextResponse.json(
      { error: 'Failed to delete supplier' },
      { status: 500 }
    );
  }
}

// POST /api/suppliers/[id] - Buka nomor rekening (body: { pin })
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
    // Izin dulu, baru PIN: tanpa `suppliers:view` tidak ada tebakan PIN yang dihitung.
    const tanpaIzin = tolakTanpaIzin(session.user.permissions, PERMISSIONS.SUPPLIERS_VIEW);
    if (tanpaIzin) return tanpaIzin;

    const isian = pinSchema.safeParse(await req.json().catch(() => null));
    if (!isian.success) {
      return NextResponse.json({ error: 'pinInvalid' }, { status: 400 });
    }

    const ip = ipDari(req);
    const pinResult = await verifyPin(session.user.id, isian.data.pin, 'VIEW_BANK_ACCOUNT', {
      ipAddress: ip,
    });
    if (!pinResult.success) return tolakanPin(pinResult.messageKey);

    let bankAccount: string;
    try {
      bankAccount = await decryptSupplierBankAccount(id, session.user.id, {
        ip,
        userAgent: req.headers.get('user-agent') || 'unknown',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Bank account not found') {
        return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ bankAccount });
  } catch (error) {
    console.error('Failed to decrypt bank account:', error);
    return NextResponse.json(
      { error: 'Failed to decrypt bank account' },
      { status: 500 }
    );
  }
}
