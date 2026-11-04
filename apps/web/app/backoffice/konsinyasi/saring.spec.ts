import { describe, expect, it } from "vitest";
import { bacaSaringSiklus, saringSiklus } from "./saring";

const s = (noKonsi: string, tahap: string, storeName = "Butik Eloraé Senayan", noNota: string | null = null) => ({
  noKonsi,
  tahap: tahap as never,
  storeName,
  periode: "Agu 2026",
  noNota,
  noFakturPajak: null,
});

const baris = [
  s("KONSI/26/08/0001", "bayar_toko", "Butik Eloraé Senayan", "NP-202608-0058"),
  s("KONSI/26/08/0002", "selesai"),
  s("KONSI/26/09/0003", "laporan", "Toko Makmur"),
];

describe("saringSiklus", () => {
  it("bawaan menyembunyikan siklus yang sudah selesai", () => {
    expect(saringSiklus(baris, { saring: "berjalan", cari: "" }).map((b) => b.noKonsi)).toEqual([
      "KONSI/26/08/0001",
      "KONSI/26/09/0003",
    ]);
  });

  it("per tahap dan semua", () => {
    expect(saringSiklus(baris, { saring: "selesai", cari: "" }).map((b) => b.noKonsi)).toEqual(["KONSI/26/08/0002"]);
    expect(saringSiklus(baris, { saring: "semua", cari: "" })).toHaveLength(3);
  });

  it("mencari nomor konsi, toko (abai aksen), dan nomor nota", () => {
    expect(saringSiklus(baris, { saring: "semua", cari: "elorae" })).toHaveLength(2);
    expect(saringSiklus(baris, { saring: "semua", cari: "NP-2026" }).map((b) => b.noKonsi)).toEqual(["KONSI/26/08/0001"]);
  });

  it("membaca ?tahap= dengan bawaan berjalan", () => {
    expect(bacaSaringSiklus(undefined)).toBe("berjalan");
    expect(bacaSaringSiklus("semua")).toBe("semua");
    expect(bacaSaringSiklus("bayar_spg")).toBe("bayar_spg");
    expect(bacaSaringSiklus("ngawur")).toBe("berjalan");
  });
});
