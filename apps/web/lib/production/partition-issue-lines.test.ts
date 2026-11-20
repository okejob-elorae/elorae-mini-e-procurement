import { describe, expect, it } from "vitest";
import {
  partitionIssueLinesByType,
  typedIssueIdempotencyKey,
} from "./partition-issue-lines";

describe("partitionIssueLinesByType", () => {
  const fabricIds = new Set(["fab-1", "fab-2"]);
  const isFabric = (id: string) => fabricIds.has(id);

  it("puts fabric and accessories into separate buckets", () => {
    const lines = [
      { itemId: "fab-1", qty: 1 },
      { itemId: "acc-1", qty: 2 },
      { itemId: "fab-2", qty: 3 },
    ];
    expect(partitionIssueLinesByType(lines, isFabric)).toEqual({
      FABRIC: [
        { itemId: "fab-1", qty: 1 },
        { itemId: "fab-2", qty: 3 },
      ],
      ACCESSORIES: [{ itemId: "acc-1", qty: 2 }],
    });
  });

  it("leaves the empty type as an empty array", () => {
    expect(partitionIssueLinesByType([{ itemId: "acc-1", qty: 1 }], isFabric)).toEqual({
      FABRIC: [],
      ACCESSORIES: [{ itemId: "acc-1", qty: 1 }],
    });
  });

  it("returns both empty for no lines", () => {
    expect(partitionIssueLinesByType([], isFabric)).toEqual({
      FABRIC: [],
      ACCESSORIES: [],
    });
  });
});

describe("typedIssueIdempotencyKey", () => {
  it("suffixes the form key with the issue type", () => {
    expect(typedIssueIdempotencyKey("abc", "FABRIC")).toBe("abc:FABRIC");
    expect(typedIssueIdempotencyKey("abc", "ACCESSORIES")).toBe("abc:ACCESSORIES");
  });
});
