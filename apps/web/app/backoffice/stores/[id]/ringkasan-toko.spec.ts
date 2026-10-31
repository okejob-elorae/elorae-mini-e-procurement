import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { batasBerlaku, formatJarak } from "./ringkasan-toko";

describe("formatJarak", () => {
  it("di bawah 1 km ditulis dalam meter dengan titik ribuan tidak perlu", () => {
    expect(formatJarak(0)).toBe("0 m");
    expect(formatJarak(850)).toBe("850 m");
    expect(formatJarak(999.4)).toBe("999 m");
  });

  it("1 km ke atas ditulis dalam km, satu desimal koma", () => {
    expect(formatJarak(1000)).toBe("1 km");
    expect(formatJarak(1250)).toBe("1,3 km");
    expect(formatJarak(573345)).toBe("573,3 km");
    expect(formatJarak(12_345_678)).toBe("12.345,7 km");
  });
});

describe("batasBerlaku — batas toko menimpa bawaan, kosong ikut bawaan", () => {
  it("toko punya batas sendiri", () => {
    expect(batasBerlaku(15_000_000, 20_000_000)).toEqual({ sumber: "TOKO", nilai: 15_000_000 });
  });

  it("0 adalah batas sah (tidak boleh ada), bukan kosong", () => {
    expect(batasBerlaku(0, 20_000_000)).toEqual({ sumber: "TOKO", nilai: 0 });
  });

  it("toko kosong → bawaan", () => {
    expect(batasBerlaku(null, 20_000_000)).toEqual({ sumber: "BAWAAN", nilai: 20_000_000 });
  });

  it("toko dan bawaan kosong → tidak dibatasi", () => {
    expect(batasBerlaku(null, null)).toEqual({ sumber: "TANPA", nilai: null });
  });
});

describe("tautan Target stok di kartu buku stok SPG", () => {
  // Target stok dijaga stores:manage; tautan untuk pemegang stores:view saja hanya memantul balik.
  it("hanya untuk toko konsinyasi dan pemegang izin kelola toko", () => {
    const rincian = readFileSync(path.join(__dirname, "StoreDetailView.tsx"), "utf8");
    expect(rincian).toContain('tautanTitipan={store.termsType === "KONSI" && canEdit ?');
    const halaman = readFileSync(path.join(__dirname, "target-stok", "page.tsx"), "utf8");
    expect(halaman).toContain("PERMISSIONS.STORES_MANAGE");
  });
});
