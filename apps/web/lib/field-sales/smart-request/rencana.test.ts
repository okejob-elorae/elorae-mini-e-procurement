import { describe, it, expect } from "vitest";
import {
  bagiPcsKeUkuran,
  susunRencanaKirim,
  type BahanRencana,
  type KandidatRencana,
  type KriteriaRencana,
} from "./rencana";
import { susunDraf } from "./rencana-draf";
import { bacaKriteriaTersimpan, SUMBER_BAWAAN } from "./kriteria";

const rasio = [
  { size: "S", qty: 1 },
  { size: "M", qty: 2 },
  { size: "L", qty: 2 },
  { size: "XL", qty: 1 },
];
const ukuran = (id: string, daftar = ["S", "M", "L", "XL"]) => daftar.map((u) => ({ variantSku: `${id}-${u}`, size: u }));
const stokPenuh = (id: string, n = 50, daftar = ["S", "M", "L", "XL"]) =>
  Object.fromEntries(daftar.map((u) => [`${id}-${u}`, n]));

const kandidat = (itemId: string, over: Partial<KandidatRencana> = {}): KandidatRencana => ({
  itemId,
  sku: itemId.toUpperCase(),
  kategoriId: "k1",
  variants: ukuran(itemId),
  available: stokPenuh(itemId),
  harga: 10_000,
  ...over,
});

const bahanKosong = (kandidatList: KandidatRencana[], over: Partial<BahanRencana> = {}): BahanRencana => ({
  kandidat: kandidatList,
  pernahDikirim: new Set(),
  stokTokoDiketahui: false,
  stokToko: new Map(),
  dipesanToko: new Map(),
  jualTokoLain: new Map(),
  umurHari: new Map(),
  ...over,
});

const kriteria = (over: Partial<KriteriaRencana> = {}): KriteriaRencana => ({
  kategoriIds: ["k1"],
  sumber: ["BELUM_DIKIRIM"],
  jumlah: { mode: "PACK" },
  hariBaru: 90,
  lewatiSisaMin: null,
  maksArtikel: 10,
  anggaran: null,
  konsi: false,
  ...over,
});

describe("bagiPcsKeUkuran", () => {
  it("divides N pcs by the pack ratio (largest remainder)", () => {
    const r = bagiPcsKeUkuran({ pcs: 12, variants: ukuran("a"), available: stokPenuh("a"), ratio: rasio });
    expect(r.baris.map((b) => [b.ukuran, b.qty])).toEqual([["S", 2], ["M", 4], ["L", 4], ["XL", 2]]);
    expect(r.kurang).toEqual([]);

    const sepuluh = bagiPcsKeUkuran({ pcs: 10, variants: ukuran("a"), available: stokPenuh("a"), ratio: rasio });
    // 10 × [1,2,2,1]/6 = 1.67, 3.33, 3.33, 1.67 → lantai 1,3,3,1; dua sisa terbesar (S, XL) dapat +1.
    expect(sepuluh.baris.map((b) => b.qty)).toEqual([2, 3, 3, 2]);
    expect(sepuluh.baris.reduce((s, b) => s + b.qty, 0)).toBe(10);
  });

  it("never exceeds warehouse stock per size and reports the shortfall instead of moving it", () => {
    const r = bagiPcsKeUkuran({
      pcs: 12,
      variants: ukuran("a"),
      available: { "a-S": 0, "a-M": 3, "a-L": 9, "a-XL": 9 },
      ratio: rasio,
    });
    expect(r.baris.map((b) => [b.ukuran, b.qty, b.tersedia])).toEqual([["M", 3, 3], ["L", 4, 9], ["XL", 2, 9]]);
    expect(r.kurang).toEqual([
      { ukuran: "S", butuh: 2, ada: 0 },
      { ukuran: "M", butuh: 4, ada: 3 },
    ]);
  });

  it("falls back to an even split over sizes in stock when no size is in the ratio", () => {
    const r = bagiPcsKeUkuran({
      pcs: 6,
      variants: ukuran("j", ["28", "30", "32"]),
      available: { "j-28": 5, "j-30": 0, "j-32": 5 },
      ratio: rasio,
    });
    expect(r.baris.map((b) => [b.ukuran, b.qty])).toEqual([["28", 3], ["32", 3]]);
    expect(r.kurang).toEqual([]);
  });

  it("an empty ratio also splits evenly over sizes in stock", () => {
    const r = bagiPcsKeUkuran({ pcs: 5, variants: ukuran("a", ["S", "M"]), available: { "a-S": 9, "a-M": 9 }, ratio: [] });
    expect(r.baris.map((b) => b.qty)).toEqual([3, 2]);
  });

  it("an item without variants sends everything as one bucket, capped by its stock", () => {
    const r = bagiPcsKeUkuran({ pcs: 12, variants: [], available: { "": 7 }, ratio: rasio });
    expect(r.baris).toEqual([{ variantSku: "", ukuran: "", qty: 7, tersedia: 7 }]);
    expect(r.kurang).toEqual([{ ukuran: "", butuh: 12, ada: 7 }]);
  });
});

describe("susunRencanaKirim — sumber dan urutan", () => {
  it("only articles that pass a ticked source are considered; the rest are not even listed as skipped", () => {
    const h = susunRencanaKirim(
      bahanKosong([kandidat("a"), kandidat("b")], { pernahDikirim: new Set(["b"]) }),
      kriteria({ sumber: ["BELUM_DIKIRIM"] }),
      rasio,
    );
    expect(h.artikel.map((a) => a.itemId)).toEqual(["a"]);
    expect(h.dilewati).toEqual([]);
    expect(h.artikel[0].alasan).toEqual([{ jenis: "BELUM_DIKIRIM" }]);
  });

  it("with the default sources it keeps the old quick-order ranking: never sent first, then most ordered", () => {
    const h = susunRencanaKirim(
      bahanKosong([kandidat("lama1"), kandidat("lama2"), kandidat("baru")], {
        pernahDikirim: new Set(["lama1", "lama2"]),
        dipesanToko: new Map([["lama1", 5], ["lama2", 50]]),
      }),
      kriteria({ sumber: [...SUMBER_BAWAAN] }),
      rasio,
    );
    expect(h.artikel.map((a) => a.itemId)).toEqual(["baru", "lama2", "lama1"]);
    expect(h.artikel[1].alasan).toEqual([{ jenis: "DIPESAN_DI_SINI", pcs: 50 }]);
  });

  it("lists every matching reason, and within one tier the article with more reasons comes first", () => {
    const h = susunRencanaKirim(
      bahanKosong([kandidat("a"), kandidat("b")], {
        jualTokoLain: new Map([["b", { pcs: 14, toko: 3 }]]),
        umurHari: new Map([["a", 5], ["b", 40]]),
      }),
      kriteria({ sumber: ["BELUM_DIKIRIM", "LAKU_DI_TOKO_LAIN", "BARANG_BARU"] }),
      rasio,
    );
    expect(h.artikel.map((a) => a.itemId)).toEqual(["b", "a"]);
    expect(h.artikel[0].alasan).toEqual([
      { jenis: "BELUM_DIKIRIM" },
      { jenis: "LAKU_DI_TOKO_LAIN", pcs: 14, toko: 3 },
      { jenis: "BARANG_BARU", umurHari: 40 },
    ]);
  });

  it("sells-elsewhere needs at least a pack's worth of pieces sold, like the offer suggestions", () => {
    const h = susunRencanaKirim(
      bahanKosong([kandidat("a"), kandidat("b")], {
        jualTokoLain: new Map([
          ["a", { pcs: 5, toko: 4 }],
          ["b", { pcs: 6, toko: 1 }],
        ]),
      }),
      kriteria({ sumber: ["LAKU_DI_TOKO_LAIN"] }),
      rasio,
    );
    expect(h.artikel.map((a) => a.itemId)).toEqual(["b"]);
  });

  it("new items follow the day limit typed on the form", () => {
    const bahan = bahanKosong([kandidat("a"), kandidat("b")], { umurHari: new Map([["a", 12], ["b", 100]]) });
    expect(susunRencanaKirim(bahan, kriteria({ sumber: ["BARANG_BARU"], hariBaru: 30 }), rasio).artikel.map((a) => a.alasan)).toEqual([
      [{ jenis: "BARANG_BARU", umurHari: 12 }],
    ]);
    expect(susunRencanaKirim(bahan, kriteria({ sumber: ["BARANG_BARU"], hariBaru: 120 }), rasio).artikel).toHaveLength(2);
  });

  it("refill at a store whose stock is recorded: sold a lot, little left", () => {
    const h = susunRencanaKirim(
      bahanKosong([kandidat("a"), kandidat("b"), kandidat("c")], {
        stokTokoDiketahui: true,
        stokToko: new Map([
          ["a", { sisa: 1, dalamProses: 0, laku: 9 }],
          ["b", { sisa: 6, dalamProses: 0, laku: 5 }],
          // Sisa tipis tapi kirimannya sudah di jalan.
          ["c", { sisa: 1, dalamProses: 8, laku: 9 }],
        ]),
        // Riwayat pesanan tidak dipakai bila stok toko tercatat.
        dipesanToko: new Map([["b", 100]]),
      }),
      kriteria({ sumber: ["LAKU_DI_SINI"] }),
      rasio,
    );
    expect(h.artikel.map((a) => a.itemId)).toEqual(["a"]);
    expect(h.artikel[0].alasan).toEqual([{ jenis: "LAKU_DI_SINI", laku: 9, sisa: 1 }]);
  });

  it("takes categories in turns so every chosen category is represented before the article limit", () => {
    const list = [
      kandidat("a1"),
      kandidat("a2"),
      kandidat("a3"),
      kandidat("b1", { kategoriId: "k2" }),
      kandidat("b2", { kategoriId: "k2" }),
    ];
    const h = susunRencanaKirim(bahanKosong(list), kriteria({ kategoriIds: ["k1", "k2"], maksArtikel: 3 }), rasio);
    expect(h.artikel.map((a) => a.itemId)).toEqual(["a1", "b1", "a2"]);
    expect(h.lebih).toBe(2);
  });

  it("ignores articles of a category that was not chosen", () => {
    const h = susunRencanaKirim(bahanKosong([kandidat("a", { kategoriId: "lain" })]), kriteria(), rasio);
    expect(h.artikel).toEqual([]);
    expect(h.lebih).toBe(0);
  });
});

describe("susunRencanaKirim — jumlah dan pengecualian", () => {
  it("one pack per article follows the ratio, and a pack that does not fit is skipped with its reason", () => {
    const h = susunRencanaKirim(
      bahanKosong([
        kandidat("a"),
        kandidat("b", { available: { ...stokPenuh("b"), "b-M": 1 } }),
        kandidat("c", { variants: ukuran("c", ["S", "M", "L"]) }),
        kandidat("d", { variants: [], available: { "": 99 } }),
      ]),
      kriteria(),
      rasio,
    );
    expect(h.artikel.map((a) => [a.itemId, a.pcs])).toEqual([["a", 6]]);
    expect(h.dilewati).toEqual([
      { itemId: "b", sebab: { jenis: "STOK_GUDANG_KURANG", ukuran: "M", butuh: 2, ada: 1 } },
      { itemId: "c", sebab: { jenis: "UKURAN_TIDAK_ADA", ukuran: "XL" } },
      { itemId: "d", sebab: { jenis: "UKURAN_TIDAK_ADA", ukuran: "S" } },
    ]);
  });

  it("an empty ratio in pack mode skips every article with RASIO_KOSONG", () => {
    const h = susunRencanaKirim(bahanKosong([kandidat("a")]), kriteria(), []);
    expect(h.dilewati).toEqual([{ itemId: "a", sebab: { jenis: "RASIO_KOSONG" } }]);
  });

  it("N pcs mode keeps a partly covered article, reports the shortfall, and skips one with no stock at all", () => {
    const h = susunRencanaKirim(
      bahanKosong([
        kandidat("a", { available: { "a-S": 0, "a-M": 9, "a-L": 9, "a-XL": 9 } }),
        kandidat("b", { available: {} }),
        kandidat("c", { variants: [], available: { "": 30 } }),
      ]),
      kriteria({ jumlah: { mode: "PCS", pcs: 12 } }),
      rasio,
    );
    expect(h.artikel.map((a) => [a.itemId, a.pcs])).toEqual([["a", 10], ["c", 12]]);
    expect(h.artikel[0].kurang).toEqual([{ ukuran: "S", butuh: 2, ada: 0 }]);
    expect(h.dilewati).toEqual([{ itemId: "b", sebab: { jenis: "STOK_GUDANG_HABIS" } }]);
    expect(h.totalPcs).toBe(22);
  });

  it("skips an article already well stocked at the store, counting what is on its way — only when the stock is known", () => {
    const bahan = (diketahui: boolean) =>
      bahanKosong([kandidat("a"), kandidat("b")], {
        stokTokoDiketahui: diketahui,
        stokToko: new Map([
          ["a", { sisa: 4, dalamProses: 2, laku: 0 }],
          ["b", { sisa: 2, dalamProses: 0, laku: 0 }],
        ]),
      });
    const h = susunRencanaKirim(bahan(true), kriteria({ lewatiSisaMin: 6 }), rasio);
    expect(h.artikel.map((a) => a.itemId)).toEqual(["b"]);
    expect(h.dilewati).toEqual([{ itemId: "a", sebab: { jenis: "SUDAH_CUKUP", sisa: 4, dalamProses: 2 } }]);

    // Toko putus tanpa buku: sisanya tidak diketahui, tidak ada yang dilewati karena sisa.
    expect(susunRencanaKirim(bahan(false), kriteria({ lewatiSisaMin: 6 }), rasio).artikel).toHaveLength(2);
  });

  it("a putus article without a price is skipped; a consignment one needs no price", () => {
    const list = [kandidat("a", { harga: null })];
    expect(susunRencanaKirim(bahanKosong(list), kriteria(), rasio).dilewati).toEqual([
      { itemId: "a", sebab: { jenis: "HARGA_KOSONG" } },
    ]);
    expect(susunRencanaKirim(bahanKosong(list), kriteria({ konsi: true }), rasio).artikel).toHaveLength(1);
  });

  it("the budget skips an article that does not fit and still tries cheaper ones after it", () => {
    const h = susunRencanaKirim(
      bahanKosong([kandidat("a", { harga: 10_000 }), kandidat("b", { harga: 50_000 }), kandidat("c", { harga: 5_000 })]),
      kriteria({ anggaran: 100_000 }),
      rasio,
    );
    // a = 6 × 10.000 = 60.000; b = 300.000 tidak muat; c = 30.000 → total 90.000.
    expect(h.artikel.map((a) => a.itemId)).toEqual(["a", "c"]);
    expect(h.dilewati).toEqual([{ itemId: "b", sebab: { jenis: "MELEBIHI_ANGGARAN" } }]);
    expect(h.totalNilai).toBe(90_000);
  });

  it("a consignment plan has no budget and no value, whatever the caller passes", () => {
    const h = susunRencanaKirim(
      bahanKosong([kandidat("a", { harga: null }), kandidat("b", { harga: null })]),
      kriteria({ konsi: true, anggaran: 1 }),
      rasio,
    );
    expect(h.artikel).toHaveLength(2);
    expect(h.totalNilai).toBeNull();
  });
});

describe("susunDraf", () => {
  const info = new Map([
    ["a", { sku: "KAOS-A", nama: "Kaos A", kategoriId: "k1", variantsMentah: [{ sku: "a-S", size: "S", color: "Hitam" }], harga: 25_000 }],
  ]);
  const hasil = {
    artikel: [
      {
        itemId: "a",
        alasan: [{ jenis: "BELUM_DIKIRIM" as const }],
        baris: [{ variantSku: "a-S", ukuran: "S", qty: 2, tersedia: 9 }],
        kurang: [],
        pcs: 2,
      },
    ],
    dilewati: [{ itemId: "a", sebab: { jenis: "STOK_GUDANG_HABIS" as const } }],
    lebih: 0,
    totalPcs: 2,
    totalNilai: 50_000,
  };

  it("a consignment draft carries no price, total or rupiah anywhere in its JSON", () => {
    const draf = susunDraf({ hasil, info, namaKategori: new Map([["k1", "Kaos"]]), konsi: true });
    const json = JSON.stringify(draf);
    expect(json).not.toMatch(/harga|price|total|nilai|anggaran|budget|rupiah/i);
    expect(json).not.toContain("Rp");
    expect(json).not.toContain("25000");
    expect(draf.artikel[0].baris[0]).toEqual({ variantSku: "a-S", label: "Hitam · S", namaProduk: "Kaos A — Hitam · S", qty: 2, tersedia: 9 });
  });

  it("a putus draft carries the server unit price on every line", () => {
    const draf = susunDraf({ hasil, info, namaKategori: new Map([["k1", "Kaos"]]), konsi: false });
    expect(draf.konsi).toBe(false);
    if (!draf.konsi) expect(draf.artikel[0].baris[0].hargaSatuan).toBe(25_000);
    expect(draf.artikel[0].kategori).toBe("Kaos");
    expect(draf.dilewati[0]).toEqual({ itemId: "a", sku: "KAOS-A", nama: "Kaos A", sebab: { jenis: "STOK_GUDANG_HABIS" } });
  });
});

describe("bacaKriteriaTersimpan", () => {
  const opsi = { kategoriAda: new Set(["k1", "k2"]), hariBaruBawaan: 90, adaRasio: true };

  it("returns null for nothing or garbage", () => {
    expect(bacaKriteriaTersimpan(null, opsi)).toBeNull();
    expect(bacaKriteriaTersimpan("{bukan json", opsi)).toBeNull();
    expect(bacaKriteriaTersimpan("[1,2]", opsi)).toBeNull();
  });

  it("keeps valid fields, drops vanished categories, and falls back per field", () => {
    const k = bacaKriteriaTersimpan(
      JSON.stringify({
        kategoriIds: ["k2", "hilang", "k2"],
        jumlah: { mode: "PCS", pcs: 12 },
        sumber: ["BARANG_BARU", "ASAL", "BELUM_DIKIRIM"],
        hariBaru: 0,
        lewatiSisa: { aktif: false, min: 4 },
        maksArtikel: 500,
        anggaran: 250_000,
      }),
      opsi,
    );
    expect(k).toEqual({
      kategoriIds: ["k2"],
      jumlah: { mode: "PCS", pcs: 12 },
      sumber: ["BELUM_DIKIRIM", "BARANG_BARU"],
      hariBaru: 90,
      lewatiSisa: { aktif: false, min: 4 },
      maksArtikel: 10,
      anggaran: 250_000,
    });
  });

  it("a saved pack choice becomes 6 pcs when the pack ratio is gone", () => {
    const k = bacaKriteriaTersimpan(JSON.stringify({ jumlah: { mode: "PACK" } }), { ...opsi, adaRasio: false });
    expect(k?.jumlah).toEqual({ mode: "PCS", pcs: 6 });
    expect(k?.sumber).toEqual(SUMBER_BAWAAN);
  });
});
