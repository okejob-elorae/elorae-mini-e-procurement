import { afterEach, describe, expect, it } from "vitest";
import { alamatDaftarPo, bacaCariPo, bacaHalamanPo, jepitHalaman, syaratCariPo } from "./cari-po";

const URL_ASLI = process.env.DATABASE_URL;
afterEach(() => {
  process.env.DATABASE_URL = URL_ASLI;
});

describe("syaratCariPo", () => {
  it("kosong → tanpa syarat (semua PO)", () => {
    expect(syaratCariPo("")).toBeNull();
    expect(syaratCariPo("   ")).toBeNull();
    expect(syaratCariPo(undefined)).toBeNull();
  });

  it("mencari nomor PO, nama pemasok, dan kode pemasok di server", () => {
    process.env.DATABASE_URL = "mysql://x@localhost:1/db";
    expect(syaratCariPo(" 0063 ")).toEqual({
      OR: [
        { docNumber: { contains: "0063" } },
        { supplier: { name: { contains: "0063" } } },
        { supplier: { code: { contains: "0063" } } },
      ],
    });
  });

  it("di PostgreSQL abai huruf besar-kecil lewat cariTeks", () => {
    process.env.DATABASE_URL = "postgresql://x@localhost:1/db";
    expect(syaratCariPo("kain")?.OR[1]).toEqual({ supplier: { name: { contains: "kain", mode: "insensitive" } } });
  });
});

describe("baca alamat daftar PO", () => {
  it("kata kunci dipangkas dan dibatasi panjangnya", () => {
    expect(bacaCariPo("  PO/2026  ")).toBe("PO/2026");
    expect(bacaCariPo("x".repeat(300))).toHaveLength(100);
  });

  it("halaman rusak jatuh ke 1", () => {
    expect(bacaHalamanPo("2")).toBe(2);
    expect(bacaHalamanPo("0")).toBe(1);
    expect(bacaHalamanPo("abc")).toBe(1);
    expect(bacaHalamanPo(undefined)).toBe(1);
  });

  it("halaman dijepit ke halaman terakhir hasil saringan", () => {
    expect(jepitHalaman(2, 13, 10)).toBe(2);
    expect(jepitHalaman(5, 13, 10)).toBe(2);
    expect(jepitHalaman(3, 0, 10)).toBe(1);
  });
});

describe("alamatDaftarPo", () => {
  it("menulis saringan yang terisi saja; halaman 1 dan kosong tidak ditulis", () => {
    expect(alamatDaftarPo({ status: "", cari: "", halaman: 1 })).toBe("");
    expect(alamatDaftarPo({ status: "overdue", cari: " 0063 ", halaman: 2 })).toBe("status=overdue&cari=0063&halaman=2");
    expect(alamatDaftarPo({ status: "", cari: "PO/2026", halaman: 1 })).toBe("cari=PO%2F2026");
  });
});
