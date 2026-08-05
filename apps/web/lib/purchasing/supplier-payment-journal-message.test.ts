import { describe, expect, it } from "vitest";
import idMessages from "../i18n/messages/id.json";
import enMessages from "../i18n/messages/en.json";
import {
  SUPPLIER_PAYMENT_JOURNAL_ERROR_CODES,
  supplierPaymentJournalErrorKey,
} from "./supplier-payment-journal-message";

const locales = { id: idMessages, en: enMessages } as Record<
  string,
  { supplierPayments: { journal: { err: Record<string, string> } } }
>;

describe("supplierPaymentJournalErrorKey", () => {
  it("maps each known failure code to its own key", () => {
    for (const code of SUPPLIER_PAYMENT_JOURNAL_ERROR_CODES) {
      expect(supplierPaymentJournalErrorKey(code)).toBe(`journal.err.${code}`);
    }
  });

  it("falls back to the generic key for the synthetic thrown-journal code", () => {
    expect(supplierPaymentJournalErrorKey("ERROR")).toBe("journal.err.GENERIC");
  });

  it("falls back to the generic key for an unrecognised code", () => {
    /* A future server code must degrade to a sentence, never to a raw key. */
    expect(supplierPaymentJournalErrorKey("SOME_NEW_CODE")).toBe("journal.err.GENERIC");
  });
});

describe("supplier payment journal messages", () => {
  it("defines every key the mapper can return, in both locales", () => {
    const keys = [
      ...SUPPLIER_PAYMENT_JOURNAL_ERROR_CODES.map((code) => code as string),
      "GENERIC",
    ];
    for (const [locale, messages] of Object.entries(locales)) {
      const err = messages.supplierPayments.journal.err;
      for (const key of keys) {
        expect(err[key], `${locale}.supplierPayments.journal.err.${key}`).toBeTruthy();
      }
      expect(Object.keys(err).sort()).toEqual([...keys].sort());
    }
  });

  it("interpolates the posting role only where a role is reported", () => {
    for (const messages of Object.values(locales)) {
      const err = messages.supplierPayments.journal.err;
      expect(err.UNMAPPED_ROLE).toContain("{role}");
      for (const key of Object.keys(err)) {
        if (key !== "UNMAPPED_ROLE") expect(err[key]).not.toContain("{role}");
      }
    }
  });
});
