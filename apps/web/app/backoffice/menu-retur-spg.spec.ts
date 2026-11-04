import { describe, expect, it } from "vitest";
import { getRequiredPermission, hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehAnak, grupUntukRute, navItems } from "@/lib/nav/menu";

/*
 * SPG → Retur pembeli (keputusan pemilik 2026-11-02): laporan retur pembeli SPG menunggu
 * persetujuan kantor. Pengawas SPG membuka daftarnya (`spg_sales:view`, ROUTE_PERMISSIONS dan pagar
 * `retur-spg/page.tsx`); menyetujui dan menolak = `spg_returns:approve`, diperiksa di halaman
 * rincian dan di aksinya. Menu memakai kode halaman, bukan kode persetujuan — penyetuju yang tidak
 * bisa membuka halamannya tidak boleh diberi entri yang berujung pengalihan.
 */

const RUTE = "/backoffice/retur-spg";
const grup = navItems.find((i) => (i.children ?? []).some((c) => c.href === RUTE));
const anak = grup?.children?.find((c) => c.href === RUTE);

/** Pagar halaman daftar, persis yang diperiksa `page.tsx`. */
const pagar = (izin: string[]) => hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW);

describe("menu Retur pembeli SPG mengikuti pagar halaman", () => {
  it("entrinya ada di grup SPG, dan rute daftar maupun rinciannya digerbangi izin melihat penjualan SPG", () => {
    expect(anak).toBeDefined();
    expect(grup?.labelKey).toBe("navGroupSpg");
    expect(getRequiredPermission(RUTE)).toBe(PERMISSIONS.SPG_SALES_VIEW);
    expect(getRequiredPermission(`${RUTE}/abc123`)).toBe(PERMISSIONS.SPG_SALES_VIEW);
  });

  it.each([
    [["*"]],
    [[PERMISSIONS.SPG_SALES_VIEW]],
    [[PERMISSIONS.SPG_SALES_VIEW, PERMISSIONS.SPG_RETURNS_APPROVE]],
    [[PERMISSIONS.SPG_RETURNS_APPROVE]],
    [[PERMISSIONS.SPG_SALES_RECORD]],
    [[]],
  ])("terlihat di menu ⇔ halamannya terbuka (%j)", (izin) => {
    expect(bolehAnak(izin, anak?.permission)).toBe(pagar(izin));
    expect(hasPermission(izin, getRequiredPermission(RUTE) ?? "")).toBe(pagar(izin));
  });

  it("rincian satu laporan menyala di grup SPG", () => {
    expect(grupUntukRute(`${RUTE}/abc123`)).toBe(grup?.href);
  });
});
