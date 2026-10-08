import { describe, expect, it } from "vitest";
import { perkiraanNilaiRetur, pisahTautanBukti } from "./perkiraan-nilai";

describe("perkiraanNilaiRetur", () => {
  it("kain dan aksesoris dinilai qty × harga rata-rata", () => {
    expect(
      perkiraanNilaiRetur(
        [
          { type: "FABRIC", itemId: "kain", qty: 50 },
          { type: "ACCESSORIES", itemId: "kancing", qty: 100 },
        ],
        { kain: 25_000, kancing: 200 },
      ),
    ).toEqual({ nilai: 1_270_000, adaBarangJadi: false, adaTanpaHarga: false });
  });

  it("barang jadi cacat tidak dijumlah tetapi ditandai (dinilai saat disimpan)", () => {
    const h = perkiraanNilaiRetur([{ type: "FG_REJECT", itemId: "kaos", qty: 3 }], { kaos: 50_000 });
    expect(h).toEqual({ nilai: 0, adaBarangJadi: true, adaTanpaHarga: false });
  });

  it("baris kosong diabaikan; barang tanpa harga rata-rata ditandai", () => {
    expect(
      perkiraanNilaiRetur(
        [
          { type: "ACCESSORIES", itemId: "", qty: 5 },
          { type: "ACCESSORIES", itemId: "x", qty: 0 },
          { type: "ACCESSORIES", itemId: "baru", qty: 2 },
        ],
        {},
      ),
    ).toEqual({ nilai: 0, adaBarangJadi: false, adaTanpaHarga: true });
  });
});

describe("pisahTautanBukti", () => {
  it("baris baru dan koma memisahkan; spasi dan kosong dibuang", () => {
    expect(pisahTautanBukti(" https://a.test/1 ,\nhttps://a.test/2\n\n")).toEqual(["https://a.test/1", "https://a.test/2"]);
  });
});
