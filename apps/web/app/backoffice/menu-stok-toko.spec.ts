import { describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/rbac";

/*
 * Grup "Stok di toko konsinyasi": menyetujui hitungan stok toko dan transfer
 * antar toko kini izinnya sendiri (keputusan manager, pemilik 2026-11-01),
 * terpisah dari `stores:manage`. Halamannya menerima penyetuju itu, jadi menu
 * juga harus menampilkannya — tanpa itu penyetuju yang bukan pengelola toko
 * memegang izinnya tetapi tidak pernah menemukan halamannya.
 */

vi.mock("@/components/offline/OfflineIndicator", () => ({ OfflineIndicator: () => null }));
vi.mock("@/components/QuickActionFAB", () => ({ QuickActionFAB: () => null }));
vi.mock("@/components/notifications/FcmRegistration", () => ({ FcmRegistration: () => null }));
vi.mock("@/components/notifications/NotificationIcon", () => ({ NotificationIcon: () => null }));
vi.mock("@/components/ui/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/lib/offline/sync", () => ({ setupSyncListeners: () => () => {}, syncReferenceData: async () => {} }));

const { navItems, bolehAnak } = await import("./BackofficeShell");

const grup = navItems.find((i) => i.labelKey === "consignmentSales");

function terlihat(izin: string[]): string[] {
  return (grup?.children ?? []).filter((c) => bolehAnak(izin, c.permission)).map((c) => c.href);
}

describe("menu Stok di toko konsinyasi", () => {
  it("grupnya ada dengan siklus konsinyasi, hitung stok toko, laporan sell-through, dan transfer antar toko", () => {
    expect(grup?.children?.map((c) => c.href)).toEqual([
      "/backoffice/konsinyasi",
      "/backoffice/store-stocktakes",
      "/backoffice/konsi-sell-through",
      "/backoffice/store-transfers",
    ]);
  });

  it("pengelola toko melihat ketiganya", () => {
    expect(terlihat([PERMISSIONS.STORES_VIEW, PERMISSIONS.STORES_MANAGE])).toEqual([
      "/backoffice/store-stocktakes",
      "/backoffice/konsi-sell-through",
      "/backoffice/store-transfers",
    ]);
  });

  it("penyetuju hitungan stok toko menemukan halaman hitungan tanpa izin mengelola toko", () => {
    expect(terlihat([PERMISSIONS.STORES_VIEW, PERMISSIONS.STORE_STOCKTAKES_APPROVE])).toEqual([
      "/backoffice/store-stocktakes",
      "/backoffice/konsi-sell-through",
    ]);
  });

  it("penyetuju transfer antar toko menemukan halaman transfer tanpa izin mengelola toko", () => {
    expect(terlihat([PERMISSIONS.STORES_VIEW, PERMISSIONS.STORE_TRANSFERS_APPROVE])).toEqual([
      "/backoffice/konsi-sell-through",
      "/backoffice/store-transfers",
    ]);
  });

  it("pembaca toko saja hanya melihat laporan sell-through", () => {
    expect(terlihat([PERMISSIONS.STORES_VIEW])).toEqual(["/backoffice/konsi-sell-through"]);
  });

  it("admin melihat ketiganya", () => {
    expect(terlihat(["*"])).toHaveLength(3);
  });
});
