import { hasPermission, PERMISSIONS } from "@/lib/rbac";

export const LAPORAN_TABS = ["production", "overdue", "rp1", "rp2", "rp3"] as const;
export type LaporanTab = (typeof LAPORAN_TABS)[number];

/**
 * Izin modul tiap laporan berat — sama dengan penjaga aksinya
 * (`app/actions/reports/*`, `wajibIzinLaporan`). Tab tanpa entri terbuka untuk
 * setiap pemegang halaman laporan (`dashboard:view`).
 */
export const IZIN_TAB_LAPORAN: Partial<Record<LaporanTab, string>> = {
  rp1: PERMISSIONS.PURCHASE_ORDERS_VIEW,
  rp2: PERMISSIONS.WORK_ORDERS_VIEW,
  rp3: PERMISSIONS.INVENTORY_VIEW,
};

/** Tab yang boleh dilihat penonton, urut seperti di layar. */
export function tabLaporanTerlihat(izin: string[]): LaporanTab[] {
  return LAPORAN_TABS.filter((tab) => {
    const kode = IZIN_TAB_LAPORAN[tab];
    return !kode || hasPermission(izin, kode);
  });
}

/** Tab dari `?tab=`; yang asing atau tidak boleh dilihat jatuh ke Produksi. */
export function tabLaporanAktif(dariUrl: string | null, terlihat: readonly LaporanTab[]): LaporanTab {
  const tab = terlihat.find((t) => t === dariUrl);
  return tab ?? "production";
}
