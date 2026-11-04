import { describe, expect, it } from "vitest";
import { classifyResult } from "./classify";

describe("classifyResult — barang tanpa harga", () => {
  it("BARANG_TANPA_HARGA berhenti di antrean (terminal): harga tidak muncul hanya karena HP mencoba lagi", () => {
    expect(classifyResult({ ok: false, code: "BARANG_TANPA_HARGA", itemIds: ["topi"] })).toBe("terminal");
  });
});
