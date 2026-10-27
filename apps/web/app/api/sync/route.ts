import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { prisma } from '@elorae/db';
import { encryptBankAccount } from '@/lib/encryption';
import { generateSupplierCode } from '@/lib/docNumber';
import { createPurchaseOrderFromOfflinePayload } from '@/lib/purchase-orders/mutations';
import { parsePaymentTermsDays } from "@/lib/purchase-orders/payment-terms";
import { updateSupplier, supplierUpdateSchema } from "@/lib/suppliers/mutations";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";

export const dynamic = 'force-dynamic';

// POST /api/sync - Process offline operations
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const operation = await req.json();
    const permissions = session.user.permissions ?? [];

    /* Each case is gated on the permission its online counterpart action enforces. */
    switch (operation.type) {
      case 'SUPPLIER_CREATE':
        if (!hasPermission(permissions, PERMISSIONS.SUPPLIERS_CREATE)) return forbidden();
        return await handleSupplierCreate(operation.payload);
      case 'SUPPLIER_UPDATE':
        if (!hasPermission(permissions, PERMISSIONS.SUPPLIERS_EDIT)) return forbidden();
        return await handleSupplierUpdate(operation.payload);
      case 'PO_CREATE':
        if (!hasPermission(permissions, PERMISSIONS.PURCHASE_ORDERS_CREATE)) return forbidden();
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

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

async function handleSupplierCreate(payload: any) {
  try {
    const terms = parsePaymentTermsDays(payload.paymentTermsDays ?? null);
    if (!terms.ok) {
      return NextResponse.json(
        { error: "Payment terms must be a whole number of days from 0 to 365" },
        { status: 400 }
      );
    }

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
        paymentTermsDays: terms.value,
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
    const id = payload?.id;
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Validation error" }, { status: 400 });
    }

    /* Same schema and writer as PUT /api/suppliers/[id]: unlisted columns, `id` and `status` included, are dropped. */
    const parsed = supplierUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.issues },
        { status: 400 }
      );
    }

    let supplier;
    try {
      supplier = await updateSupplier(id, parsed.data);
    } catch (error) {
      if (error instanceof Error && error.message === "Supplier code already exists") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

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
