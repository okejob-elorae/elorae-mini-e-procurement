import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import {
  BATAS_ALASAN_PENYESUAIAN,
  BATAS_CATATAN_KEMBALI,
  alasanKembaliBahan,
  bahanMasihDiCmt,
  barisHargaPengeluaran,
  barisPengeluaran,
  batasNilaiKembali,
  catatanDariAlasan,
  hargaDalamBatas,
  hargaDariAlasan,
  hargaKeluar,
  jumlahPerBarang,
  kunciBarisKembali,
  periksaBarisKembali,
  rataRataSesudahKembali,
  sisaBahanDiCmt,
} from "./kembali-bahan";

const angka = (d: Decimal) => d.toNumber();

describe("barisPengeluaran", () => {
  it("membaca TEKS JSON dan array; qty teks dibaca angka; baris tanpa barang dibuang", () => {
    const teks = JSON.stringify([
      { itemId: "kain", qty: 78.75 },
      { itemId: "kancing", qty: "200" },
      { qty: 5 },
    ]);
    expect(barisPengeluaran(teks).map((b) => [b.itemId, angka(b.qty)])).toEqual([
      ["kain", 78.75],
      ["kancing", 200],
    ]);
    expect(barisPengeluaran([{ item_id: "benang", quantity: 3 }]).map((b) => [b.itemId, angka(b.qty)])).toEqual([["benang", 3]]);
    expect(barisPengeluaran("{rusak")).toEqual([]);
    expect(barisPengeluaran(null)).toEqual([]);
  });
});

describe("barisHargaPengeluaran", () => {
  it("membaca harga rata-rata saat keluar (avgCostAtIssue) per baris dokumen; teks dibaca angka", () => {
    const teks = JSON.stringify([
      { itemId: "kain", qty: 10, avgCostAtIssue: 30_000, totalCost: 300_000 },
      { itemId: "kancing", qty: "200", avgCostAtIssue: "1000" },
      { item_id: "benang", quantity: 3, avg_cost_at_issue: 2_500 },
    ]);
    expect(barisHargaPengeluaran(teks).map((b) => [b.itemId, angka(b.qty), b.harga == null ? null : angka(b.harga)])).toEqual([
      ["kain", 10, 30_000],
      ["kancing", 200, 1_000],
      ["benang", 3, 2_500],
    ]);
  });

  it("harga kosong, 0, negatif, bukan angka, atau hanya di kolom lain (unitCost) → null, tidak pernah Rp 0", () => {
    const hasil = barisHargaPengeluaran([
      { itemId: "a", qty: 1 },
      { itemId: "b", qty: 1, avgCostAtIssue: 0 },
      { itemId: "c", qty: 1, avgCostAtIssue: -5 },
      { itemId: "d", qty: 1, avgCostAtIssue: "abc" },
      { itemId: "e", qty: 1, avgCostAtIssue: "" },
      { itemId: "f", qty: 1, avgCostAtIssue: null },
      { itemId: "g", qty: 1, unitCost: 25_000 },
    ]);
    expect(hasil.map((b) => [b.itemId, b.harga])).toEqual([
      ["a", null],
      ["b", null],
      ["c", null],
      ["d", null],
      ["e", null],
      ["f", null],
      ["g", null],
    ]);
    expect(barisHargaPengeluaran("{rusak")).toEqual([]);
  });
});

describe("sisa bahan di CMT", () => {
  it("keluar 80 + 40 kain, kembali 30 → sisa 90; kancing kembali semua → sisa 0 dan bukan penghalang", () => {
    const keluar = jumlahPerBarang([
      { itemId: "kain", qty: 80 },
      { itemId: "kain", qty: 40 },
      { itemId: "kancing", qty: 200 },
    ]);
    const kembali = jumlahPerBarang([
      { itemId: "kain", qty: 30 },
      { itemId: "kancing", qty: 200 },
    ]);
    const sisa = sisaBahanDiCmt(keluar, kembali);
    expect(sisa.map((s) => [s.itemId, angka(s.keluar), angka(s.kembali), angka(s.sisa)])).toEqual([
      ["kain", 120, 30, 90],
      ["kancing", 200, 200, 0],
    ]);
    expect(bahanMasihDiCmt(sisa).map((s) => s.itemId)).toEqual(["kain"]);
  });

  it("kembali lebih dari keluar (data lama) → sisa 0, tidak negatif", () => {
    const sisa = sisaBahanDiCmt(jumlahPerBarang([{ itemId: "a", qty: 5 }]), jumlahPerBarang([{ itemId: "a", qty: 7 }]));
    expect(angka(sisa[0].sisa)).toBe(0);
    expect(bahanMasihDiCmt(sisa)).toEqual([]);
  });
});

describe("periksaBarisKembali", () => {
  const sisa = sisaBahanDiCmt(
    jumlahPerBarang([
      { itemId: "kain", qty: 78.75 },
      { itemId: "kancing", qty: 200 },
    ]),
    jumlahPerBarang([{ itemId: "kancing", qty: 150 }]),
  );

  it("qty 0 dibuang, koma desimal diterima, dibulatkan 2 desimal", () => {
    const hasil = periksaBarisKembali(
      [
        { itemId: "kain", qty: "12,345" },
        { itemId: "kancing", qty: 0 },
      ],
      sisa,
    );
    expect(hasil.ok).toBe(true);
    if (hasil.ok) expect(hasil.baris.map((b) => [b.itemId, angka(b.qty)])).toEqual([["kain", 12.35]]);
  });

  it("tepat sebesar sisa diterima; 0,01 di atas sisa ditolak MELEBIHI_SISA beserta sisanya", () => {
    expect(periksaBarisKembali([{ itemId: "kancing", qty: 50 }], sisa).ok).toBe(true);
    expect(periksaBarisKembali([{ itemId: "kain", qty: 78.75 }], sisa).ok).toBe(true);
    expect(periksaBarisKembali([{ itemId: "kancing", qty: 50.01 }], sisa)).toEqual({
      ok: false,
      code: "MELEBIHI_SISA",
      itemId: "kancing",
      sisa: 50,
    });
  });

  it("semua nol → TANPA_BARIS; negatif/bukan angka → QTY_TIDAK_VALID; dua kali → BARANG_GANDA; bukan bahan WO → BUKAN_BAHAN_WO", () => {
    expect(periksaBarisKembali([{ itemId: "kain", qty: 0 }], sisa)).toEqual({ ok: false, code: "TANPA_BARIS" });
    expect(periksaBarisKembali([{ itemId: "kain", qty: -1 }], sisa)).toMatchObject({ code: "QTY_TIDAK_VALID" });
    expect(periksaBarisKembali([{ itemId: "kain", qty: "abc" }], sisa)).toMatchObject({ code: "QTY_TIDAK_VALID" });
    expect(
      periksaBarisKembali(
        [
          { itemId: "kain", qty: 1 },
          { itemId: "kain", qty: 2 },
        ],
        sisa,
      ),
    ).toMatchObject({ code: "BARANG_GANDA", itemId: "kain" });
    expect(periksaBarisKembali([{ itemId: "resleting", qty: 1 }], sisa)).toMatchObject({
      code: "BUKAN_BAHAN_WO",
      itemId: "resleting",
    });
  });
});

describe("harga keluar dan harga rata-rata sesudah kembali", () => {
  it("keluar 60 @ 30.000 + 20 @ 40.000 (dua baris gudang) → 32.500 per meter", () => {
    expect(
      angka(
        hargaKeluar([
          { qty: -60, unitCost: 30_000 },
          { qty: -20, unitCost: "40000" },
        ]),
      ),
    ).toBe(32_500);
    expect(angka(hargaKeluar([]))).toBe(0);
  });

  it("gudang 100 @ 30.000, kembali 20 @ 36.000 → 31.000; stok 0 atau negatif → harga yang kembali", () => {
    expect(angka(rataRataSesudahKembali(100, 30_000, 20, 36_000))).toBe(31_000);
    expect(angka(rataRataSesudahKembali(0, 30_000, 20, 36_000))).toBe(36_000);
    expect(angka(rataRataSesudahKembali(-5, 30_000, 20, 36_000))).toBe(36_000);
  });
});

it("kunci baris per WO, per kunci formulir, per barang", () => {
  expect(kunciBarisKembali("wo1", "k-1", "kain")).toBe("woret:wo1:k-1:kain");
});

describe("batas nilai bahan kembali sesudah penerimaan barang jadi", () => {
  it("belum ada penerimaan → tanpa batas; ada penerimaan → biaya bahan − sudah kembali − sudah dibebankan, tidak pernah negatif", () => {
    expect(batasNilaiKembali({ adaPenerimaan: false, biayaBahanWo: 2_000_000, sudahKembali: 0, sudahDibebankan: 0 })).toBeNull();
    expect(angka(batasNilaiKembali({ adaPenerimaan: true, biayaBahanWo: 2_000_000, sudahKembali: 100_000, sudahDibebankan: 1_650_000 })!)).toBe(250_000);
    expect(angka(batasNilaiKembali({ adaPenerimaan: true, biayaBahanWo: 2_000_000, sudahKembali: 0, sudahDibebankan: 2_000_000 })!)).toBe(0);
    expect(angka(batasNilaiKembali({ adaPenerimaan: true, biayaBahanWo: 1_000, sudahKembali: 600, sudahDibebankan: 900 })!)).toBe(0);
  });

  it("harga diperkecil dengan faktor yang sama, dibulatkan ke bawah ke sen: Σ nilai 249.999,70 ≤ batas 250.000", () => {
    const baris = [
      { qty: 20, harga: 30_000 },
      { qty: 50, harga: 1_000 },
    ];
    const { harga, dibatasi } = hargaDalamBatas(baris, new Decimal(250_000));
    expect(dibatasi).toBe(true);
    expect(harga.map(angka)).toEqual([11_538.46, 384.61]);
    expect(angka(harga[0].mul(20).plus(harga[1].mul(50)))).toBe(249_999.7);
    expect(hargaDalamBatas(baris, new Decimal(650_000))).toEqual({ harga: [new Decimal(30_000), new Decimal(1_000)], dibatasi: false });
    expect(hargaDalamBatas(baris, null).dibatasi).toBe(false);
    expect(hargaDalamBatas(baris, new Decimal(0)).harga.map(angka)).toEqual([0, 0]);
  });
});

describe("alasan penyesuaian bahan kembali", () => {
  // Tepat 120 karakter = BATAS_CATATAN_KEMBALI.
  const catatanPenuh =
    "Sisa potong kain katun combed 30s warna navy dari meja 3, dihitung ulang bersama kepala produksi CMT, cocok dengan nota.";
  const dasar = { woDocNumber: "WO/2026/0001", harga: "30000.00", hargaDariDokumen: false, vendor: "Penjahit uji", catatan: "sisa potong" };

  it("pendek → susunan lama apa adanya; penanda harga dokumen tepat sesudah harga; tanpa nama CMT → \"CMT\"", () => {
    expect(alasanKembaliBahan(dasar)).toBe("Kembali bahan WO/2026/0001 @ 30000.00 dari Penjahit uji — sisa potong");
    expect(alasanKembaliBahan({ ...dasar, hargaDariDokumen: true })).toBe(
      "Kembali bahan WO/2026/0001 @ 30000.00 (harga dokumen) dari Penjahit uji — sisa potong",
    );
    expect(alasanKembaliBahan({ ...dasar, catatan: "" })).toBe("Kembali bahan WO/2026/0001 @ 30000.00 dari Penjahit uji");
    expect(alasanKembaliBahan({ ...dasar, vendor: null, catatan: "" })).toBe("Kembali bahan WO/2026/0001 @ 30000.00 dari CMT");
    expect(alasanKembaliBahan({ ...dasar, vendor: "  ", catatan: "" })).toBe("Kembali bahan WO/2026/0001 @ 30000.00 dari CMT");
  });

  it("catatan 120 karakter + harga dokumen + nama CMT panjang → yang dipendekkan nama CMT, catatan utuh, harga & penandanya terbaca", () => {
    expect(catatanPenuh.length).toBe(BATAS_CATATAN_KEMBALI);
    const alasan = alasanKembaliBahan({ ...dasar, hargaDariDokumen: true, vendor: "Konveksi Maju Bersama Sejahtera", catatan: catatanPenuh });
    expect(alasan).toBe(`Kembali bahan WO/2026/0001 @ 30000.00 (harga dokumen) dari Konveks… — ${catatanPenuh}`);
    expect(alasan.length).toBe(BATAS_ALASAN_PENYESUAIAN);
    expect(catatanDariAlasan(alasan)).toBe(catatanPenuh);
    expect(hargaDariAlasan(alasan)).toEqual({ harga: new Decimal(30_000), dariDokumen: true });
  });

  it("tanpa ruang untuk nama CMT → \"dari <CMT>\" dibuang, catatan tetap utuh", () => {
    const alasan = alasanKembaliBahan({ ...dasar, woDocNumber: "WO/BDG/2026/0001-ULANG", hargaDariDokumen: true, catatan: catatanPenuh });
    expect(alasan).toBe(`Kembali bahan WO/BDG/2026/0001-ULANG @ 30000.00 (harga dokumen) — ${catatanPenuh}`);
    expect(catatanDariAlasan(alasan)).toBe(catatanPenuh);
  });

  it("awalan terpanjang yang dijanjikan (nomor WO 18 karakter, harga terbesar, penanda) + catatan 120 → masih utuh", () => {
    const alasan = alasanKembaliBahan({
      woDocNumber: "WO/2026/00001-ULNG",
      harga: "9999999999999.99",
      hargaDariDokumen: true,
      vendor: "Konveksi",
      catatan: catatanPenuh,
    });
    expect(alasan.length).toBeLessThanOrEqual(BATAS_ALASAN_PENYESUAIAN);
    expect(catatanDariAlasan(alasan)).toBe(catatanPenuh);
  });

  it("awalan yang sendiri melewati kolom (jalan terakhir) → tetap dipotong ke 190 karakter", () => {
    const alasan = alasanKembaliBahan({ ...dasar, woDocNumber: `WO/${"X".repeat(40)}`, hargaDariDokumen: true, catatan: catatanPenuh });
    expect(alasan.length).toBe(BATAS_ALASAN_PENYESUAIAN);
    expect(alasan.startsWith(`Kembali bahan WO/${"X".repeat(40)} @ 30000.00 (harga dokumen) — `)).toBe(true);
  });

  it("tanda pisah di nama CMT tidak terbaca sebagai awal catatan", () => {
    const alasan = alasanKembaliBahan({ ...dasar, vendor: "CMT A — B", catatan: "sisa" });
    expect(alasan).toBe("Kembali bahan WO/2026/0001 @ 30000.00 dari CMT A - B — sisa");
    expect(catatanDariAlasan(alasan)).toBe("sisa");
    expect(catatanDariAlasan(alasanKembaliBahan({ ...dasar, catatan: "" }))).toBeNull();
  });

  it("harga dibaca dari \"@\" pertama; penanda hanya dihitung TEPAT sesudah harga; tanpa \"@\" → null", () => {
    expect(hargaDariAlasan("Kembali bahan WO/2026/0001 @ 34807.69 dari Penjahit uji")).toEqual({ harga: new Decimal("34807.69"), dariDokumen: false });
    expect(hargaDariAlasan("Kembali bahan WO/2026/0001 @ 30000.00 dari (harga dokumen) CMT").dariDokumen).toBe(false);
    expect(hargaDariAlasan("Penyesuaian manual")).toEqual({ harga: null, dariDokumen: false });
  });
});
