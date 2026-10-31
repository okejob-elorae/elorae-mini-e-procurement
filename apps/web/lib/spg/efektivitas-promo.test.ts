import { describe, expect, it } from "vitest";
import {
  bandingkan,
  bandingkanPenjualan,
  barangKenaSasaran,
  bersihBaris,
  biayaPerKenaikan,
  deretHarian,
  HARI_MS,
  hitungKeranjang,
  hitungPelanggan,
  hitungPemakaian,
  indeksHari,
  jendelaPromo,
  jumlahSlotHari,
  perHari,
  perToko,
  ringkasEfektivitas,
  sasaranDariTarget,
  type BarisJualPromo,
  type BarisRincianPromo,
  type SasaranPromo,
} from "./efektivitas-promo";

const wib = (s: string) => new Date(`${s}+07:00`);
const SEMUA: SasaranPromo = { semuaToko: true, tokoIds: [], semuaBarang: true, barangIds: [], kategoriIds: [] };

describe("jendelaPromo", () => {
  const sekarang = wib("2026-10-20T12:00:00");

  it("a finished promo: W = start to the end of its last day, B = the same length right before", () => {
    const j = jendelaPromo({ startsAt: wib("2026-10-01T00:00:00"), endsAt: wib("2026-10-10T23:59:59.999"), createdAt: wib("2026-09-28T09:00:00") }, sekarang)!;
    expect(j.promo).toEqual({ mulai: wib("2026-10-01T00:00:00"), akhir: wib("2026-10-11T00:00:00") });
    expect(j.pembanding).toEqual({ mulai: wib("2026-09-21T00:00:00"), akhir: wib("2026-10-01T00:00:00") });
    expect(j.hari).toBe(10);
    expect(j.masihBerjalan).toBe(false);
    expect(j.dipotongRentang).toBe(false);
  });

  it("a running promo ends now, so the baseline is exactly as long (fractional day included)", () => {
    const j = jendelaPromo({ startsAt: wib("2026-10-18T00:00:00"), endsAt: null, createdAt: wib("2026-10-17T00:00:00") }, sekarang)!;
    expect(j.promo.akhir).toEqual(sekarang);
    expect(j.hari).toBe(2.5);
    expect(j.pembanding).toEqual({ mulai: wib("2026-10-15T12:00:00"), akhir: wib("2026-10-18T00:00:00") });
    expect(j.masihBerjalan).toBe(true);
  });

  it("without a start date the promo starts when it was created", () => {
    const j = jendelaPromo({ startsAt: null, endsAt: null, createdAt: wib("2026-10-19T12:00:00") }, sekarang)!;
    expect(j.mulaiPromo).toEqual(wib("2026-10-19T12:00:00"));
    expect(j.hari).toBe(1);
  });

  it("a deactivated promo stops at the moment it was switched off", () => {
    const j = jendelaPromo(
      { startsAt: wib("2026-10-01T00:00:00"), endsAt: wib("2026-10-31T23:59:59.999"), createdAt: wib("2026-10-01T00:00:00"), berhentiPada: wib("2026-10-05T00:00:00") },
      sekarang,
    )!;
    expect(j.promo.akhir).toEqual(wib("2026-10-05T00:00:00"));
    expect(j.berhentiDimatikan).toBe(true);
    expect(j.masihBerjalan).toBe(false);
  });

  it("a range clips W, but the baseline stays right before the promo really started", () => {
    const j = jendelaPromo(
      { startsAt: wib("2026-06-01T00:00:00"), endsAt: null, createdAt: wib("2026-06-01T00:00:00") },
      sekarang,
      { dari: wib("2026-10-11T00:00:00"), sampai: wib("2026-10-15T23:59:59.999") },
    )!;
    expect(j.promo).toEqual({ mulai: wib("2026-10-11T00:00:00"), akhir: wib("2026-10-16T00:00:00") });
    expect(j.pembanding).toEqual({ mulai: wib("2026-05-27T00:00:00"), akhir: wib("2026-06-01T00:00:00") });
    expect(j.dipotongRentang).toBe(true);
    expect(j.masihBerjalan).toBe(true);
  });

  it("null when the promo did not run in the range, or has not started", () => {
    const p = { startsAt: wib("2026-10-01T00:00:00"), endsAt: wib("2026-10-05T23:59:59.999"), createdAt: wib("2026-09-01T00:00:00") };
    expect(jendelaPromo(p, sekarang, { dari: wib("2026-10-06T00:00:00"), sampai: wib("2026-10-20T23:59:59.999") })).toBeNull();
    expect(jendelaPromo({ ...p, startsAt: wib("2026-11-01T00:00:00"), endsAt: null }, sekarang)).toBeNull();
  });

  it("day slots: 24 hours from each period's own start; the last may be partial", () => {
    const j = jendelaPromo({ startsAt: wib("2026-10-18T00:00:00"), endsAt: null, createdAt: wib("2026-10-18T00:00:00") }, sekarang)!;
    expect(jumlahSlotHari(j.promo)).toBe(3);
    expect(indeksHari(wib("2026-10-20T11:00:00"), j.promo)).toBe(2);
    expect(indeksHari(wib("2026-10-17T23:00:00"), j.promo)).toBeNull();
    expect(indeksHari(wib("2026-10-15T12:00:00"), j.pembanding)).toBe(0);
  });
});

describe("sasaran", () => {
  it("items = item targets ∪ items whose current category is a category target; stores only when not all", () => {
    const s = sasaranDariTarget({
      allStores: false,
      allItems: false,
      targets: [
        { kind: "STORE", refId: "t1" },
        { kind: "ITEM", refId: "b1" },
        { kind: "CATEGORY", refId: "k1" },
        { kind: "ITEM", refId: "b1" },
      ],
    });
    expect(s).toEqual({ semuaToko: false, tokoIds: ["t1"], semuaBarang: false, barangIds: ["b1"], kategoriIds: ["k1"] });
    expect(barangKenaSasaran(s, { itemId: "b1", categoryId: null })).toBe(true);
    expect(barangKenaSasaran(s, { itemId: "b2", categoryId: "k1" })).toBe(true);
    expect(barangKenaSasaran(s, { itemId: "b3", categoryId: "k2" })).toBe(false);
    expect(barangKenaSasaran(SEMUA, { itemId: "x", categoryId: null })).toBe(true);
  });

  it("'all' ignores leftover target rows", () => {
    expect(sasaranDariTarget({ allStores: true, allItems: true, targets: [{ kind: "STORE", refId: "t1" }] })).toEqual(SEMUA);
  });
});

describe("comparisons", () => {
  it("percent only when the baseline is above zero", () => {
    expect(bandingkan(150, 100)).toEqual({ promo: 150, pembanding: 100, selisih: 50, persen: 50 });
    expect(bandingkan(10, 0).persen).toBeNull();
    expect(bandingkan(2, 3).persen).toBe(-33.3);
  });

  it("cost per Rp1 uplift exists only when sales went up", () => {
    expect(biayaPerKenaikan(30_000, 120_000)).toBe(0.25);
    expect(biayaPerKenaikan(30_000, 0)).toBeNull();
    expect(biayaPerKenaikan(30_000, -5_000)).toBeNull();
  });

  it("per day divides by the (possibly fractional) length, from one full day on", () => {
    expect(perHari(10, 2.5)).toBe(4);
    expect(perHari(10, 0)).toBeNull();
    expect(perHari(860_840, 0.05)).toBeNull();
  });
});

describe("net line value after shopper returns", () => {
  it("prorates the NET line total by the pieces kept", () => {
    expect(bersihBaris({ qty: 3, returnedQty: 1, lineTotal: 300_000 })).toEqual({ pcs: 2, sen: 20_000_000 });
    expect(bersihBaris({ qty: 2, returnedQty: 2, lineTotal: 100 })).toEqual({ pcs: 0, sen: 0 });
    expect(bersihBaris({ qty: 3, returnedQty: 0, lineTotal: 100 })).toEqual({ pcs: 3, sen: 10_000 });
  });
});

const sekarang = wib("2026-10-20T12:00:00");
const j = jendelaPromo({ startsAt: wib("2026-10-11T00:00:00"), endsAt: wib("2026-10-15T23:59:59.999"), createdAt: wib("2026-10-01T00:00:00") }, sekarang)!;
const baris = (o: Partial<BarisJualPromo> & { waktu: Date }): BarisJualPromo => ({
  spgSaleId: o.spgSaleId ?? `n-${o.waktu.getTime()}-${Math.random()}`,
  storeId: o.storeId ?? "t1",
  itemId: o.itemId ?? "b1",
  categoryId: o.categoryId ?? null,
  waktu: o.waktu,
  qty: o.qty ?? 1,
  returnedQty: o.returnedQty ?? 0,
  lineTotal: o.lineTotal ?? 100_000,
});

describe("sales of target items, promo vs baseline", () => {
  const s: SasaranPromo = { semuaToko: false, tokoIds: ["t1"], semuaBarang: false, barangIds: ["b1"], kategoriIds: [] };
  const data = [
    baris({ spgSaleId: "w1", waktu: wib("2026-10-11T10:00:00"), qty: 2, lineTotal: 180_000 }),
    baris({ spgSaleId: "w1", waktu: wib("2026-10-11T10:00:00"), itemId: "b2", qty: 5 }), // bukan sasaran
    baris({ spgSaleId: "w2", waktu: wib("2026-10-15T23:00:00"), qty: 3, returnedQty: 1, lineTotal: 270_000 }),
    baris({ spgSaleId: "w3", waktu: wib("2026-10-12T10:00:00"), storeId: "t2", qty: 9 }), // toko lain
    baris({ spgSaleId: "b1", waktu: wib("2026-10-06T00:00:00"), qty: 1, lineTotal: 100_000 }),
    baris({ spgSaleId: "b2", waktu: wib("2026-10-10T23:59:59"), qty: 1, lineTotal: 100_000 }),
    baris({ spgSaleId: "x", waktu: wib("2026-10-05T23:59:59"), qty: 7 }), // sebelum pembanding
    baris({ spgSaleId: "y", waktu: wib("2026-10-16T00:00:00"), qty: 7 }), // sesudah promo
  ];

  it("counts net pieces, net rupiah and receipts per period, with per-day averages", () => {
    const p = bandingkanPenjualan(data, s, j);
    expect(p.pcs).toEqual({ promo: 4, pembanding: 2, selisih: 2, persen: 100 });
    expect(p.rupiah).toEqual({ promo: 360_000, pembanding: 200_000, selisih: 160_000, persen: 80 });
    expect(p.nota).toEqual({ promo: 2, pembanding: 2, selisih: 0, persen: 0 });
    expect(p.perHari.pcs).toEqual([0.8, 0.4]);
  });

  it("daily series aligns day k of the promo with day k of the baseline", () => {
    const d = deretHarian(data, s, j);
    expect(d).toHaveLength(5);
    expect(d[0]).toEqual({ hariKe: 1, tanggalPromo: "2026-10-11", tanggalPembanding: "2026-10-06", promo: 2, pembanding: 1 });
    expect(d[4]).toEqual({ hariKe: 5, tanggalPromo: "2026-10-15", tanggalPembanding: "2026-10-10", promo: 2, pembanding: 1 });
    expect(d.reduce((a, x) => a + x.promo, 0)).toBe(4);
  });
});

describe("usage from the per-promo detail rows", () => {
  const r = (o: Partial<BarisRincianPromo>): BarisRincianPromo => ({
    spgSaleId: "n1",
    storeId: "t1",
    termsType: "KONSI",
    waktu: wib("2026-10-12T10:00:00"),
    kind: "BARANG",
    qty: 1,
    discount: 10_000,
    storeDiscount: 0,
    ...o,
  });
  const rincian = [
    r({ spgSaleId: "n1", qty: 2, discount: 20_000, storeDiscount: 5_000 }),
    r({ spgSaleId: "n1", qty: 1, discount: 10_000, storeDiscount: 2_500 }),
    r({ spgSaleId: "n2", storeId: "t2", termsType: "PUTUS", qty: 3, discount: 15_000.5 }),
    r({ spgSaleId: "n3", waktu: wib("2026-10-17T10:00:00"), qty: 9, discount: 99_000 }), // di luar periode
  ];

  it("receipts, pieces, discount and who bears it", () => {
    expect(hitungPemakaian(rincian, j.promo, false)).toEqual({
      nota: 2,
      pcs: 6,
      potongan: 45_000.5,
      konsi: { potongan: 30_000, toko: 7_500, elorae: 22_500 },
      putus: { potongan: 15_000.5 },
    });
  });

  it("a minimum-spend promo reports receipts, not pieces", () => {
    expect(hitungPemakaian(rincian.map((x) => ({ ...x, kind: "BELANJA" })), j.promo, true).pcs).toBeNull();
  });

  it("per store, the ratio and the summary", () => {
    const s: SasaranPromo = { ...SEMUA };
    const jual = [baris({ storeId: "t1", waktu: wib("2026-10-12T10:00:00"), lineTotal: 300_000 }), baris({ storeId: "t1", waktu: wib("2026-10-07T10:00:00"), lineTotal: 100_000 })];
    const t = perToko({ sasaran: s, jendela: j, baris: jual, rincian, belanja: false, tokoBernota: ["t1", "t2", "t1"] });
    expect(t.map((x) => x.storeId)).toEqual(["t1", "t2"]);
    expect(t[0].pemakaian.potongan).toBe(30_000);
    expect(t[0].penjualan.rupiah.selisih).toBe(200_000);
    const ring = ringkasEfektivitas({ sasaran: s, jendela: j, baris: jual, rincian, belanja: false });
    expect(ring.biaya).toBe(Math.round((45_000.5 / 200_000) * 10_000) / 10_000);
  });

  it("store-targeted promos list exactly their target stores, even without sales", () => {
    const s: SasaranPromo = { semuaToko: false, tokoIds: ["t9"], semuaBarang: true, barangIds: [], kategoriIds: [] };
    const t = perToko({ sasaran: s, jendela: j, baris: [], rincian: [], belanja: false, tokoBernota: ["t1"] });
    expect(t.map((x) => x.storeId)).toEqual(["t9"]);
    expect(t[0].penjualan.rupiah.persen).toBeNull();
  });
});

describe("basket", () => {
  it("compares average net receipt value with vs without the promo, excluding old receipts", () => {
    const n = (id: string, nilai: number, storeId = "t1", waktu = wib("2026-10-12T10:00:00")) => ({ id, storeId, waktu, nilaiBersih: nilai });
    const k = hitungKeranjang([n("a", 300_000), n("b", 200_000), n("c", 100_000), n("d", 150_000), n("lama", 999_999), n("e", 50_000, "t2"), n("f", 70_000, "t1", wib("2026-10-17T00:00:00"))], {
      sasaran: { ...SEMUA, semuaToko: false, tokoIds: ["t1"] },
      jendela: j.promo,
      pakai: new Set(["a", "b"]),
      lama: new Set(["lama"]),
    });
    expect(k.dengan).toEqual({ nota: 2, rataRata: 250_000 });
    expect(k.tanpa).toEqual({ nota: 2, rataRata: 125_000 });
    expect(k.selisih).toBe(125_000);
    expect(k.persen).toBe(100);
    expect(k.dikecualikan).toBe(1);
  });

  it("no receipts without the promo → no difference", () => {
    const k = hitungKeranjang([{ id: "a", storeId: "t1", waktu: wib("2026-10-12T10:00:00"), nilaiBersih: 1 }], { sasaran: SEMUA, jendela: j.promo, pakai: new Set(["a"]), lama: new Set() });
    expect(k.tanpa.rataRata).toBeNull();
    expect(k.selisih).toBeNull();
  });
});

describe("customers", () => {
  const nota = [
    { id: "1", phone: "6281", member: true },
    { id: "2", phone: "6281", member: false },
    { id: "3", phone: "6282", member: false },
    { id: "4", phone: null, member: false },
  ];

  it("coverage, distinct buyers by phone, new buyers and members", () => {
    const p = hitungPelanggan({ notaPromo: nota, adaSebelum: new Set(["6282"]), adaSesudah: new Set(["6281"]), jendela: j, sekarang: new Date(j.promo.akhir.getTime() + 31 * HARI_MS) });
    expect(p).toMatchObject({ notaPromo: 4, notaTercatat: 3, cakupan: 75, pembeli: 2, baru: 1, member: 1 });
    expect(p.kembali).toEqual({ dinilai: true, pembeli: 1, persen: 50, sampai: new Date(j.promo.akhir.getTime() + 30 * HARI_MS) });
  });

  it("return purchases are not judged before 30 days have passed after the promo", () => {
    const p = hitungPelanggan({ notaPromo: nota, adaSebelum: new Set(), adaSesudah: new Set(["6281"]), jendela: j, sekarang });
    expect(p.kembali).toEqual({ dinilai: false, sejak: new Date(j.promo.akhir.getTime() + 30 * HARI_MS), masihBerjalan: false });
  });

  it("nothing recorded → coverage null", () => {
    expect(hitungPelanggan({ notaPromo: [], adaSebelum: new Set(), adaSesudah: new Set(), jendela: j, sekarang }).cakupan).toBeNull();
  });
});

describe("biaya tanpa pembanding (2026-10-20)", () => {
  it("does not price the uplift when the baseline sold nothing, like the percent change", () => {
    const jual = [baris({ storeId: "t1", waktu: wib("2026-10-12T10:00:00"), lineTotal: 300_000 })];
    const ring = ringkasEfektivitas({ sasaran: SEMUA, jendela: j, baris: jual, rincian: [], belanja: false });
    expect(ring.penjualan.rupiah.pembanding).toBe(0);
    expect(ring.biaya).toBeNull();
    expect(ring.biayaAlasan).toBe("TANPA_PEMBANDING");
  });
});
