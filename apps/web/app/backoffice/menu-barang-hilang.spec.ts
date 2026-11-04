import { describe, expect, it, vi } from "vitest";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMemutuskanBeban, bolehMengelola } from "@/lib/receivables/izin";

/*
 * Menu "Barang hilang" menguji izin yang SAMA dengan pagar halamannya
 * (`barang-hilang/page.tsx` dan `[id]/page.tsx`): pengawas SPG melihat,
 * `receivables:manage` mencatat, `receivables:decide_bearer` memutuskan siapa
 * yang menanggung (keputusan manager, pemilik 2026-11-01). Pemegang izin
 * memutuskan saja dulu hanya menerima lonceng — halaman tempat keputusan itu
 * diambil tidak pernah tampil di menunya.
 */

vi.mock("@/components/offline/OfflineIndicator", () => ({ OfflineIndicator: () => null }));
vi.mock("@/components/QuickActionFAB", () => ({ QuickActionFAB: () => null }));
vi.mock("@/components/notifications/FcmRegistration", () => ({ FcmRegistration: () => null }));
vi.mock("@/components/notifications/NotificationIcon", () => ({ NotificationIcon: () => null }));
vi.mock("@/components/ui/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/lib/offline/sync", () => ({ setupSyncListeners: () => () => {}, syncReferenceData: async () => {} }));

const { navItems, bolehAnak } = await import("./BackofficeShell");

const anak = navItems
  .flatMap((i) => i.children ?? [])
  .find((c) => c.href === "/backoffice/barang-hilang");

/** Pagar halaman, persis yang dipanggil `barang-hilang/page.tsx`. */
function pagar(izin: string[]): boolean {
  return bolehMengelola(izin) || bolehMemutuskanBeban(izin) || hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW);
}

const DASAR = [
  PERMISSIONS.SPG_SALES_VIEW,
  PERMISSIONS.RECEIVABLES_VIEW,
  PERMISSIONS.RECEIVABLES_MANAGE,
  PERMISSIONS.RECEIVABLES_DECIDE_BEARER,
];
const GABUNGAN: string[][] = [
  ...Array.from({ length: 1 << DASAR.length }, (_, m) => DASAR.filter((_, i) => m & (1 << i))),
  ["*"],
  ["pwa:access"],
];

describe("menu Barang hilang mengikuti pagar halaman", () => {
  it("entrinya ada", () => {
    expect(anak).toBeDefined();
  });

  it("terlihat di menu ⇔ halamannya terbuka", () => {
    for (const izin of GABUNGAN) {
      expect({ izin, terlihat: bolehAnak(izin, anak?.permission) }).toEqual({ izin, terlihat: pagar(izin) });
    }
  });

  it("pemutus penanggung (receivables:decide_bearer) saja menemukan halamannya", () => {
    expect(bolehAnak(["dashboard:view", PERMISSIONS.RECEIVABLES_DECIDE_BEARER], anak?.permission)).toBe(true);
  });
});
