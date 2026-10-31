import { describe, expect, it } from "vitest";
import {
  KANAL_JURNAL,
  KANAL_MARKETPLACE,
  LABEL_KANAL_JURNAL,
  SEMUA_KANAL_JURNAL,
  bacaKanalJurnal,
  kanalMarketplace,
  kanalPesananLapangan,
  labelKanalJurnal,
} from "./kanal";

describe("KANAL_JURNAL", () => {
  it("sembilan kanal, setiap kanal punya label, urutan tampil memuat semuanya sekali", () => {
    expect(SEMUA_KANAL_JURNAL).toEqual([
      "SHOPEE",
      "TIKTOK",
      "TOKOPEDIA",
      "MARKETPLACE_LAIN",
      "PUTUS",
      "KONSINYASI",
      "KANVAS",
      "KOL",
      "LAINNYA",
    ]);
    expect(new Set(SEMUA_KANAL_JURNAL)).toEqual(new Set(Object.values(KANAL_JURNAL)));
    for (const k of SEMUA_KANAL_JURNAL) expect(LABEL_KANAL_JURNAL[k].length).toBeGreaterThan(0);
    expect(KANAL_MARKETPLACE).toEqual(["SHOPEE", "TIKTOK", "TOKOPEDIA", "MARKETPLACE_LAIN"]);
  });
});

describe("kanalMarketplace — dari SalesOrder.channel / Settlement.marketplace", () => {
  it("memetakan setiap nilai enum SalesChannel", () => {
    expect(kanalMarketplace("SHOPEE")).toBe("SHOPEE");
    expect(kanalMarketplace("TIKTOK")).toBe("TIKTOK");
    expect(kanalMarketplace("TOKOPEDIA")).toBe("TOKOPEDIA");
    expect(kanalMarketplace("OTHER")).toBe("MARKETPLACE_LAIN");
    expect(kanalMarketplace("OFFLINE")).toBe("MARKETPLACE_LAIN");
  });

  it("mengabaikan huruf besar/kecil dan spasi; kosong atau asing → marketplace lain", () => {
    expect(kanalMarketplace(" shopee ")).toBe("SHOPEE");
    expect(kanalMarketplace("TikTok")).toBe("TIKTOK");
    expect(kanalMarketplace("tiktok_shop")).toBe("TIKTOK");
    expect(kanalMarketplace(null)).toBe("MARKETPLACE_LAIN");
    expect(kanalMarketplace(undefined)).toBe("MARKETPLACE_LAIN");
    expect(kanalMarketplace("LAZADA")).toBe("MARKETPLACE_LAIN");
  });
});

describe("kanalPesananLapangan", () => {
  it("KONSI → KONSINYASI, selain itu PUTUS", () => {
    expect(kanalPesananLapangan("KONSI")).toBe("KONSINYASI");
    expect(kanalPesananLapangan("PUTUS")).toBe("PUTUS");
  });
});

describe("bacaKanalJurnal / labelKanalJurnal", () => {
  it("hanya nilai persis yang dikenal; sisanya null dan berlabel 'Tanpa kanal'", () => {
    expect(bacaKanalJurnal("KANVAS")).toBe("KANVAS");
    expect(bacaKanalJurnal("kanvas")).toBeNull();
    expect(bacaKanalJurnal(null)).toBeNull();
    expect(bacaKanalJurnal(5)).toBeNull();
    expect(labelKanalJurnal("KONSINYASI")).toBe("Konsinyasi");
    expect(labelKanalJurnal(null)).toBe("Tanpa kanal");
    expect(labelKanalJurnal("APA")).toBe("Tanpa kanal");
  });
});
