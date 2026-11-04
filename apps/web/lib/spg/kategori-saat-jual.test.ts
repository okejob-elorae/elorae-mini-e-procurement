import { describe, expect, it } from "vitest";
import { kategoriSaatJual } from "./kategori-saat-jual";

/*
 * Kategori yang berlaku saat barang terjual (P8) untuk nota antrean HP yang sampai sesudah kategori
 * barangnya diubah. Murni — perubahan kategori disuapkan langsung.
 */

const waktu = new Date("2026-11-01T10:00:00+07:00");
const dibaca = new Date("2026-11-03T09:00:00+07:00");
const jam = (iso: string) => new Date(iso);

describe("kategoriSaatJual", () => {
  it("tanpa perubahan sesudah waktu jual: kategori master, dicatat saat dibaca (perilaku lama)", () => {
    expect(kategoriSaatJual({ sekarangId: "kaos", jejak: undefined, waktu, dibaca })).toEqual({
      categoryId: "kaos",
      categoryAt: dibaca,
      categoryFilledLater: false,
    });
    expect(kategoriSaatJual({ sekarangId: null, jejak: [], waktu, dibaca })).toEqual({ categoryId: null, categoryAt: dibaca, categoryFilledLater: false });
  });

  it("kategori diubah sesudah waktu jual: kategori yang berlaku saat terjual, dicatat pada waktu jualnya", () => {
    const jejak = [
      { createdAt: jam("2026-11-02T08:00:00+07:00"), sebelum: "kaos", sesudah: "kemeja" },
      { createdAt: jam("2026-11-02T15:00:00+07:00"), sebelum: "kemeja", sesudah: "jaket" },
    ];
    expect(kategoriSaatJual({ sekarangId: "jaket", jejak, waktu, dibaca })).toEqual({
      categoryId: "kaos",
      categoryAt: waktu,
      categoryFilledLater: false,
    });
  });

  it("kategori dihapus sesudah waktu jual: baris tetap memakai kategori saat terjual", () => {
    const jejak = [{ createdAt: jam("2026-11-02T08:00:00+07:00"), sebelum: "kaos", sesudah: null }];
    expect(kategoriSaatJual({ sekarangId: null, jejak, waktu, dibaca })).toEqual({ categoryId: "kaos", categoryAt: waktu, categoryFilledLater: false });
  });

  it("belum berkategori saat terjual lalu diberi kategori: disimpan seperti isi kemudian (P69) saat diberikan", () => {
    const diberi = jam("2026-11-02T08:00:00+07:00");
    const jejak = [
      { createdAt: diberi, sebelum: null, sesudah: "kaos" },
      { createdAt: jam("2026-11-02T15:00:00+07:00"), sebelum: "kaos", sesudah: "kemeja" },
    ];
    expect(kategoriSaatJual({ sekarangId: "kemeja", jejak, waktu, dibaca })).toEqual({
      categoryId: "kaos",
      categoryAt: diberi,
      categoryFilledLater: true,
    });
  });
});
