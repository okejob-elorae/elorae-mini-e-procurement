import { describe, expect, it } from "vitest";
import { bacaAlasan, bacaTambahan } from "@/lib/spg/saran-minta";
import { mintaDariPembeli } from "./dari-pembeli";

const tambahDari = (alamat: string) => bacaTambahan(new URL(alamat, "https://x.test").searchParams.get("tambah"));

describe("mintaDariPembeli", () => {
  it("fills the request form with the wanted goods, their recorded quantity and the shopper reason", () => {
    const h = mintaDariPembeli(
      [
        { itemId: "item_kaos", variantSku: "KAOS-HTM-XL", qty: 2 },
        { itemId: "item_celana", variantSku: "", qty: 1 },
      ],
      "DICARI_PEMBELI",
    );
    expect(h.terisi).toBe(2);
    expect(h.tanpaBarang).toBe(0);
    expect(h.alamat.startsWith("/pwa/spg/stok/minta?tambah=")).toBe(true);
    expect(tambahDari(h.alamat)).toEqual([
      { itemId: "item_kaos", variantSku: "KAOS-HTM-XL", qty: 2, alasan: "DICARI_PEMBELI" },
      { itemId: "item_celana", variantSku: "", qty: 1, alasan: "DICARI_PEMBELI" },
    ]);
  });

  it("goods typed by name cannot be prefilled — counted, never sent", () => {
    const h = mintaDariPembeli(
      [
        { itemId: null, variantSku: "", qty: 3 },
        { itemId: "item_kaos", variantSku: null, qty: 4 },
        { itemId: null, variantSku: "", qty: 1 },
      ],
      "TITIP_PEMBELI",
    );
    expect(h.terisi).toBe(1);
    expect(h.tanpaBarang).toBe(2);
    expect(tambahDari(h.alamat)).toEqual([{ itemId: "item_kaos", variantSku: "", qty: 4, alasan: "TITIP_PEMBELI" }]);
  });

  it("the phone payload carries goods, sizes and quantities only — no price", () => {
    const h = mintaDariPembeli([{ itemId: "item_kaos", variantSku: "KAOS-M", qty: 2 }], "TITIP_PEMBELI");
    const muatan = JSON.stringify(h);
    expect(muatan).not.toMatch(/harga|price|total|rp\b/i);
    expect(Object.keys(h).sort()).toEqual(["alamat", "tanpaBarang", "terisi"]);
  });

  it("only typed-name goods → the plain form, nothing prefilled", () => {
    const h = mintaDariPembeli([{ itemId: null, variantSku: "", qty: 2 }], "TITIP_PEMBELI");
    expect(h).toEqual({ alamat: "/pwa/spg/stok/minta", terisi: 0, tanpaBarang: 1 });
  });

  it("two shoppers waiting for the same size add up; a broken quantity starts at 1", () => {
    const h = mintaDariPembeli(
      [
        { itemId: "item_kaos", variantSku: "KAOS-M", qty: 2 },
        { itemId: "item_kaos", variantSku: "KAOS-M", qty: 3 },
        { itemId: "item_topi", variantSku: "", qty: 0 },
      ],
      "TITIP_PEMBELI",
    );
    expect(h.terisi).toBe(2);
    expect(tambahDari(h.alamat)).toEqual([
      { itemId: "item_kaos", variantSku: "KAOS-M", qty: 5, alasan: "TITIP_PEMBELI" },
      { itemId: "item_topi", variantSku: "", qty: 1, alasan: "TITIP_PEMBELI" },
    ]);
  });
});

describe("mintaDariPembeli — many shoppers", () => {
  it("merges before the link limit: 60 shoppers waiting for one size are one line, not 50 cut lines", () => {
    const h = mintaDariPembeli(
      Array.from({ length: 60 }, () => ({ itemId: "item_kaos", variantSku: "KAOS-M", qty: 1 })),
      "TITIP_PEMBELI",
    );
    expect(h.terisi).toBe(1);
    expect(tambahDari(h.alamat)).toEqual([{ itemId: "item_kaos", variantSku: "KAOS-M", qty: 60, alasan: "TITIP_PEMBELI" }]);
  });

  it("past the link limit, the count on the button is what reaches the form", () => {
    const h = mintaDariPembeli(
      Array.from({ length: 55 }, (_, i) => ({ itemId: `item_${i}`, variantSku: "", qty: 1 })),
      "TITIP_PEMBELI",
    );
    expect(h.terisi).toBe(50);
    expect(tambahDari(h.alamat)).toHaveLength(50);
  });
});

describe("shopper reasons on a stock request line", () => {
  it("are accepted by the request writer's reader", () => {
    expect(bacaAlasan("DICARI_PEMBELI")).toBe("DICARI_PEMBELI");
    expect(bacaAlasan("TITIP_PEMBELI")).toBe("TITIP_PEMBELI");
    expect(bacaAlasan("dicari_pembeli")).toBeNull();
  });
});
