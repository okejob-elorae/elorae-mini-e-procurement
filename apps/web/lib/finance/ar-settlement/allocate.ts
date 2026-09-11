/**
 * Deliberately import-free apart from `roundCents` from `@elorae/db/pricing`, the same policy as
 * `calc.ts` beside it: the PWA settlement screen is a "use client" component and imports this
 * directory directly, so any import here that reaches the `@elorae/db` barrel (Prisma types, the
 * generated schema enums, a `./queries`-style module) would drag Prisma and the mariadb driver
 * into the browser bundle. `@elorae/db/pricing` is a safe subpath: a pure helper, not the barrel.
 */
import { roundCents } from "@elorae/db/pricing";

export type AllocationInput = {
  receivableId: string;
  dueDate: Date;
  outstandingAmount: number;
};

export type AllocationOutput = {
  receivableId: string;
  amount: number;
};

/**
 * Allocates a settlement amount across invoices, oldest due date first. Walks invoices in
 * ascending due date order, assigning `min(remaining, invoice.outstandingAmount)` to each
 * until the amount is exhausted or all invoices are processed. Skips zero assignments.
 *
 * Invoices with equal due dates are sorted deterministically by `receivableId` to ensure
 * the same input always produces the same output.
 *
 * Uses `roundCents` to accumulate remaining amount so floating-point drift across multiple
 * allocations cannot produce a sub-cent residue.
 */
export function allocateOldestFirst(
  amount: number,
  invoices: AllocationInput[],
): AllocationOutput[] {
  if (amount <= 0) {
    return [];
  }

  const sorted = [...invoices].sort((a, b) => {
    const dateCompare = a.dueDate.getTime() - b.dueDate.getTime();
    if (dateCompare !== 0) {
      return dateCompare;
    }
    /* Tie-break on receivableId for deterministic ordering */
    return a.receivableId.localeCompare(b.receivableId);
  });

  const allocations: AllocationOutput[] = [];
  let remaining = amount;

  for (const invoice of sorted) {
    if (remaining <= 0) {
      break;
    }

    const allocated = Math.min(remaining, invoice.outstandingAmount);

    if (allocated > 0) {
      allocations.push({
        receivableId: invoice.receivableId,
        amount: allocated,
      });
      remaining = roundCents(remaining - allocated);
    }
  }

  return allocations;
}
