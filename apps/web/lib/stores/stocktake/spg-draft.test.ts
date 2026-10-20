import { describe, it, expect } from "vitest";
import { clearSpgDraft, readSpgDraft, spgDraftKey, writeSpgDraft, type SpgDraft } from "./spg-draft";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const draft: SpgDraft = {
  counts: { "i1::": "4", "new:i2::M": "2" },
  countedAtByKey: { "i1::": 1_000, "new:i2::M": 2_000 },
  pendingLines: [{ key: "new:i2::M", itemId: "i2", itemSku: "SKU2", variantSku: "M", productName: "Kaos" }],
};

describe("spg stocktake draft", () => {
  it("round-trips counts, their count times and added rows per store", () => {
    const s = memoryStorage();
    writeSpgDraft(s, "store-1", draft);
    expect(readSpgDraft(s, "store-1")).toEqual(draft);
    expect(readSpgDraft(s, "store-2")).toBeNull();
  });

  it("removes the entry instead of saving an empty draft, and clears it", () => {
    const s = memoryStorage();
    writeSpgDraft(s, "store-1", draft);
    writeSpgDraft(s, "store-1", { counts: {}, countedAtByKey: {}, pendingLines: [] });
    expect(s.map.has(spgDraftKey("store-1"))).toBe(false);

    writeSpgDraft(s, "store-1", draft);
    clearSpgDraft(s, "store-1");
    expect(readSpgDraft(s, "store-1")).toBeNull();
  });

  it("ignores a malformed or other-version entry rather than restoring garbage", () => {
    const s = memoryStorage();
    s.setItem(spgDraftKey("a"), "{not json");
    s.setItem(spgDraftKey("b"), JSON.stringify({ v: 2, ...draft }));
    s.setItem(spgDraftKey("c"), JSON.stringify({ v: 1, ...draft, countedAtByKey: { k: "soon" } }));
    expect(readSpgDraft(s, "a")).toBeNull();
    expect(readSpgDraft(s, "b")).toBeNull();
    expect(readSpgDraft(s, "c")).toBeNull();
  });

  it("never throws when storage is missing or throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSpgDraft(undefined, "s")).toBeNull();
    expect(readSpgDraft(throwing, "s")).toBeNull();
    expect(() => writeSpgDraft(throwing, "s", draft)).not.toThrow();
    expect(() => clearSpgDraft(throwing, "s")).not.toThrow();
  });
});
