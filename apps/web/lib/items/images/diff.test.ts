import { describe, it, expect } from "vitest";
import { diffItemImages } from "./diff";
import type { ItemImageDto, ItemImageSubmission } from "./types";

function mkExisting(overrides: Partial<ItemImageDto>): ItemImageDto {
  return {
    id: "x", itemId: "i", variantSku: null, url: "https://static.jubelio.com/x.jpg",
    sortOrder: 0, jubelioImageId: null, syncedAt: null, source: "ERP_UPLOAD",
    ...overrides,
  };
}

describe("diffItemImages", () => {
  it("inserts new (id absent)", () => {
    const submitted: ItemImageSubmission[] = [{ url: "https://x/new.jpg", variantSku: null, sortOrder: 0 }];
    const d = diffItemImages([], submitted);
    expect(d.inserts).toHaveLength(1);
    expect(d.updates).toHaveLength(0);
    expect(d.deletes).toHaveLength(0);
  });
  it("updates sortOrder when id matches but sortOrder differs", () => {
    const existing = [mkExisting({ id: "a", sortOrder: 0 })];
    const submitted: ItemImageSubmission[] = [{ id: "a", url: existing[0].url, variantSku: null, sortOrder: 3 }];
    const d = diffItemImages(existing, submitted);
    expect(d.updates).toEqual([{ id: "a", sortOrder: 3 }]);
    expect(d.inserts).toHaveLength(0);
    expect(d.deletes).toHaveLength(0);
  });
  it("no update when id matches and sortOrder unchanged", () => {
    const existing = [mkExisting({ id: "a", sortOrder: 0 })];
    const submitted: ItemImageSubmission[] = [{ id: "a", url: existing[0].url, variantSku: null, sortOrder: 0 }];
    const d = diffItemImages(existing, submitted);
    expect(d.updates).toHaveLength(0);
  });
  it("deletes rows that disappear from submission", () => {
    const existing = [mkExisting({ id: "a" }), mkExisting({ id: "b" })];
    const submitted: ItemImageSubmission[] = [{ id: "a", url: existing[0].url, variantSku: null, sortOrder: 0 }];
    const d = diffItemImages(existing, submitted);
    expect(d.deletes).toEqual([{ id: "b", url: existing[1].url, source: "ERP_UPLOAD" }]);
  });
  it("handles mixed insert + update + delete", () => {
    const existing = [
      mkExisting({ id: "a", sortOrder: 0 }),
      mkExisting({ id: "b", sortOrder: 1 }),
    ];
    const submitted: ItemImageSubmission[] = [
      { id: "a", url: existing[0].url, variantSku: null, sortOrder: 2 },
      { url: "https://x/new.jpg", variantSku: null, sortOrder: 0 },
    ];
    const d = diffItemImages(existing, submitted);
    expect(d.inserts).toHaveLength(1);
    expect(d.updates).toEqual([{ id: "a", sortOrder: 2 }]);
    expect(d.deletes).toEqual([{ id: "b", url: existing[1].url, source: "ERP_UPLOAD" }]);
  });
});
