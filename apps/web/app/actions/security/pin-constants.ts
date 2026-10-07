export const SENSITIVE_ACTIONS = [
  'VIEW_BANK_ACCOUNT',
  'STOCK_ADJUSTMENT',
  'VOID_DOCUMENT',
  'EDIT_POSTED_PO',
  'DELETE_SUPPLIER',
  'VIEW_KOL_SENSITIVE',
] as const;

export type SensitiveAction = (typeof SENSITIVE_ACTIONS)[number];
