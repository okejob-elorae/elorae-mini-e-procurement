import { describe, it, expect } from "vitest";
import {
  RECON_BULK_BATCH_MAX,
  chunkIds,
  idsForQuickSelect,
  summarizeBulkOutcomes,
  type ReconSelectableRow,
} from "./reconciliation-selection";

const rows: ReconSelectableRow[] = [
  { id: "neg-jubelio-higher", action: "FLAGGED", eloraeQty: -5, variance: -8 },
  { id: "pos-jubelio-higher", action: "FLAGGED", eloraeQty: 2, variance: -3 },
  { id: "pos-elorae-higher", action: "FLAGGED", eloraeQty: 9, variance: 4 },
  { id: "neg-resolved", action: "MANUALLY_RESOLVED", eloraeQty: -1, variance: -1 },
  { id: "in-sync", action: "IN_SYNC", eloraeQty: 3, variance: 0 },
];

describe("idsForQuickSelect", () => {
  it("ALL_FLAGGED takes every FLAGGED row and nothing else", () => {
    expect(idsForQuickSelect(rows, "ALL_FLAGGED")).toEqual([
      "neg-jubelio-higher",
      "pos-jubelio-higher",
      "pos-elorae-higher",
    ]);
  });

  it("ELORAE_NEGATIVE takes FLAGGED rows whose Elorae figure is below zero", () => {
    expect(idsForQuickSelect(rows, "ELORAE_NEGATIVE")).toEqual(["neg-jubelio-higher"]);
  });

  it("JUBELIO_HIGHER takes FLAGGED rows where Jubelio's figure exceeds Elorae's", () => {
    expect(idsForQuickSelect(rows, "JUBELIO_HIGHER")).toEqual(["neg-jubelio-higher", "pos-jubelio-higher"]);
  });

  it("JUBELIO_HIGHER skips a FLAGGED row with no Jubelio figure, while the other rules keep it", () => {
    const noFigure: ReconSelectableRow = { id: "no-figure", action: "FLAGGED", eloraeQty: -2, variance: null };
    expect(idsForQuickSelect([noFigure], "JUBELIO_HIGHER")).toEqual([]);
    expect(idsForQuickSelect([noFigure], "ALL_FLAGGED")).toEqual(["no-figure"]);
    expect(idsForQuickSelect([noFigure], "ELORAE_NEGATIVE")).toEqual(["no-figure"]);
  });

  it("returns nothing for a run with no FLAGGED rows", () => {
    expect(idsForQuickSelect([rows[3], rows[4]], "ALL_FLAGGED")).toEqual([]);
  });
});

describe("chunkIds", () => {
  it("splits into batches of at most the given size, keeping order", () => {
    expect(chunkIds(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("returns no batches for no ids", () => {
    expect(chunkIds([], RECON_BULK_BATCH_MAX)).toEqual([]);
  });

  it("keeps one full batch at exactly the cap", () => {
    const ids = Array.from({ length: RECON_BULK_BATCH_MAX }, (_, i) => `id-${i}`);
    expect(chunkIds(ids, RECON_BULK_BATCH_MAX)).toEqual([ids]);
  });
});

describe("summarizeBulkOutcomes", () => {
  it("counts matched rows and groups refusals by reason, most frequent first", () => {
    expect(summarizeBulkOutcomes([
      { success: true },
      { success: false, reason: "STOCK_MOVED" },
      { success: true },
      { success: false, reason: "JUBELIO_QTY_MISSING" },
      { success: false, reason: "STOCK_MOVED" },
    ])).toEqual({
      matched: 2,
      refused: [
        { reason: "STOCK_MOVED", count: 2 },
        { reason: "JUBELIO_QTY_MISSING", count: 1 },
      ],
    });
  });

  it("orders refusals with the same count by reason", () => {
    expect(summarizeBulkOutcomes([
      { success: false, reason: "STOCK_MOVED" },
      { success: false, reason: "NO_MAPPING" },
    ]).refused).toEqual([
      { reason: "NO_MAPPING", count: 1 },
      { reason: "STOCK_MOVED", count: 1 },
    ]);
  });
});
