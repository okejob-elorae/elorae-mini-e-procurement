import { z } from 'zod';
import { prisma } from '@elorae/db';
import { encryptBankAccount, decryptBankAccount } from '@/lib/encryption';
import { generateSupplierCode } from '@/lib/docNumber';
import { logBankAccountView } from '@/lib/audit';

export const supplierSchema = z.object({
  code: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    z.string().min(1).optional()
  ),
  name: z.string().min(1),
  typeId: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    z.string().email().optional()
  ),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankAccountName: z.string().optional(),
});

export const supplierUpdateSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  typeId: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    z.string().email().optional()
  ),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankAccountName: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function createSupplier(input: z.infer<typeof supplierSchema>) {
  const validated = supplierSchema.parse(input);

  let code: string;
  if (validated.code?.trim()) {
    code = validated.code.trim();
    const existing = await prisma.supplier.findUnique({ where: { code } });
    if (existing) throw new Error('Supplier code already exists');
  } else {
    code = await generateSupplierCode();
  }

  let bankAccountEnc: string | null = null;
  if (validated.bankAccount) {
    bankAccountEnc = encryptBankAccount(validated.bankAccount, 'DEFAULT_PIN');
  }

  return prisma.supplier.create({
    data: {
      code,
      name: validated.name,
      typeId: validated.typeId,
      address: validated.address,
      phone: validated.phone,
      email: validated.email,
      bankName: validated.bankName,
      bankAccountEnc,
      bankAccountName: validated.bankAccountName,
      status: 'PENDING_APPROVAL',
    },
  });
}

export async function updateSupplier(id: string, input: z.infer<typeof supplierUpdateSchema>) {
  const validated = supplierUpdateSchema.parse(input);
  const { bankAccount, code: codeInput, ...rest } = validated;

  const data: Parameters<typeof prisma.supplier.update>[0]['data'] = { ...rest };
  if (codeInput?.trim()) {
    const code = codeInput.trim();
    const existing = await prisma.supplier.findFirst({
      where: { code, id: { not: id } },
    });
    if (existing) throw new Error('Supplier code already exists');
    data.code = code;
  }
  if (bankAccount) {
    data.bankAccountEnc = encryptBankAccount(bankAccount, 'DEFAULT_PIN');
  }

  return prisma.supplier.update({ where: { id }, data });
}

export const SUPPLIER_DELETE_BLOCKED = 'SUPPLIER_DELETE_BLOCKED';

export async function deleteSupplier(id: string) {
  const [
    purchaseOrderCount,
    workOrderCount,
    workOrderStepCount,
    grnCount,
    vendorReturnCount,
    planCmtAllocationCount,
    planStageCount,
  ] = await Promise.all([
    prisma.purchaseOrder.count({ where: { supplierId: id } }),
    prisma.workOrder.count({ where: { vendorId: id } }),
    prisma.workOrderStep.count({ where: { supplierId: id } }),
    prisma.gRN.count({ where: { supplierId: id } }),
    prisma.vendorReturn.count({ where: { vendorId: id } }),
    prisma.planCmtAllocation.count({ where: { supplierId: id } }),
    prisma.planStage.count({ where: { supplierId: id } }),
  ]);

  const hasLinkedRecords =
    purchaseOrderCount > 0 ||
    workOrderCount > 0 ||
    workOrderStepCount > 0 ||
    grnCount > 0 ||
    vendorReturnCount > 0 ||
    planCmtAllocationCount > 0 ||
    planStageCount > 0;

  if (hasLinkedRecords) {
    throw new Error(SUPPLIER_DELETE_BLOCKED);
  }

  await prisma.supplier.delete({ where: { id } });
}

export async function approveSupplier(id: string, approvedById: string) {
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) throw new Error('Supplier not found');
  if (supplier.status !== 'PENDING_APPROVAL') {
    throw new Error('Supplier is not pending approval');
  }
  await prisma.supplier.update({
    where: { id },
    data: {
      status: 'ACTIVE',
      approvedById,
      approvedAt: new Date(),
      rejectionReason: null,
    },
  });
  return supplier;
}

export async function rejectSupplier(id: string, approvedById: string, reason: string) {
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) throw new Error('Supplier not found');
  if (supplier.status !== 'PENDING_APPROVAL') {
    throw new Error('Supplier is not pending approval');
  }
  await prisma.supplier.update({
    where: { id },
    data: {
      status: 'REJECTED',
      approvedById,
      approvedAt: new Date(),
      rejectionReason: reason,
    },
  });
}

export async function decryptSupplierBankAccount(
  id: string,
  userId: string,
  auditMeta: { ip: string; userAgent: string }
) {
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier?.bankAccountEnc) throw new Error('Bank account not found');
  const bankAccount = decryptBankAccount(supplier.bankAccountEnc, 'DEFAULT_PIN');
  await logBankAccountView(userId, id, auditMeta, 'User requested bank account view');
  return bankAccount;
}
