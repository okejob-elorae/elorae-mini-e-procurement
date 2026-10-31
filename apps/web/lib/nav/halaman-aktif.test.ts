import { describe, expect, it } from "vitest";
import { cocokRute, entriHalamanAktif, geserAgarTerlihat, geserKeJangkar, idJangkar } from "./halaman-aktif";
import { navItems } from "./menu";

const menu = [
  {
    href: "/backoffice/finance/reports/trial-balance",
    labelKey: "navReports",
    children: [
      { href: "/backoffice/finance/reports/trial-balance", labelKey: "navTrialBalance" },
      { href: "/backoffice/finance/reports/income-statement", labelKey: "navIncomeStatement" },
    ],
  },
  { href: "/backoffice/dashboard", labelKey: "dashboard" },
  {
    href: "/backoffice/suppliers",
    labelKey: "navMasterData",
    children: [
      { href: "/backoffice/suppliers", labelKey: "navSuppliers" },
      { href: "/backoffice/items", labelKey: "navItems" },
      { href: "/backoffice/items/categories", labelKey: "navCategories" },
    ],
  },
];

describe("cocokRute", () => {
  it("cocok dengan rute itu sendiri dan turunannya, bukan awalan nama", () => {
    expect(cocokRute("/backoffice/items", "/backoffice/items")).toBe(true);
    expect(cocokRute("/backoffice/items/abc", "/backoffice/items")).toBe(true);
    expect(cocokRute("/backoffice/items-lain", "/backoffice/items")).toBe(false);
    expect(cocokRute("/backoffice/items", "#")).toBe(false);
    expect(cocokRute("/backoffice/items", "")).toBe(false);
  });
});

describe("entriHalamanAktif", () => {
  it("anak menang seri atas induk yang berbagi href (Neraca Saldo, bukan Laporan)", () => {
    expect(entriHalamanAktif("/backoffice/finance/reports/trial-balance", menu)?.labelKey).toBe("navTrialBalance");
    expect(entriHalamanAktif("/backoffice/suppliers", menu)?.labelKey).toBe("navSuppliers");
  });

  it("kecocokan terpanjang menang", () => {
    expect(entriHalamanAktif("/backoffice/items/categories", menu)?.labelKey).toBe("navCategories");
    expect(entriHalamanAktif("/backoffice/items/xyz/edit", menu)?.labelKey).toBe("navItems");
  });

  it("entri tingkat atas tanpa anak tetap ditemukan; rute asing → null", () => {
    expect(entriHalamanAktif("/backoffice/dashboard", menu)?.labelKey).toBe("dashboard");
    expect(entriHalamanAktif("/backoffice/tidak-ada", menu)).toBeNull();
  });

  it("di menu sungguhan, halaman pertama setiap grup menyebut dirinya sendiri, bukan nama grupnya", () => {
    for (const item of navItems) {
      const anakSama = item.children?.find((c) => c.href === item.href);
      if (!anakSama) continue;
      expect(entriHalamanAktif(item.href, navItems)?.labelKey, item.href).toBe(anakSama.labelKey);
    }
  });
});

describe("geserAgarTerlihat", () => {
  const wadah = { top: 100, bottom: 700 };
  it("0 bila elemen sudah terlihat", () => {
    expect(geserAgarTerlihat(wadah, { top: 300, bottom: 332 })).toBe(0);
  });
  it("menggulir ke bawah sampai elemen di bawah tepi terlihat dengan ruang", () => {
    // Kasus audit: tautan aktif top 819 di layar 800.
    expect(geserAgarTerlihat({ top: 120, bottom: 800 }, { top: 819, bottom: 851 })).toBe(851 - 800 + 24);
  });
  it("menggulir ke atas bila elemen di atas tepi", () => {
    expect(geserAgarTerlihat(wadah, { top: 40, bottom: 72 })).toBe(40 - 100 - 24);
  });
  it("elemen lebih tinggi dari wadah: atasnya disejajarkan", () => {
    expect(geserAgarTerlihat({ top: 0, bottom: 100 }, { top: 300, bottom: 500 })).toBe(276);
  });
});

describe("jangkar halaman", () => {
  it("idJangkar membaca hash, kosong → null, karakter tersandi dibuka", () => {
    expect(idJangkar("#target")).toBe("target");
    expect(idJangkar("")).toBeNull();
    expect(idJangkar("#")).toBeNull();
    expect(idJangkar("#jadwal%20spg")).toBe("jadwal spg");
    expect(idJangkar("#%E0%A4%A")).toBe("%E0%A4%A");
  });
  it("geserKeJangkar menaruh jangkar tepat di bawah tepi atas wadah", () => {
    expect(geserKeJangkar(64, 1864)).toBe(1784);
    expect(geserKeJangkar(64, 40)).toBe(-40);
  });
});
