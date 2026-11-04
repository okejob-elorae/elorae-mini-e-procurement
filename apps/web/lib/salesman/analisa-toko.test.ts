import { describe, expect, it } from "vitest";
import {
  arahPerubahan,
  arahPorsi,
  bacaVarian,
  pilihPeriode,
  rentangAnalisa,
  susunAnalisa,
  susunLaku,
  susunWawasan,
  type BarisAnalisa,
  type InfoBarangAnalisa,
} from "./analisa-toko";

const wib = (s: string) => new Date(`${s}+07:00`);
const HARI_INI = wib("2026-10-01T10:00:00");

describe("periode", () => {
  it("hanya 3/6/12; selain itu 3", () => {
    expect(pilihPeriode("6")).toBe(6);
    expect(pilihPeriode("12")).toBe(12);
    expect(pilihPeriode("5")).toBe(3);
    expect(pilihPeriode(undefined)).toBe(3);
    expect(pilihPeriode(["6"])).toBe(3);
  });

  it("bergulir sampai akhir hari ini WIB, pembanding sama panjang", () => {
    const r = rentangAnalisa(HARI_INI, 3);
    expect(r.akhir.toISOString()).toBe(wib("2026-10-02T00:00:00").toISOString());
    expect(r.awal.toISOString()).toBe(wib("2026-07-02T00:00:00").toISOString());
    expect(r.awalSebelumnya.toISOString()).toBe(wib("2026-04-02T00:00:00").toISOString());
    expect(r.bulanTren).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("tanggal dijepit ke akhir bulan tujuan", () => {
    // Besok = 31 Mei; 3 bulan mundur = 28 Februari.
    const r = rentangAnalisa(wib("2026-05-30T10:00:00"), 3);
    expect(r.awal.toISOString()).toBe(wib("2026-02-28T00:00:00").toISOString());
  });
});

describe("varian", () => {
  const variants = [
    { sku: "KAOS-01-HTM-M", size: "M", color: "Hitam" },
    { SKU: "KAOS-01-PTH-L", Size: "L", Color: "Putih" },
  ];
  it("dibaca dari Item.variants, kunci tanpa peduli huruf besar", () => {
    expect(bacaVarian(variants, "KAOS-01-HTM-M", "KAOS-01")).toEqual({ ukuran: "M", warna: "Hitam" });
    expect(bacaVarian(variants, "kaos-01-pth-l", "KAOS-01")).toEqual({ ukuran: "L", warna: "Putih" });
  });

  it("varian tersimpan sebagai teks JSON", () => {
    expect(bacaVarian(JSON.stringify([{ Size: "32", sku: "JEANS-32" }]), "JEANS-32", "JEANS")).toEqual({ ukuran: "32", warna: null });
  });

  it("tanpa baris varian: ditebak dari akhiran SKU", () => {
    expect(bacaVarian(null, "27000101P-BLK-XL", "27000101P")).toEqual({ ukuran: "XL", warna: "BLK" });
    expect(bacaVarian("bukan json", "JEANS-34", "JEANS")).toEqual({ ukuran: "34", warna: null });
    expect(bacaVarian(null, "LAIN-34", "JEANS")).toEqual({ ukuran: null, warna: null });
    expect(bacaVarian(variants, "", "KAOS-01")).toEqual({ ukuran: null, warna: null });
  });
});

describe("arah", () => {
  it("ambang 10%; baru bila sebelumnya kosong", () => {
    expect(arahPerubahan(11, 10)).toBe("naik");
    expect(arahPerubahan(10, 10)).toBe("tetap");
    expect(arahPerubahan(9.5, 10)).toBe("tetap");
    expect(arahPerubahan(9, 10)).toBe("turun");
    expect(arahPerubahan(5, 0)).toBe("baru");
    expect(arahPerubahan(0, 0)).toBe("tetap");
    expect(arahPorsi(45, 30)).toBe("naik");
    expect(arahPorsi(30, 30)).toBe("sama");
    expect(arahPorsi(30, null)).toBeNull();
  });
});

const barang = new Map<string, InfoBarangAnalisa>([
  ["kaos", { nama: "Kaos Polos", sku: "KAOS", kategoriId: "k-kaos", variants: [{ sku: "KAOS-M", size: "M", color: "Hitam" }, { sku: "KAOS-L", size: "L", color: "Putih" }] }],
  ["kemeja", { nama: "Kemeja", sku: "KMJ", kategoriId: "k-kemeja", variants: null }],
  ["topi", { nama: "Topi", sku: "TOPI", kategoriId: null, variants: null }],
]);
const kategori = new Map([
  ["k-kaos", "Kaos"],
  ["k-kemeja", "Kemeja"],
]);
const baris = (tanggal: string, itemId: string, pcs: number, nilai: number | null, variantSku = ""): BarisAnalisa => ({
  tanggal: wib(tanggal),
  itemId,
  variantSku,
  pcs,
  nilai,
});

describe("analisa", () => {
  const rentang = rentangAnalisa(HARI_INI, 3);
  const data = [
    // Periode ini (2 Jul – 1 Okt)
    baris("2026-09-10T10:00:00", "kaos", 30, 300_000, "KAOS-M"),
    baris("2026-08-10T10:00:00", "kaos", 15, 150_000, "KAOS-L"),
    baris("2026-09-15T10:00:00", "kemeja", 40, 800_000, "KMJ-HTM-XL"),
    baris("2026-07-20T10:00:00", "topi", 15, null),
    // Pembanding (2 Apr – 1 Jul)
    baris("2026-05-10T10:00:00", "kaos", 30, 300_000, "KAOS-M"),
    baris("2026-06-10T10:00:00", "kemeja", 60, 1_200_000, "KMJ-HTM-XL"),
    baris("2026-06-11T10:00:00", "topi", 10, null),
    // Di luar keduanya
    baris("2026-01-10T10:00:00", "kaos", 999, 1, "KAOS-M"),
  ];

  it("kategori: pcs, porsi, arah, nilai hanya dari baris bernilai", () => {
    const a = susunAnalisa({ baris: data, barang, kategori, rentang, tampilNilai: true });
    expect(a.totalPcs).toBe(100);
    expect(a.totalPcsSebelumnya).toBe(100);
    expect(a.perubahanPcs).toBe(0);
    expect(a.totalNilai).toBe(1_250_000);
    expect(a.kategori).toEqual([
      { kategoriId: "k-kaos", nama: "Kaos", pcs: 45, pcsSebelumnya: 30, persen: 45, persenSebelumnya: 30, nilai: 450_000, arah: "naik" },
      { kategoriId: "k-kemeja", nama: "Kemeja", pcs: 40, pcsSebelumnya: 60, persen: 40, persenSebelumnya: 60, nilai: 800_000, arah: "turun" },
      { kategoriId: null, nama: null, pcs: 15, pcsSebelumnya: 10, persen: 15, persenSebelumnya: 10, nilai: 0, arah: "naik" },
    ]);
  });

  it("toko konsinyasi: tidak ada rupiah sama sekali", () => {
    const a = susunAnalisa({ baris: data, barang, kategori, rentang, tampilNilai: false });
    expect(a.totalNilai).toBeNull();
    expect(a.kategori.every((k) => k.nilai === null)).toBe(true);
    expect(a.artikel.every((x) => x.nilai === null)).toBe(true);
  });

  it("artikel dengan ukuran dan warna terlaris; tren per bulan", () => {
    const a = susunAnalisa({ baris: data, barang, kategori, rentang, tampilNilai: true });
    expect(a.artikel.map((x) => x.itemId)).toEqual(["kaos", "kemeja", "topi"]);
    expect(a.artikel[0].ukuran).toEqual([
      { label: "M", pcs: 30, persen: 67 },
      { label: "L", pcs: 15, persen: 33 },
    ]);
    expect(a.artikel[1].ukuran).toEqual([{ label: "XL", pcs: 40, persen: 100 }]);
    expect(a.artikel[1].warna).toEqual([{ label: "HTM", pcs: 40, persen: 100 }]);
    expect(a.artikel[2].ukuran).toEqual([]);
    expect(a.ukuran.map((u) => u.label)).toEqual(["XL", "M", "L"]);
    expect(a.tren).toEqual([
      { bulan: "2026-08", pcs: 15 },
      { bulan: "2026-09", pcs: 70 },
      { bulan: "2026-10", pcs: 0 },
    ]);
  });
});

describe("pengembalian pembeli", () => {
  it("pcs negatif mengurangi ukurannya, tidak dibuang", () => {
    const a = susunAnalisa({
      baris: [baris("2026-09-01T10:00:00", "kaos", 6, null, "KAOS-M"), baris("2026-09-02T10:00:00", "kaos", -1, null, "KAOS-M")],
      barang,
      kategori,
      rentang: rentangAnalisa(HARI_INI, 3),
      tampilNilai: false,
    });
    expect(a.artikel[0]).toMatchObject({ pcs: 5, ukuran: [{ label: "M", pcs: 5, persen: 100 }] });
  });
});

describe("laku konsinyasi", () => {
  const rentang = rentangAnalisa(HARI_INI, 3);
  it("cepat laku, lambat (lama di toko dan tidak laku), laku dari kiriman", () => {
    const l = susunLaku({
      sumber: "BUKU_TOKO",
      rentang,
      terkirim: [baris("2026-08-01T10:00:00", "kaos", 50, null), baris("2026-08-01T10:00:00", "kemeja", 50, null)],
      terjual: [baris("2026-09-01T10:00:00", "kaos", 40, null, "KAOS-M"), baris("2026-09-02T10:00:00", "kaos", 5, null, "KAOS-L")],
      stok: [
        { itemId: "kaos", variantSku: "KAOS-M", qty: 5, firstInAt: wib("2026-08-01T10:00:00") },
        { itemId: "kaos", variantSku: "KAOS-L", qty: 0, firstInAt: wib("2026-08-01T10:00:00") },
        { itemId: "kemeja", variantSku: "", qty: 50, firstInAt: wib("2026-08-01T10:00:00") },
        // Baru tiba: belum dicap lambat.
        { itemId: "topi", variantSku: "", qty: 20, firstInAt: wib("2026-09-25T10:00:00") },
      ],
      barang,
      hariIni: HARI_INI,
    });
    expect(l).toMatchObject({ adaDataLaku: true, terkirimPcs: 100, lakuPcs: 45, sisaPcs: 75, persenLakuDariKirim: 45, jumlahLambat: 1 });
    expect(l.cepat).toEqual([{ itemId: "kaos", nama: "Kaos Polos", sku: "KAOS", laku: 45, sisa: 5, persen: 90 }]);
    expect(l.lambat).toEqual([{ itemId: "kemeja", nama: "Kemeja", sku: "KMJ", sisa: 50, hariDiToko: 61 }]);
  });

  it("tanpa data laku sama sekali", () => {
    const l = susunLaku({ sumber: "TITIPAN", rentang, terkirim: [], terjual: [], stok: [], barang, hariIni: HARI_INI });
    expect(l.adaDataLaku).toBe(false);
    expect(l.persenLakuDariKirim).toBeNull();
  });
});

describe("wawasan", () => {
  const rentang = rentangAnalisa(HARI_INI, 3);
  const data = [
    baris("2026-09-10T10:00:00", "kaos", 45, 450_000, "KAOS-M"),
    baris("2026-09-10T10:00:00", "kemeja", 40, 800_000),
    baris("2026-09-10T10:00:00", "topi", 15, null),
    baris("2026-05-10T10:00:00", "kaos", 30, 300_000, "KAOS-L"),
    baris("2026-05-10T10:00:00", "kemeja", 70, 1_400_000),
  ];

  it("contoh pemilik: 'Kategori Kaos menyumbang 45% — naik dari 30%'", () => {
    const a = susunAnalisa({ baris: data, barang, kategori, rentang, tampilNilai: true });
    const w = susunWawasan(a, null);
    expect(w[0]).toEqual({ kode: "KATEGORI_UTAMA", kategori: "Kaos", persen: 45, persenSebelumnya: 30 });
    expect(w.find((x) => x.kode === "TOTAL")).toEqual({ kode: "TOTAL", pcs: 100, persen: 0 });
    // Hanya satu ukuran yang dikenal: tidak ada yang dibandingkan.
    expect(w.some((x) => x.kode === "UKURAN")).toBe(false);
  });

  it("kategori yang porsinya naik paling cepat (selain yang utama)", () => {
    const a = susunAnalisa({
      baris: [
        baris("2026-09-10T10:00:00", "kemeja", 50, 1),
        baris("2026-09-10T10:00:00", "kaos", 30, 1),
        baris("2026-09-10T10:00:00", "topi", 20, 1),
        baris("2026-05-10T10:00:00", "kemeja", 80, 1),
        baris("2026-05-10T10:00:00", "kaos", 10, 1),
        baris("2026-05-10T10:00:00", "topi", 10, 1),
      ],
      barang,
      kategori,
      rentang,
      tampilNilai: true,
    });
    const w = susunWawasan(a, null);
    expect(w).toContainEqual({ kode: "KATEGORI_NAIK", kategori: "Kaos", dari: 10, ke: 30 });
  });

  it("toko konsinyasi: laku dari kiriman dan barang lambat didahulukan; tanpa data laku disebut", () => {
    const a = susunAnalisa({ baris: data, barang, kategori, rentang, tampilNilai: false });
    const laku = {
      sumber: "BUKU_TOKO" as const,
      adaDataLaku: true,
      terkirimPcs: 100,
      lakuPcs: 40,
      sisaPcs: 60,
      persenLakuDariKirim: 40,
      cepat: [],
      lambat: [],
      jumlahLambat: 3,
    };
    const w = susunWawasan(a, laku);
    expect(w[0]).toEqual({ kode: "LAKU_DARI_KIRIM", persen: 40, laku: 40, terkirim: 100 });
    expect(w[1]).toEqual({ kode: "BELUM_LAKU", jumlah: 3 });
    expect(w.length).toBeLessThanOrEqual(5);
    expect(susunWawasan(a, { ...laku, adaDataLaku: false, jumlahLambat: 0 })[0]).toEqual({ kode: "TANPA_DATA_LAKU" });
  });

  it("toko tanpa riwayat: tidak ada wawasan", () => {
    const a = susunAnalisa({ baris: [], barang, kategori, rentang, tampilNilai: true });
    expect(susunWawasan(a, null)).toEqual([]);
    expect(a.kategori).toEqual([]);
    expect(a.tren.every((t) => t.pcs === 0)).toBe(true);
  });

  it("satu-satunya kelompok tanpa kategori: porsi tidak disebut", () => {
    const a = susunAnalisa({ baris: [baris("2026-09-10T10:00:00", "topi", 5, 1)], barang, kategori, rentang, tampilNilai: true });
    expect(susunWawasan(a, null).map((x) => x.kode)).toEqual(["TOTAL"]);
  });
});
