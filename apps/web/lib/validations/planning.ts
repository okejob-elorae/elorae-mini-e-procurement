import { z } from "zod";
import { parseItemVariants, variantSelectOptions } from "@/lib/items/variants";

export const createPlanYearSchema = z.object({
  year: z.number().int().min(2000).max(3000),
  notes: z.string().optional(),
});

export const createPlanCategorySchema = z
  .object({
    planYearId: z.string().min(1),
    code: z.string().min(1).max(50).optional(),
    name: z.string().min(1).max(200).optional(),
    itemCategoryId: z.string().optional().nullable(),
    description: z.string().optional(),
    parentId: z.string().optional().nullable(),
    targetQty: z.number().int().min(0).optional().nullable(),
    parentSharePercent: z.number().min(0).max(100).optional().nullable(),
    itemId: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (!data.parentId) {
      if (!data.itemCategoryId) {
        ctx.addIssue({
          code: "custom",
          message: "Parent category requires itemCategoryId",
          path: ["itemCategoryId"],
        });
      }
      if (data.targetQty == null || data.targetQty < 0) {
        ctx.addIssue({
          code: "custom",
          message: "Parent category requires targetQty",
          path: ["targetQty"],
        });
      }
      if (data.parentSharePercent != null) {
        ctx.addIssue({
          code: "custom",
          message: "Parent cannot have parentSharePercent",
          path: ["parentSharePercent"],
        });
      }
    } else {
      if (!data.code) {
        ctx.addIssue({
          code: "custom",
          message: "Child category requires code",
          path: ["code"],
        });
      }
      if (!data.name) {
        ctx.addIssue({
          code: "custom",
          message: "Child category requires name",
          path: ["name"],
        });
      }
      if (data.itemCategoryId) {
        ctx.addIssue({
          code: "custom",
          message: "Child cannot link to item category master",
          path: ["itemCategoryId"],
        });
      }
      if (data.parentSharePercent == null || data.parentSharePercent <= 0) {
        ctx.addIssue({
          code: "custom",
          message: "Child requires parentSharePercent > 0",
          path: ["parentSharePercent"],
        });
      }
      if (data.targetQty != null) {
        ctx.addIssue({
          code: "custom",
          message: "Child cannot have targetQty",
          path: ["targetQty"],
        });
      }
    }
  });

export const updatePlanCategorySchema = z.object({
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  targetQty: z.number().int().min(0).nullable().optional(),
  parentSharePercent: z.number().min(0).max(100).nullable().optional(),
  itemId: z.string().nullable().optional(),
});

export const updateMonthlyTargetSchema = z.object({
  planCategoryId: z.string().min(1),
  month: z.number().int().min(1).max(12),
  targetQty: z.number().int().min(0),
  notes: z.string().optional(),
});

export const createPlanStageSchema = z.object({
  planCategoryId: z.string().min(1),
  name: z.string().min(1).max(200),
  targetQty: z.number().int().positive(),
  targetMonth: z.number().int().min(1).max(12).optional().nullable(),
  variantSku: z.string().trim().max(191).optional().nullable(),
  supplierId: z.string().optional().nullable(),
  fabricNotes: z.string().optional(),
  colorNotes: z.string().optional(),
});

export const updatePlanStageSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  targetQty: z.number().int().positive().optional(),
  targetMonth: z.number().int().min(1).max(12).nullable().optional(),
  variantSku: z.string().trim().max(191).nullable().optional(),
  supplierId: z.string().nullable().optional(),
  fabricNotes: z.string().nullable().optional(),
  colorNotes: z.string().nullable().optional(),
});

/*
 * Tahap Plan Kerja yang sudah berjalan (2026-10-07).
 *
 * "Buat WO dari tahap" dan jadwal produksi tetap boleh walau plan sudah AKTIF
 * dan terkunci — tahap adalah pekerjaan berjalan. Masukan WO (varian, penjahit)
 * dan bulan target (pengelompokan di tab Kalender) karena itu juga tetap boleh
 * diubah; nama dan qty tetap terkunci bersama plan. Varian dan penjahit tidak
 * boleh berubah lagi begitu tahap punya WO yang masih hidup (tidak CANCELLED),
 * karena WO itu dibuat dengan varian dan penjahit tersebut.
 */
export const KOLOM_TAHAP_BERJALAN = ["variantSku", "targetMonth", "supplierId"] as const;
export type KolomTahapBerjalan = (typeof KOLOM_TAHAP_BERJALAN)[number];

export const kolomTahapBerjalan = (kolom: string): kolom is KolomTahapBerjalan =>
  (KOLOM_TAHAP_BERJALAN as readonly string[]).includes(kolom);

/** Isian varian tahap: `undefined` = tidak diubah, kosong/spasi = dikosongkan (`null`). */
export function rapikanVarianTahap(nilai: string | null | undefined): string | null | undefined {
  if (nilai === undefined) return undefined;
  const sku = (nilai ?? "").trim();
  return sku === "" ? null : sku;
}

/** SKU varian tahap harus salah satu varian barang jadi yang terhubung ke jenis (leaf) itu. */
export function varianTahapSah(sku: string, variantsBarang: unknown): boolean {
  return variantSelectOptions(parseItemVariants(variantsBarang)).some((v) => v.sku === sku);
}

/**
 * Penolakan mengubah tahap yang sudah ada:
 *  - plan tidak lagi DRAFT/terbuka → hanya `KOLOM_TAHAP_BERJALAN` yang boleh berubah;
 *  - varian (kapan pun) dan penjahit (saat plan terkunci) tidak boleh berubah
 *    selama tahap punya WO hidup.
 * `kolomBerubah` = kolom yang nilainya BENAR-BENAR berbeda dari yang tersimpan.
 */
export function tolakUbahTahap(o: {
  planBisaDiubah: boolean;
  kolomBerubah: readonly string[];
  woHidup: boolean;
}): "PLAN_TERKUNCI" | "SUDAH_ADA_WO" | null {
  if (!o.planBisaDiubah && o.kolomBerubah.some((k) => !kolomTahapBerjalan(k))) return "PLAN_TERKUNCI";
  if (
    o.woHidup &&
    (o.kolomBerubah.includes("variantSku") || (!o.planBisaDiubah && o.kolomBerubah.includes("supplierId")))
  ) {
    return "SUDAH_ADA_WO";
  }
  return null;
}

export const monthlyColorAllocationRowSchema = z.object({
  variantSku: z.string().min(1),
  colorLabel: z.string().optional(),
  allocatedQty: z.number().int().min(0),
  notes: z.string().optional(),
});

export const upsertMonthlyColorAllocationsSchema = z.object({
  planCategoryId: z.string().min(1),
  month: z.number().int().min(1).max(12),
  allocations: z.array(monthlyColorAllocationRowSchema),
});

export const colorAllocationRowSchema = monthlyColorAllocationRowSchema;

export const upsertColorAllocationsSchema = z.object({
  planCategoryId: z.string().min(1),
  month: z.number().int().min(1).max(12).default(1),
  allocations: z.array(colorAllocationRowSchema),
});

export const monthlyCmtAllocationRowSchema = z.object({
  supplierId: z.string().min(1),
  allocatedQty: z.number().int().min(0),
  notes: z.string().optional(),
});

export const upsertMonthlyCmtAllocationsSchema = z.object({
  planCategoryId: z.string().min(1),
  month: z.number().int().min(1).max(12),
  variantSku: z.string().min(1),
  allocations: z.array(monthlyCmtAllocationRowSchema),
});

export const cmtAllocationRowSchema = monthlyCmtAllocationRowSchema;

export const upsertCmtAllocationsSchema = z.object({
  planCategoryId: z.string().min(1),
  month: z.number().int().min(1).max(12).default(1),
  variantSku: z.string().min(1).default("__LEGACY__"),
  allocations: z.array(cmtAllocationRowSchema),
});

export const accessoryPlanRowSchema = z.object({
  itemId: z.string().min(1),
  qtyPerPcs: z.number().positive(),
  notes: z.string().optional(),
});

export const upsertAccessoryPlansSchema = z.object({
  planCategoryId: z.string().min(1),
  plans: z.array(accessoryPlanRowSchema),
});

export const excelMonthlyColorRowSchema = z.object({
  code: z.string().min(1),
  month: z.number().int().min(1).max(12),
  variantSku: z.string().min(1),
  qty: z.number().int().min(0),
});

export const excelMonthlyCmtRowSchema = z.object({
  code: z.string().min(1),
  month: z.number().int().min(1).max(12),
  variantSku: z.string().min(1),
  supplierCode: z.string().min(1),
  qty: z.number().int().min(0),
});

export const excelPlanRowSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  parentCode: z.string().optional(),
  itemCategoryCode: z.string().optional(),
  targetQty: z.number().optional().nullable(),
  parentSharePercent: z.number().optional().nullable(),
  itemSku: z.string().optional().nullable(),
});
