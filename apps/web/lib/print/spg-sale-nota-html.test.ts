import { describe, expect, it } from "vitest";
import type { SpgSaleDetail } from "@/lib/spg/sale-queries";
import { jenisPotongan, rincianNotaSpg, spgSaleNotaHtml } from "./spg-sale-nota-html";

const dasar: SpgSaleDetail = {
  id: "s1",
  docNo: "SPG/2026/00001",
  salesmanLabel: "Sari",
  storeName: "Toko Satu",
  saleLat: null,
  saleLng: null,
  subtotal: 250_000,
  total: 250_000,
  cashReceived: 250_000,
  changeGiven: 0,
  note: null,
  // 3 Okt 2026 17.30 UTC = 4 Okt 2026 00.30 WIB — nota harus bertanggal WIB.
  createdAtIso: "2026-10-03T17:30:00.000Z",
  discountTotal: 0,
  orderPromoName: null,
  orderDiscount: 0,
  manualDiscount: 0,
  manualDiscountReason: null,
  capturedOffline: false,
  syncedAtIso: null,
  customer: null,
  lines: [
    { productName: "Kaos — M", variantSku: "KAOS-M", qty: 2, unitPrice: 100_000, lineTotal: 200_000, discount: 0, promoName: null },
    { productName: "Topi", variantSku: null, qty: 1, unitPrice: 50_000, lineTotal: 50_000, discount: 0, promoName: null },
  ],
};

const teks = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("rincianNotaSpg", () => {
  it("writes an item-promo discount on its own line when it is the only kind of discount", () => {
    const r = rincianNotaSpg({
      ...dasar,
      total: 230_000,
      discountTotal: 20_000,
      lines: [{ ...dasar.lines[0], lineTotal: 180_000, discount: 20_000, promoName: "Diskon 10%" }, dasar.lines[1]],
    });
    expect(r.baris[0]).toEqual({ kotor: 200_000, promo: "Diskon 10%", potongan: 20_000 });
    expect(r.baris[1]).toEqual({ kotor: 50_000, promo: null, potongan: null });
    expect(r.promoBarang).toBe(20_000);
    expect(r.subtotal - r.potonganTotal).toBe(r.total);
  });

  it("splits the discount into item promos, the spend promo, and the SPG discount — and stops labelling line shares", () => {
    const r = rincianNotaSpg({
      ...dasar,
      total: 205_000,
      discountTotal: 45_000,
      orderPromoName: "Belanja 200rb",
      orderDiscount: 15_000,
      manualDiscount: 10_000,
      lines: [
        { ...dasar.lines[0], lineTotal: 160_000, discount: 40_000, promoName: "Diskon 10%" },
        { ...dasar.lines[1], lineTotal: 45_000, discount: 5_000 },
      ],
    });
    expect(r.promoBarang).toBe(20_000);
    expect(r.promoBelanja).toEqual({ nama: "Belanja 200rb", potongan: 15_000 });
    expect(r.diskonSpg).toBe(10_000);
    expect(r.promoBarang + (r.promoBelanja?.potongan ?? 0) + r.diskonSpg).toBe(r.potonganTotal);
    // Potongan baris memuat bagian promo belanja + diskon SPG: tidak ditulis di bawah nama promo barang.
    expect(r.baris.map((b) => b.potongan)).toEqual([null, null]);
    expect(r.baris[0].promo).toBe("Diskon 10%");
  });
});

describe("jenisPotongan", () => {
  it("prints the total-discount row only when more than one kind of discount applies", () => {
    expect(jenisPotongan({ promoBarang: 168_800, promoBelanja: null, diskonSpg: 0 })).toBe(1);
    expect(jenisPotongan({ promoBarang: 20_000, promoBelanja: { nama: "Belanja", potongan: 15_000 }, diskonSpg: 0 })).toBe(2);
  });
});

describe("spgSaleNotaHtml", () => {
  it("prints an old receipt without discounts as before: total only, paid at the store's till, WIB date", () => {
    const t = teks(spgSaleNotaHtml(dasar));
    expect(t).toContain("TOTAL Rp 250.000");
    expect(t).toContain("Bayar di kasir toko");
    expect(t).not.toContain("Subtotal");
    expect(t).not.toContain("hemat");
    expect(t).toContain("04 Okt 2026");
  });

  it("prints subtotal, the discount breakdown, the net total, and the shopper", () => {
    const t = teks(
      spgSaleNotaHtml({
        ...dasar,
        total: 215_000,
        discountTotal: 35_000,
        orderPromoName: "Belanja 200rb",
        orderDiscount: 15_000,
        customer: { id: "c1", name: "Ani <b>", phone: "6281234567890" },
        lines: [
          { ...dasar.lines[0], lineTotal: 170_000, discount: 30_000, promoName: "Diskon 10%" },
          { ...dasar.lines[1], lineTotal: 45_000, discount: 5_000 },
        ],
      }),
    );
    expect(t).toContain("Subtotal Rp 250.000");
    expect(t).toContain("Promo barang -Rp 20.000");
    expect(t).toContain("Belanja 200rb -Rp 15.000");
    expect(t).toContain("Total potongan -Rp 35.000");
    expect(t).toContain("TOTAL Rp 215.000");
    expect(t).toContain("Anda hemat Rp 35.000");
    expect(t).toContain("Bayar di kasir toko");
    expect(t).toContain("Ani &lt;b&gt;");
    // Nomor HP pembeli tidak pernah tercetak di nota.
    expect(t).not.toContain("6281234567890");
  });

  it("still prints cash lines for an old sale that really recorded change", () => {
    const t = teks(spgSaleNotaHtml({ ...dasar, cashReceived: 300_000, changeGiven: 50_000 }));
    expect(t).toContain("TUNAI Rp 300.000");
    expect(t).toContain("KEMBALI Rp 50.000");
    expect(t).not.toContain("Bayar di kasir toko");
  });

  it("fits 58 mm paper: no fixed 80 mm page size", () => {
    const html = spgSaleNotaHtml(dasar);
    expect(html).not.toMatch(/size:\s*80mm/);
    expect(html).toContain("max-width: 80mm");
  });
});
