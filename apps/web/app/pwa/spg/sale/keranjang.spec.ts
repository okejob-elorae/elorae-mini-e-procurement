import { describe, expect, it } from "vitest";
import {
  angkaDiskon,
  diskonUntukMesin,
  kekuranganJual,
  masalahPembeliBaru,
  pembeliUntukKirim,
  uraiSimpananKeranjang,
} from "./keranjang";

describe("uraiSimpananKeranjang", () => {
  it("restores lines, key, discount and shopper", () => {
    const s = uraiSimpananKeranjang(
      JSON.stringify({
        baris: [["i1::M", 2]],
        idempotencyKey: "k1",
        diskon: { jenis: "PERSEN", nilai: "5", alasan: "cacat" },
        pembeli: { jenis: "baru", nama: "Ani", hp: "0812", setuju: true },
      }),
    );
    expect(s).toEqual({
      baris: [["i1::M", 2]],
      idempotencyKey: "k1",
      diskon: { jenis: "PERSEN", nilai: "5", alasan: "cacat" },
      pembeli: { jenis: "baru", nama: "Ani", hp: "0812", setuju: true },
    });
  });

  it("reads a cart saved before discounts and shoppers existed", () => {
    expect(uraiSimpananKeranjang(JSON.stringify({ baris: [["i1::", 1]], idempotencyKey: "k1" }))).toEqual({
      baris: [["i1::", 1]],
      idempotencyKey: "k1",
      diskon: null,
      pembeli: null,
    });
  });

  it("drops broken lines and broken parts, and refuses a cart without its key", () => {
    const s = uraiSimpananKeranjang(
      JSON.stringify({
        baris: [["a", 0], ["b", 1.5], [3, 1], ["c", 2]],
        idempotencyKey: "k1",
        diskon: { jenis: "GRATIS", nilai: "5", alasan: "" },
        pembeli: { jenis: "ada", nama: "Budi", hp: "62812" },
      }),
    );
    expect(s?.baris).toEqual([["c", 2]]);
    expect(s?.diskon).toBeNull();
    expect(s?.pembeli).toBeNull();
    expect(uraiSimpananKeranjang(JSON.stringify({ baris: [], idempotencyKey: "" }))).toBeNull();
    expect(uraiSimpananKeranjang("{rusak")).toBeNull();
    expect(uraiSimpananKeranjang(null)).toBeNull();
  });
});

describe("angkaDiskon / diskonUntukMesin", () => {
  it("reads rupiah with thousands dots and percent with a decimal comma", () => {
    expect(angkaDiskon({ jenis: "RUPIAH", nilai: "10.000" })).toBe(10_000);
    expect(angkaDiskon({ jenis: "RUPIAH", nilai: "10 000" })).toBe(10_000);
    expect(angkaDiskon({ jenis: "PERSEN", nilai: "12,5" })).toBe(12.5);
    expect(angkaDiskon({ jenis: "PERSEN", nilai: "7" })).toBe(7);
  });

  it("returns null for empty input and NaN for something that is not a number", () => {
    expect(angkaDiskon({ jenis: "PERSEN", nilai: "  " })).toBeNull();
    expect(angkaDiskon({ jenis: "PERSEN", nilai: "5%" })).toBeNaN();
    expect(angkaDiskon({ jenis: "RUPIAH", nilai: "Rp5000" })).toBeNaN();
  });

  it("gives the engine no discount for an empty, zero, or unreadable amount", () => {
    expect(diskonUntukMesin(null)).toBeNull();
    expect(diskonUntukMesin({ jenis: "PERSEN", nilai: "", alasan: "" })).toBeNull();
    expect(diskonUntukMesin({ jenis: "PERSEN", nilai: "0", alasan: "" })).toBeNull();
    expect(diskonUntukMesin({ jenis: "PERSEN", nilai: "abc", alasan: "" })).toBeNull();
    expect(diskonUntukMesin({ jenis: "RUPIAH", nilai: "5.000", alasan: "" })).toEqual({ jenis: "RUPIAH", nilai: 5_000 });
  });
});

describe("masalahPembeliBaru — same rules as the server", () => {
  it("needs a name, a WhatsApp-able mobile number, and consent — in that order", () => {
    expect(masalahPembeliBaru({ nama: " ", hp: "081234567890", setuju: true })).toBe("NAMA");
    expect(masalahPembeliBaru({ nama: "Ani", hp: "022-123456", setuju: true })).toBe("HP");
    expect(masalahPembeliBaru({ nama: "Ani", hp: "0812", setuju: true })).toBe("HP");
    expect(masalahPembeliBaru({ nama: "Ani", hp: "0812 3456 7890", setuju: false })).toBe("SETUJU");
    expect(masalahPembeliBaru({ nama: "Ani", hp: "0812 3456 7890", setuju: true })).toBeNull();
  });
});

describe("pembeliUntukKirim", () => {
  it("sends an existing customer by id and a complete new shopper trimmed", () => {
    expect(pembeliUntukKirim({ jenis: "ada", id: "c1", nama: "Budi", hp: "62812" })).toEqual({ id: "c1", nama: "Budi" });
    expect(pembeliUntukKirim({ jenis: "baru", nama: " Ani ", hp: " 081234567890 ", setuju: true })).toEqual({
      nama: "Ani",
      hp: "081234567890",
      setuju: true,
    });
  });

  it("never sends a new shopper without consent", () => {
    expect(pembeliUntukKirim({ jenis: "baru", nama: "Ani", hp: "081234567890", setuju: false })).toBeNull();
  });
});

describe("kekuranganJual", () => {
  const tanpa = { diskon: null, alasanWajib: true, galatMesin: null, pembeli: null } as const;

  it("lets a plain cart through", () => {
    expect(kekuranganJual(tanpa)).toBeNull();
  });

  it("names the discount problem first, in form order", () => {
    expect(kekuranganJual({ ...tanpa, diskon: { jenis: "PERSEN", nilai: "", alasan: "" } })).toBe("DISKON_KOSONG");
    expect(kekuranganJual({ ...tanpa, diskon: { jenis: "PERSEN", nilai: "x", alasan: "" } })).toBe("DISKON_TIDAK_VALID");
    expect(
      kekuranganJual({ ...tanpa, diskon: { jenis: "PERSEN", nilai: "50", alasan: "" }, galatMesin: "DISKON_MANUAL_LEWAT_BATAS" }),
    ).toBe("DISKON_MANUAL_LEWAT_BATAS");
    expect(kekuranganJual({ ...tanpa, diskon: { jenis: "PERSEN", nilai: "5", alasan: " " } })).toBe("ALASAN_DISKON_WAJIB");
    expect(kekuranganJual({ ...tanpa, alasanWajib: false, diskon: { jenis: "PERSEN", nilai: "5", alasan: "" } })).toBeNull();
  });

  it("then the new shopper", () => {
    expect(
      kekuranganJual({
        ...tanpa,
        diskon: { jenis: "PERSEN", nilai: "5", alasan: "" },
        pembeli: { jenis: "baru", nama: "", hp: "", setuju: false },
      }),
    ).toBe("ALASAN_DISKON_WAJIB");
    expect(kekuranganJual({ ...tanpa, pembeli: { jenis: "baru", nama: "Ani", hp: "081234567890", setuju: false } })).toBe(
      "PEMBELI_SETUJU",
    );
    expect(kekuranganJual({ ...tanpa, pembeli: { jenis: "ada", id: "c1", nama: "Budi", hp: "62812" } })).toBeNull();
  });
});
