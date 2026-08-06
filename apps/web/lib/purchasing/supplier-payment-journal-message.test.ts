import { describe, expect, it } from "vitest";
import idMessages from "../i18n/messages/id.json";
import enMessages from "../i18n/messages/en.json";
import {
  SUPPLIER_PAYMENT_JOURNAL_ERROR_CODES,
  supplierPaymentJournalErrorKey,
  type SupplierPaymentDirection,
} from "./supplier-payment-journal-message";

type ErrEntry = string | Record<SupplierPaymentDirection, string>;

const locales = { id: idMessages, en: enMessages } as unknown as Record<
  string,
  { supplierPayments: { journal: { err: Record<string, ErrEntry> } } }
>;

const DIRECTIONS: SupplierPaymentDirection[] = ["payment", "reversal"];

/* The two codes whose message is written per direction. Kept as a literal here
   rather than imported so a code silently dropped from (or added to) the module's
   own list fails these tests instead of being followed. */
const DIRECTION_SPECIFIC = ["UNBALANCED", "GENERIC"];

/** Every leaf sentence under `journal.err`, keyed by its dotted path. */
function flattenErr(err: Record<string, ErrEntry>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(err)) {
    if (typeof value === "string") {
      flat[key] = value;
      continue;
    }
    for (const [direction, sentence] of Object.entries(value)) flat[`${key}.${direction}`] = sentence;
  }
  return flat;
}

/** Every key the mapper can return, minus the `journal.err.` prefix. */
function expectedKeys(): string[] {
  const codes = [...SUPPLIER_PAYMENT_JOURNAL_ERROR_CODES.map((c) => c as string), "GENERIC"];
  return codes.flatMap((code) =>
    DIRECTION_SPECIFIC.includes(code) ? DIRECTIONS.map((direction) => `${code}.${direction}`) : [code],
  );
}

describe("supplierPaymentJournalErrorKey", () => {
  it("maps each direction-independent code to its own key", () => {
    for (const code of SUPPLIER_PAYMENT_JOURNAL_ERROR_CODES) {
      if (DIRECTION_SPECIFIC.includes(code)) continue;
      for (const direction of DIRECTIONS) {
        expect(supplierPaymentJournalErrorKey(code, direction)).toBe(`journal.err.${code}`);
      }
    }
  });

  it("keys the two direction-dependent codes per direction", () => {
    for (const code of DIRECTION_SPECIFIC) {
      for (const direction of DIRECTIONS) {
        expect(supplierPaymentJournalErrorKey(code, direction)).toBe(`journal.err.${code}.${direction}`);
      }
    }
  });

  it("falls back to the generic key for the synthetic thrown-journal code, keeping the direction", () => {
    expect(supplierPaymentJournalErrorKey("ERROR", "payment")).toBe("journal.err.GENERIC.payment");
    expect(supplierPaymentJournalErrorKey("ERROR", "reversal")).toBe("journal.err.GENERIC.reversal");
  });

  it("falls back to the generic key for an unrecognised code", () => {
    /* A future server code must degrade to a sentence, never to a raw key. */
    expect(supplierPaymentJournalErrorKey("SOME_NEW_CODE", "payment")).toBe("journal.err.GENERIC.payment");
    expect(supplierPaymentJournalErrorKey("SOME_NEW_CODE", "reversal")).toBe("journal.err.GENERIC.reversal");
  });
});

describe("supplier payment journal messages", () => {
  it("defines every key the mapper can return, and nothing else, in both locales", () => {
    const keys = expectedKeys();
    for (const [locale, messages] of Object.entries(locales)) {
      const err = flattenErr(messages.supplierPayments.journal.err);
      for (const key of keys) {
        expect(err[key], `${locale}.supplierPayments.journal.err.${key}`).toBeTruthy();
      }
      expect(Object.keys(err).sort()).toEqual([...keys].sort());
    }
  });

  it("interpolates the posting role only where a role is reported", () => {
    for (const messages of Object.values(locales)) {
      const err = flattenErr(messages.supplierPayments.journal.err);
      expect(err.UNMAPPED_ROLE).toContain("{role}");
      for (const key of Object.keys(err)) {
        if (key !== "UNMAPPED_ROLE") expect(err[key]).not.toContain("{role}");
      }
    }
  });

  /*
   * The claim the review caught: a reversal-direction failure leaves the earlier
   * payment journal standing, so no reversal message may tell the operator
   * payables and bank were left alone. Asserted on the wording rather than left
   * to review, in both locales, because it is the sentence that decides whether
   * the operator goes looking for the gap or assumes there is none.
   */
  it("never claims payables and bank are untouched on a reversal failure", () => {
    const untouched: Record<string, string> = { id: "belum tersentuh", en: "untouched" };
    for (const [locale, messages] of Object.entries(locales)) {
      for (const code of DIRECTION_SPECIFIC) {
        const entry = messages.supplierPayments.journal.err[code];
        expect(typeof entry, `${locale}.${code} must be keyed per direction`).not.toBe("string");
        const reversal = (entry as Record<SupplierPaymentDirection, string>).reversal;
        const phrase = untouched[locale];
        /* "BUKAN belum tersentuh" / "NOT untouched" are the explicit denials, so
           the phrase may only appear when negated. */
        const negated = locale === "id" ? reversal.includes(`BUKAN ${phrase}`) : reversal.includes(`NOT ${phrase}`);
        expect(
          !reversal.includes(phrase) || negated,
          `${locale}.supplierPayments.journal.err.${code}.reversal claims the ledger is untouched`,
        ).toBe(true);
      }
    }
  });

  /*
   * Both directions must carry a remedy. The payment half is retried through the
   * toggle; the reversal half cannot be, so it has to name the standing-payment
   * control instead of the mark/unmark dance.
   */
  it("gives each direction the remedy that direction actually has", () => {
    const markAgain: Record<string, string> = { id: "tandai lunas lagi", en: "mark it paid again" };
    const standing: Record<string, string> = { id: "peringatan pembayaran menggantung", en: "standing-payment warning" };
    for (const [locale, messages] of Object.entries(locales)) {
      for (const code of DIRECTION_SPECIFIC) {
        const entry = messages.supplierPayments.journal.err[code] as Record<SupplierPaymentDirection, string>;
        expect(entry.payment, `${locale}.${code}.payment`).toContain(markAgain[locale]);
        expect(entry.reversal, `${locale}.${code}.reversal`).toContain(standing[locale]);
      }
    }
  });
});
