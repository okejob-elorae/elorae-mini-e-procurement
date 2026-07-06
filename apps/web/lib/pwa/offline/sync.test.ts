import { describe, it, expect } from "vitest";
import { classifyResult } from "./sync";

describe("classifyResult", () => {
  it("evicts on success", () => { expect(classifyResult({ ok: true, orderNo: "X" })).toBe("evict"); });
  it("terminal on MIN_QTY / NO_ACTIVE_VISIT / EMPTY / UNAUTHORIZED", () => {
    for (const code of ["EMPTY", "NO_ACTIVE_VISIT", "UNAUTHORIZED"] as const) expect(classifyResult({ ok: false, code })).toBe("terminal");
    expect(classifyResult({ ok: false, code: "MIN_QTY", violations: [] })).toBe("terminal");
  });
  it("retry on a thrown/transient error", () => { expect(classifyResult({ thrown: true })).toBe("retry"); });
});
