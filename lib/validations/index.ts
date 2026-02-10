import { z } from 'zod';

export const itemSchema = z.object({
  sku: z.string().optional(),
  nameId: z.string().min(1, 'Nama item wajib diisi'),
  nameEn: z.string().min(1, 'Item name is required'),
  type: z.enum(['FABRIC', 'ACCESSORIES', 'FINISHED_GOOD']),
  uomId: z.string().min(1, 'Pilih satuan'),
  description: z.string().optional(),
  variants: z.array(z.record(z.string(), z.string())).optional(),
  reorderPoint: z.number().min(0).optional(),
});

export const consumptionRuleSchema = z.object({
  materialId: z.string().uuid(),
  qtyRequired: z.number().positive(),
  wastePercent: z.number().min(0).max(100).default(0),
  notes: z.string().optional(),
});

export const poItemSchema = z.object({
  itemId: z.string().min(1, 'Pilih item'),
  qty: z.number().positive('Qty harus lebih dari 0'),
  price: z.number().nonnegative('Harga tidak boleh negatif'),
  uomId: z.string().min(1, 'Pilih satuan'),
  notes: z.string().optional(),
});

export const poSchema = z.object({
  supplierId: z.string().min(1, 'Pilih supplier'),
  etaDate: z.date().optional().nullable(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  items: z.array(poItemSchema).min(1, 'Minimal 1 item'),
});
