import { describe, expect, it } from "vitest";
import { bacaJumlah, jumlahDalamSisa, rapikanJumlah, tulisJumlah, tulisRupiah } from "./jumlah-bayar";

/*
 * Isian jumlah pembayaran toko. Tagihan konsinyasi bisa berpecahan sen (harga
 * konsi hasil gross-up, potongan promo dibagi per sen), jadi isian yang hanya
 * menerima rupiah bulat membuat tagihan seperti Rp1.234.567,40 tidak pernah
 * bisa dilunasi dari layar: "Isi sisa" membulatkan ke 1.234.567 (tersisa 40 sen
 * yang tidak bisa diketik) atau ke 1.234.568 (ditolak server: melebihi sisa).
 */
describe("jumlah pembayaran toko", () => {
  it("membaca format Indonesia: titik ribuan, koma desimal, paling banyak dua angka sen", () => {
    expect(bacaJumlah("600.000")).toBe(600_000);
    expect(bacaJumlah("Rp 1.234.567,40")).toBe(1_234_567.4);
    expect(bacaJumlah("1.234.567,4")).toBe(1_234_567.4);
    expect(bacaJumlah("0,60")).toBe(0.6);
    expect(bacaJumlah("")).toBe(0);
    expect(bacaJumlah("abc")).toBe(0);
  });

  it("merapikan ketikan tanpa membuang koma yang sedang diketik", () => {
    expect(rapikanJumlah("1234567")).toBe("1.234.567");
    expect(rapikanJumlah("1.234.567,")).toBe("1.234.567,");
    expect(rapikanJumlah("1234567,456")).toBe("1.234.567,45");
    expect(rapikanJumlah("007")).toBe("7");
    expect(rapikanJumlah(",5")).toBe("0,5");
    expect(rapikanJumlah("")).toBe("");
  });

  it("'Isi sisa' menulis sisa persis sampai sen, dan hasilnya terbaca kembali sama", () => {
    expect(tulisJumlah(1_234_567.4)).toBe("1.234.567,40");
    expect(tulisJumlah(900_000)).toBe("900.000");
    expect(bacaJumlah(tulisJumlah(1_234_567.6))).toBe(1_234_567.6);
  });

  it("jumlah sah = lebih dari nol dan tidak melebihi sisa, dibandingkan per sen", () => {
    expect(jumlahDalamSisa(1_234_567.4, 1_234_567.4)).toBe(true);
    expect(jumlahDalamSisa(1_234_567.41, 1_234_567.4)).toBe(false);
    expect(jumlahDalamSisa(0.4, 0.4)).toBe(true);
    expect(jumlahDalamSisa(1, 0.4)).toBe(false);
    expect(jumlahDalamSisa(0, 900_000)).toBe(false);
  });

  it("rupiah ditampilkan dengan sen hanya kalau ada sen", () => {
    expect(tulisRupiah(900_000)).toBe("Rp 900.000");
    expect(tulisRupiah(0.4)).toBe("Rp 0,40");
    expect(tulisRupiah(-1_500)).toBe("Rp 1.500");
  });
});
