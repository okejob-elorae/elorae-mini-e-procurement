import { STOCK_LEDGER_REF_TYPES } from "@elorae/db";
import { describe, expect, it } from "vitest";
import enMessages from "../i18n/messages/en.json";
import idMessages from "../i18n/messages/id.json";
import { LEDGER_REF_MESSAGE_KEY, ledgerRefMessageKey } from "./ledger-ref-display";

const locales: Record<string, unknown> = { en: enMessages, id: idMessages };

/**
 * Walks a dotted key ("refType.konsiTransfer") into the `stockMovements` namespace of
 * a locale file. The messages are real nested objects, never flat dotted keys, so a
 * flat `key in namespace` check would report a false failure against correctly
 * structured JSON — this must descend one segment at a time.
 */
function resolveMessage(messages: unknown, dottedKey: string): unknown {
  let node: unknown = (messages as Record<string, unknown>).stockMovements;
  for (const segment of dottedKey.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

describe("LEDGER_REF_MESSAGE_KEY", () => {
  it("has exactly one entry per registry member and no extras", () => {
    const mapKeys = Object.keys(LEDGER_REF_MESSAGE_KEY).sort();
    const registryKeys = [...STOCK_LEDGER_REF_TYPES].sort();
    expect(mapKeys).toEqual(registryKeys);
  });

  it("resolves every named message key in both locales", () => {
    for (const refType of STOCK_LEDGER_REF_TYPES) {
      const key = LEDGER_REF_MESSAGE_KEY[refType];
      for (const [locale, messages] of Object.entries(locales)) {
        const resolved = resolveMessage(messages, key);
        expect(typeof resolved, `${locale}.stockMovements.${key}`).toBe("string");
        expect((resolved as string).length, `${locale}.stockMovements.${key}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("ledgerRefMessageKey", () => {
  it("resolves every registry member to the map's own key", () => {
    for (const refType of STOCK_LEDGER_REF_TYPES) {
      expect(ledgerRefMessageKey(refType)).toBe(LEDGER_REF_MESSAGE_KEY[refType]);
    }
  });

  it("returns null for a value outside the registry, including the fixture-only value", () => {
    expect(ledgerRefMessageKey("TEST")).toBeNull();
    expect(ledgerRefMessageKey("ADJUSTMENT")).toBeNull();
    expect(ledgerRefMessageKey("")).toBeNull();
  });
});
