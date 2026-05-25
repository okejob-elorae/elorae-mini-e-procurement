import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { prisma } from '@elorae/db';
import { encryptBankAccount } from '@/lib/encryption';
import { generateSupplierCode } from '@/lib/docNumber';
import { createPurchaseOrderFromOfflinePayload } from '@/lib/purchase-orders/mutations';

export const dynamic = 'force-dynamic';

// POST /api/sync - Process offline operations
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const operation = await req.json();

    switch (operation.type) {
      case 'SUPPLIER_CREATE':
        return await handleSupplierCreate(operation.payload);
      case 'SUPPLIER_UPDATE':
        return await handleSupplierUpdate(operation.payload);
      case 'PO_CREATE':
        return await handlePOCreate(operation.payload, session.user.id);
      default:
        return NextResponse.json(
          { error: 'Unknown operation type' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Sync operation failed:', error);
    return NextResponse.json(
      { error: 'Sync operation failed' },
      { status: 500 }
    );
  }
}

async function handleSupplierCreate(payload: any) {
  try {
    const code = await generateSupplierCode();

    let bankAccountEnc = null;
    if (payload.bankAccount) {
      bankAccountEnc = encryptBankAccount(payload.bankAccount, 'DEFAULT_PIN');
    }

    const supplier = await prisma.supplier.create({
      data: {
        code,
        name: payload.name,
        typeId: payload.typeId,
        address: payload.address,
        phone: payload.phone,
        email: payload.email,
        bankName: payload.bankName,
        bankAccountEnc,
        bankAccountName: payload.bankAccountName,
      },
    });

    return NextResponse.json({ success: true, data: supplier });
  } catch (error) {
    console.error('Failed to sync supplier create:', error);
    return NextResponse.json(
      { error: 'Failed to create supplier' },
      { status: 500 }
    );
  }
}

async function handleSupplierUpdate(payload: any) {
  try {
    const { id, ...rest } = { ...payload };
    delete rest.categoryId;

    let bankAccountEnc = undefined;
    if (rest.bankAccount) {
      bankAccountEnc = encryptBankAccount(rest.bankAccount, 'DEFAULT_PIN');
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        ...rest,
        bankAccountEnc,
      },
    });

    return NextResponse.json({ success: true, data: supplier });
  } catch (error) {
    console.error('Failed to sync supplier update:', error);
    return NextResponse.json(
      { error: 'Failed to update supplier' },
      { status: 500 }
    );
  }
}

async function handlePOCreate(payload: any, userId: string) {
  try {
    const po = await createPurchaseOrderFromOfflinePayload(payload, userId);
    return NextResponse.json({ success: true, data: po });
  } catch (error) {
    console.error('Failed to sync PO create:', error);
    return NextResponse.json(
      { error: 'Failed to create purchase order' },
      { status: 500 }
    );
  }
}
