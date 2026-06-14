/**
 * Client-safe enum constants. Mirror Prisma schema enums.
 * Use this in client components instead of @prisma/client to avoid
 * bundling Prisma (and its .prisma/client resolution) in the browser.
 */

export const Role = {
  ADMIN: 'ADMIN',
  PURCHASER: 'PURCHASER',
  WAREHOUSE: 'WAREHOUSE',
  PRODUCTION: 'PRODUCTION',
  USER: 'USER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ItemType = {
  FABRIC: 'FABRIC',
  ACCESSORIES: 'ACCESSORIES',
  FINISHED_GOOD: 'FINISHED_GOOD',
} as const;
export type ItemType = (typeof ItemType)[keyof typeof ItemType];

export const POStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  PARTIAL: 'PARTIAL',
  CLOSED: 'CLOSED',
  OVER: 'OVER',
  CANCELLED: 'CANCELLED',
} as const;
export type POStatus = (typeof POStatus)[keyof typeof POStatus];

export const WOStatus = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  IN_PRODUCTION: 'IN_PRODUCTION',
  PARTIAL: 'PARTIAL',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type WOStatus = (typeof WOStatus)[keyof typeof WOStatus];

export const ReturnStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  PROCESSED: 'PROCESSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ReturnStatus = (typeof ReturnStatus)[keyof typeof ReturnStatus];

export const DocType = {
  PO: 'PO',
  GRN: 'GRN',
  WO: 'WO',
  ADJ: 'ADJ',
  RET: 'RET',
  ISSUE: 'ISSUE',
  RECEIPT: 'RECEIPT',
} as const;
export type DocType = (typeof DocType)[keyof typeof DocType];

export const SupplierStatus = {
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  ACTIVE: 'ACTIVE',
  REJECTED: 'REJECTED',
} as const;
export type SupplierStatus = (typeof SupplierStatus)[keyof typeof SupplierStatus];

export const SalesChannel = {
  SHOPEE: "SHOPEE",
  TOKOPEDIA: "TOKOPEDIA",
  TIKTOK: "TIKTOK",
  OTHER: "OTHER",
} as const;
export type SalesChannel = (typeof SalesChannel)[keyof typeof SalesChannel];
export const SALES_CHANNEL_VALUES = Object.values(SalesChannel);

export const SalesOrderStatus = {
  NEW: "NEW",
  PROCESSING: "PROCESSING",
  SHIPPED: "SHIPPED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  RETURNED: "RETURNED",
} as const;
export type SalesOrderStatus = (typeof SalesOrderStatus)[keyof typeof SalesOrderStatus];
export const SALES_ORDER_STATUS_VALUES = Object.values(SalesOrderStatus);

export const SalesOrderFulfillmentStatus = {
  PENDING: "PENDING",
  PICKED: "PICKED",
  PACKED: "PACKED",
  SHIPPED: "SHIPPED",
} as const;
export type SalesOrderFulfillmentStatus =
  (typeof SalesOrderFulfillmentStatus)[keyof typeof SalesOrderFulfillmentStatus];
export const SALES_ORDER_FULFILLMENT_STATUS_VALUES = Object.values(SalesOrderFulfillmentStatus);
