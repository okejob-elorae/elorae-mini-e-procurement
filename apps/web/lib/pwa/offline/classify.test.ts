import { describe, expect, it } from "vitest";
import { classifyResult } from "./classify";

describe("classifyResult — kredit", () => {
  it("KREDIT_DIBLOKIR berhenti di antrean (terminal), tidak diulang", () => {
    expect(
      classifyResult({ ok: false, code: "KREDIT_DIBLOKIR", alasan: [{ kode: "LEWAT_JANJI", nilai: 1000, faktur: 1 }] }),
    ).toBe("terminal");
  });

  it("pesanan yang tercatat tapi ditahan tetap dikeluarkan dari antrean", () => {
    expect(classifyResult({ ok: true, orderNo: "X", kreditDitahan: true })).toBe("evict");
  });
});
