import { z } from 'zod';
import { prisma } from '@elorae/db';
import { normalTcx } from '@/lib/tampilan/warna-pilihan';
import { ambilPantone } from '@/lib/tampilan/warna-pantone-queries';

/**
 * Warna jenis (pemilik 2026-10-09): kode Pantone TCX dari katalog, atau null/"" = otomatis. Hex-nya
 * diambil dari katalog oleh penulis di bawah, tidak pernah dari peramban.
 */
const pantoneJenis = z
  .union([z.string(), z.null()])
  .transform((v, ctx) => {
    if (v === null || v.trim() === "") return null;
    const tcx = normalTcx(v);
    if (!tcx) {
      ctx.addIssue({ code: "custom", message: "Warna harus kode Pantone TCX, mis. 19-4052" });
      return z.NEVER;
    }
    return tcx;
  });

export const createSupplierTypeSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1),
  colorTcx: pantoneJenis.optional(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional(),
});

export const updateSupplierTypeSchema = createSupplierTypeSchema.partial();

/**
 * Penolakan yang bisa dijelaskan ke pengguna. Pesannya tetap bahasa Inggris
 * seperti sebelumnya (dipakai rute API); layar membaca `code`, karena pesan
 * galat aksi server disamarkan jadi digest di produksi.
 */
export class SupplierTypeError extends Error {
  constructor(
    readonly code: "DUPLICATE_CODE" | "IN_USE" | "UNKNOWN_PANTONE",
    message: string,
    readonly count = 0,
  ) {
    super(message);
    this.name = "SupplierTypeError";
  }
}

/**
 * Kolom warna untuk ditulis: undefined = tidak diubah; null = otomatis; kode = hex dari katalog.
 * Kode yang tidak ada di katalog ditolak, bukan disimpan tanpa warna.
 */
async function kolomWarna(colorTcx: string | null | undefined): Promise<{ color: string | null; colorTcx: string | null } | undefined> {
  if (colorTcx === undefined) return undefined;
  if (colorTcx === null) return { color: null, colorTcx: null };
  const w = (await ambilPantone([colorTcx])).get(colorTcx);
  if (!w) throw new SupplierTypeError("UNKNOWN_PANTONE", "Unknown Pantone code");
  return { color: w.hex, colorTcx: w.tcx };
}

/** Kode selalu huruf besar tanpa spasi tepi — "fabric " dan "FABRIC" adalah jenis yang sama. */
function rapikanKode(code: string): string {
  return code.trim().toUpperCase();
}

export async function createSupplierType(input: z.infer<typeof createSupplierTypeSchema>) {
  const validated = createSupplierTypeSchema.parse({ ...input, code: rapikanKode(input.code ?? "") });
  const existing = await prisma.supplierType.findUnique({ where: { code: validated.code } });
  if (existing) throw new SupplierTypeError("DUPLICATE_CODE", "A supplier type with this code already exists");
  const warna = await kolomWarna(validated.colorTcx);
  return prisma.supplierType.create({
    data: {
      code: validated.code,
      name: validated.name,
      color: warna?.color ?? null,
      colorTcx: warna?.colorTcx ?? null,
      isActive: validated.isActive,
      sortOrder: validated.sortOrder,
    },
  });
}

export async function updateSupplierType(
  id: string,
  input: z.infer<typeof updateSupplierTypeSchema>
) {
  const validated = updateSupplierTypeSchema.parse(
    input.code === undefined ? input : { ...input, code: rapikanKode(input.code) },
  );
  if (validated.code) {
    const existing = await prisma.supplierType.findFirst({
      where: { code: validated.code, id: { not: id } },
    });
    if (existing) throw new SupplierTypeError("DUPLICATE_CODE", "A supplier type with this code already exists");
  }
  const { colorTcx, ...lain } = validated;
  const warna = await kolomWarna(colorTcx);
  return prisma.supplierType.update({ where: { id }, data: { ...lain, ...(warna ?? {}) } });
}

export async function deleteSupplierType(id: string) {
  const inUse = await prisma.supplier.count({ where: { typeId: id } });
  if (inUse > 0) throw new SupplierTypeError("IN_USE", "Cannot delete supplier type in use", inUse);
  await prisma.supplierType.delete({ where: { id } });
}
