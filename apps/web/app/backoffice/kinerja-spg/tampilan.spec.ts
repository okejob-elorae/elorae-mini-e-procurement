import { describe, expect, it } from "vitest";
import { bacaTampilan, cariDenganTampilan } from "./tampilan";

describe("tab Kinerja SPG di alamat", () => {
  it("hanya `kehadiran` yang dikenali; selain itu tab Penjualan", () => {
    expect(bacaTampilan("kehadiran")).toBe("kehadiran");
    expect(bacaTampilan(["kehadiran", "penjualan"])).toBe("kehadiran");
    expect(bacaTampilan("penjualan")).toBe("penjualan");
    expect(bacaTampilan(undefined)).toBe("penjualan");
    expect(bacaTampilan("lain")).toBe("penjualan");
  });

  it("mengganti tab mempertahankan bulan dan toko; tab bawaan tidak ditulis", () => {
    expect(cariDenganTampilan("bulan=2026-10&toko=t1", "kehadiran")).toBe("bulan=2026-10&toko=t1&tampilan=kehadiran");
    expect(cariDenganTampilan("?bulan=2026-10&tampilan=kehadiran", "penjualan")).toBe("bulan=2026-10");
    expect(cariDenganTampilan("", "penjualan")).toBe("");
  });
});
