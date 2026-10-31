import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMembacaPiutang, bolehMemverifikasi } from "@/lib/receivables/izin";
import type { DashboardStats } from "@/lib/dashboard/queries";

/**
 * Kartu beranda yang boleh dilihat — dan DIMUAT — seorang pengguna.
 *
 * `dashboard:view` hanya membuka halamannya. Dulu itu cukup untuk melihat
 * semuanya, jadi orang gudang, pembelian, dan produksi membaca umur piutang
 * seluruh toko, penjualan per salesman, dan nilai persediaan. Sekarang tiap
 * kartu diuji dengan izin halaman yang ditautnya, dan halaman server tidak
 * menjalankan kueri kartu yang tidak tampil: kartu yang disembunyikan di
 * browser tetapi datanya tetap dikirim bukanlah pagar.
 *
 * Dipakai juga oleh aksi beranda (`app/actions/dashboard.ts`), supaya grafik
 * yang dimuat ulang lewat aksi menguji aturan yang sama dengan halamannya.
 */
export type KartuBeranda = {
  /**
   * Grafik tren di puncak beranda. Ia menggabungkan SEMUA saluran (marketplace
   * dan lapangan), jadi butuh kedua izin penjualan: satu izin saja akan
   * membocorkan saluran yang lain lewat garis "semua".
   */
  tren: boolean;
  /** Penjualan marketplace hari ini dan pesanan belum dikirim — `sales_orders:view`. */
  penjualanMarketplace: boolean;
  /** Penjualan lapangan terealisasi dan tabel per salesman — `field_sales_orders:view`. */
  penjualanLapangan: boolean;
  /** Umur piutang, lewat janji bayar, retur tertahan — pembaca piutang. */
  piutang: boolean;
  /** Komposisi nilai stok dan stok yang perlu perhatian — `inventory:view`. */
  stok: boolean;
  /** Baris "BKM menunggu verifikasi" di daftar tindakan — keuangan yang memverifikasi. */
  klaimMenunggu: boolean;
};

export function kartuBeranda(izin: string[] | undefined): KartuBeranda {
  const p = izin ?? [];
  const penjualanMarketplace = hasPermission(p, PERMISSIONS.SALES_ORDERS_VIEW);
  const penjualanLapangan = hasPermission(p, PERMISSIONS.FIELD_SALES_ORDERS_VIEW);
  return {
    tren: penjualanMarketplace && penjualanLapangan,
    penjualanMarketplace,
    penjualanLapangan,
    piutang: bolehMembacaPiutang(p),
    stok: hasPermission(p, PERMISSIONS.INVENTORY_VIEW),
    klaimMenunggu: bolehMemverifikasi(p),
  };
}

/**
 * Statistik yang DIKIRIM ke browser beranda: hanya angka yang digambar.
 *
 * `getDashboardStats` juga menghitung nilai seluruh persediaan dan nilai
 * seluruh PO dalam rupiah. Keduanya tidak tampil di beranda, tetapi dulu
 * objeknya diteruskan utuh, jadi setiap pemegang `dashboard:view` — termasuk
 * yang tidak boleh melihat kartu stok — membawa nilai persediaan di muatan
 * halamannya. Hitungan stok menipis hanya untuk kartu stok (`inventory:view`).
 */
export type StatistikBeranda = {
  po: { draft: number };
  /**
   * Dua angka, bukan "berjalan": tiap angka menaut ke daftar SPK dengan SATU
   * status (`?status=IN_PRODUCTION` / `?status=PARTIAL`), dan daftar SPK hanya
   * bisa menyaring satu status.
   */
  workOrders: { sedangDiproduksi: number; selesaiSebagian: number; completedToday: number };
  suppliers: { activeCount: number };
  grnsThisWeek: number;
  /** `null` bila kartu stok tidak tampil. Definisi ringkasan Inventori (Menipis, Habis). */
  items: { lowStockCount: number; habisCount: number } | null;
};

export function statistikBeranda(stats: DashboardStats, kartu: KartuBeranda): StatistikBeranda {
  return {
    po: { draft: stats.po.draft },
    workOrders: {
      sedangDiproduksi: stats.workOrders.sedangDiproduksi,
      selesaiSebagian: stats.workOrders.selesaiSebagian,
      completedToday: stats.workOrders.completedToday,
    },
    suppliers: { activeCount: stats.suppliers.activeCount },
    grnsThisWeek: stats.grnsThisWeek,
    items: kartu.stok ? { lowStockCount: stats.items.lowStockCount, habisCount: stats.items.habisCount } : null,
  };
}
