import { z } from 'zod';

export type ValidationTranslate = (key: string) => string;

const defaultT: ValidationTranslate = (k) => k;

export function createItemSchema(t: ValidationTranslate = defaultT) {
  return z.object({
    sku: z.string().optional(),
    nameId: z.string().min(1, t('itemNameIdRequired')),
    nameEn: z.string().min(1, t('itemNameEnRequired')),
    type: z.enum(['FABRIC', 'ACCESSORIES', 'FINISHED_GOOD']),
    uomId: z.string().min(1, t('selectUom')),
    description: z.string().optional(),
    variants: z.array(z.record(z.string(), z.string())).optional(),
    reorderPoint: z.number().min(0).optional(),
  });
}

export const itemSchema = createItemSchema();

export const consumptionRuleSchema = z.object({
  materialId: z.string().uuid(),
  qtyRequired: z.number().positive(),
  wastePercent: z.number().min(0).max(100).default(0),
  notes: z.string().optional(),
});

export function createPoItemSchema(t: ValidationTranslate = defaultT) {
  return z.object({
    itemId: z.string().min(1, t('selectItem')),
    qty: z.number().positive(t('qtyPositive')),
    price: z.number().nonnegative(t('priceNonNegative')),
    uomId: z.string().min(1, t('selectUom')),
    notes: z.string().optional(),
  });
}

export const poItemSchema = createPoItemSchema();

export function createPoSchema(t: ValidationTranslate = defaultT) {
  const poItem = createPoItemSchema(t);
  return z.object({
    supplierId: z.string().min(1, t('selectSupplier')),
    etaDate: z.date().optional().nullable(),
    paymentDueDate: z.date().optional().nullable(),
    notes: z.string().optional(),
    terms: z.string().optional(),
    items: z.array(poItem).min(1, t('minOneItem')),
  });
}

export const poSchema = createPoSchema();
