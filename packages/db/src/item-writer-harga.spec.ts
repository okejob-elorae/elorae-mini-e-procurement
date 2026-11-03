import { describe, expect, it } from "vitest";
import { hargaJubelioBerbeda, keputusanHargaBerlaku, senPositif } from "./item-writer-harga";

/*
 * Owner answers 2026-11-02: P1 (the highest variant price is THE Jubelio price), P2 (a price edited
 * in Jubelio raises a warning), P75 (while it is open no push may change the Jubelio price). The
 * api product push holds on exactly these two predicates.
 */
describe("senPositif", () => {
  it.each([
    [null, null],
    [undefined, null],
    ["", null],
    ["abc", null],
    ["0", null],
    [0, null],
    [-5, null],
    ["150000", 15_000_000],
    ["150000.5", 15_000_050],
    [150_000.004, 15_000_000],
    [{ toFixed: () => "99.99" }, 9_999],
  ])("%p → %p", (masuk, keluar) => {
    expect(senPositif(masuk as never)).toBe(keluar);
  });
});

describe("hargaJubelioBerbeda", () => {
  it.each([
    ["sama di semua varian", "110000", "110000", "110000.00", false],
    ["tertinggi berbeda", "120000", "110000", "110000", true],
    ["terendah berbeda (varian lebih murah)", "110000", "100000", "110000", true],
    ["satu varian tanpa harga (terendah 0)", "110000", "0", "110000", true],
    ["tanpa harga di kedua sisi", null, "0", null, false],
    ["0 di ERP sama dengan tanpa harga", null, null, "0", false],
    ["Jubelio tanpa harga, ERP berharga", null, "0", "110000", true],
    ["beda di bawah satu sen tidak dihitung", "110000.001", "110000", "110000", false],
    ["teks tak terbaca = tanpa harga", "x", "x", null, false],
  ])("%s", (_label, tertinggi, terendah, terkonfirmasi, hasil) => {
    expect(hargaJubelioBerbeda({ tertinggi, terendah, terkonfirmasi })).toBe(hasil);
  });
});

describe("keputusanHargaBerlaku", () => {
  const sebelum = new Date("2026-11-03T01:00:00.000Z");
  const sesudah = new Date("2026-11-03T02:00:00.000Z");

  it("tanpa keputusan → tidak berlaku", () => {
    expect(keputusanHargaBerlaku({ diputuskanPada: null, berubahPada: null })).toBe(false);
    expect(keputusanHargaBerlaku({ diputuskanPada: null, berubahPada: sebelum })).toBe(false);
  });

  it("keputusan sesudah (atau tepat saat) bacaan berubah → berlaku", () => {
    expect(keputusanHargaBerlaku({ diputuskanPada: sesudah, berubahPada: sebelum })).toBe(true);
    expect(keputusanHargaBerlaku({ diputuskanPada: sebelum, berubahPada: sebelum })).toBe(true);
    expect(keputusanHargaBerlaku({ diputuskanPada: sebelum, berubahPada: null })).toBe(true);
  });

  it("Jubelio berubah lagi sesudah keputusan → keputusannya tidak berlaku", () => {
    expect(keputusanHargaBerlaku({ diputuskanPada: sebelum, berubahPada: sesudah })).toBe(false);
  });
});
