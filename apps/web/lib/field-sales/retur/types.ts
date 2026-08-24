/**
 * Shared retur line shape. It lives in its own module rather than in `writer.ts` because the
 * route's spec mocks the whole writer module — importing the reason list from there would
 * make it `undefined` under test and blow up at module load.
 */
export const FIELD_RETURN_REASONS = ["DAMAGED", "UNSOLD", "EXPIRED", "OTHER"] as const;

export type FieldReturnReasonInput = (typeof FIELD_RETURN_REASONS)[number];

export type FieldReturnLineInput = {
  itemId: string;
  variantSku: string;
  qty: number;
  reason: FieldReturnReasonInput;
  reasonNote?: string | null;
};
