import { describe, expect, it, vi } from "vitest";
import {
  bolehMembacaArsip,
  bolehMembacaPelunasan,
  bolehMembacaPiutang,
  bolehMembacaRetur,
} from "@/lib/receivables/izin";

/*
 * Menu samping Piutang & Pelunasan menguji izin yang SAMA dengan pagar
 * halamannya. Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — setiap
 * halaman memagari dirinya dengan fungsi di `lib/receivables/izin.ts`. Dulu
 * seluruh grup menunya hanya untuk `receivables:view`, jadi keuangan yang
 * memverifikasi BKM, gudang yang menghitung retur, dan pemegang
 * `receivables:manage` saja boleh membuka halamannya tetapi tidak pernah
 * menemukannya di menu.
 */

// Komponen berat yang tidak relevan untuk susunan menu.
vi.mock("@/components/offline/OfflineIndicator", () => ({ OfflineIndicator: () => null }));
vi.mock("@/components/QuickActionFAB", () => ({ QuickActionFAB: () => null }));
vi.mock("@/components/notifications/FcmRegistration", () => ({ FcmRegistration: () => null }));
vi.mock("@/components/notifications/NotificationIcon", () => ({ NotificationIcon: () => null }));
vi.mock("@/components/ui/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/lib/offline/sync", () => ({ setupSyncListeners: () => () => {}, syncReferenceData: async () => {} }));

const { navItems, bolehAnak } = await import("./BackofficeShell");

/** Pagar halaman tiap anak menu, persis yang dipanggil `page.tsx`-nya. */
const PAGAR: Record<string, (izin: string[]) => boolean> = {
  "/backoffice/pelunasan-dasbor": bolehMembacaPiutang,
  "/backoffice/piutang": bolehMembacaPiutang,
  "/backoffice/kontrabon": bolehMembacaPiutang,
  "/backoffice/pelunasan": bolehMembacaPelunasan,
  "/backoffice/tugas-tagih": bolehMembacaArsip,
  "/backoffice/retur-toko": bolehMembacaRetur,
  "/backoffice/beban-selisih": bolehMembacaPiutang,
  "/backoffice/arsip-retur": bolehMembacaArsip,
};

const DASAR = ["receivables:view", "receivables:manage", "journals:manage", "inventory_opname:count"];
/** Setiap gabungan keempat izin yang menentukan, ditambah admin dan orang lapangan. */
const GABUNGAN: string[][] = [
  ...Array.from({ length: 1 << DASAR.length }, (_, m) => DASAR.filter((_, i) => m & (1 << i))),
  ["*"],
  ["pwa:access"],
  ["dashboard:view", "inventory:view"],
];

const grup = navItems.find((i) => i.labelKey === "navGroupReceivables");

describe("menu Piutang & Pelunasan mengikuti pagar halaman", () => {
  it("grupnya ada dan setiap anak punya pagar halaman yang dikenal", () => {
    expect(grup).toBeDefined();
    const href = (grup?.children ?? []).map((c) => c.href).sort();
    expect(href).toEqual(Object.keys(PAGAR).sort());
  });

  for (const anak of grup?.children ?? []) {
    it(`${anak.href}: terlihat di menu ⇔ halamannya terbuka`, () => {
      const pagar = PAGAR[anak.href];
      for (const izin of GABUNGAN) {
        expect({ izin, terlihat: bolehAnak(izin, anak.permission) }).toEqual({ izin, terlihat: pagar(izin) });
      }
    });
  }

  it("keuangan (journals:manage) menemukan BKM dan nota retur, bukan buku piutang", () => {
    const keuangan = ["dashboard:view", "journals:manage"];
    const terlihat = (grup?.children ?? []).filter((c) => bolehAnak(keuangan, c.permission)).map((c) => c.href);
    expect(terlihat.sort()).toEqual(["/backoffice/pelunasan", "/backoffice/retur-toko"]);
  });

  it("gudang (inventory_opname:count) hanya menemukan nota retur", () => {
    const gudang = ["inventory:view", "inventory_opname:count"];
    const terlihat = (grup?.children ?? []).filter((c) => bolehAnak(gudang, c.permission)).map((c) => c.href);
    expect(terlihat).toEqual(["/backoffice/retur-toko"]);
  });
});
