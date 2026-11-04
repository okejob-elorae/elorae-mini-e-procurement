import { describe, expect, it } from "vitest";
import { bacaSaringKontrabon, saringKontrabon } from "./saring";

const k = (docNo: string, status: "BERJALAN" | "SELESAI" | "BATAL", dikonfirmasi = true, storeName = "Toko Sinar Jaya") => ({
  docNo,
  status,
  dikonfirmasi,
  storeName,
  salesmanName: "Budi",
  receivedBy: null,
});

const baris = [
  k("TT/2026/0001", "BERJALAN"),
  k("TT/2026/0002", "SELESAI"),
  k("TT/2026/0003", "BERJALAN", false, "Toko Makmur"),
  k("TT/2026/0004", "BATAL"),
];

describe("saringKontrabon", () => {
  it("bawaan hanya yang berjalan — yang selesai dan batal disembunyikan", () => {
    expect(saringKontrabon(baris, { saring: "berjalan", cari: "" }).map((b) => b.docNo)).toEqual([
      "TT/2026/0001",
      "TT/2026/0003",
    ]);
  });

  it("belum dikonfirmasi dan semua", () => {
    expect(saringKontrabon(baris, { saring: "belum", cari: "" }).map((b) => b.docNo)).toEqual(["TT/2026/0003"]);
    expect(saringKontrabon(baris, { saring: "semua", cari: "" })).toHaveLength(4);
  });

  it("mencari nomor dan toko", () => {
    expect(saringKontrabon(baris, { saring: "semua", cari: "makmur" }).map((b) => b.docNo)).toEqual(["TT/2026/0003"]);
    expect(saringKontrabon(baris, { saring: "semua", cari: "0002" }).map((b) => b.docNo)).toEqual(["TT/2026/0002"]);
  });

  it("membaca ?saring= dengan bawaan berjalan", () => {
    expect(bacaSaringKontrabon(undefined)).toBe("berjalan");
    expect(bacaSaringKontrabon("belum")).toBe("belum");
    expect(bacaSaringKontrabon("semua")).toBe("semua");
    expect(bacaSaringKontrabon("x")).toBe("berjalan");
  });
});
