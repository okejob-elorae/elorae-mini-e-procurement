import { describe, expect, it } from "vitest";
import { tabAktifSpg, tampilkanMenuSpg } from "./menu-spg";

describe("tampilkanMenuSpg", () => {
  it("shows the menu on the SPG's working screens", () => {
    for (const p of [
      "/pwa",
      "/pwa/spg/stok",
      "/pwa/spg/terima",
      "/pwa/spg/nota",
      "/pwa/spg/lainnya",
      "/pwa/spg/dicari",
      "/pwa/spg/mutasi",
      "/pwa/spg/mutasi/abc123",
      "/pwa/retur",
      "/pwa/tampilan",
    ]) {
      expect(tampilkanMenuSpg(p), p).toBe(true);
    }
  });

  it("hides it on the selling screen and on a printable receipt", () => {
    for (const p of ["/pwa/spg/sale", "/pwa/spg/abc123/nota", "/pwa/offline"]) {
      expect(tampilkanMenuSpg(p), p).toBe(false);
    }
  });

  it("hides it on every SPG form with its own submit bar", () => {
    for (const p of [
      "/pwa/spg/opname",
      "/pwa/spg/stocktake",
      "/pwa/spg/stok/minta",
      "/pwa/spg/terima/PUTUS/abc123",
      "/pwa/spg/terima/MUTASI/abc123",
      "/pwa/retur/baru",
      "/pwa/spg/mutasi/kirim",
      "/pwa/spg/abc123/kembali",
    ]) {
      expect(tampilkanMenuSpg(p), p).toBe(false);
    }
  });

  it("keeps the menu on the receive LIST while hiding it on one delivery's form", () => {
    expect(tampilkanMenuSpg("/pwa/spg/terima")).toBe(true);
    expect(tampilkanMenuSpg("/pwa/spg/terima/KONSI/x")).toBe(false);
  });

  it("does not mistake the receipt list for a printable receipt", () => {
    expect(tampilkanMenuSpg("/pwa/spg/nota")).toBe(true);
  });
});

describe("tabAktifSpg", () => {
  it("groups receiving, counting, requesting and transfers under Stok", () => {
    for (const p of [
      "/pwa/spg/stok",
      "/pwa/spg/stok/minta",
      "/pwa/spg/terima",
      "/pwa/spg/terima/PUTUS/abc123",
      "/pwa/spg/opname",
      "/pwa/spg/stocktake",
      "/pwa/spg/mutasi",
      "/pwa/spg/mutasi/kirim",
      "/pwa/spg/mutasi/abc123",
    ]) {
      expect(tabAktifSpg(p), p).toBe("stok");
    }
  });

  it("lights Jual on the selling screen and on lost sales, which is opened from it", () => {
    expect(tabAktifSpg("/pwa/spg/sale")).toBe("jual");
    expect(tabAktifSpg("/pwa/spg/dicari")).toBe("jual");
  });

  it("lights Lainnya for the screens listed behind it", () => {
    for (const p of [
      "/pwa/spg/lainnya",
      "/pwa/spg/gaji",
      "/pwa/tampilan",
      "/pwa/retur",
      "/pwa/retur/baru",
      "/pwa/target",
      "/pwa/peringkat",
      "/pwa/stores/abc123",
      "/pwa/stores/abc123/checklist",
    ]) {
      expect(tabAktifSpg(p), p).toBe("lainnya");
    }
  });

  it("no longer lists the salesman's order screen", () => {
    expect(tabAktifSpg("/pwa/orders")).toBeNull();
  });

  it("does not light Stok for a path that only starts with the same letters", () => {
    expect(tabAktifSpg("/pwa/spg/stokopname")).toBeNull();
  });

  it("lights Beranda only on the home itself", () => {
    expect(tabAktifSpg("/pwa")).toBe("beranda");
    expect(tabAktifSpg("/pwa/spg/nota")).toBe("nota");
  });
});
