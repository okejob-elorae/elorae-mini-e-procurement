import { z } from "zod";

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
  supplierId: z.string().optional().nullable(),
  fabricNotes: z.string().optional(),
  colorNotes: z.string().optional(),
});

export const updatePlanStageSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  targetQty: z.number().int().positive().optional(),
  targetMonth: z.number().int().min(1).max(12).nullable().optional(),
  supplierId: z.string().nullable().optional(),
  fabricNotes: z.string().nullable().optional(),
  colorNotes: z.string().nullable().optional(),
});

export const colorAllocationRowSchema = z.object({
  colorName: z.string().min(1),
  colorCode: z.string().optional(),
  allocatedQty: z.number().int().min(0),
  notes: z.string().optional(),
});

export const upsertColorAllocationsSchema = z.object({
  planCategoryId: z.string().min(1),
  allocations: z.array(colorAllocationRowSchema),
});

export const cmtAllocationRowSchema = z.object({
  supplierId: z.string().min(1),
  allocatedQty: z.number().int().min(0),
  notes: z.string().optional(),
});

export const upsertCmtAllocationsSchema = z.object({
  planCategoryId: z.string().min(1),
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
