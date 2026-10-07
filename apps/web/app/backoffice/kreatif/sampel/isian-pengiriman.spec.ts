import { describe, expect, it } from "vitest";
import {
  alasanBelumSiap,
  bacaOngkir,
  barisSamaIsian,
  dariBarang,
  labelVarianPendek,
  perluPilihVarian,
  teksBaris,
  teksBerhasil,
  teksGagal,
  tersediaBaris,
  untukServer,
  varianDitawarkan,
  varianOtomatis,
  type BarisIsian,
} from "@/components/kreatif/pengiriman/isian-pengiriman";

/*
 * Logika isian barang sampel di layar (baris antrean Sampel dan dialog panel
 * Pengiriman). Berkasnya di components/, diuji dari sini karena vitest hanya
 * memuat lib/**.test.ts dan app/**.spec.ts.
 */

const pilihan = {
  perluVarian: true,
  varian: [
    { sku: "K-M", label: "Hitam · M (K-M)", tersedia: 6 },
    { sku: "K-L", label: "Hitam · L (K-L)", tersedia: 0 },
  ],
  tersediaTanpaVarian: null,
};

const baris = (p: Partial<BarisIsian> = {}): BarisIsian => ({
  uid: "u1",
  itemId: "kaos",
  itemName: "Kaos",
  variantSku: null,
  variantLabel: null,
  qty: 1,
  bervarian: true,
  ...p,
});

describe("isian barang sampel", () => {
  it("rencana/pengiriman jadi baris isian; barang bervarian tanpa ukuran belum siap", () => {
    const isi = dariBarang([
      { itemId: "kaos", itemName: "Kaos", variantSku: null, variantLabel: null, qty: 2, perluVarian: true },
      { itemId: "topi", itemName: "Topi", variantSku: null, variantLabel: null, qty: 1, perluVarian: false },
    ]);
    expect(isi.map((b) => [b.itemId, b.bervarian, b.qty])).toEqual([
      ["kaos", true, 2],
      ["topi", false, 1],
    ]);
    expect(alasanBelumSiap(isi, { kaos: pilihan })).toEqual({ kode: "VARIAN", nama: "Kaos" });
    expect(alasanBelumSiap([], {})).toEqual({ kode: "KOSONG" });
    expect(alasanBelumSiap([baris({ variantSku: "K-M", qty: Number.NaN })], {})).toEqual({ kode: "QTY", nama: "Kaos" });
    expect(alasanBelumSiap([baris({ variantSku: "K-M" })], { kaos: pilihan })).toBeNull();
  });

  it("perlu varian juga bila stoknya punya lebih dari satu kunci walau katalog tidak menyebut", () => {
    expect(perluPilihVarian(baris({ bervarian: false }), pilihan)).toBe(true);
    expect(perluPilihVarian(baris({ bervarian: false }), { ...pilihan, perluVarian: false })).toBe(false);
  });

  it("stok tersedia per baris, varian yang ditawarkan, dan varian otomatis", () => {
    expect(tersediaBaris(baris({ variantSku: "K-M" }), pilihan)).toBe(6);
    expect(tersediaBaris(baris({ variantSku: "K-XL" }), pilihan)).toBe(0);
    expect(tersediaBaris(baris(), pilihan)).toBeNull();
    expect(tersediaBaris(baris(), undefined)).toBeNull();
    expect(tersediaBaris(baris({ bervarian: false }), { perluVarian: false, varian: [], tersediaTanpaVarian: 4 })).toBe(4);

    expect(varianDitawarkan(pilihan, null)).toEqual({ tampil: [pilihan.varian[0]], tersembunyi: 1 });
    // Yang sedang terpilih tetap terlihat walau stoknya habis.
    expect(varianDitawarkan(pilihan, "K-L").tampil).toHaveLength(2);

    expect(varianOtomatis(pilihan)).toBeNull();
    expect(varianOtomatis({ perluVarian: false, varian: [pilihan.varian[0]], tersediaTanpaVarian: null })).toBe("K-M");
  });

  it("isian sama dengan asalnya tidak dikirim ulang ke server", () => {
    const asal = [
      { itemId: "kaos", variantSku: "K-M", qty: 2 },
      { itemId: "topi", variantSku: null, qty: 1 },
    ];
    const isi = [baris({ itemId: "topi", qty: 1 }), baris({ itemId: "kaos", variantSku: "K-M", qty: 2 })];
    expect(barisSamaIsian(isi, asal)).toBe(true);
    expect(barisSamaIsian([...isi.slice(0, 1), baris({ itemId: "kaos", variantSku: "K-M", qty: 3 })], asal)).toBe(false);
    expect(untukServer([baris({ variantSku: " K-M " })])).toEqual([{ itemId: "kaos", variantSku: "K-M", qty: 1 }]);
  });

  it("ongkir diketik pemaaf; negatif atau rusak ditandai NaN, kosong null", () => {
    expect(bacaOngkir("Rp 12.000")).toBe(12_000);
    expect(bacaOngkir("12rb")).toBe(12_000);
    expect(bacaOngkir("  ")).toBeNull();
    expect(bacaOngkir("-5")).toBeNaN();
    expect(bacaOngkir("abc")).toBeNaN();
  });

  it("label varian ringkas dan teks baris", () => {
    expect(labelVarianPendek("Hitam · M (KAOS-HTM-M)")).toBe("Hitam · M");
    expect(labelVarianPendek("KAOS-HTM-M")).toBe("KAOS-HTM-M");
    expect(labelVarianPendek(null)).toBeNull();
    expect(teksBaris({ itemName: "Kaos", variantLabel: "Hitam · M (K-M)", qty: 2 })).toBe("Kaos — Hitam · M ×2");
    expect(teksBaris({ itemName: "Topi", variantLabel: null, qty: 1 })).toBe("Topi ×1");
  });

  it("pesan toast menyebut perpindahan tahap; kode galat tak dikenal jatuh ke GAGAL", () => {
    const t = (k: string, v?: Record<string, string | number>) => (v ? `${k}${JSON.stringify(v)}` : k);
    expect(teksBerhasil(t, "resi", { tahap: { dari: "DEAL", ke: "SAMPEL_DIKIRIM" } })).toBe(
      'sampel.ok.tahap{"pesan":"sampel.ok.resi","tahap":"tahap.SAMPEL_DIKIRIM"}',
    );
    expect(teksBerhasil(t, "terima", { tahap: null })).toBe("sampel.ok.terima");
    expect(teksBerhasil(t, "resi", { ulang: true, tahap: null })).toBe("sampel.ok.ulang");
    expect(teksGagal(t, { kode: "VARIAN_WAJIB", detail: "Kaos" })).toBe('sampel.err.VARIAN_WAJIB{"barang":"Kaos"}');
    expect(teksGagal(t, { kode: "ENTAH" })).toBe('sampel.err.GAGAL{"barang":""}');
  });
});
