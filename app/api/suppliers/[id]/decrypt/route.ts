import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { decryptBankAccount } from '@/lib/encryption';
import { logBankAccountView } from '@/lib/audit';
import { verifyPinForAction } from '@/app/actions/security/pin-auth';

const bodySchema = z.object({
  pin: z.string().min(4),
});

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
    const { pin } = bodySchema.parse(body);
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    const pinResult = await verifyPinForAction(
      session.user.id,
      pin,
      'VIEW_BANK_ACCOUNT',
      'User requested bank account view',
      ip
    );
    if (!pinResult.success) {
      return NextResponse.json(
        { error: pinResult.message },
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

    const bankAccount = decryptBankAccount(supplier.bankAccountEnc, 'DEFAULT_PIN');

    await logBankAccountView(
      session.user.id,
      id,
      { ip, userAgent },
      'User requested bank account view'
    );

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
