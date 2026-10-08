import { z } from 'zod';
import { prisma } from '@elorae/db';
import { encryptBankAccount, decryptBankAccount } from '@/lib/encryption';
import { generateSupplierCode } from '@/lib/docNumber';
import { logBankAccountView } from '@/lib/audit';

/**
 * Data pajak pemasok (akuntansi & pajak lengkap): status PKP (null = belum
 * diisi), jenis potongan PPh atas pembayarannya, punya NPWP atau tidak, dan
 * NPWP/NIK-nya. Dipakai pembayaran pemasok (potongan bawaan) dan ongkos jasa
 * produksi (pemasok bukan PKP tidak memungut PPN).
 */
const pajakPemasokSchema = {
  isPkp: z.boolean().nullable().optional(),
  taxWithholding: z.enum(['PPH23', 'PPH21', 'PPH4_2']).nullable().optional(),
  hasNpwp: z.boolean().optional(),
  npwp: z.string().max(32).optional(),
};

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
  ...pajakPemasokSchema,
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
  ...pajakPemasokSchema,
});

/**
 * NPWP/NIK pemasok untuk bukti potong PPh — dienkripsi (AES-GCM kunci server,
 * konteks `supplier:<id>:npwp`, sama dengan data sensitif KOL); hanya 4 digit
 * terakhirnya yang tersimpan terbuka. Kosong = tidak diubah.
 */
/** Angka NPWP/NIK ('' = tidak diisi). Melempar sebelum ada yang ditulis bila panjangnya salah. */
function angkaNpwp(npwp: string | undefined): string {
  const angka = (npwp ?? '').replace(/\D/g, '');
  if (angka && angka.length !== 15 && angka.length !== 16) throw new Error('NPWP harus 15 atau 16 digit');
  return angka;
}

async function simpanNpwpPemasok(id: string, npwp: string | undefined) {
  const angka = angkaNpwp(npwp);
  if (!angka) return;
  const { enkripsi } = await import('@/lib/creative/data-sensitif');
  await prisma.supplier.update({
    where: { id },
    data: { npwpEnc: enkripsi(angka, `supplier:${id}:npwp`), npwpLast4: angka.slice(-4), hasNpwp: true },
  });
}

export async function createSupplier(input: z.infer<typeof supplierSchema>) {
  const validated = supplierSchema.parse(input);
  angkaNpwp(validated.npwp);

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

  const dibuat = await prisma.supplier.create({
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
      ...(validated.isPkp !== undefined ? { isPkp: validated.isPkp } : {}),
      ...(validated.taxWithholding !== undefined ? { taxWithholding: validated.taxWithholding } : {}),
      ...(validated.hasNpwp !== undefined ? { hasNpwp: validated.hasNpwp } : {}),
      status: 'PENDING_APPROVAL',
    },
  });
  if (validated.npwp?.trim()) await simpanNpwpPemasok(dibuat.id, validated.npwp);
  return dibuat;
}

export async function updateSupplier(id: string, input: z.infer<typeof supplierUpdateSchema>) {
  const validated = supplierUpdateSchema.parse(input);
  const { bankAccount, code: codeInput, npwp, ...rest } = validated;
  angkaNpwp(npwp);

  const data: Parameters<typeof prisma.supplier.update>[0]['data'] = { ...rest };
  // Tanpa NPWP → hapus NPWP tersimpan (bukti potong memakai tarif tanpa NPWP).
  if (rest.hasNpwp === false) {
    data.npwpEnc = null;
    data.npwpLast4 = null;
  }
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

  const diubah = await prisma.supplier.update({ where: { id }, data });
  if (npwp?.trim() && rest.hasNpwp !== false) await simpanNpwpPemasok(id, npwp);
  return diubah;
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
