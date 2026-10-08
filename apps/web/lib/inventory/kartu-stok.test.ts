import { describe, expect, it } from "vitest";
import {
  gabungGerakan,
  kunciPasanganMovement,
  susunKartuStok,
  tautanMovement,
  tautanPenyesuaian,
  type BarisPenyesuaianKartu,
  type BarisMovementKartu,
} from "./kartu-stok";

/*
 * Kartu stok dirakit dari DUA buku: StockMovement (GRN, produksi, retur pemasok,
 * opname, penyesuaian manual) dan StockAdjustment (penjualan marketplace,
 * pengiriman lapangan, van, retur, tukar, transfer konsi, webhook Jubelio…).
 * Sebagian penulis mengisi keduanya untuk satu kejadian; kejadian itu hanya
 * boleh muncul sekali.
 */

const t = (iso: string) => new Date(iso);
const ITEM = "item-1";

function mv(p: Partial<BarisMovementKartu> & { id: string; qty: number; createdAt: Date }): BarisMovementKartu {
  return {
    itemId: ITEM,
    variantSku: "",
    type: p.qty >= 0 ? "IN" : "OUT",
    refType: "GRN",
    refId: `ref-${p.id}`,
    refDocNumber: `DOC-${p.id}`,
    unitCost: 10_000,
    notes: null,
    ...p,
  };
}

function adj(
  p: Partial<BarisPenyesuaianKartu> & { id: string; type: "POSITIVE" | "NEGATIVE"; qtyChange: number; createdAt: Date },
): BarisPenyesuaianKartu {
  return {
    itemId: ITEM,
    docNumber: `ADJ-${p.id}`,
    prevAvgCost: 10_000,
    newAvgCost: 10_000,
    source: "ERP",
    externalRef: null,
    reason: `alasan ${p.id}`,
    ...p,
  };
}

describe("gabungGerakan", () => {
  it("penambahan opname (StockMovement ADJUSTMENT, qty +2) masuk kolom Masuk, bukan Keluar", () => {
    const g = gabungGerakan(
      [mv({ id: "op", type: "ADJUSTMENT", refType: "OPNAME", refId: "opn-1", qty: 2, createdAt: t("2026-10-01T01:00:00Z") })],
      [],
      new Set(),
    );
    const kartu = susunKartuStok({
      gerakan: g,
      saldoSekarang: 2,
      nilaiSekarang: 20_000,
      dari: t("2026-10-01T00:00:00Z"),
      sampai: t("2026-10-02T00:00:00Z"),
      qtySebelumDari: 0,
    });
    expect(kartu.movements[0]).toMatchObject({ in: 2, out: null, balance: 2, jenis: "OPNAME" });
  });

  it("arah penyesuaian diambil dari jenisnya, apa pun tanda qtyChange yang ditulis penulisnya", () => {
    const g = gabungGerakan(
      [],
      [
        // Penulis konsumsi menulis qtyChange negatif…
        adj({ id: "jual", type: "NEGATIVE", qtyChange: -3, source: "FULFILLMENT_CONSUME", createdAt: t("2026-10-01T02:00:00Z") }),
        // …muat van menulis negatif, retur van menulis positif, NRI menulis besaran saja.
        adj({ id: "van", type: "NEGATIVE", qtyChange: -2, source: "VAN_LOAD", createdAt: t("2026-10-01T03:00:00Z") }),
        adj({ id: "nri", type: "POSITIVE", qtyChange: 1, source: "STORE_RETURN_RECEIVE", createdAt: t("2026-10-01T04:00:00Z") }),
        // Penulis lain menulis besaran positif dengan jenis NEGATIVE.
        adj({ id: "konsi", type: "NEGATIVE", qtyChange: 1, source: "KONSI_TRANSFER", createdAt: t("2026-10-01T05:00:00Z") }),
      ],
      new Set(),
    );
    expect(g.map((x) => [x.jenis, x.qty])).toEqual([
      ["FULFILLMENT_CONSUME", -3],
      ["VAN_LOAD", -2],
      ["STORE_RETURN_RECEIVE", 1],
      ["KONSI_TRANSFER", -1],
    ]);
  });

  it("kejadian yang ditulis di kedua buku muncul sekali (manual, opname, rekonsiliasi)", () => {
    const movements = [
      mv({ id: "m1", type: "ADJUSTMENT", refType: "ADJUSTMENT", refId: "adj-manual", qty: 5, createdAt: t("2026-10-01T01:00:00Z") }),
      mv({ id: "m2", type: "ADJUSTMENT", refType: "OPNAME", refId: "opn-1", qty: -1, createdAt: t("2026-10-01T02:00:00Z") }),
      mv({ id: "m3", type: "ADJUSTMENT", refType: "RECON", refId: "run-1", qty: 4, createdAt: t("2026-10-01T03:00:00Z") }),
    ];
    const kunci = new Set(movements.map(kunciPasanganMovement).filter((k): k is string => k != null));
    const g = gabungGerakan(
      movements,
      [
        adj({ id: "adj-manual", type: "POSITIVE", qtyChange: 5, source: "ERP", createdAt: t("2026-10-01T01:00:00Z") }),
        adj({ id: "a2", type: "NEGATIVE", qtyChange: 1, source: "ERP_OPNAME", externalRef: "opn-1", createdAt: t("2026-10-01T02:00:00Z") }),
        adj({ id: "a3", type: "POSITIVE", qtyChange: 4, source: "JUBELIO_RECONCILE", externalRef: "run-1", createdAt: t("2026-10-01T03:00:00Z") }),
        // Opname yang sama, barang LAIN tanpa StockMovement → bukan pasangan, tetap tampil.
        adj({ id: "a4", itemId: "item-2", type: "NEGATIVE", qtyChange: 1, source: "ERP_OPNAME", externalRef: "opn-1", createdAt: t("2026-10-01T02:00:00Z") }),
        // Penyesuaian ERP tanpa pasangan (penulis yang tidak menulis StockMovement) tetap tampil.
        adj({ id: "a5", type: "POSITIVE", qtyChange: 2, source: "ERP", createdAt: t("2026-10-01T04:00:00Z") }),
      ],
      kunci,
    );
    expect(g.map((x) => x.id).sort()).toEqual(["a4", "a5", "m1", "m2", "m3"]);
  });

  it("StockMovement OUT selalu keluar dan IN selalu masuk, apa pun tanda qty baris lamanya", () => {
    const g = gabungGerakan(
      [
        mv({ id: "grn", type: "IN", qty: 10, createdAt: t("2026-10-01T01:00:00Z") }),
        // Baris lama yang menulis OUT dengan qty positif.
        mv({ id: "keluar", type: "OUT", refType: "WO_ISSUE", qty: 3, createdAt: t("2026-10-01T02:00:00Z") }),
        mv({ id: "retur", type: "OUT", refType: "VENDOR_RETURN", qty: -1, createdAt: t("2026-10-01T03:00:00Z") }),
        mv({ id: "opn", type: "ADJUSTMENT", refType: "OPNAME", qty: -2, createdAt: t("2026-10-01T04:00:00Z") }),
      ],
      [],
      new Set(),
    );
    expect(g.map((x) => [x.jenis, x.qty])).toEqual([
      ["GRN", 10],
      ["WO_ISSUE", -3],
      ["VENDOR_RETURN", -1],
      ["OPNAME", -2],
    ]);
  });

  it("gerakan nol dibuang dan urutan menurut waktu", () => {
    const g = gabungGerakan(
      [mv({ id: "b", qty: 1, createdAt: t("2026-10-01T05:00:00Z") })],
      [
        adj({ id: "nol", type: "POSITIVE", qtyChange: 0, source: "JUBELIO_WEBHOOK", createdAt: t("2026-10-01T01:00:00Z") }),
        adj({ id: "a", type: "NEGATIVE", qtyChange: -1, source: "JUBELIO_WEBHOOK", createdAt: t("2026-10-01T02:00:00Z") }),
      ],
      new Set(),
    );
    expect(g.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("susunKartuStok", () => {
  const dari = t("2026-10-01T00:00:00Z");
  const sampai = t("2026-10-31T23:59:59Z");

  it("saldo berjalan berakhir tepat di qtyOnHand, nilai di totalValue (pcs dan rupiah)", () => {
    const g = gabungGerakan(
      [mv({ id: "grn", qty: 10, unitCost: 10_000, createdAt: t("2026-10-02T00:00:00Z") })],
      [adj({ id: "jual", type: "NEGATIVE", qtyChange: -3, source: "FULFILLMENT_CONSUME", createdAt: t("2026-10-03T00:00:00Z") })],
      new Set(),
    );
    const kartu = susunKartuStok({ gerakan: g, saldoSekarang: 7, nilaiSekarang: 70_000, dari, sampai, qtySebelumDari: 0 });
    expect(kartu.openingBalance).toBe(0);
    expect(kartu.openingValue).toBe(0);
    expect(kartu.movements.map((m) => [m.in, m.out, m.balance, m.balanceValue])).toEqual([
      [10, null, 10, 100_000],
      [null, 3, 7, 70_000],
    ]);
    expect(kartu.closingBalance).toBe(7);
    expect(kartu.closingValue).toBe(70_000);
    expect(kartu.tanpaDokumen).toBe(0);
  });

  it("rentang di masa lalu: gerakan sesudah 'sampai' tidak tampil tapi tetap dipakai menjangkar saldo", () => {
    const g = gabungGerakan(
      [mv({ id: "grn", qty: 10, createdAt: t("2026-10-02T00:00:00Z") })],
      [adj({ id: "jual", type: "NEGATIVE", qtyChange: -3, source: "FIELD_SALES_CONSUME", createdAt: t("2026-11-05T00:00:00Z") })],
      new Set(),
    );
    const kartu = susunKartuStok({ gerakan: g, saldoSekarang: 7, nilaiSekarang: 70_000, dari, sampai, qtySebelumDari: 0 });
    expect(kartu.movements).toHaveLength(1);
    expect(kartu.openingBalance).toBe(0);
    expect(kartu.closingBalance).toBe(10);
    expect(kartu.closingValue).toBe(100_000);
  });

  it("stok tanpa dokumen (mis. stok awal dari katalog Jubelio) ditampung di saldo awal dan disebut", () => {
    const g = gabungGerakan(
      [mv({ id: "grn", qty: 10, createdAt: t("2026-10-02T00:00:00Z") })],
      [adj({ id: "jual", type: "NEGATIVE", qtyChange: 3, source: "FULFILLMENT_CONSUME", createdAt: t("2026-10-03T00:00:00Z") })],
      new Set(),
    );
    const kartu = susunKartuStok({ gerakan: g, saldoSekarang: 12, nilaiSekarang: 120_000, dari, sampai, qtySebelumDari: 0 });
    expect(kartu.openingBalance).toBe(5);
    expect(kartu.openingValue).toBe(50_000);
    expect(kartu.closingBalance).toBe(12);
    expect(kartu.tanpaDokumen).toBe(5);
    // Tanpa angka sebelum 'dari', selisihnya tidak bisa disebut.
    expect(susunKartuStok({ gerakan: g, saldoSekarang: 12, nilaiSekarang: 120_000, dari, sampai, qtySebelumDari: null }).tanpaDokumen).toBeNull();
  });

  it("sisa van kembali menggeser harga rata-rata: nilai = nilai baris sesudah − sebelum, saldo awal rupiah tetap 0", () => {
    // Gudang 10 pcs @10.000. Van mengembalikan 2 pcs yang dimuat @7.000 → rata-rata
    // baru (100.000 + 14.000) / 12 = 9.500; penulis menyetel totalValue = 12 × 9.500 = 114.000.
    const g = gabungGerakan(
      [mv({ id: "grn", qty: 10, unitCost: 10_000, createdAt: t("2026-10-02T00:00:00Z") })],
      [
        adj({
          id: "van",
          type: "POSITIVE",
          qtyChange: 2,
          prevQty: 10,
          newQty: 12,
          prevAvgCost: 10_000,
          newAvgCost: 9_500,
          source: "VAN_RETURN",
          createdAt: t("2026-10-03T00:00:00Z"),
        }),
      ],
      new Set(),
    );
    const kartu = susunKartuStok({ gerakan: g, saldoSekarang: 12, nilaiSekarang: 114_000, dari, sampai, qtySebelumDari: 0 });
    expect(kartu.openingValue).toBe(0);
    expect(kartu.movements.map((m) => [m.in, m.unitCost, m.balanceValue])).toEqual([
      [10, 10_000, 100_000],
      [2, 7_000, 114_000],
    ]);
    expect(kartu.closingValue).toBe(114_000);
  });

  it("prevQty/newQty yang tidak cocok dengan qty tidak dipakai menilai (jatuh ke qty × harga rata-rata)", () => {
    const g = gabungGerakan(
      [],
      [
        adj({
          id: "aneh",
          type: "POSITIVE",
          qtyChange: 2,
          prevQty: 0,
          newQty: 0,
          prevAvgCost: 10_000,
          newAvgCost: 9_500,
          source: "VAN_RETURN",
          createdAt: t("2026-10-03T00:00:00Z"),
        }),
      ],
      new Set(),
    );
    expect(g[0]).toMatchObject({ qty: 2, hargaSatuan: 9_500, nilai: null });
  });

  it("qty pecahan (meter kain) tidak menumpuk galat pembulatan", () => {
    const g = gabungGerakan(
      [
        mv({ id: "a", qty: 0.1, unitCost: 3, createdAt: t("2026-10-02T00:00:00Z") }),
        mv({ id: "b", qty: 0.2, unitCost: 3, createdAt: t("2026-10-03T00:00:00Z") }),
      ],
      [],
      new Set(),
    );
    const kartu = susunKartuStok({ gerakan: g, saldoSekarang: 0.3, nilaiSekarang: 0.9, dari, sampai, qtySebelumDari: 0 });
    expect(kartu.movements.map((m) => m.balance)).toEqual([0.1, 0.3]);
    expect(kartu.openingBalance).toBe(0);
    expect(kartu.closingValue).toBe(0.9);
  });
});

describe("tautan dokumen di kartu stok", () => {
  it("jenis yang refId-nya id dokumen menaut ke rinciannya", () => {
    expect(tautanMovement("GRN", "g1")).toBe("/backoffice/inventory/grn/g1");
    expect(tautanMovement("GRN_OWNER_DECLINE", "g1")).toBe("/backoffice/inventory/grn/g1");
    expect(tautanMovement("OPNAME", "o1")).toBe("/backoffice/inventory/stock-opname/o1");
    expect(tautanMovement("VENDOR_RETURN", "r1")).toBe("/backoffice/vendor-returns/r1");
    expect(tautanMovement("RECON", "run1")).toBe("/backoffice/inventory/reconciliation/run1");
    expect(tautanMovement("ADJUSTMENT", "a1")).toBe("/backoffice/inventory/adjustment/a1");
  });

  it("dokumen tanpa halaman, refId kosong, atau penanda sementara → tanpa tautan", () => {
    expect(tautanMovement("WO_ISSUE", "i1")).toBeNull();
    expect(tautanMovement("FG_RECEIPT", "f1")).toBeNull();
    expect(tautanMovement("GRN", "")).toBeNull();
    expect(tautanMovement("GRN", "temp")).toBeNull();
    expect(tautanPenyesuaian("")).toBeNull();
    expect(tautanPenyesuaian("a/1")).toBe("/backoffice/inventory/adjustment/a%2F1");
  });

  it("baris kartu membawa tautannya dari kedua buku", () => {
    const g = gabungGerakan(
      [mv({ id: "m1", qty: 5, createdAt: t("2026-09-01T00:00:00Z") })],
      [adj({ id: "a2", type: "NEGATIVE", qtyChange: 2, createdAt: t("2026-09-02T00:00:00Z"), source: "FULFILLMENT_CONSUME" })],
      new Set(),
    );
    const kartu = susunKartuStok({
      gerakan: g,
      saldoSekarang: 3,
      nilaiSekarang: 30_000,
      dari: t("2026-08-01T00:00:00Z"),
      sampai: t("2026-10-01T00:00:00Z"),
      qtySebelumDari: 0,
    });
    expect(kartu.movements.map((m) => m.tautan)).toEqual([
      "/backoffice/inventory/grn/ref-m1",
      "/backoffice/inventory/adjustment/a2",
    ]);
  });
});
