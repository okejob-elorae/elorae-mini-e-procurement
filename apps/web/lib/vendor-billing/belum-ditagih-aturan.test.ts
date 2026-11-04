import { describe, it, expect } from "vitest";
import {
  adalahTerlambat,
  belumDitagihLangkah,
  belumDitagihPerKunci,
  selisihHariKalender,
  statusBarisPermintaan,
  statusPermintaan,
} from "./belum-ditagih-aturan";

describe("belumDitagihPerKunci", () => {
  it("nets completed returns, billed and waived pieces, never below zero", () => {
    expect(belumDitagihPerKunci([{ key: "a", diterima: 100, diretur: 20, ditagih: 50, dibebaskan: 0 }])).toEqual([{ key: "a", neto: 80, belum: 30 }]);
    expect(belumDitagihPerKunci([{ key: "a", diterima: 100, diretur: 0, ditagih: 60, dibebaskan: 40 }])).toEqual([{ key: "a", neto: 100, belum: 0 }]);
    expect(belumDitagihPerKunci([{ key: "a", diterima: 10, diretur: 0, ditagih: 12, dibebaskan: 0 }])[0].belum).toBe(0);
  });
});

describe("belumDitagihLangkah", () => {
  it("takes old pieces (CMT never booked) first", () => {
    expect(belumDitagihLangkah({ qtyDiterima: 300, qtyDitagih: 100, qtyDibebaskan: 0, qtyLamaBelumDibukukan: 50 })).toEqual({ qtyBelum: 200, qtyLama: 50, qtyBaru: 150 });
    expect(belumDitagihLangkah({ qtyDiterima: 100, qtyDitagih: 0, qtyDibebaskan: 100, qtyLamaBelumDibukukan: 0 })).toEqual({ qtyBelum: 0, qtyLama: 0, qtyBaru: 0 });
  });
});

describe("selisihHariKalender", () => {
  it("counts calendar days", () => {
    expect(selisihHariKalender("2026-11-01", "2026-11-08")).toBe(7);
    expect(selisihHariKalender("2026-10-31", "2026-11-01")).toBe(1);
  });
});

describe("statusBarisPermintaan / statusPermintaan", () => {
  const k = (o: Partial<{ mati: boolean; perlu: number; ditagih: number; dibebaskan: number }>) => ({ mati: false, perlu: 100, ditagih: 0, dibebaskan: 0, ...o });

  it("derives each line from its source now", () => {
    expect(statusBarisPermintaan({ billedQty: 0 }, k({}))).toBe("BELUM");
    expect(statusBarisPermintaan({ billedQty: 0 }, k({ ditagih: 40 }))).toBe("SEBAGIAN");
    expect(statusBarisPermintaan({ billedQty: 0 }, k({ ditagih: 100 }))).toBe("DITERIMA");
    expect(statusBarisPermintaan({ billedQty: 0 }, k({ dibebaskan: 100 }))).toBe("TIDAK_PERLU");
    expect(statusBarisPermintaan({ billedQty: 0 }, k({ ditagih: 60, dibebaskan: 40 }))).toBe("DITERIMA");
    expect(statusBarisPermintaan({ billedQty: 0 }, k({ mati: true }))).toBe("SUMBER_BATAL");
    expect(statusBarisPermintaan({ billedQty: 0 }, null)).toBe("SUMBER_BATAL");
  });

  it("a request is received when every line is done and one was invoiced", () => {
    expect(statusPermintaan({ dibatalkan: false, baris: ["DITERIMA", "TIDAK_PERLU"] })).toBe("DITERIMA");
    expect(statusPermintaan({ dibatalkan: false, baris: ["TIDAK_PERLU", "SUMBER_BATAL"] })).toBe("SELESAI_TANPA_INVOICE");
    expect(statusPermintaan({ dibatalkan: false, baris: ["DITERIMA", "SEBAGIAN"] })).toBe("TERBUKA");
    expect(statusPermintaan({ dibatalkan: true, baris: ["BELUM"] })).toBe("DIBATALKAN");
  });

  it("is late from 7 WIB calendar days after the last ask (P19)", () => {
    expect(adalahTerlambat("TERBUKA", "2026-11-01", "2026-11-07")).toBe(false);
    expect(adalahTerlambat("TERBUKA", "2026-11-01", "2026-11-08")).toBe(true);
    expect(adalahTerlambat("DITERIMA", "2026-11-01", "2026-11-09")).toBe(false);
  });
});
