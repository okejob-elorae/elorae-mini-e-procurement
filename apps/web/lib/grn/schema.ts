import { z } from "zod";
import { hasAtMostTwoDecimals } from "./decimals";

export const GRN_MAX_ROLLS = 2000;
export const GRN_ROLL_TEXT_MAX = 191;
export const GRN_NOTES_MAX = 191;
export const GRN_MAX_PHOTOS = 10;
export const GRN_PHOTO_URL_MAX = 512;

export const grnItemSchema = z.object({
  itemId: z.string().min(1),
  variantSku: z.string().optional(),
  qty: z.number().positive(),
  unitCost: z.number().nonnegative(),
  uomId: z.string().min(1).optional(),
  rolls: z
    .array(
      z.object({
        rollRef: z.string().min(1).max(GRN_ROLL_TEXT_MAX),
        length: z.number().positive().refine(hasAtMostTwoDecimals, "At most 2 decimal places"),
        notes: z.string().max(GRN_ROLL_TEXT_MAX).optional(),
      })
    )
    .max(GRN_MAX_ROLLS)
    .optional(),
});

export const grnSchema = z.object({
  poId: z.string().min(1).optional(),
  supplierId: z.string().min(1),
  items: z.array(grnItemSchema).min(1),
  notes: z.string().max(GRN_NOTES_MAX).optional(),
  photoUrls: z.array(z.string().max(GRN_PHOTO_URL_MAX)).max(GRN_MAX_PHOTOS).optional(),
});
