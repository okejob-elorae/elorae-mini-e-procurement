import { describe, expect, it } from "vitest";
import { hitungPromoKonter, promoBerlaku, type BarisKeranjangPromo, type DiskonManual, type PromoKonter } from "./promo-konter";
import {
  contohPromo,
  hariSah,
  jumlahPotongPaket,
  hitungPemakaianPromo,
  keHariWib,
  keRentangWib,
  periksaIsianPromoKonter,
  rapikanIsianPromoKonter,
  sahkanDiskonManual,
  statusPromoKonter,
  type IsianPromoKonter,
  type NotaPemakaian,
} from "./promo-konter-kantor";

const promo = (p: Partial<PromoKonter> & Pick<PromoKonter, "id" | "type">): PromoKonter => ({
  name: p.id,
  value: null,
  buyQty: null,
  freeQty: null,
  minSubtotal: null,
  allItems: true,
  itemIds: [],
  categoryIds: [],
  allStores: true,
  storeIds: [],
  startsAt: null,
  endsAt: null,
  priority: 0,
  isActive: true,
  ...p,
});

const isian = (i: Partial<IsianPromoKonter> = {}): IsianPromoKonter => ({
  name: "Diskon kemeja",
  type: "PERSEN",
  value: 20,
  buyQty: null,
  freeQty: null,
  minSubtotal: null,
  allItems: true,
  itemIds: [],
  categoryIds: [],
  allStores: true,
  storeIds: [],
  dari: "",
  sampai: "",
  priority: 0,
  note: "",
  storeSharePercent: 0,
  memberOnly: false,
  komponen: [],
  ...i,
});

describe("statusPromoKonter", () => {
  const sekarang = new Date("2026-10-03T05:00:00.000Z");
  it("turunkan status dari tanggal; nonaktif menang", () => {
    expect(statusPromoKonter({ isActive: true, startsAt: null, endsAt: null }, sekarang)).toBe("BERLAKU");
    expect(statusPromoKonter({ isActive: true, startsAt: "2026-10-04T00:00:00+07:00", endsAt: null }, sekarang)).toBe("TERJADWAL");
    expect(statusPromoKonter({ isActive: true, startsAt: null, endsAt: new Date("2026-10-02T16:59:59.999Z") }, sekarang)).toBe("BERAKHIR");
    expect(statusPromoKonter({ isActive: false, startsAt: null, endsAt: null }, sekarang)).toBe("NONAKTIF");
    expect(statusPromoKonter({ isActive: false, startsAt: "2027-01-01T00:00:00Z", endsAt: null }, sekarang)).toBe("NONAKTIF");
  });
  it("detik terakhir masih berlaku", () => {
    expect(statusPromoKonter({ isActive: true, startsAt: null, endsAt: sekarang }, sekarang)).toBe("BERLAKU");
  });
});

describe("rentang tanggal WIB", () => {
  it("mulai = 00:00 WIB hari mulai, akhir = 23:59:59.999 WIB hari akhir", () => {
    const r = keRentangWib("2026-10-03", "2026-10-05");
    expect(r?.startsAt?.toISOString()).toBe("2026-10-02T17:00:00.000Z");
    expect(r?.endsAt?.toISOString()).toBe("2026-10-05T16:59:59.999Z");
  });
  it("kosong = tanpa batas; bolehTerbuka hanya hari akhir kosong", () => {
    expect(keRentangWib("", "")).toEqual({ startsAt: null, endsAt: null });
    expect(keRentangWib("2026-10-03", "")?.endsAt).toBeNull();
  });
  it("menolak teks yang bukan hari kalender", () => {
    expect(keRentangWib("2026-02-31", "")).toBeNull();
    expect(keRentangWib("", "3/10/2026")).toBeNull();
    expect(hariSah("2026-02-29")).toBe(false);
    expect(hariSah("2028-02-29")).toBe(true);
  });
  it("bolak-balik ke hari WIB tidak bergeser, juga di server UTC", () => {
    const r = keRentangWib("2026-10-01", "2026-10-31")!;
    expect(keHariWib(r.startsAt, r.endsAt)).toEqual({ dari: "2026-10-01", sampai: "2026-10-31" });
  });
  it("nota jam 23.30 WIB hari terakhir masih kena promo, 00.00 WIB besoknya tidak", () => {
    const r = keRentangWib("2026-10-01", "2026-10-05")!;
    const p = promo({ id: "a", type: "PERSEN", value: 10, startsAt: r.startsAt!.toISOString(), endsAt: r.endsAt!.toISOString() });
    expect(promoBerlaku(p, "toko", new Date("2026-10-05T23:30:00+07:00"))).toBe(true);
    expect(promoBerlaku(p, "toko", new Date("2026-10-06T00:00:00+07:00"))).toBe(false);
    expect(promoBerlaku(p, "toko", new Date("2026-10-01T00:00:00+07:00"))).toBe(true);
    expect(promoBerlaku(p, "toko", new Date("2026-09-30T23:59:59+07:00"))).toBe(false);
  });
});

describe("contohPromo", () => {
  it("contoh dari mesin yang sama dengan nota", () => {
    expect(contohPromo({ type: "PERSEN", value: 20, buyQty: null, freeQty: null, minSubtotal: null })).toEqual({
      jenis: "SATUAN",
      harga: 199_000,
      sesudah: 159_200,
    });
    expect(contohPromo({ type: "POTONGAN", value: 25_000, buyQty: null, freeQty: null, minSubtotal: null })).toMatchObject({ sesudah: 174_000 });
    expect(contohPromo({ type: "HARGA_KHUSUS", value: 150_000, buyQty: null, freeQty: null, minSubtotal: null })).toMatchObject({ sesudah: 150_000 });
    expect(contohPromo({ type: "BELI_GRATIS", value: null, buyQty: 2, freeQty: 1, minSubtotal: null })).toEqual({
      jenis: "PAKET",
      qty: 3,
      harga: 199_000,
      kotor: 597_000,
      bayar: 398_000,
      gratis: 1,
    });
    expect(contohPromo({ type: "MIN_BELANJA_PERSEN", value: 10, buyQty: null, freeQty: null, minSubtotal: 500_000 })).toEqual({
      jenis: "NOTA",
      belanja: 500_000,
      sesudah: 450_000,
    });
    expect(contohPromo({ type: "MIN_BELANJA_POTONGAN", value: 50_000, buyQty: null, freeQty: null, minSubtotal: 0 })).toEqual({
      jenis: "NOTA",
      belanja: 199_000,
      sesudah: 149_000,
    });
  });
  it("null bila isian belum cukup", () => {
    expect(contohPromo({ type: "PERSEN", value: null, buyQty: null, freeQty: null, minSubtotal: null })).toBeNull();
    expect(contohPromo({ type: "BELI_GRATIS", value: null, buyQty: 0, freeQty: 1, minSubtotal: null })).toBeNull();
  });
});

describe("isian formulir", () => {
  it("merapikan: kolom yang bukan milik jenisnya dikosongkan, sasaran 'semua' membuang pilihan", () => {
    const r = rapikanIsianPromoKonter(
      isian({ type: "BELI_GRATIS", value: 20, buyQty: 2, freeQty: 1, minSubtotal: 9, allItems: true, itemIds: ["x"], allStores: true, storeIds: ["s"], name: "  A  " }),
    );
    expect(r).toMatchObject({ name: "A", value: null, buyQty: 2, freeQty: 1, minSubtotal: null, itemIds: [], storeIds: [] });
    const n = rapikanIsianPromoKonter(isian({ type: "MIN_BELANJA_PERSEN", value: 10, buyQty: 2, minSubtotal: 300_000, allItems: false, itemIds: ["a", "a", ""] }));
    expect(n).toMatchObject({ buyQty: null, minSubtotal: 300_000, itemIds: ["a"] });
  });
  it("memeriksa tanggal, prioritas, sasaran, panjang", () => {
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian()))).toEqual([]);
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian({ dari: "2026-10-05", sampai: "2026-10-01" })))).toContain("TANGGAL_TERBALIK");
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian({ dari: "2026-13-01" })))).toContain("TANGGAL_TIDAK_VALID");
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian({ priority: 1.5 })))).toContain("PRIORITAS_TIDAK_VALID");
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian({ allItems: false })))).toContain("BARANG_KOSONG");
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian({ allStores: false })))).toContain("TOKO_KOSONG");
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian({ value: 120 })))).toContain("PERSEN_LEWAT_100");
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian({ name: "x".repeat(121) })))).toContain("NAMA_TERLALU_PANJANG");
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian({ type: "MIN_BELANJA_POTONGAN", value: 10_000, minSubtotal: null })))).toContain(
      "MIN_BELANJA_TIDAK_VALID",
    );
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian({ storeSharePercent: 100.5 })))).toContain("BAGIAN_TOKO_TIDAK_VALID");
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian({ storeSharePercent: 33.333 })))).toContain("BAGIAN_TOKO_TIDAK_VALID");
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian({ storeSharePercent: 33.33 })))).toEqual([]);
    // Hari mulai = hari akhir sah: promo satu hari.
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian({ dari: "2026-10-05", sampai: "2026-10-05" })))).toEqual([]);
  });
});

describe("sahkanDiskonManual", () => {
  it("hanya menerima nilai yang terbaca kembali persis sama", () => {
    expect(sahkanDiskonManual({ aktif: true, maksPersen: 15, alasanWajib: false, bagianTokoPersen: 50 })).toEqual({
      aktif: true,
      maksPersen: 15,
      alasanWajib: false,
      bagianTokoPersen: 50,
    });
    expect(sahkanDiskonManual({ aktif: true, maksPersen: 101, alasanWajib: true, bagianTokoPersen: 0 })).toBeNull();
    expect(sahkanDiskonManual({ aktif: true, maksPersen: 7.5, alasanWajib: true, bagianTokoPersen: 0 })).toBeNull();
    expect(sahkanDiskonManual({ aktif: "ya", maksPersen: 10, alasanWajib: true, bagianTokoPersen: 0 })).toBeNull();
    expect(sahkanDiskonManual({ aktif: true, maksPersen: 10, alasanWajib: true, bagianTokoPersen: 120 })).toBeNull();
    expect(sahkanDiskonManual({ aktif: true, maksPersen: 10, alasanWajib: true })).toBeNull();
    expect(sahkanDiskonManual(null)).toBeNull();
  });
});

/** Nota seperti yang ditulis `recordSpgSale`, dari mesin yang sama. */
function notaDariMesin(id: string, baris: BarisKeranjangPromo[], promos: PromoKonter[], manual?: DiskonManual): NotaPemakaian {
  const h = hitungPromoKonter({
    baris,
    promos,
    storeId: "toko",
    waktu: new Date("2026-10-03T10:00:00+07:00"),
    diskonManual: manual ?? null,
    aturanManual: { aktif: true, maksPersen: 100 },
  });
  if (!h.ok) throw new Error(h.code);
  return {
    id,
    total: h.total,
    discountTotal: h.potonganTotal,
    orderDiscount: h.promoNota?.potongan ?? 0,
    manualDiscount: h.diskonManual,
    orderPromoId: h.promoNota?.id ?? null,
    baris: baris.map((b) => {
      const r = h.baris.find((x) => x.key === b.key)!;
      return { counterPromoId: r.promoId, qty: b.qty, unitPrice: b.unitPrice, lineTotal: r.bersih, discount: r.potongan };
    }),
  };
}

describe("hitungPemakaianPromo", () => {
  const kemeja: BarisKeranjangPromo = { key: "kemeja", itemId: "kemeja", categoryId: null, qty: 2, unitPrice: 100_000 };
  const celana: BarisKeranjangPromo = { key: "celana", itemId: "celana", categoryId: null, qty: 3, unitPrice: 50_000 };
  const kaos: BarisKeranjangPromo = { key: "kaos", itemId: "kaos", categoryId: null, qty: 1, unitPrice: 75_000 };
  const persen = promo({ id: "persen", type: "PERSEN", value: 20, allItems: false, itemIds: ["kemeja"] });
  const potong = promo({ id: "potong", type: "POTONGAN", value: 10_000, allItems: false, itemIds: ["celana"] });

  it("promo barang tanpa potongan nota: potongan baris apa adanya", () => {
    const m = hitungPemakaianPromo([notaDariMesin("n1", [kemeja, kaos], [persen])]);
    expect(m.get("persen")).toEqual({ nota: 1, potongan: 40_000 });
  });

  it("diskon manual tidak ikut terhitung sebagai potongan promo barang (dua promo, satu nota)", () => {
    const n = notaDariMesin("n1", [kemeja, celana, kaos], [persen, potong], { jenis: "PERSEN", nilai: 10 });
    expect(n.manualDiscount).toBeGreaterThan(0);
    const m = hitungPemakaianPromo([n]);
    expect(m.get("persen")).toEqual({ nota: 1, potongan: 40_000 });
    expect(m.get("potong")).toEqual({ nota: 1, potongan: 30_000 });
  });

  it("promo belanja dihitung dari potongan notanya; jumlah semua potongan = potongan nota − diskon manual", () => {
    const belanja = promo({ id: "belanja", type: "MIN_BELANJA_POTONGAN", value: 25_000, minSubtotal: 200_000 });
    const n1 = notaDariMesin("n1", [kemeja, celana], [persen, potong, belanja], { jenis: "RUPIAH", nilai: 7_000 });
    const n2 = notaDariMesin("n2", [kemeja], [persen]);
    const m = hitungPemakaianPromo([n1, n2]);
    expect(m.get("belanja")).toEqual({ nota: 1, potongan: 25_000 });
    expect(m.get("persen")).toEqual({ nota: 2, potongan: 80_000 });
    expect(m.get("potong")).toEqual({ nota: 1, potongan: 30_000 });
    const jumlah = [...m.values()].reduce((s, v) => s + v.potongan, 0);
    expect(jumlah).toBeCloseTo(n1.discountTotal - n1.manualDiscount + n2.discountTotal, 2);
  });

  it("beli X gratis Y: potong gratis jadi potongan promonya", () => {
    const paket = promo({ id: "paket", type: "BELI_GRATIS", buyQty: 2, freeQty: 1 });
    const m = hitungPemakaianPromo([notaDariMesin("n1", [{ ...kemeja, qty: 3 }], [paket])]);
    expect(m.get("paket")).toEqual({ nota: 1, potongan: 100_000 });
  });

  it("nota tanpa promo tidak tercatat", () => {
    expect(hitungPemakaianPromo([notaDariMesin("n1", [kaos], [persen])]).size).toBe(0);
  });
});

describe("pemakaian dengan rincian dan diskon member (2026-10-20)", () => {
  it("uses the recorded per-promo detail exactly, including a second promo on the same line", () => {
    const hasil = hitungPemakaianPromo([
      {
        id: "n1",
        total: 80_000,
        discountTotal: 20_000,
        orderDiscount: 0,
        manualDiscount: 0,
        memberDiscount: 5_000,
        orderPromoId: null,
        baris: [{ counterPromoId: "a", qty: 2, unitPrice: 50_000, lineTotal: 80_000, discount: 20_000 }],
        rincian: [
          { promoId: "a", discount: 10_000 },
          { promoId: "b", discount: 5_000 },
        ],
      },
    ]);
    expect(hasil.get("a")).toEqual({ nota: 1, potongan: 10_000 });
    expect(hasil.get("b")).toEqual({ nota: 1, potongan: 5_000 });
  });

  it("does not count the member discount as item-promo discount on notes without detail", () => {
    const hasil = hitungPemakaianPromo([
      {
        id: "n1",
        total: 85_000,
        discountTotal: 15_000,
        orderDiscount: 0,
        manualDiscount: 0,
        memberDiscount: 5_000,
        orderPromoId: null,
        baris: [{ counterPromoId: "a", qty: 1, unitPrice: 100_000, lineTotal: 85_000, discount: 15_000 }],
      },
    ]);
    expect(hasil.get("a")?.potongan).toBe(10_000);
  });
});

describe("promo paket dan khusus member di formulir kantor (2026-10-20)", () => {
  const paket = (i: Partial<IsianPromoKonter> = {}) =>
    isian({
      name: "Paket kaos + celana",
      type: "PAKET",
      value: 250_000,
      komponen: [
        { jenis: "CATEGORY", refId: "kaos", qty: 2 },
        { jenis: "ITEM", refId: "celana", qty: 1 },
      ],
      ...i,
    });

  it("derives the item and category targets from the components and never keeps 'all items'", () => {
    const r = rapikanIsianPromoKonter(paket({ allItems: true, itemIds: ["lain"], categoryIds: ["lain"], buyQty: 2, freeQty: 1, minSubtotal: 9 }));
    expect(r).toMatchObject({
      type: "PAKET",
      value: 250_000,
      allItems: false,
      itemIds: ["celana"],
      categoryIds: ["kaos"],
      buyQty: null,
      freeQty: null,
      minSubtotal: null,
    });
    expect(r.komponen).toEqual([
      { jenis: "CATEGORY", refId: "kaos", qty: 2 },
      { jenis: "ITEM", refId: "celana", qty: 1 },
    ]);
    expect(periksaIsianPromoKonter(r)).toEqual([]);
  });

  it("drops components from every other promo type", () => {
    const r = rapikanIsianPromoKonter(isian({ komponen: [{ jenis: "ITEM", refId: "celana", qty: 2 }] }));
    expect(r.komponen).toEqual([]);
    expect(r.allItems).toBe(true);
  });

  it("keeps broken components so the check refuses them instead of saving a smaller bundle", () => {
    const rusak = rapikanIsianPromoKonter(
      paket({ komponen: [{ jenis: "ITEM", refId: "celana", qty: 1 }, { jenis: "BARANG", refId: "kaos", qty: 1 } as never, null as never] }),
    );
    expect(rusak.komponen).toHaveLength(3);
    expect(periksaIsianPromoKonter(rusak)).toContain("PAKET_TIDAK_VALID");
    expect(rapikanIsianPromoKonter(paket({ komponen: "bukan daftar" as never })).komponen).toEqual([]);
  });

  it("refuses an empty, duplicated, too small or out-of-range bundle with one problem, not 'no products' too", () => {
    const masalah = (i: Partial<IsianPromoKonter>) => periksaIsianPromoKonter(rapikanIsianPromoKonter(paket(i)));
    expect(masalah({ komponen: [] })).toEqual(["PAKET_TIDAK_VALID"]);
    expect(
      masalah({
        komponen: [
          { jenis: "ITEM", refId: "celana", qty: 1 },
          { jenis: "ITEM", refId: "celana", qty: 1 },
        ],
      }),
    ).toEqual(["PAKET_TIDAK_VALID"]);
    expect(masalah({ komponen: [{ jenis: "ITEM", refId: "celana", qty: 1 }] })).toEqual(["PAKET_TIDAK_VALID"]);
    expect(masalah({ komponen: [{ jenis: "ITEM", refId: "celana", qty: 21 }] })).toEqual(["PAKET_TIDAK_VALID"]);
    expect(masalah({ komponen: [{ jenis: "ITEM", refId: "", qty: 2 }] })).toEqual(["PAKET_TIDAK_VALID"]);
    expect(masalah({ komponen: [{ jenis: "ITEM", refId: "celana", qty: 1.5 }, { jenis: "CATEGORY", refId: "kaos", qty: 1 }] })).toEqual(["PAKET_TIDAK_VALID"]);
    expect(masalah({ value: null })).toEqual(["NILAI_TIDAK_VALID"]);
  });

  it("keeps the members-only switch as a strict boolean on every promo type", () => {
    expect(rapikanIsianPromoKonter(isian({ memberOnly: true })).memberOnly).toBe(true);
    expect(rapikanIsianPromoKonter(isian({ memberOnly: "ya" as never })).memberOnly).toBe(false);
    expect(rapikanIsianPromoKonter(paket({ memberOnly: true })).memberOnly).toBe(true);
    expect(periksaIsianPromoKonter(rapikanIsianPromoKonter(isian({ memberOnly: true })))).toEqual([]);
  });

  it("counts the pieces of one bundle, ignoring quantities that are not whole numbers", () => {
    expect(jumlahPotongPaket(paket().komponen)).toBe(3);
    expect(jumlahPotongPaket([{ jenis: "ITEM", refId: "a", qty: Number.NaN }, { jenis: "ITEM", refId: "b", qty: 2 }])).toBe(2);
    expect(jumlahPotongPaket(undefined)).toBe(0);
  });

  it("works the bundle example out with the same engine as the receipt", () => {
    const komponen = paket().komponen;
    expect(contohPromo({ type: "PAKET", value: 450_000, buyQty: null, freeQty: null, minSubtotal: null, komponen })).toEqual({
      jenis: "BUNDEL",
      qty: 3,
      harga: 199_000,
      kotor: 597_000,
      bayar: 450_000,
      terbentuk: true,
      dariHargaBarang: false,
    });
    // Not below the normal price: the counter does not form the bundle.
    expect(contohPromo({ type: "PAKET", value: 600_000, buyQty: null, freeQty: null, minSubtotal: null, komponen })).toEqual({
      jenis: "BUNDEL",
      qty: 3,
      harga: 199_000,
      kotor: 597_000,
      bayar: 597_000,
      terbentuk: false,
      dariHargaBarang: false,
    });
    expect(contohPromo({ type: "PAKET", value: null, buyQty: null, freeQty: null, minSubtotal: null, komponen })).toBeNull();
    expect(
      contohPromo({ type: "PAKET", value: 100_000, buyQty: null, freeQty: null, minSubtotal: null, komponen: [{ jenis: "ITEM", refId: "a", qty: 1 }] }),
    ).toBeNull();
  });
});

describe("contoh paket dengan harga barang sebenarnya (2026-10-20)", () => {
  const komponen = [
    { jenis: "ITEM" as const, refId: "kemeja", qty: 1 },
    { jenis: "ITEM" as const, refId: "celana", qty: 1 },
  ];
  const harga = new Map([
    ["kemeja", 249_000],
    ["celana", 279_000],
  ]);
  it("uses the goods' Elorae selling prices when every component is a specific item", () => {
    const c = contohPromo({ type: "PAKET", value: 450_000, buyQty: null, freeQty: null, minSubtotal: null, komponen, hargaBarang: (id) => harga.get(id) ?? null });
    expect(c).toEqual({ jenis: "BUNDEL", qty: 2, harga: 0, kotor: 528_000, bayar: 450_000, terbentuk: true, dariHargaBarang: true });
  });
  it("falls back to the sample price when a component is a category or a price is missing", () => {
    const c = contohPromo({
      type: "PAKET",
      value: 450_000,
      buyQty: null,
      freeQty: null,
      minSubtotal: null,
      komponen: [komponen[0], { jenis: "CATEGORY", refId: "kaos", qty: 1 }],
      hargaBarang: (id) => harga.get(id) ?? null,
    });
    expect(c && c.jenis === "BUNDEL" && c.dariHargaBarang).toBe(false);
  });
});
