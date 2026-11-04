import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { bacaBerkasHpp } from "./baca-berkas";

const CSV = ["SKU,Nama barang,HPP baru", "GMS-S,Gamis S,\"90.000\"", "GMS-M,Gamis M,\"1.250.000\"", "KMJ,Kemeja,85000,50", "CLN,Celana,"].join("\n");

describe("bacaBerkasHpp", () => {
  it("CSV: \"90.000\" dibaca sembilan puluh ribu (raw: true), bukan 90", () => {
    const h = bacaBerkasHpp(CSV);
    expect(h.tanpaJudul).toBe(false);
    expect(h.baris.find((b) => b.sku === "GMS-S")?.hpp).toBe(90_000);
    expect(h.baris.find((b) => b.sku === "GMS-M")?.hpp).toBe(1_250_000);
  });

  it("TANPA raw: true SheetJS memang merusak nilainya — inilah yang dijaga", () => {
    const wb = XLSX.read(CSV, { type: "string" });
    const sel = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    expect(sel[1][2]).toBe(90);
  });

  it("baris tanpa HPP dilewati (HPP-nya tidak diubah)", () => {
    const h = bacaBerkasHpp(CSV);
    expect(h.baris.map((b) => b.sku)).not.toContain("CLN");
  });

  it("berkas .xlsx (sel angka asli)", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["SKU", "HPP sekarang", "HPP baru"],
      ["A-1", 1000, 125000.5],
      ["A-2", 1000, ""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Persediaan");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const h = bacaBerkasHpp(buf);
    // "HPP baru" didahulukan atas kolom HPP lain.
    expect(h.baris).toEqual([{ baris: 2, sku: "A-1", hpp: 125000.5 }]);
  });
});
