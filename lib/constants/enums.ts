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
