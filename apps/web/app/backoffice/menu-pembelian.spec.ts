import { describe, expect, it, vi } from "vitest";
import { getRequiredPermission, PERMISSIONS } from "@/lib/rbac";

/*
 * Pembelian (PO, pembayaran pemasok, retur ke pemasok) dulu terselip di grup
 * Produksi. Sekarang satu grup sendiri — tanpa menggeser satu pun hak akses:
 * izin tiap anak tetap persis pagar rutenya.
 */

vi.mock("@/components/offline/OfflineIndicator", () => ({ OfflineIndicator: () => null }));
vi.mock("@/components/QuickActionFAB", () => ({ QuickActionFAB: () => null }));
vi.mock("@/components/notifications/FcmRegistration", () => ({ FcmRegistration: () => null }));
vi.mock("@/components/notifications/NotificationIcon", () => ({ NotificationIcon: () => null }));
vi.mock("@/components/ui/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/lib/offline/sync", () => ({ setupSyncListeners: () => () => {}, syncReferenceData: async () => {} }));

const { navItems, bolehAnak } = await import("./BackofficeShell");

const PEMBELIAN = [
  { href: "/backoffice/purchase-orders", permission: PERMISSIONS.PURCHASE_ORDERS_VIEW },
  { href: "/backoffice/supplier-payments", permission: PERMISSIONS.SUPPLIER_PAYMENTS_VIEW },
  { href: "/backoffice/supplier-payments/umur-hutang", permission: PERMISSIONS.SUPPLIER_PAYMENTS_VIEW },
  { href: "/backoffice/vendor-returns", permission: PERMISSIONS.VENDOR_RETURNS_VIEW },
];

const grup = navItems.find((i) => i.labelKey === "navGroupPurchasing");

describe("menu Pembelian", () => {
  it("satu grup berisi PO, pembayaran pemasok, umur utang, dan retur ke pemasok — izinnya tidak berubah", () => {
    expect(grup).toBeDefined();
    expect(grup?.section).toBe("secOperations");
    expect(grup?.children?.map((c) => ({ href: c.href, permission: c.permission }))).toEqual(PEMBELIAN);
  });

  it("izin tiap anak sama dengan pagar rutenya", () => {
    for (const anak of grup?.children ?? []) {
      expect(anak.permission, anak.href).toBe(getRequiredPermission(anak.href));
    }
  });

  it("tidak ada lagi di Produksi, dan setiap halaman pembelian muncul sekali di seluruh menu", () => {
    const produksi = navItems.find((i) => i.labelKey === "production");
    const hrefProduksi = produksi?.children?.map((c) => c.href) ?? [];
    for (const p of PEMBELIAN) {
      expect(hrefProduksi).not.toContain(p.href);
      const muncul = navItems.flatMap((i) => i.children ?? []).filter((c) => c.href === p.href);
      expect(muncul, p.href).toHaveLength(1);
    }
  });

  it("Master Pemasok tetap di Data Master", () => {
    const master = navItems.find((i) => i.labelKey === "navGroupMasterDataKalimat");
    expect(master?.children?.map((c) => c.href)).toContain("/backoffice/suppliers");
  });

  it("href grup unik (kunci buka-tutup grup memakai href induk)", () => {
    const hrefInduk = navItems.map((i) => i.href);
    expect(new Set(hrefInduk).size).toBe(hrefInduk.length);
  });

  it("pemegang izin pembayaran pemasok saja melihat pembayaran dan umur utang, bukan PO", () => {
    const izin = [PERMISSIONS.SUPPLIER_PAYMENTS_VIEW];
    const terlihat = (grup?.children ?? []).filter((c) => bolehAnak(izin, c.permission)).map((c) => c.href);
    expect(terlihat).toEqual(["/backoffice/supplier-payments", "/backoffice/supplier-payments/umur-hutang"]);
  });
});
