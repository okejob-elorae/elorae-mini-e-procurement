import { describe, expect, it } from "vitest";
import {
  bacaAngkaUkuran,
  bacaTabelUkuran,
  periksaTabelUkuran,
  pilihTabelUkuran,
  ringkasUkuran,
  teksAngkaUkuran,
  type IsianTabelUkuran,
} from "./size-chart";

const dasar = (ubah: Partial<IsianTabelUkuran> = {}): IsianTabelUkuran => ({
  name: "Kaos dewasa",
  unit: "cm",
  categoryId: null,
  columns: ["Lebar dada", "Panjang badan"],
  rows: [
    { ukuran: "S", nilai: [48, 68] },
    { ukuran: "M", nilai: [50, 70.5] },
  ],
  note: "Ukur di permukaan datar.",
  isActive: true,
  ...ubah,
});

const masalah = (isian: IsianTabelUkuran) => {
  const h = periksaTabelUkuran(isian);
  return h.ok ? [] : h.masalah;
};

describe("periksaTabelUkuran", () => {
  it("accepts a well-formed chart and tidies the text", () => {
    const h = periksaTabelUkuran(
      dasar({ name: "  Kaos   dewasa ", columns: [" Lebar  dada", "Panjang badan "], categoryId: " cat1 ", note: "  " }),
    );
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.data.name).toBe("Kaos dewasa");
    expect(h.data.columns).toEqual(["Lebar dada", "Panjang badan"]);
    expect(h.data.categoryId).toBe("cat1");
    expect(h.data.note).toBeNull();
    expect(h.data.rows[1]).toEqual({ ukuran: "M", nilai: [50, 70.5] });
  });

  it("requires a name and a known unit", () => {
    expect(masalah(dasar({ name: "  " }))).toContain("NAMA_WAJIB");
    expect(masalah(dasar({ name: "x".repeat(101) }))).toContain("NAMA_TERLALU_PANJANG");
    expect(masalah(dasar({ unit: "mm" }))).toContain("SATUAN_TIDAK_DIKENAL");
    expect(masalah(dasar({ unit: "inci" }))).toEqual([]);
  });

  it("needs at least one column, unique and non-empty, at most twelve", () => {
    expect(masalah(dasar({ columns: [], rows: [{ ukuran: "S", nilai: [] }] }))).toContain("KOLOM_WAJIB");
    expect(masalah(dasar({ columns: ["Lebar dada", ""] }))).toContain("KOLOM_KOSONG");
    expect(masalah(dasar({ columns: ["Lebar dada", "lebar  DADA"] }))).toContain("KOLOM_GANDA");
    expect(masalah(dasar({ columns: ["x".repeat(41), "y"] }))).toContain("KOLOM_TERLALU_PANJANG");
    const tiga13 = Array.from({ length: 13 }, (_, i) => `K${i}`);
    expect(masalah(dasar({ columns: tiga13, rows: [{ ukuran: "S", nilai: tiga13.map(() => 1) }] }))).toContain(
      "KOLOM_TERLALU_BANYAK",
    );
  });

  it("needs at least one size row, unique sizes, at most thirty", () => {
    expect(masalah(dasar({ rows: [] }))).toContain("BARIS_WAJIB");
    expect(masalah(dasar({ rows: [{ ukuran: "", nilai: [1, 2] }] }))).toContain("UKURAN_KOSONG");
    expect(masalah(dasar({ rows: [{ ukuran: "m", nilai: [1, 2] }, { ukuran: "M", nilai: [1, 2] }] }))).toContain("UKURAN_GANDA");
    const banyak = Array.from({ length: 31 }, (_, i) => ({ ukuran: `U${i}`, nilai: [1, 2] }));
    expect(masalah(dasar({ rows: banyak }))).toContain("BARIS_TERLALU_BANYAK");
  });

  it("values line up with the columns, are positive with at most two decimals, and a row is never all blank", () => {
    expect(masalah(dasar({ rows: [{ ukuran: "S", nilai: [48] }] }))).toContain("BENTUK_TIDAK_SAH");
    expect(masalah(dasar({ rows: [{ ukuran: "S", nilai: [48, -1] }] }))).toContain("ANGKA_TIDAK_SAH");
    expect(masalah(dasar({ rows: [{ ukuran: "S", nilai: [48, 0] }] }))).toContain("ANGKA_TIDAK_SAH");
    expect(masalah(dasar({ rows: [{ ukuran: "S", nilai: [48, 1.234] }] }))).toContain("ANGKA_TIDAK_SAH");
    expect(masalah(dasar({ rows: [{ ukuran: "S", nilai: [48, 1001] }] }))).toContain("ANGKA_TIDAK_SAH");
    expect(masalah(dasar({ rows: [{ ukuran: "S", nilai: [48, Number.NaN] }] }))).toContain("ANGKA_TIDAK_SAH");
    expect(masalah(dasar({ rows: [{ ukuran: "S", nilai: [null, null] }] }))).toContain("BARIS_TANPA_ANGKA");
    // Satu sel kosong boleh.
    expect(masalah(dasar({ rows: [{ ukuran: "S", nilai: [48, null] }] }))).toEqual([]);
    // Angka seperti 20.35 (galat pembulatan biner) tetap sah.
    expect(masalah(dasar({ rows: [{ ukuran: "S", nilai: [20.35, 33.3] }] }))).toEqual([]);
  });

  it("rejects a note over the limit", () => {
    expect(masalah(dasar({ note: "x".repeat(2001) }))).toContain("CATATAN_TERLALU_PANJANG");
  });

  it("an inactive chart stays inactive", () => {
    const h = periksaTabelUkuran(dasar({ isActive: false }));
    expect(h.ok && h.data.isActive).toBe(false);
  });
});

describe("bacaAngkaUkuran / teksAngkaUkuran", () => {
  it("reads comma or dot decimals, blank as null, anything else as NaN", () => {
    expect(bacaAngkaUkuran("52,5")).toBe(52.5);
    expect(bacaAngkaUkuran(" 52.25 ")).toBe(52.25);
    expect(bacaAngkaUkuran("")).toBeNull();
    expect(bacaAngkaUkuran("  ")).toBeNull();
    expect(bacaAngkaUkuran("abc")).toBeNaN();
    expect(bacaAngkaUkuran("1,234")).toBeNaN();
    expect(bacaAngkaUkuran("-3")).toBeNaN();
    expect(bacaAngkaUkuran("0")).toBeNaN();
    expect(bacaAngkaUkuran("50-52")).toBeNaN();
  });
  it("prints Indonesian decimals by default and round-trips", () => {
    expect(teksAngkaUkuran(52.5)).toBe("52,5");
    expect(teksAngkaUkuran(52.5, "en")).toBe("52.5");
    expect(teksAngkaUkuran(null)).toBe("");
    expect(bacaAngkaUkuran(teksAngkaUkuran(20.35))).toBe(20.35);
  });
});

describe("bacaTabelUkuran", () => {
  it("survives broken JSON from the database", () => {
    expect(bacaTabelUkuran(null, "x")).toEqual({ columns: [], rows: [] });
    expect(
      bacaTabelUkuran(["Dada", 3, " Panjang "], [{ ukuran: "S", nilai: [48, "x", 70] }, { ukuran: "" }, "rusak", { ukuran: "M" }]),
    ).toEqual({
      columns: ["Dada", "Panjang"],
      rows: [
        { ukuran: "S", nilai: [48, null] },
        { ukuran: "M", nilai: [null, null] },
      ],
    });
  });
});

describe("pilihTabelUkuran", () => {
  const t = (id: string, categoryId: string | null, isActive = true, updatedAt = "2026-10-01T00:00:00Z") => ({
    id,
    categoryId,
    isActive,
    updatedAt,
  });
  const semua = [t("kaos", "cat-kaos"), t("celana", "cat-celana"), t("khusus", null), t("mati", null, false)];

  it("the item's own active chart wins", () => {
    expect(pilihTabelUkuran({ sizeChartId: "khusus", categoryId: "cat-kaos" }, semua)).toEqual({
      tabel: semua[2],
      sumber: "BARANG",
    });
  });
  it("blank, missing or inactive own chart falls back to the category default", () => {
    expect(pilihTabelUkuran({ sizeChartId: null, categoryId: "cat-kaos" }, semua)?.tabel.id).toBe("kaos");
    expect(pilihTabelUkuran({ sizeChartId: "hilang", categoryId: "cat-kaos" }, semua)?.sumber).toBe("KATEGORI");
    expect(pilihTabelUkuran({ sizeChartId: "mati", categoryId: "cat-celana" }, semua)?.tabel.id).toBe("celana");
  });
  it("no chart when nothing applies, and an inactive category chart is never a default", () => {
    expect(pilihTabelUkuran({ sizeChartId: null, categoryId: null }, semua)).toBeNull();
    expect(pilihTabelUkuran({ sizeChartId: null, categoryId: "cat-x" }, [t("x", "cat-x", false)])).toBeNull();
  });
  it("two active defaults for one category (old data): the most recently changed wins", () => {
    const dua = [t("lama", "c", true, "2026-01-01T00:00:00Z"), t("baru", "c", true, "2026-09-01T00:00:00Z")];
    expect(pilihTabelUkuran({ sizeChartId: null, categoryId: "c" }, dua)?.tabel.id).toBe("baru");
  });
});

describe("ringkasUkuran", () => {
  it("lists sizes and shortens long lists", () => {
    expect(ringkasUkuran([{ ukuran: "S", nilai: [] }, { ukuran: "M", nilai: [] }])).toBe("S, M");
    const banyak = Array.from({ length: 10 }, (_, i) => ({ ukuran: String(i + 30), nilai: [] }));
    expect(ringkasUkuran(banyak, 3)).toBe("30, 31, 32, …");
  });
});
