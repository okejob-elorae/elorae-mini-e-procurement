/**
 * Deliberately import-free — no `@elorae/db`, not even for the `TaxInvoiceStatusFilter` type.
 * Both `FakturPajakPageClient.tsx` and `DeliveriesCard.tsx` are "use client" components; one
 * import of the barrel, even a type-only one re-exported through a value module, would drag
 * Prisma and the mariadb driver into the browser bundle. Same policy as
 * `lib/field-sales/retur/variance.ts`. This module declares its own status union rather than
 * importing `TaxInvoiceStatusFilter` from `./queries` (a `@elorae/db`-importing module) — the two
 * unions must be kept in sync by hand, which is exactly why this is Global Constraint site 7: the
 * next status addition will find this file's own union first.
 */
export type TaxInvoiceStatusValue = "PENDING" | "CREATED" | "SENT_TO_STORE" | "NOT_REQUIRED";

export const STATUS_BADGE_VARIANT: Record<
  TaxInvoiceStatusValue,
  "secondary" | "default" | "outline"
> = {
  PENDING: "secondary",
  CREATED: "default",
  SENT_TO_STORE: "default",
  NOT_REQUIRED: "outline",
};

export const STATUS_LABEL_KEY: Record<
  TaxInvoiceStatusValue,
  "statusPending" | "statusCreated" | "statusSentToStore" | "statusNotRequired"
> = {
  PENDING: "statusPending",
  CREATED: "statusCreated",
  SENT_TO_STORE: "statusSentToStore",
  NOT_REQUIRED: "statusNotRequired",
};
