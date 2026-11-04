import { describe, expect, it } from "vitest";
import { konfirmasiGrnDariUrl, tabInventori } from "./tab-inventori";

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

/*
 * Tautan Beranda "GRN tanpa PO menunggu konfirmasi" membuka `?tab=grn&konfirmasi=menunggu`; dulu
 * halaman tidak membaca `konfirmasi`, jadi angka Beranda membuka daftar GRN lengkap.
 */
describe("konfirmasiGrnDariUrl", () => {
  it("menunggu → saringan menunggu konfirmasi", () => {
    expect(konfirmasiGrnDariUrl("menunggu")).toBe("menunggu");
  });

  it("kosong atau tidak dikenal → tanpa saringan", () => {
    expect(konfirmasiGrnDariUrl(null)).toBeNull();
    expect(konfirmasiGrnDariUrl(undefined)).toBeNull();
    expect(konfirmasiGrnDariUrl("")).toBeNull();
    expect(konfirmasiGrnDariUrl("dikonfirmasi")).toBeNull();
    expect(konfirmasiGrnDariUrl("MENUNGGU")).toBeNull();
  });
});
