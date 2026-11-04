import { describe, expect, it } from "vitest";
import { asalTagihan, bacaJenisTagihan, cocokJenisTagihan, JENIS_TAGIHAN } from "./jenis-tagihan";

describe("bacaJenisTagihan — ?jenis= dari alamat", () => {
  it("menerima kedua jenis", () => {
    for (const j of JENIS_TAGIHAN) expect(bacaJenisTagihan(j)).toBe(j);
  });

  it("kosong, tidak dikenal, atau huruf besar = semua jenis", () => {
    expect(bacaJenisTagihan(undefined)).toBeNull();
    expect(bacaJenisTagihan(null)).toBeNull();
    expect(bacaJenisTagihan("")).toBeNull();
    expect(bacaJenisTagihan("KONSI")).toBeNull();
    expect(bacaJenisTagihan("putus")).toBeNull();
  });

  it("nilai berulang di alamat memakai yang pertama", () => {
    expect(bacaJenisTagihan(["nonkonsi", "konsi"])).toBe("nonkonsi");
    expect(bacaJenisTagihan([])).toBeNull();
  });
});

describe("cocokJenisTagihan", () => {
  it.each([
    [true, null, true],
    [false, null, true],
    [true, "konsi", true],
    [false, "konsi", false],
    [true, "nonkonsi", false],
    [false, "nonkonsi", true],
  ] as const)("konsi=%s jenis=%s → %s", (konsi, jenis, hasil) => {
    expect(cocokJenisTagihan(konsi, jenis)).toBe(hasil);
  });
});

describe("asalTagihan", () => {
  it("siklus konsinyasi menang atas sumber", () => {
    expect(asalTagihan({ source: "DELIVERY", sellThroughId: null, consignmentCycleId: "c1" })).toBe("SIKLUS_KONSI");
  });

  it("laporan sell-through", () => {
    expect(asalTagihan({ source: "DELIVERY", sellThroughId: "s1", consignmentCycleId: null })).toBe("LAPORAN_KONSI");
  });

  it("impor, manual, dan nota pengiriman", () => {
    expect(asalTagihan({ source: "IMPORT", sellThroughId: null, consignmentCycleId: null })).toBe("IMPORT");
    expect(asalTagihan({ source: "MANUAL", sellThroughId: null, consignmentCycleId: null })).toBe("MANUAL");
    expect(asalTagihan({ source: "DELIVERY", sellThroughId: null, consignmentCycleId: null })).toBe("DELIVERY");
  });
});
