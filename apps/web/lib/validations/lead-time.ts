import { z } from "zod";

export const processTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    leadTimeType: z.enum(["FIXED", "PER_QTY"]),
    days: z.number().int().min(1),
    rateQty: z.number().int().min(1).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    sortOrder: z.number().int().min(0).optional(),
    isApproval: z.boolean().optional(),
    sopInstructions: z.string().max(5000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.leadTimeType === "PER_QTY") {
      if (data.rateQty == null || data.rateQty < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rateQty"],
          message: "rateQty is required for PER_QTY",
        });
      }
    }
  });

export const updateProcessTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    leadTimeType: z.enum(["FIXED", "PER_QTY"]).optional(),
    days: z.number().int().min(1).optional(),
    rateQty: z.number().int().min(1).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    sortOrder: z.number().int().min(0).optional(),
    isApproval: z.boolean().optional(),
    sopInstructions: z.string().max(5000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.leadTimeType === "PER_QTY" && data.rateQty != null && data.rateQty < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rateQty"],
        message: "rateQty must be >= 1",
      });
    }
  });

export const supplierProcessSchema = z.object({
  supplierId: z.string().cuid(),
  processTemplateId: z.string().cuid(),
  overrideDays: z.number().int().min(1).optional().nullable(),
  overrideRateQty: z.number().int().min(1).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const updateSupplierProcessSchema = z.object({
  overrideDays: z.number().int().min(1).optional().nullable(),
  overrideRateQty: z.number().int().min(1).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const confirmPositionSchema = z.object({
  docType: z.enum(["PO", "WO"]).default("PO"),
  docId: z.string().cuid().optional(),
  poId: z.string().cuid().optional(),
  stepIndex: z.number().int().min(0).nullable(),
}).superRefine((data, ctx) => {
  if (!data.docId && !data.poId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["docId"],
      message: "docId or poId required",
    });
  }
});

export const reorderChainSchema = z.object({
  supplierId: z.string().cuid(),
  orderedStepIds: z.array(z.string().cuid()).min(1),
});

export const chainTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).optional().nullable(),
  steps: z
    .array(
      z.object({
        processTemplateId: z.string().cuid(),
        notes: z.string().max(500).optional().nullable(),
      })
    )
    .min(1),
});

export const updateChainTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(2000).optional().nullable(),
  steps: z
    .array(
      z.object({
        processTemplateId: z.string().cuid(),
        notes: z.string().max(500).optional().nullable(),
      })
    )
    .min(1)
    .optional(),
});

export const applyChainTemplateSchema = z.object({
  supplierId: z.string().cuid(),
  chainTemplateId: z.string().cuid(),
  mode: z.enum(["REPLACE", "APPEND"]),
});
