import { describe, expect, it } from "vitest";
import { bacaParamKartuStok, tulisParamKartuStok } from "./param-kartu-stok";

/*
 * Kartu stok dulu tidak bisa dibuka langsung untuk satu barang dan pilihan
 * barang/varian/rentang tidak tersimpan di URL. Sekarang `?itemId=&varian=&dari=&sampai=`.
 */
const BAWAAN = { dari: "2026-09-06", sampai: "2026-10-06" };

describe("bacaParamKartuStok", () => {
  it("membaca barang, varian, dan rentang", () => {
    const sp = new URLSearchParams("itemId=item-1&varian=27000038P-BLK-S&dari=2026-01-01&sampai=2026-10-06");
    expect(bacaParamKartuStok(sp, BAWAAN)).toEqual({
      itemId: "item-1",
      varian: "27000038P-BLK-S",
      dari: "2026-01-01",
      sampai: "2026-10-06",
    });
  });

  it("tanpa parameter → bawaan 30 hari, tanpa barang", () => {
    expect(bacaParamKartuStok(new URLSearchParams(""), BAWAAN)).toEqual({ itemId: "", varian: "", ...BAWAAN });
  });

  it("tanggal rusak jatuh ke bawaan; rentang terbalik ditukar", () => {
    expect(bacaParamKartuStok(new URLSearchParams("dari=kemarin&sampai=2026-13-40"), BAWAAN)).toMatchObject(BAWAAN);
    expect(bacaParamKartuStok(new URLSearchParams("dari=2026-10-06&sampai=2026-01-01"), BAWAAN)).toMatchObject({
      dari: "2026-01-01",
      sampai: "2026-10-06",
    });
  });
});

describe("tulisParamKartuStok", () => {
  it("hanya yang terisi; rentang bawaan tidak ditulis", () => {
    expect(tulisParamKartuStok({ itemId: "item-1", varian: "", ...BAWAAN }, BAWAAN)).toBe("itemId=item-1");
    expect(tulisParamKartuStok({ itemId: "item-1", varian: "V-S", dari: "2026-01-01", sampai: "2026-10-06" }, BAWAAN)).toBe(
      "itemId=item-1&varian=V-S&dari=2026-01-01&sampai=2026-10-06",
    );
    expect(tulisParamKartuStok({ itemId: "", varian: "", ...BAWAAN }, BAWAAN)).toBe("");
  });
});
