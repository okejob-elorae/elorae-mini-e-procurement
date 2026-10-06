import { describe, it, expect } from "vitest";
import { classifyResult } from "./classify";

describe("classifyResult", () => {
  it("evicts a successful submit", () => {
    expect(classifyResult({ ok: true, orderNo: "SO-1", creditHold: false })).toBe("evict");
  });

  it("treats ITEM_UNAVAILABLE as terminal", () => {
    expect(classifyResult({ ok: false, code: "ITEM_UNAVAILABLE", itemIds: ["i1"] })).toBe("terminal");
  });

  it("treats MIN_QTY as terminal", () => {
    expect(classifyResult({ ok: false, code: "MIN_QTY", violations: [] })).toBe("terminal");
  });

  it("retries an unknown code", () => {
    expect(classifyResult({ ok: false, code: "SOMETHING_NEW" } as never)).toBe("retry");
  });

  it("retries a thrown result", () => {
    expect(classifyResult({ thrown: true })).toBe("retry");
  });
});
