import { describe, expect, it } from "vitest";
import { tabInventori } from "./tab-inventori";

/*
 * Tab halaman Inventori sekarang ditulis ke `?tab=` (dulu hanya dibaca saat
 * dimuat). Nilai dari URL bisa apa saja — yang tidak dikenal kembali ke Level Stok.
 */
describe("tabInventori", () => {
  it("tab yang dikenal", () => {
    expect(tabInventori("grn")).toBe("grn");
    expect(tabInventori("rolls")).toBe("rolls");
    expect(tabInventori("adjustments")).toBe("adjustments");
    expect(tabInventori("stock")).toBe("stock");
  });

  it("kosong atau tidak dikenal → stock", () => {
    expect(tabInventori(null)).toBe("stock");
    expect(tabInventori("")).toBe("stock");
    expect(tabInventori("<script>")).toBe("stock");
  });
});
