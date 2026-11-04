import { describe, expect, it } from "vitest";
import { getRequiredPermission, hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehAnak, navItems } from "@/lib/nav/menu";

/*
 * Menu Jubelio → Konfirmasi harga memakai izin yang SAMA dengan pagar halamannya
 * (`ROUTE_PERMISSIONS` + pemeriksaan di `page.tsx`): `jubelio_prices:confirm`, persetujuan yang
 * bawaannya hanya admin (keputusan pemilik 2026-11-02). Pemegang izin itu saja harus menemukan
 * halamannya di menu; yang hanya bisa membuka Pengaturan Jubelio tidak.
 */

const RUTE = "/backoffice/jubelio/harga";
const grup = navItems.find((i) => (i.children ?? []).some((c) => c.href === RUTE));
const anak = grup?.children?.find((c) => c.href === RUTE);

/** Pagar halaman, persis yang diperiksa `page.tsx`. */
const pagar = (izin: string[]) => hasPermission(izin, PERMISSIONS.JUBELIO_PRICES_CONFIRM);

describe("menu Konfirmasi harga Jubelio mengikuti pagar halaman", () => {
  it("entrinya ada, dan rutenya digerbangi izin konfirmasi harga", () => {
    expect(anak).toBeDefined();
    expect(getRequiredPermission(RUTE)).toBe(PERMISSIONS.JUBELIO_PRICES_CONFIRM);
  });

  it.each([
    [["*"]],
    [[PERMISSIONS.JUBELIO_PRICES_CONFIRM]],
    [[PERMISSIONS.SETTINGS_SECURITY_VIEW]],
    [[PERMISSIONS.SETTINGS_SECURITY_VIEW, PERMISSIONS.SETTINGS_SECURITY_MANAGE]],
    [[PERMISSIONS.JUBELIO_ADMIN_VIEW, PERMISSIONS.ITEMS_EDIT]],
    [[]],
  ])("terlihat di menu ⇔ halamannya terbuka (%j)", (izin) => {
    expect(bolehAnak(izin, anak?.permission)).toBe(pagar(izin));
    expect(hasPermission(izin, getRequiredPermission(RUTE) ?? "")).toBe(pagar(izin));
  });

  it("pemegang konfirmasi harga saja melihat grup Jubelio beserta entrinya", () => {
    const izin = [PERMISSIONS.JUBELIO_PRICES_CONFIRM];
    expect(grup).toBeDefined();
    expect((grup?.children ?? []).some((c) => bolehAnak(izin, c.permission))).toBe(true);
    expect(bolehAnak(izin, anak?.permission)).toBe(true);
  });

  it("yang hanya membuka Pengaturan Jubelio tidak melihat entrinya", () => {
    expect(bolehAnak([PERMISSIONS.SETTINGS_SECURITY_VIEW], anak?.permission)).toBe(false);
  });
});
