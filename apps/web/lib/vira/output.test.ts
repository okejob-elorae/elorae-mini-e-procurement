import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Prisma } from "@elorae/db";
import {
  getBaseUrl,
  listInputShape,
  recordUrl,
  serialize,
  sliceToPage,
  toolError,
  toolResult,
  toPage,
} from "./output";

const rows = Array.from({ length: 120 }, (_, i) => i);

describe("sliceToPage (limit spec)", () => {
  it("120 rows, limit 50, offset 0 → 50 items, total 120, hasMore", () => {
    const page = sliceToPage(rows, 0, 50);
    expect(page.items).toHaveLength(50);
    expect(page.items[0]).toBe(0);
    expect(page).toMatchObject({ total: 120, offset: 0, limit: 50, hasMore: true });
  });

  it("120 rows, limit 50, offset 100 → 20 items, no more", () => {
    const page = sliceToPage(rows, 100, 50);
    expect(page.items).toHaveLength(20);
    expect(page.items[0]).toBe(100);
    expect(page).toMatchObject({ total: 120, offset: 100, limit: 50, hasMore: false });
  });

  it("an offset past the end → empty page", () => {
    expect(sliceToPage(rows, 200, 50)).toEqual({ items: [], total: 120, offset: 200, limit: 50, hasMore: false });
  });
});

describe("listInputShape", () => {
  const schema = z.object(listInputShape);

  it("defaults to limit 20, offset 0", () => {
    expect(schema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it("limit 51 throws; limit 0 throws; offset -1 throws", () => {
    expect(() => schema.parse({ limit: 51 })).toThrow();
    expect(() => schema.parse({ limit: 0 })).toThrow();
    expect(() => schema.parse({ offset: -1 })).toThrow();
  });

  it("accepts the bounds and rejects fractions", () => {
    expect(schema.parse({ limit: 1, offset: 0 })).toEqual({ limit: 1, offset: 0 });
    expect(schema.parse({ limit: 50, offset: 7 })).toEqual({ limit: 50, offset: 7 });
    expect(() => schema.parse({ limit: 2.5 })).toThrow();
  });
});

describe("toPage", () => {
  it("hasMore is true when rows remain past this page", () => {
    expect(toPage([1, 2], 5, 0, 2)).toEqual({ items: [1, 2], total: 5, offset: 0, limit: 2, hasMore: true });
  });

  it("hasMore is false on the last page", () => {
    expect(toPage([5], 5, 4, 2).hasMore).toBe(false);
    expect(toPage([3, 4], 4, 2, 2).hasMore).toBe(false);
    expect(toPage([], 0, 0, 20).hasMore).toBe(false);
  });
});

describe("serialize", () => {
  it("converts Decimal, Date and bigint, inside nested arrays and objects, and drops undefined keys", () => {
    const when = new Date("2026-11-16T05:00:00.000Z");
    const out = serialize({
      price: new Prisma.Decimal("12.50"),
      at: when,
      big: BigInt(42),
      gone: undefined,
      keep: null,
      nested: { list: [{ qty: new Prisma.Decimal("3"), at: when, gone: undefined }, "x", 1, true] },
    });
    expect(out).toEqual({
      price: 12.5,
      at: "2026-11-16T05:00:00.000Z",
      big: 42,
      keep: null,
      nested: { list: [{ qty: 3, at: "2026-11-16T05:00:00.000Z" }, "x", 1, true] },
    });
    expect(Object.keys(out as object)).not.toContain("gone");
  });

  it("leaves primitives as they are", () => {
    expect(serialize("a")).toBe("a");
    expect(serialize(3)).toBe(3);
    expect(serialize(null)).toBeNull();
    expect(serialize(undefined)).toBeUndefined();
  });
});

describe("getBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const request = () =>
    new Request("http://web:3000/api/vira/mcp", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "elorae.cloud" },
    });

  it("prefers VIRA_APP_URL when set", () => {
    vi.stubEnv("VIRA_APP_URL", "https://app.example.test/");
    expect(getBaseUrl(request())).toBe("https://app.example.test");
  });

  it("falls back to the request origin (asalPermintaan)", () => {
    vi.stubEnv("VIRA_APP_URL", "");
    expect(getBaseUrl(request())).toBe("https://elorae.cloud");
    expect(getBaseUrl(new Request("http://localhost:3000/api/vira/mcp"))).toBe("http://localhost:3000");
  });
});

describe("recordUrl", () => {
  it("joins base and path", () => {
    expect(recordUrl("https://x.test", "/backoffice/items/5")).toBe("https://x.test/backoffice/items/5");
  });

  it("rejects a path without a leading slash", () => {
    expect(() => recordUrl("https://x.test", "backoffice")).toThrow();
  });
});

describe("toolResult / toolError", () => {
  it("toolResult has the exact success shape", () => {
    const data = { a: 1, b: "x" };
    expect(toolResult(data)).toEqual({
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    });
  });

  it("toolResult wraps an array as { items } in structuredContent", () => {
    expect(toolResult([1, 2])).toEqual({
      content: [{ type: "text", text: "[1,2]" }],
      structuredContent: { items: [1, 2] },
    });
  });

  it("toolError has the exact failure shape", () => {
    expect(toolError("NOT_FOUND", "No such item")).toEqual({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: { code: "NOT_FOUND", message: "No such item" } }) }],
    });
  });
});
