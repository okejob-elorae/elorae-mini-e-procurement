/**
 * Import-free on purpose: the Settings → Documents page is a client component, and pulling
 * Prisma's `DocType` from `@elorae/db` would drag the barrel into the browser bundle. The union
 * is restated by hand; `doc-type-groups.test.ts` pins it to Prisma's enum at runtime. The
 * `Record` below only makes a union member missing from the map a type error; a Prisma member
 * missing from the union is one because of the `Record<DocType, …>` pin that assigns this map in
 * `app/actions/settings/doc-numbers.ts`.
 */
export type DocTypeValue =
  | "PO"
  | "GRN"
  | "WO"
  | "ADJ"
  | "RET"
  | "ISSUE"
  | "RECEIPT"
  | "OPN"
  | "PUTUS"
  | "KONSI"
  | "VANLOAD"
  | "VANSALE"
  | "VANRECON"
  | "SPGSALE"
  | "DELIVERY"
  | "FIELDRET"
  | "KONSITRF"
  | "STOCKTAKE"
  | "PAYMENT"
  | "BKM"
  | "STORETRF"
  | "SELLTHRU"
  | "ITEMREQ"
  | "VENDOR_BILL"
  | "VENDOR_PAYMENT"
  | "CASHOUT"
  | "CASHIN"
  | "CASHTRF"
  | "SUPPAY"
  | "ASSET";

export type DocTypeGroup = "procurement" | "inventory" | "fieldSales" | "finance";

export const DOC_TYPE_GROUP_ORDER: readonly DocTypeGroup[] = ["procurement", "inventory", "fieldSales", "finance"];

/* Key order is display order within each group. */
export const DOC_TYPE_GROUP: Record<DocTypeValue, DocTypeGroup> = {
  PO: "procurement",
  GRN: "procurement",
  RET: "procurement",
  WO: "procurement",
  ISSUE: "procurement",
  RECEIPT: "procurement",
  ITEMREQ: "procurement",
  VENDOR_BILL: "procurement",
  ADJ: "inventory",
  OPN: "inventory",
  STOCKTAKE: "inventory",
  KONSITRF: "inventory",
  STORETRF: "inventory",
  PUTUS: "fieldSales",
  KONSI: "fieldSales",
  DELIVERY: "fieldSales",
  FIELDRET: "fieldSales",
  VANLOAD: "fieldSales",
  VANSALE: "fieldSales",
  VANRECON: "fieldSales",
  SPGSALE: "fieldSales",
  SELLTHRU: "fieldSales",
  PAYMENT: "finance",
  BKM: "finance",
  VENDOR_PAYMENT: "finance",
  SUPPAY: "finance",
  CASHOUT: "finance",
  CASHIN: "finance",
  CASHTRF: "finance",
  ASSET: "finance",
};

export function docTypesInGroup(group: DocTypeGroup): DocTypeValue[] {
  return (Object.keys(DOC_TYPE_GROUP) as DocTypeValue[]).filter((type) => DOC_TYPE_GROUP[type] === group);
}

export function isDocTypeValue(value: string): value is DocTypeValue {
  return Object.hasOwn(DOC_TYPE_GROUP, value);
}
