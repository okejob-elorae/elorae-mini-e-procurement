import { describe, expect, it } from "vitest";
import { tabAktif, tampilkanMenu } from "./menu";

describe("tampilkanMenu", () => {
  it("shows the menu on every top-level and detail screen", () => {
    for (const p of ["/pwa", "/pwa/stores", "/pwa/stores/abc", "/pwa/piutang", "/pwa/piutang/abc", "/pwa/bkm", "/pwa/retur", "/pwa/beban", "/pwa/lainnya", "/pwa/tampilan", "/pwa/orders/pending", "/pwa/biaya", "/pwa/absen", "/pwa/rute", "/pwa/hari-ini", "/pwa/piutang/abc/riwayat"]) {
      expect(tampilkanMenu(p), p).toBe(true);
    }
  });

  it("hides it on forms and selling screens that carry their own bottom bar", () => {
    for (const p of ["/pwa/stores/abc/catalog", "/pwa/stores/abc/smart-request", "/pwa/van", "/pwa/van/xyz/nota", "/pwa/bkm/baru", "/pwa/retur/baru", "/pwa/spg/sale", "/pwa/offline", "/pwa/biaya/baru", "/pwa/stores/baru", "/pwa/piutang/abc/janji"]) {
      expect(tampilkanMenu(p), p).toBe(false);
    }
  });

  it("does not mistake a store called 'catalog' for the catalog screen", () => {
    expect(tampilkanMenu("/pwa/stores/catalog")).toBe(true);
  });
});

describe("tabAktif", () => {
  it("lights Beranda only on the home itself, not on every /pwa/ path", () => {
    expect(tabAktif("/pwa")).toBe("beranda");
    // Riwayat penjualan dibuka dari kartu beranda dan dari Lainnya — sama seperti Target.
    expect(tabAktif("/pwa/penjualan")).toBe("lainnya");
    expect(tabAktif("/pwa/stores")).toBe("toko");
  });

  it("keeps the parent tab lit on detail screens", () => {
    expect(tabAktif("/pwa/stores/abc")).toBe("toko");
    expect(tabAktif("/pwa/piutang/abc")).toBe("tagihan");
    expect(tabAktif("/pwa/bkm")).toBe("pelunasan");
  });

  it("lights Lainnya for the screens listed behind it", () => {
    for (const p of ["/pwa/lainnya", "/pwa/retur", "/pwa/beban", "/pwa/tampilan", "/pwa/orders/pending", "/pwa/insentif", "/pwa/peringkat", "/pwa/biaya", "/pwa/biaya/baru", "/pwa/absen", "/pwa/hari-ini", "/pwa/tukar", "/pwa/rute", "/pwa/target"]) {
      expect(tabAktif(p), p).toBe("lainnya");
    }
  });

  it("does not confuse a prefix for a parent", () => {
    expect(tabAktif("/pwa/storesx")).toBeNull();
  });
});
