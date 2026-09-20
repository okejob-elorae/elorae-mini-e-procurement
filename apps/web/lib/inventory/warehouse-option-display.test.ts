import { describe, expect, it } from "vitest";
import enMessages from "../i18n/messages/en.json";
import idMessages from "../i18n/messages/id.json";
import { WAREHOUSE_OPTION_KEY, WAREHOUSE_TYPES } from "./warehouse-option-display";

const locales: Record<string, unknown> = { en: enMessages, id: idMessages };

/**
 * Walks a dotted key ("warehouseOption.main") into the `stockMovements` namespace of a
 * locale file. Same helper as ledger-ref-display.test.ts's own — duplicated rather than
 * shared, since it is a few lines and this file has no other reason to import that one.
 */
function resolveMessage(messages: unknown, dottedKey: string): unknown {
  let node: unknown = (messages as Record<string, unknown>).stockMovements;
  for (const segment of dottedKey.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

function expectResolvedString(dottedKey: string): void {
  for (const [locale, messages] of Object.entries(locales)) {
    const resolved = resolveMessage(messages, dottedKey);
    expect(typeof resolved, `${locale}.stockMovements.${dottedKey}`).toBe("string");
    expect((resolved as string).length, `${locale}.stockMovements.${dottedKey}`).toBeGreaterThan(0);
  }
}

describe("WAREHOUSE_OPTION_KEY", () => {
  it("has exactly one entry per warehouse type and no extras", () => {
    expect(Object.keys(WAREHOUSE_OPTION_KEY).sort()).toEqual([...WAREHOUSE_TYPES].sort());
  });

  it("resolves every warehouse option's message key in both locales", () => {
    for (const key of Object.values(WAREHOUSE_OPTION_KEY)) expectResolvedString(key);
  });
});

/*
 * WAREHOUSE_OPTION_KEY and `refType` (covered by ledger-ref-display.test.ts) are each
 * exhaustive over a TypeScript union, so a missing MAP entry is a compile error. Nothing
 * makes a missing LOCALE key a compile error, which is the gap this test — and the
 * refType one it mirrors — exists to close for the movement-filter copy this branch
 * added. Every entry below is a FLAT (non-namespaced) `stockMovements` key with no
 * union or registry behind it, so it is listed by hand: a new plain string added
 * anywhere in MovementsPageClient's copy must be added to this list too, or it is not
 * checked by anything.
 */
describe("stockMovements flat keys added by the movement-filter branch", () => {
  const keys = [
    "warehouseLabel",
    "allWarehouses",
    "movementTypeLabel",
    "allMovementTypes",
    "otherMovementType",
    "filterSelectedCount",
    "noMovementsForFilters",
  ];

  it("resolves every key in both locales", () => {
    for (const key of keys) expectResolvedString(key);
  });
});
