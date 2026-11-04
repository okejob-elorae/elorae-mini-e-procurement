import { describe, expect, it } from "vitest";
import {
  hppTerbaruDari,
  susunRiwayatHpp,
  type EntriBukuHpp,
  type GrnRiwayatHpp,
  type MasukanRiwayatHpp,
  type PenerimaanRiwayatHpp,
} from "./riwayat-hpp";

/*
 * Riwayat HPP barang (keputusan pemilik 2026-11-01): setiap peristiwa biaya
 * dengan HPP SEBENARNYA peristiwa itu, dari angka tersimpan — bukan rata-rata
 * stok hari ini.
 */

const ITEM = "item-1";

const terima = (isi: Partial<PenerimaanRiwayatHpp> & { id: string }): PenerimaanRiwayatHpp => ({
  docNumber: `RCPT/${isi.id}`,
  receivedAt: new Date("2026-10-01T03:00:00.000Z"),
  woId: "wo-1",
  woDocNumber: "WO/2026/0007",
  qtyAccepted: 10,
  avgCostPerUnit: 50_000,
  totalCostValue: 500_000,
  materialCost: 300_000,
  skuBreakdown: null,
  ...isi,
});

const entri = (isi: Partial<EntriBukuHpp> & { id: string; refId: string }): EntriBukuHpp => ({
  refDocNumber: "",
  variantSku: "",
  qty: 10,
  totalCost: 500_000,
  balanceQty: 10,
  balanceValue: 500_000,
  createdAt: new Date("2026-10-01T03:00:00.000Z"),
  ...isi,
});

const grn = (isi: Partial<GrnRiwayatHpp> & { id: string }): GrnRiwayatHpp => ({
  docNumber: `GRN/${isi.id}`,
  poId: null,
  poDocNumber: null,
  ownerDeclinedAt: null,
  items: [],
  ...isi,
});

const masukan = (isi: Partial<MasukanRiwayatHpp> = {}): MasukanRiwayatHpp => ({
  itemId: ITEM,
  penerimaan: [],
  entriPenerimaan: [],
  entriPembelian: [],
  grn: [],
  labelVarian: {},
  batas: 50,
  ambil: 51,
  ...isi,
});

describe("susunRiwayatHpp — penerimaan barang jadi", () => {
  it("contoh pemilik: HPP 50.000 lalu 55.000 tampak apa adanya; rata-rata stok 53.750 hanya di kolom sesudahnya", () => {
    const r = susunRiwayatHpp(
      masukan({
        penerimaan: [
          terima({ id: "r2", receivedAt: new Date("2026-11-01T03:00:00.000Z"), qtyAccepted: 30, avgCostPerUnit: 55_000, totalCostValue: 1_650_000 }),
          terima({ id: "r1" }),
        ],
        entriPenerimaan: [
          entri({ id: "e1", refId: "r1" }),
          entri({ id: "e2", refId: "r2", qty: 30, totalCost: 1_650_000, balanceQty: 40, balanceValue: 2_150_000 }),
        ],
      }),
    );
    expect(r.adaLagi).toBe(false);
    expect(
      r.baris.map((b) => ({ dokumen: b.dokumen, jumlah: b.jumlah, hpp: b.hppPerPcs, sesudah: b.rataRataSesudah, tanggal: b.tanggal })),
    ).toEqual([
      { dokumen: "RCPT/r2", jumlah: 30, hpp: 55_000, sesudah: 53_750, tanggal: "2026-11-01T03:00:00.000Z" },
      { dokumen: "RCPT/r1", jumlah: 10, hpp: 50_000, sesudah: 50_000, tanggal: "2026-10-01T03:00:00.000Z" },
    ]);
    expect(r.baris[0]).toMatchObject({
      jenis: "PRODUKSI",
      tautan: "/backoffice/work-orders/wo-1?tab=receipts",
      induk: "WO/2026/0007",
      tautanInduk: "/backoffice/work-orders/wo-1",
    });
    expect(hppTerbaruDari(r.baris)).toEqual({
      perPcs: 55_000,
      jenis: "PRODUKSI",
      dokumen: "RCPT/r2",
      tautan: "/backoffice/work-orders/wo-1?tab=receipts",
      tanggal: "2026-11-01T03:00:00.000Z",
      jumlah: 30,
    });
  });

  it("per varian dari entri buku stok, berlabel; HPP dokumen tetap tingkat barang", () => {
    const r = susunRiwayatHpp(
      masukan({
        penerimaan: [terima({ id: "r1", qtyAccepted: 3, avgCostPerUnit: 33_333.33, totalCostValue: 100_000 })],
        entriPenerimaan: [
          entri({ id: "e2", refId: "r1", variantSku: "KAOS-M", qty: 2, totalCost: 66_666.67, balanceQty: 2, balanceValue: 66_666.67 }),
          entri({ id: "e1", refId: "r1", variantSku: "KAOS-L", qty: 1, totalCost: 33_333.33, balanceQty: 5, balanceValue: 160_000 }),
        ],
        labelVarian: { "KAOS-M": "Hitam · M (KAOS-M)" },
      }),
    );
    expect(r.baris.map((b) => [b.varianSku, b.varianLabel, b.jumlah, b.hppPerPcs, b.hppDokumen, b.rataRataSesudah])).toEqual([
      ["KAOS-L", null, 1, 33_333.33, 33_333.33, 32_000],
      ["KAOS-M", "Hitam · M (KAOS-M)", 2, 33_333.34, 33_333.33, 33_333.34],
    ]);
  });

  it("penerimaan dari sebelum buku stok: per varian dari rincian penerimaan, HPP = avgCostPerUnit, tanpa rata-rata", () => {
    const r = susunRiwayatHpp(
      masukan({
        penerimaan: [
          terima({ id: "r1", qtyAccepted: 5, avgCostPerUnit: 20_000, skuBreakdown: [{ variantSku: "A-S", qty: 2 }, { variantSku: "A-M", qty: 3 }, { variantSku: "A-L", qty: 0 }] }),
          terima({ id: "r0", receivedAt: new Date("2026-09-01T03:00:00.000Z"), qtyAccepted: 4, avgCostPerUnit: null, totalCostValue: 70_000, skuBreakdown: JSON.stringify("rusak") }),
        ],
      }),
    );
    expect(r.baris.map((b) => [b.dokumen, b.varianSku, b.jumlah, b.hppPerPcs, b.rataRataSesudah])).toEqual([
      ["RCPT/r1", "A-M", 3, 20_000, null],
      ["RCPT/r1", "A-S", 2, 20_000, null],
      ["RCPT/r0", null, 4, 17_500, null],
    ]);
  });

  it("entri buku stok tanpa nilai (sebelum kolom nilai ada) → HPP dokumen, rata-rata tidak tercatat", () => {
    const r = susunRiwayatHpp(
      masukan({
        penerimaan: [terima({ id: "r1" })],
        entriPenerimaan: [entri({ id: "e1", refId: "r1", totalCost: null, balanceValue: null })],
      }),
    );
    expect(r.baris[0]).toMatchObject({ hppPerPcs: 50_000, rataRataSesudah: null });
  });

  it("penerimaan tanpa bahan (lebih produksi) ditandai dan tidak menjadi HPP terbaru", () => {
    const r = susunRiwayatHpp(
      masukan({
        penerimaan: [
          terima({ id: "r2", receivedAt: new Date("2026-11-01T03:00:00.000Z"), qtyAccepted: 5, avgCostPerUnit: 17_000, totalCostValue: 85_000, materialCost: 0 }),
          terima({ id: "r1" }),
        ],
      }),
    );
    expect(r.baris.map((b) => [b.dokumen, b.hppPerPcs, b.catatan])).toEqual([
      ["RCPT/r2", 17_000, "TANPA_BAHAN"],
      ["RCPT/r1", 50_000, null],
    ]);
    expect(hppTerbaruDari(r.baris)?.dokumen).toBe("RCPT/r1");
  });
});

describe("susunRiwayatHpp — pembelian (GRN)", () => {
  it("nilai masuk persediaan per satuan, dengan tautan GRN dan PO", () => {
    const r = susunRiwayatHpp(
      masukan({
        entriPembelian: [entri({ id: "b1", refId: "g1", qty: 100, totalCost: 2_500_000, balanceQty: 150, balanceValue: 3_500_000 })],
        grn: [grn({ id: "g1", poId: "po-1", poDocNumber: "PO/2026/0003" })],
      }),
    );
    expect(r.baris).toEqual([
      expect.objectContaining({
        jenis: "PEMBELIAN",
        dokumen: "GRN/g1",
        tautan: "/backoffice/inventory/grn/g1",
        induk: "PO/2026/0003",
        tautanInduk: "/backoffice/purchase-orders/po-1",
        jumlah: 100,
        hppPerPcs: 25_000,
        hppDokumen: 25_000,
        rataRataSesudah: 23_333.33,
        catatan: null,
      }),
    ]);
  });

  it("entri tanpa nilai → unitCost baris GRN tersimpan (teks JSON), yang SUDAH memuat PPN yang dikapitalisasi; rata-rata dari newAvgCost", () => {
    // Bentuk yang benar-benar disimpan `app/actions/grn.ts`: unitCost = (qty × hargaPo + PPN) ÷ qty.
    const r = susunRiwayatHpp(
      masukan({
        entriPembelian: [entri({ id: "b1", refId: "g1", variantSku: "", qty: 10, totalCost: null, balanceValue: null })],
        grn: [
          grn({
            id: "g1",
            items: JSON.stringify([
              { itemId: "lain", variantSku: null, qty: 10, unitCost: 1 },
              { itemId: ITEM, variantSku: null, qty: 10, unitCost: 11_100, hargaPo: 10_000, ppnDikapitalisasi: 11_000, totalCost: 111_000, newAvgCost: 9_800 },
            ]),
          }),
        ],
      }),
    );
    // PPN tidak dijumlah dua kali (bukan 12.200).
    expect(r.baris[0]).toMatchObject({ hppPerPcs: 11_100, hppDokumen: 11_100, rataRataSesudah: 9_800 });
  });

  it("entri tanpa nilai, GRN tanpa PPN dikapitalisasi → unitCost apa adanya", () => {
    const r = susunRiwayatHpp(
      masukan({
        entriPembelian: [entri({ id: "b1", refId: "g1", variantSku: "K-M", qty: 4, totalCost: null, balanceValue: null })],
        grn: [grn({ id: "g1", items: [{ itemId: ITEM, variantSku: "K-M", qty: 4, unitCost: 25_000 }] })],
      }),
    );
    expect(r.baris[0]).toMatchObject({ hppPerPcs: 25_000, rataRataSesudah: null });
  });

  it("semua baris satu GRN memakai waktu entri terbarunya", () => {
    const r = susunRiwayatHpp(
      masukan({
        entriPembelian: [
          entri({ id: "b1", refId: "g1", variantSku: "K-S", createdAt: new Date("2026-10-01T03:00:00.000Z") }),
          entri({ id: "b2", refId: "g1", variantSku: "K-M", createdAt: new Date("2026-10-01T03:00:00.004Z") }),
        ],
        grn: [grn({ id: "g1" })],
      }),
    );
    expect(r.baris.map((b) => [b.varianSku, b.tanggal])).toEqual([
      ["K-M", "2026-10-01T03:00:00.004Z"],
      ["K-S", "2026-10-01T03:00:00.004Z"],
    ]);
  });

  it("HPP dokumen GRN = Σ nilai ÷ Σ qty semua varian barang ini", () => {
    const r = susunRiwayatHpp(
      masukan({
        entriPembelian: [
          entri({ id: "b2", refId: "g1", variantSku: "K-M", qty: 10, totalCost: 120_000 }),
          entri({ id: "b1", refId: "g1", variantSku: "K-S", qty: 30, totalCost: 300_000 }),
        ],
        grn: [grn({ id: "g1" })],
      }),
    );
    expect(r.baris.map((b) => [b.varianSku, b.hppPerPcs, b.hppDokumen])).toEqual([
      ["K-M", 12_000, 10_500],
      ["K-S", 10_000, 10_500],
    ]);
    expect(hppTerbaruDari(r.baris)).toMatchObject({ perPcs: 10_500, jumlah: 40, jenis: "PEMBELIAN" });
  });

  it("GRN yang ditolak pemilik ditandai dan dilewati sebagai HPP terbaru", () => {
    const r = susunRiwayatHpp(
      masukan({
        entriPembelian: [
          entri({ id: "b2", refId: "g2", createdAt: new Date("2026-11-01T03:00:00.000Z"), totalCost: 900_000 }),
          entri({ id: "b1", refId: "g1" }),
        ],
        grn: [grn({ id: "g2", ownerDeclinedAt: new Date("2026-11-02T03:00:00.000Z") }), grn({ id: "g1" })],
      }),
    );
    expect(r.baris.map((b) => [b.dokumen, b.catatan])).toEqual([
      ["GRN/g2", "DITOLAK_PEMILIK"],
      ["GRN/g1", null],
    ]);
    expect(hppTerbaruDari(r.baris)).toMatchObject({ perPcs: 50_000, dokumen: "GRN/g1" });
  });

  it("GRN yang barisnya tidak ditemukan tetap tampil dengan nomor dari buku stok, tanpa tautan", () => {
    const r = susunRiwayatHpp(masukan({ entriPembelian: [entri({ id: "b1", refId: "hilang", refDocNumber: "GRN/LAMA/1" })] }));
    expect(r.baris[0]).toMatchObject({ dokumen: "GRN/LAMA/1", tautan: null, hppPerPcs: 50_000 });
  });
});

describe("susunRiwayatHpp — gabungan dan halaman", () => {
  it("penerimaan dan pembelian diurutkan terbaru dulu; batas memotong, menandai ada lagi, dan memberi penunjuk", () => {
    const r = susunRiwayatHpp(
      masukan({
        batas: 2,
        penerimaan: [
          terima({ id: "r2", receivedAt: new Date("2026-10-20T03:00:00.000Z") }),
          terima({ id: "r1", receivedAt: new Date("2026-10-05T03:00:00.000Z") }),
        ],
        entriPembelian: [entri({ id: "b1", refId: "g1", createdAt: new Date("2026-10-10T03:00:00.000Z") })],
        grn: [grn({ id: "g1" })],
      }),
    );
    expect(r.baris.map((b) => b.dokumen)).toEqual(["RCPT/r2", "GRN/g1"]);
    expect(r.adaLagi).toBe(true);
    expect(r.berikutnya).toBe("2026-10-10T03:00:00.000Z");
  });

  it("satu penerimaan dengan banyak varian tidak terbelah walau melebihi batas", () => {
    const r = susunRiwayatHpp(
      masukan({
        batas: 2,
        penerimaan: [
          terima({ id: "r2", receivedAt: new Date("2026-10-20T03:00:00.000Z"), qtyAccepted: 3 }),
          terima({ id: "r1", receivedAt: new Date("2026-10-05T03:00:00.000Z") }),
        ],
        entriPenerimaan: [
          entri({ id: "e1", refId: "r2", variantSku: "A-S", qty: 1 }),
          entri({ id: "e2", refId: "r2", variantSku: "A-M", qty: 1 }),
          entri({ id: "e3", refId: "r2", variantSku: "A-L", qty: 1 }),
        ],
      }),
    );
    expect(r.baris.map((b) => [b.dokumen, b.varianSku])).toEqual([
      ["RCPT/r2", "A-L"],
      ["RCPT/r2", "A-M"],
      ["RCPT/r2", "A-S"],
    ]);
    expect(r).toMatchObject({ adaLagi: true, berikutnya: "2026-10-20T03:00:00.000Z" });
    expect(hppTerbaruDari(r.baris)).toMatchObject({ dokumen: "RCPT/r2", jumlah: 3 });
  });

  it("sumber yang terpotong: baris pada atau sebelum peristiwa tertuanya yang terbaca ditunda, tidak dilompati", () => {
    // `ambil` 2 dan dua penerimaan terbaca → mungkin ada penerimaan lain ≤ 10 Okt yang belum terbaca,
    // jadi GRN 1 Okt tidak boleh tampil dulu (penerimaan yang belum terbaca di sela-selanya akan hilang).
    const r = susunRiwayatHpp(
      masukan({
        ambil: 2,
        penerimaan: [
          terima({ id: "r3", receivedAt: new Date("2026-10-20T03:00:00.000Z") }),
          terima({ id: "r2", receivedAt: new Date("2026-10-10T03:00:00.000Z") }),
        ],
        entriPembelian: [
          entri({ id: "b2", refId: "g2", createdAt: new Date("2026-10-15T03:00:00.000Z") }),
          entri({ id: "b1", refId: "g1", createdAt: new Date("2026-10-01T03:00:00.000Z") }),
        ],
        grn: [grn({ id: "g2" }), grn({ id: "g1" })],
      }),
    );
    expect(r.baris.map((b) => b.dokumen)).toEqual(["RCPT/r3", "GRN/g2"]);
    expect(r).toMatchObject({ adaLagi: true, berikutnya: "2026-10-15T03:00:00.000Z" });
  });

  it("semua yang terbaca sudah tampil dan tidak ada yang terpotong → tidak ada lagi, tanpa penunjuk", () => {
    const r = susunRiwayatHpp(masukan({ batas: 5, penerimaan: [terima({ id: "r1" })] }));
    expect(r).toMatchObject({ adaLagi: false, berikutnya: null });
  });

  it("peristiwa sebanyak `ambil` pada milidetik yang sama: tetap tampil, tidak macet tanpa baris", () => {
    const r = susunRiwayatHpp(
      masukan({ batas: 1, ambil: 2, penerimaan: [terima({ id: "r2" }), terima({ id: "r1" })] }),
    );
    expect(r.baris.map((b) => b.dokumen)).toEqual(["RCPT/r2", "RCPT/r1"]);
    expect(r).toMatchObject({ adaLagi: true, berikutnya: "2026-10-01T03:00:00.000Z" });
  });

  it("belum ada peristiwa biaya → kosong, tanpa HPP terbaru", () => {
    const r = susunRiwayatHpp(masukan());
    expect(r).toEqual({ baris: [], adaLagi: false, berikutnya: null });
    expect(hppTerbaruDari(r.baris)).toBeNull();
  });
});

/*
 * Jawaban pemilik P49 (2026-11-02): "HPP harus real" — selisih harga invoice yang DITERIMA menaikkan
 * HPP penerimaan itu, dan HPP terbaru memakai angka yang sudah dikoreksi.
 */
describe("susunRiwayatHpp — selisih harga invoice yang diterima", () => {
  it("menambahkan bagian persediaan ÷ pcs ke HPP baris dan dokumennya, dengan catatan dan HPP sebelumnya", () => {
    const r = susunRiwayatHpp(
      masukan({
        penerimaan: [terima({ id: "r1" })],
        entriPenerimaan: [entri({ id: "e1", refId: "r1" })],
        koreksi: [{ dokumen: "FG_RECEIPT", dokumenId: "r1", variantSku: null, persediaan: 20_000 }],
      }),
    );
    expect(r.baris[0]).toMatchObject({ hppPerPcs: 52_000, hppDokumen: 52_000, hppSebelumKoreksi: 50_000, catatan: "DIKOREKSI_INVOICE" });
    expect(hppTerbaruDari(r.baris)).toMatchObject({ perPcs: 52_000, dokumen: "RCPT/r1" });
  });

  it("koreksi dokumen lain atau GRN dengan id sama tidak menyentuh baris ini; catatan lama dipertahankan", () => {
    const r = susunRiwayatHpp(
      masukan({
        penerimaan: [terima({ id: "r1", materialCost: 0, totalCostValue: 0 })],
        entriPenerimaan: [entri({ id: "e1", refId: "r1" })],
        koreksi: [
          { dokumen: "GRN", dokumenId: "r1", variantSku: null, persediaan: 99_000 },
          { dokumen: "FG_RECEIPT", dokumenId: "r1", variantSku: null, persediaan: 10_000 },
        ],
      }),
    );
    expect(r.baris[0]).toMatchObject({ hppPerPcs: 51_000, catatan: "TANPA_BAHAN" });
    // Tanpa bahan tetap bukan dasar HPP terbaru.
    expect(hppTerbaruDari(r.baris)).toBeNull();
  });
});
