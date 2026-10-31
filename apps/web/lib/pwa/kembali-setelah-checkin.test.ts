import { describe, expect, it } from "vitest";
import {
  TUJUAN_BERANDA,
  UMUR_TITIPAN_MS,
  bacaTitipan,
  isiTitipan,
  kembaliAman,
  tautanCheckInLaluKembali,
  tujuanSesudahCheckIn,
} from "./kembali-setelah-checkin";

describe("kembaliAman", () => {
  it("accepts screens inside the phone app, keeping their query", () => {
    expect(kembaliAman("/pwa/spg/opname")).toBe("/pwa/spg/opname");
    expect(kembaliAman("/pwa/spg/terima/PUTUS/abc")).toBe("/pwa/spg/terima/PUTUS/abc");
    expect(kembaliAman("/pwa/spg/stok?saring=habis")).toBe("/pwa/spg/stok?saring=habis");
  });

  it("refuses anything that leaves the phone app", () => {
    for (const v of [
      "https://evil.example/pwa/x",
      "//evil.example/pwa/x",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "/backoffice/settings",
      "/pwa",
      "/pwa/../backoffice",
      "/pwa/%2e%2e/backoffice",
      "pwa/spg/opname",
      "/pwa/spg\nopname",
      "",
    ]) {
      expect(kembaliAman(v), v).toBeNull();
    }
  });

  it("refuses non-strings and oversized values", () => {
    expect(kembaliAman(undefined)).toBeNull();
    expect(kembaliAman(["/pwa/spg/opname"])).toBeNull();
    expect(kembaliAman(`/pwa/${"a".repeat(400)}`)).toBeNull();
  });
});

describe("tautanCheckInLaluKembali", () => {
  it("carries the screen to the home page, encoded", () => {
    expect(tautanCheckInLaluKembali("/pwa/spg/opname")).toBe("/pwa?kembali=%2Fpwa%2Fspg%2Fopname");
  });

  it("falls back to the bare home for an unsafe or missing screen", () => {
    expect(tautanCheckInLaluKembali("https://evil.example")).toBe("/pwa");
    expect(tautanCheckInLaluKembali(null)).toBe("/pwa");
  });
});

describe("bacaTitipan", () => {
  const sekarang = 1_000_000_000;

  it("returns the screen for the same store while fresh", () => {
    expect(bacaTitipan(isiTitipan("toko-1", "/pwa/spg/opname", sekarang - 5_000), "toko-1", sekarang)).toBe("/pwa/spg/opname");
  });

  it("ignores a note left for another store", () => {
    expect(bacaTitipan(isiTitipan("toko-2", "/pwa/spg/opname", sekarang), "toko-1", sekarang)).toBeNull();
  });

  it("ignores a stale note so it never hijacks a later visit", () => {
    expect(bacaTitipan(isiTitipan("toko-1", "/pwa/spg/opname", sekarang - UMUR_TITIPAN_MS - 1), "toko-1", sekarang)).toBeNull();
  });

  it("re-checks the destination even when it came from storage", () => {
    expect(bacaTitipan(isiTitipan("toko-1", "https://evil.example", sekarang), "toko-1", sekarang)).toBeNull();
  });

  it("survives junk", () => {
    expect(bacaTitipan(null, "toko-1", sekarang)).toBeNull();
    expect(bacaTitipan("{not json", "toko-1", sekarang)).toBeNull();
    expect(bacaTitipan(JSON.stringify({ storeId: "toko-1", kembali: "/pwa/spg/opname" }), "toko-1", sekarang)).toBeNull();
  });
});

describe("tujuanSesudahCheckIn (SPG mendarat di mana sesudah check-in)", () => {
  it("keeps the screen that asked for the check-in", () => {
    expect(tujuanSesudahCheckIn("/pwa/spg/opname")).toBe("/pwa/spg/opname");
    expect(tujuanSesudahCheckIn("/pwa/spg/terima/PUTUS/abc")).toBe("/pwa/spg/terima/PUTUS/abc");
  });

  it("without a screen (or with an unsafe one) lands on the SPG home, where the Sell button is", () => {
    expect(tujuanSesudahCheckIn(null)).toBe(TUJUAN_BERANDA);
    expect(tujuanSesudahCheckIn(undefined)).toBe(TUJUAN_BERANDA);
    expect(tujuanSesudahCheckIn("https://evil.example")).toBe(TUJUAN_BERANDA);
    expect(TUJUAN_BERANDA).toBe("/pwa");
  });

  it("a note left for the home page is read back as the home page, still bound to its store and age", () => {
    const sekarang = 2_000_000_000;
    expect(bacaTitipan(isiTitipan("toko-1", TUJUAN_BERANDA, sekarang - 1_000), "toko-1", sekarang)).toBe("/pwa");
    expect(bacaTitipan(isiTitipan("toko-2", TUJUAN_BERANDA, sekarang - 1_000), "toko-1", sekarang)).toBeNull();
    expect(bacaTitipan(isiTitipan("toko-1", TUJUAN_BERANDA, sekarang - UMUR_TITIPAN_MS - 1), "toko-1", sekarang)).toBeNull();
  });

  it("the home page is accepted only exactly — not a lookalike outside the phone app", () => {
    const sekarang = 2_000_000_000;
    for (const v of ["/pwa?x=//evil", "/pwax", "/pwa/../backoffice", "//pwa", "/PWA"]) {
      const dibaca = bacaTitipan(isiTitipan("toko-1", v, sekarang), "toko-1", sekarang);
      expect(dibaca === null || dibaca.startsWith("/pwa/"), v).toBe(true);
    }
  });

  it("`?kembali=` from a URL still refuses the bare home page", () => {
    expect(kembaliAman("/pwa")).toBeNull();
  });
});
