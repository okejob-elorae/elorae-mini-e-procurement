import { describe, expect, it } from "vitest";
import {
  asalBarisNri,
  bacaJenisGerakRusak,
  bacaKeputusanGudangRusak,
  kondisiRusak,
  kunciRusak,
  periksaKeputusanRusak,
  qtyBertanda,
  rapikanCatatanGudangRusak,
  sisaKirimBalikPembeli,
} from "./gudang-rusak";

describe("periksaKeputusanRusak", () => {
  const dasar = { keputusan: "MUSNAHKAN", qty: 2, catatan: "  sobek   parah  " };

  it("menerima keputusan sah, merapikan catatan, dan mengabaikan nilai selain jual obral", () => {
    expect(periksaKeputusanRusak({ ...dasar, nilai: 5000 }, 3)).toEqual({ ok: true, keputusan: "MUSNAHKAN", qty: 2, catatan: "sobek parah", nilai: null });
  });

  it("jual obral: nilai opsional — kosong berarti belum diketahui (null), bukan nol", () => {
    expect(periksaKeputusanRusak({ ...dasar, keputusan: "JUAL_OBRAL", nilai: "" }, 3)).toMatchObject({ ok: true, nilai: null });
    expect(periksaKeputusanRusak({ ...dasar, keputusan: "JUAL_OBRAL", nilai: 0 }, 3)).toMatchObject({ ok: true, nilai: 0 });
    expect(periksaKeputusanRusak({ ...dasar, keputusan: "JUAL_OBRAL", nilai: 12500.555 }, 3)).toMatchObject({ ok: true, nilai: 12500.56 });
    expect(periksaKeputusanRusak({ ...dasar, keputusan: "JUAL_OBRAL", nilai: -1 }, 3)).toEqual({ ok: false, alasan: "NILAI_TIDAK_SAH" });
    expect(periksaKeputusanRusak({ ...dasar, keputusan: "JUAL_OBRAL", nilai: "abc" }, 3)).toEqual({ ok: false, alasan: "NILAI_TIDAK_SAH" });
  });

  it("menolak keputusan, jumlah, dan catatan yang tidak sah", () => {
    expect(periksaKeputusanRusak({ ...dasar, keputusan: "MASUK_RETUR" }, 3)).toEqual({ ok: false, alasan: "KEPUTUSAN_TIDAK_SAH" });
    for (const qty of [0, -1, 1.5, "2", null]) {
      expect(periksaKeputusanRusak({ ...dasar, qty }, 3)).toEqual({ ok: false, alasan: "JUMLAH_TIDAK_SAH" });
    }
    expect(periksaKeputusanRusak({ ...dasar, catatan: "   " }, 3)).toEqual({ ok: false, alasan: "CATATAN_WAJIB" });
    expect(periksaKeputusanRusak({ ...dasar, catatan: "x".repeat(301) }, 3)).toEqual({ ok: false, alasan: "CATATAN_WAJIB" });
  });

  it("keluar tidak pernah melebihi saldo", () => {
    expect(periksaKeputusanRusak({ ...dasar, qty: 3 }, 3)).toMatchObject({ ok: true, qty: 3 });
    expect(periksaKeputusanRusak({ ...dasar, qty: 4 }, 3)).toEqual({ ok: false, alasan: "SALDO_KURANG" });
    expect(periksaKeputusanRusak({ ...dasar, qty: 1 }, 0)).toEqual({ ok: false, alasan: "SALDO_KURANG" });
  });
});

describe("asalBarisNri", () => {
  const baris = { itemId: "A", variantSku: "A-M" };

  it("hitungan tanpa nota toko = TANPA_NOTA", () => {
    expect(asalBarisNri(baris, null)).toEqual(["TANPA_NOTA"]);
  });

  it("dikenali dari penunjuk baris NRT (barang + varian sama, kondisi bukan LAYAK)", () => {
    const nrt = {
      items: [
        { itemId: "A", variantSku: "A-M", condition: "RUSAK", spgSaleReturnLineId: "rp1" },
        { itemId: "A", variantSku: "A-M", condition: "RUSAK", storeReceiptLineId: "srl1" },
        { itemId: "A", variantSku: "A-M", condition: "EXPIRED" },
        // Tidak ikut: LAYAK, varian lain, barang lain.
        { itemId: "A", variantSku: "A-M", condition: "LAYAK", spgSaleReturnLineId: "x" },
        { itemId: "A", variantSku: "A-L", condition: "RUSAK", storeReceiptLineId: "y" },
        { itemId: "B", variantSku: "A-M", condition: "RUSAK", spgSaleReturnLineId: "z" },
      ],
    };
    expect(asalBarisNri(baris, nrt)).toEqual(["RETUR_PEMBELI", "KIRIMAN_RUSAK", "NRT"]);
    expect(asalBarisNri({ itemId: "A", variantSku: "A-L" }, nrt)).toEqual(["KIRIMAN_RUSAK"]);
  });

  it("nota toko tanpa baris rusak yang cocok tetap NRT (gudang menemukan rusaknya sendiri)", () => {
    expect(asalBarisNri(baris, { items: [{ itemId: "A", variantSku: "A-M", condition: "LAYAK" }] })).toEqual(["NRT"]);
  });

  it("varian kosong dan null dianggap sama", () => {
    expect(asalBarisNri({ itemId: "A", variantSku: null }, { items: [{ itemId: "A", variantSku: "", condition: "RUSAK", spgSaleReturnLineId: "r" }] })).toEqual([
      "RETUR_PEMBELI",
    ]);
  });
});

describe("pembantu kecil", () => {
  it("qty bertanda: masuk positif, keputusan negatif", () => {
    expect(qtyBertanda("MASUK_RETUR", 3)).toBe(3);
    expect(qtyBertanda("PERBAIKI", 3)).toBe(-3);
    expect(qtyBertanda("JUAL_OBRAL", -3)).toBe(-3);
    expect(qtyBertanda("MUSNAHKAN", 1)).toBe(-1);
  });

  it("kondisi rusak hanya RUSAK/EXPIRED", () => {
    expect(kondisiRusak("RUSAK")).toBe(true);
    expect(kondisiRusak("EXPIRED")).toBe(true);
    expect(kondisiRusak("LAYAK")).toBe(false);
    expect(kondisiRusak(undefined)).toBe(false);
  });

  it("pembaca kode menolak yang tidak dikenal", () => {
    expect(bacaKeputusanGudangRusak("PERBAIKI")).toBe("PERBAIKI");
    expect(bacaKeputusanGudangRusak("MASUK_RETUR")).toBeNull();
    expect(bacaJenisGerakRusak("MASUK_RETUR")).toBe("MASUK_RETUR");
    expect(bacaJenisGerakRusak("HILANG")).toBeNull();
  });

  it("sisa kirim balik tidak pernah negatif; kunci saldo merapikan varian", () => {
    expect(sisaKirimBalikPembeli(3, 1)).toBe(2);
    expect(sisaKirimBalikPembeli(3, 5)).toBe(0);
    expect(kunciRusak("A", " A-M ")).toBe("A::A-M");
    expect(kunciRusak("A", null)).toBe("A::");
    expect(rapikanCatatanGudangRusak(42)).toBeNull();
  });
});
