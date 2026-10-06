"use client";

import { useTranslations } from "next-intl";
import {
  supplierPaymentJournalErrorKey,
  type SupplierPaymentDirection,
} from "@/lib/purchasing/supplier-payment-journal-message";

/**
 * The one place a supplier-payment journal failure code becomes a sentence, so
 * the paid toggle's toast on both the PO detail page and the supplier-payments
 * register, the PO page's "payment journal not posted" banner and its retry
 * toast cannot drift apart. `UNMAPPED_ROLE` is the only message that
 * interpolates a value, so it is resolved from its literal key to keep
 * next-intl's parameter typing intact; passing values alongside the computed
 * key would widen the whole call to `never` and drop that check. Any code the
 * key mapper does not know falls back to the direction's generic sentence.
 */
export function useSupplierPaymentJournalFailureMessage(): (
  code: string,
  role: string | null,
  direction: SupplierPaymentDirection,
) => string {
  const tSupplierPayments = useTranslations("supplierPayments");
  return (code, role, direction) =>
    code === "UNMAPPED_ROLE"
      ? tSupplierPayments("journal.err.UNMAPPED_ROLE", { role: role ?? "" })
      : tSupplierPayments(supplierPaymentJournalErrorKey(code, direction) as never);
}
