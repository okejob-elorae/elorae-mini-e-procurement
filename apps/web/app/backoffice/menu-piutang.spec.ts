import { describe, expect, it, vi } from "vitest";
import { getRequiredPermission, hasPermission, PERMISSIONS } from "@/lib/rbac";
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
 *
 * Memverifikasi BKM kini izinnya sendiri, `payments:verify` ("periksa
 * pembayaran", keputusan pemilik 2026-10-29), bukan lagi menumpang
 * `journals:manage` — jadi pekerjaan jurnal saja tidak lagi membuka BKM.
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
  // Layar `/backoffice/finance/*` memagari dirinya di `page.tsx`-nya.
  "/backoffice/finance/piutang": (izin) => hasPermission(izin, PERMISSIONS.RECEIVABLES_VIEW),
  "/backoffice/finance/payments": (izin) => hasPermission(izin, PERMISSIONS.PAYMENTS_MANAGE),
  // Pelunasan toko dan setoran penagih: dikelola penagihan, disetujui/diverifikasi pemeriksa pembayaran
  // (aksinya menuntut `payments:verify`), jadi pagar halamannya menerima salah satu.
  "/backoffice/finance/pelunasan": (izin) =>
    hasPermission(izin, PERMISSIONS.COLLECTIONS_MANAGE) || hasPermission(izin, PERMISSIONS.PAYMENTS_VERIFY),
  "/backoffice/finance/collections": (izin) =>
    hasPermission(izin, PERMISSIONS.COLLECTIONS_MANAGE) || hasPermission(izin, PERMISSIONS.PAYMENTS_VERIFY),
};

const DASAR = [
  "receivables:view",
  "receivables:manage",
  "journals:manage",
  "inventory_opname:count",
  "payments:manage",
  "payments:verify",
  "collections:manage",
];
/** Setiap gabungan izin yang menentukan, ditambah admin dan orang lapangan. */
const GABUNGAN: string[][] = [
  ...Array.from({ length: 1 << DASAR.length }, (_, m) => DASAR.filter((_, i) => m & (1 << i))),
  ["*"],
  ["pwa:access"],
  ["dashboard:view", "inventory:view"],
];

const grup = navItems.find((i) => i.labelKey === "navGroupReceivablesKalimat");

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

  // proxy.ts menguji ROUTE_PERMISSIONS SEBELUM `page.tsx` jalan: rute yang dipetakan ke satu izin memantulkan
  // pemegang izin kedua yang diterima pagar halamannya, padahal menunya terlihat. Itu yang terjadi pada
  // `/backoffice/finance/collections` (dipetakan ke collections:manage) bagi pemegang payments:verify saja.
  it("setiap gabungan yang lolos pagar halaman juga lolos ROUTE_PERMISSIONS rutenya", () => {
    for (const anak of grup?.children ?? []) {
      const rute = getRequiredPermission(anak.href);
      if (!rute) continue;
      for (const izin of GABUNGAN.filter((g) => PAGAR[anak.href](g))) {
        expect({ href: anak.href, izin, lolos: hasPermission(izin, rute) }).toEqual({ href: anak.href, izin, lolos: true });
      }
    }
  });

  it("pemeriksa pembayaran (payments:verify) menemukan BKM, nota retur, pelunasan toko, dan setoran penagih — bukan buku piutang", () => {
    const pemeriksa = ["dashboard:view", "payments:verify"];
    const terlihat = (grup?.children ?? []).filter((c) => bolehAnak(pemeriksa, c.permission)).map((c) => c.href);
    expect(terlihat.sort()).toEqual([
      "/backoffice/finance/collections",
      "/backoffice/finance/pelunasan",
      "/backoffice/pelunasan",
      "/backoffice/retur-toko",
    ]);
  });

  it("pekerjaan jurnal saja (journals:manage) tidak lagi membuka apa pun di grup ini", () => {
    const jurnal = ["dashboard:view", "journals:view", "journals:manage"];
    const terlihat = (grup?.children ?? []).filter((c) => bolehAnak(jurnal, c.permission)).map((c) => c.href);
    expect(terlihat).toEqual([]);
  });

  it("gudang (inventory_opname:count) hanya menemukan nota retur", () => {
    const gudang = ["inventory:view", "inventory_opname:count"];
    const terlihat = (grup?.children ?? []).filter((c) => bolehAnak(gudang, c.permission)).map((c) => c.href);
    expect(terlihat).toEqual(["/backoffice/retur-toko"]);
  });
});
