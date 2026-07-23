export const POSTING_ROLES = [
  "INVENTORY",
  "AP",
  "AR",
  "SALES_REVENUE",
  "COGS",
  "BANK",
  "MARKETPLACE_FEE",
  "INVENTORY_VARIANCE",
  "TAX",
] as const;

export type PostingRole = (typeof POSTING_ROLES)[number];
