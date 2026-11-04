import { describe, expect, it } from "vitest";
import type { InfoBarangAnalisa, StokSekarang } from "@/lib/salesman/analisa-toko";
import {
  barangLambatSpg,
  labelVarian,
  pilihPeriodeSpg,
  rentangSpg,
  susunAnalisaSpg,
  susunCukupHari,
  susunDicari,
  HARI_HAMPIR_HABIS,
  type JualSpg,
} from "./analisa";

/** Instan dari tanggal-jam WIB. */
const wib = (s: string) => new Date(`${s}+07:00`);

const barang = new Map<string, InfoBarangAnalisa>([
  ["A", { nama: "Kaos A", sku: "SKU-A", kategoriId: "k1", variants: [{ sku: "SKU-A-M", size: "M" }, { sku: "SKU-A-L", size: "L" }] }],
  ["B", { nama: "Kemeja B", sku: "SKU-B", kategoriId: "k2", variants: null }],
  ["C", { nama: "Celana C", sku: "SKU-C", kategoriId: "k2", variants: null }],
  ["D", { nama: "Topi D", sku: "SKU-D", kategoriId: null, variants: null }],
]);
const kategori = new Map([
  ["k1", "Kaos"],
  ["k2", "Kemeja"],
]);
const jual = (tanggal: string, itemId: string, variantSku: string, pcs: number): JualSpg => ({ tanggal: wib(tanggal), itemId, variantSku, pcs });

describe("pilihPeriodeSpg", () => {
  it("accepts the four periods and falls back to 30 days", () => {
    expect(pilihPeriodeSpg("7h")).toBe("7h");
    expect(pilihPeriodeSpg(["bulan-lalu"])).toBe("bulan-lalu");
    expect(pilihPeriodeSpg("90h")).toBe("30h");
    expect(pilihPeriodeSpg(undefined)).toBe("30h");
  });
});

describe("rentangSpg", () => {
  const hariIni = wib("2026-03-10T12:00:00");

  it("7 days: today counts, compared with the 7 days just before", () => {
    const r = rentangSpg(hariIni, "7h");
    expect(r).toMatchObject({ dari: "2026-03-04", sampai: "2026-03-10", dariLalu: "2026-02-25", sampaiLalu: "2026-03-03", hari: 7, hariLalu: 7 });
    expect(r.awal.toISOString()).toBe(wib("2026-03-04T00:00:00").toISOString());
    expect(r.akhir.toISOString()).toBe(wib("2026-03-11T00:00:00").toISOString());
  });

  it("30 days crosses a short February correctly", () => {
    expect(rentangSpg(hariIni, "30h")).toMatchObject({ dari: "2026-02-09", sampai: "2026-03-10", dariLalu: "2026-01-10", hari: 30 });
  });

  it("this month is compared with the SAME days of last month, not the whole month", () => {
    expect(rentangSpg(hariIni, "bulan-ini")).toMatchObject({
      dari: "2026-03-01",
      sampai: "2026-03-10",
      dariLalu: "2026-02-01",
      sampaiLalu: "2026-02-10",
      hari: 10,
      hariLalu: 10,
    });
  });

  it("this month on the 31st stops the comparison at the end of a shorter month", () => {
    expect(rentangSpg(wib("2026-03-31T12:00:00"), "bulan-ini")).toMatchObject({ dariLalu: "2026-02-01", sampaiLalu: "2026-02-28", hari: 31, hariLalu: 28 });
  });

  it("last month vs the month before, whole calendar months", () => {
    expect(rentangSpg(hariIni, "bulan-lalu")).toMatchObject({
      dari: "2026-02-01",
      sampai: "2026-02-28",
      dariLalu: "2026-01-01",
      sampaiLalu: "2026-01-31",
      hari: 28,
      hariLalu: 31,
    });
  });

  it("uses the WIB calendar day, not UTC", () => {
    // 18:00 UTC on 31 March is already 1 April in Jakarta.
    expect(rentangSpg(new Date("2026-03-31T18:00:00Z"), "bulan-ini")).toMatchObject({ dari: "2026-04-01", hari: 1 });
  });
});

describe("susunAnalisaSpg", () => {
  const hariIni = wib("2026-03-10T12:00:00");
  const data = [
    jual("2026-03-09T10:00:00", "A", "SKU-A-M", 5),
    jual("2026-03-05T10:00:00", "A", "SKU-A-L", 3),
    jual("2026-03-08T10:00:00", "B", "", 4),
    // Dikembalikan pembeli seluruhnya: bersih 0.
    jual("2026-03-06T10:00:00", "C", "", 0),
    // Periode sebelumnya (25 Feb – 3 Mar).
    jual("2026-02-28T10:00:00", "B", "", 2),
    jual("2026-02-26T10:00:00", "A", "SKU-A-M", 2),
    jual("2026-03-01T10:00:00", "C", "", 1),
    // Di luar kedua periode.
    jual("2026-02-01T10:00:00", "B", "", 99),
  ];
  const a = susunAnalisaSpg({ rentang: rentangSpg(hariIni, "7h"), jual: data, barang, kategori });

  it("totals net pieces and compares with the previous period", () => {
    expect(a.totalPcs).toBe(12);
    expect(a.totalPcsLalu).toBe(5);
    expect(a.perubahanPcs).toBe(140);
    expect(a.arah).toBe("naik");
    expect(a.rataHarian).toBe(1.7);
  });

  it("ranks articles by pieces, with their own direction and best sizes", () => {
    expect(a.artikel.map((x) => [x.itemId, x.pcs, x.pcsLalu, x.arah])).toEqual([
      ["A", 8, 2, "naik"],
      ["B", 4, 2, "naik"],
    ]);
    expect(a.artikel[0].ukuran.map((u) => u.label)).toEqual(["M", "L"]);
    // A fully-returned line is not a best seller.
    expect(a.artikel.some((x) => x.itemId === "C")).toBe(false);
  });

  it("ranks variants (article × size) separately", () => {
    expect(a.varian.map((v) => [v.sku, v.label, v.pcs])).toEqual([
      ["SKU-A-M", "M", 5],
      ["SKU-B", null, 4],
      ["SKU-A-L", "L", 3],
    ]);
  });

  it("shares by category, size and colour", () => {
    expect(a.kategori.filter((k) => k.pcs > 0).map((k) => [k.nama, k.pcs, k.persen])).toEqual([
      ["Kaos", 8, 67],
      ["Kemeja", 4, 33],
    ]);
    expect(a.ukuran.map((u) => u.label)).toEqual(["M", "L"]);
  });

  it("this month compares only the same days of last month", () => {
    const b = susunAnalisaSpg({
      rentang: rentangSpg(hariIni, "bulan-ini"),
      jual: [jual("2026-03-02T10:00:00", "A", "SKU-A-M", 4), jual("2026-02-05T10:00:00", "A", "SKU-A-M", 2), jual("2026-02-20T10:00:00", "A", "SKU-A-M", 50)],
      barang,
      kategori,
    });
    expect([b.totalPcs, b.totalPcsLalu, b.arah]).toEqual([4, 2, "naik"]);
    expect(b.kategori[0].pcsSebelumnya).toBe(2);
  });

  it("a period with nothing before reads 'new', with no percentage", () => {
    const b = susunAnalisaSpg({ rentang: rentangSpg(hariIni, "7h"), jual: [jual("2026-03-09T10:00:00", "B", "", 3)], barang, kategori });
    expect([b.perubahanPcs, b.arah]).toEqual([null, "baru"]);
  });

  it("labels a variant by size/colour, falling back to its SKU", () => {
    expect(labelVarian(barang.get("A"), "SKU-A-M")).toBe("M");
    expect(labelVarian({ nama: "x", sku: "Q", kategoriId: null, variants: [{ sku: "Q-HTM-XL", Color: "Hitam", Size: "XL" }] }, "Q-HTM-XL")).toBe("XL · Hitam");
    expect(labelVarian(barang.get("B"), "")).toBeNull();
    expect(labelVarian(barang.get("B"), "LAIN-1")).toBe("LAIN-1");
  });
});

describe("susunCukupHari", () => {
  const hariIni = wib("2026-03-31T12:00:00");
  const stok: StokSekarang[] = [
    { itemId: "A", variantSku: "SKU-A-M", qty: 3, firstInAt: null },
    { itemId: "A", variantSku: "SKU-A-L", qty: 10, firstInAt: null },
    { itemId: "B", variantSku: "", qty: -2, firstInAt: null },
    { itemId: "D", variantSku: "", qty: 5, firstInAt: null },
  ];
  const data = [
    jual("2026-03-20T10:00:00", "A", "SKU-A-M", 30),
    jual("2026-03-21T10:00:00", "A", "SKU-A-L", 3),
    jual("2026-03-15T10:00:00", "B", "", 15),
    // Jendela 30 hari = 2–31 Maret WIB.
    jual("2026-03-01T23:30:00", "A", "SKU-A-M", 100),
    jual("2026-03-02T00:30:00", "D", "", 0),
  ];
  const c = susunCukupHari({ stok, jual: data, barang, hariIni });

  it("divides shelf stock by the daily rate of the last 30 days, most urgent first", () => {
    expect(c.baris.map((x) => [x.itemId, x.sisa, x.laku, x.lajuHarian, x.hariCukup, x.hampirHabis])).toEqual([
      // Negative book balance is "out", not a credit for other sizes.
      ["B", 0, 15, 0.5, 0, true],
      ["A", 13, 33, 1.1, 11, false],
    ]);
  });

  it("does not list products that did not sell (that is the slow-mover list)", () => {
    expect(c.baris.some((x) => x.itemId === "D")).toBe(false);
  });

  it("suggests requesting each selling size up to 14 days of cover", () => {
    expect(c.baris.find((x) => x.itemId === "A")?.minta).toEqual([{ itemId: "A", variantSku: "SKU-A-M", qty: 11 }]);
    expect(c.mintaHampirHabis).toEqual([{ itemId: "B", variantSku: "", qty: 7 }]);
    expect(c.jumlahHampirHabis).toBe(1);
  });

  it("calls a product low exactly at the threshold", () => {
    const x = susunCukupHari({
      stok: [{ itemId: "B", variantSku: "", qty: HARI_HAMPIR_HABIS, firstInAt: null }],
      jual: [jual("2026-03-20T10:00:00", "B", "", 30)],
      barang,
      hariIni,
    }).baris[0];
    expect([x.hariCukup, x.hampirHabis]).toEqual([HARI_HAMPIR_HABIS, true]);
  });
});

describe("barangLambatSpg", () => {
  const hariIni = wib("2026-03-31T12:00:00");
  it("lists stock on the shelf for over 30 days with no sale in the last 30 days", () => {
    const hasil = barangLambatSpg({
      stok: [
        { itemId: "A", variantSku: "SKU-A-M", qty: 4, firstInAt: wib("2026-01-01T09:00:00") },
        { itemId: "B", variantSku: "", qty: 3, firstInAt: wib("2026-03-20T09:00:00") },
        { itemId: "C", variantSku: "", qty: 2, firstInAt: wib("2026-01-01T09:00:00") },
        { itemId: "D", variantSku: "", qty: 0, firstInAt: wib("2026-01-01T09:00:00") },
      ],
      jual: [jual("2026-03-15T10:00:00", "C", "", 1), jual("2026-02-10T10:00:00", "A", "SKU-A-M", 5)],
      barang,
      hariIni,
    });
    expect(hasil.baris.map((b) => [b.itemId, b.sisa, b.hariDiToko])).toEqual([["A", 4, 89]]);
    expect(hasil.jumlah).toBe(1);
  });
});

describe("susunDicari", () => {
  it("groups linked requests per variant and typed ones per normalised text, within the period", () => {
    const hasil = susunDicari({
      baris: [
        { itemId: "A", variantSku: "SKU-A-M", description: "kaos a m", qty: 2, tanggal: wib("2026-03-09T10:00:00") },
        { itemId: "A", variantSku: "SKU-A-M", description: "kaos a", qty: 1, tanggal: wib("2026-03-08T10:00:00") },
        { itemId: null, variantSku: "", description: "Kaos  Polos Hitam", qty: 1, tanggal: wib("2026-03-07T10:00:00") },
        { itemId: null, variantSku: "", description: "kaos polos hitam ", qty: 3, tanggal: wib("2026-03-09T11:00:00") },
        { itemId: null, variantSku: "", description: "Jaket", qty: 50, tanggal: wib("2026-01-01T10:00:00") },
      ],
      rentang: { awal: wib("2026-03-04T00:00:00"), akhir: wib("2026-03-11T00:00:00") },
      barang,
    });
    expect(hasil.map((d) => [d.keterangan, d.qty, d.kali, d.itemId])).toEqual([
      ["kaos polos hitam", 4, 2, null],
      ["Kaos A — M", 3, 2, "A"],
    ]);
  });
});
