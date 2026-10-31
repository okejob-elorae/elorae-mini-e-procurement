import { describe, expect, it } from "vitest";
import { alamatTermin, bacaChipTermin, bacaMasa, bacaParamTermin, geserMasa } from "./termin-param";

describe("alamat Pembayaran per termin", () => {
  it("bawaan tidak ditulis; saringan ikut alamat; pintasan ?kolaborasi= dari Hari ini terbaca", () => {
    expect(alamatTermin(bacaParamTermin({}))).toBe("/backoffice/kreatif/pembayaran");
    const p = bacaParamTermin({ chip: "JATUH_TEMPO", cari: " @siti ", kolaborasi: "c1", halaman: "2", per: "50" });
    expect(p).toMatchObject({ chip: "JATUH_TEMPO", cari: "@siti", kolaborasi: "c1", halaman: 2, per: 50 });
    expect(alamatTermin(p)).toBe("/backoffice/kreatif/pembayaran?chip=JATUH_TEMPO&cari=%40siti&kolaborasi=c1&halaman=2&per=50");
  });

  it("chip lama dari layar per-kolaborasi tetap terbaca", () => {
    expect(bacaChipTermin("LUNAS")).toBe("DIBAYAR");
    expect(bacaChipTermin("SEBAGIAN")).toBe("BELUM");
    expect(bacaChipTermin("ngawur")).toBe("BELUM");
  });

  it("masa pajak", () => {
    expect(bacaMasa("2026-10")).toBe("2026-10");
    expect(bacaMasa("2026-13")).toBeNull();
    expect(geserMasa("2026-01", -1)).toBe("2025-12");
    expect(geserMasa("2026-12", 1)).toBe("2027-01");
  });
});
