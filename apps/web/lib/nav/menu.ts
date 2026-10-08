import type { ElementType } from "react";
import {
  BarChart2,
  BookOpen,
  BookOpenText,
  Database,
  Factory,
  FolderArchive,
  Handshake,
  LayoutDashboard,
  MapPinned,
  Megaphone,
  Package,
  Plug,
  ReceiptText,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Store,
} from "lucide-react";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";

/*
 * Susunan menu samping kantor — SATU sumber untuk kerangka (`BackofficeShell`),
 * editor peran, dan lencana menu (`/api/backoffice/nav-counts`, yang
 * menurunkan grup setiap pekerjaan dari halaman tujuannya lewat
 * `grupUntukRute`). Murni: tanpa React selain tipe, aman untuk server.
 */

export interface NavChild {
  labelKey: string;
  href: string;
  /**
   * Izin untuk melihat entri ini. Daftar = SALAH SATU cukup — untuk halaman yang
   * dibuka dua kelompok orang (mis. tukar barang: sales menyetujui, gudang
   * menyelesaikan), supaya entri ini tidak hilang bagi kelompok kedua.
   */
  permission?: string | readonly string[];
}

/** Entri anak terlihat: tanpa izin, atau memegang salah satu izinnya. Diekspor untuk tes menu. */
export function bolehAnak(permissions: string[], izin: NavChild["permission"]): boolean {
  if (!izin) return true;
  return typeof izin === "string" ? hasPermission(permissions, izin) : izin.some((p) => hasPermission(permissions, p));
}

export interface NavItem {
  labelKey: string;
  href: string;
  /**
   * Ikon garis menu. Menggantikan emoji: emoji warna-warni tidak seragam satu
   * sama lain, digambar berbeda di Windows dan Mac, dan menjadi satu-satunya
   * warna yang tidak ikut tema di menu samping.
   */
  icon: ElementType;
  /** Izin untuk melihat entri ini; kosong = semua orang yang membuka kantor (mis. Bantuan). */
  permission?: string;
  /**
   * Judul pemisah di atas entri ini. Ditulis pada entri PERTAMA tiap bagian;
   * yang berikutnya membiarkannya kosong dan ikut bagian di atasnya.
   */
  section?: string;
  children?: NavChild[];
}

/**
 * Susunan menu samping.
 *
 * DIKELOMPOKKAN MENURUT LINGKUP PEKERJAAN, dan itu bukan soal kerapian.
 * Sebelumnya modul piutang menambahkan delapan entri DATAR di tingkat atas —
 * piutang, kontrabon, pelunasan, retur toko, beban, arsip, dasbor, konsinyasi —
 * sehingga daftarnya jadi dua puluh baris tanpa hierarki. Daftar sepanjang itu
 * berhenti dibaca; orang menghafal posisi, lalu tersesat begitu ada yang
 * bergeser.
 *
 * `section` memberi judul pemisah. Satu bagian dibiarkan tanpa judul (Beranda)
 * karena ia bukan kelompok, melainkan titik berangkat.
 *
 * SETIAP ANAK WAJIB PUNYA `permission` SENDIRI. Anak tanpa izin terlihat oleh
 * siapa pun yang lolos izin INDUKNYA, jadi memindahkannya ke induk lain diam-
 * diam mengubah siapa yang bisa melihatnya. Izin yang tertulis di sini persis
 * izin induk lamanya, supaya pengelompokan ulang ini tidak menggeser satu pun
 * hak akses.
 */
/*
 * Izin anak menu Piutang & Pelunasan — SAMA dengan pagar halamannya di
 * `lib/receivables/izin.ts` (rute modul ini tidak dipetakan di
 * ROUTE_PERMISSIONS; tiap halaman memagari dirinya). Dulu seluruh grup hanya
 * untuk `receivables:view`, jadi keuangan yang memverifikasi BKM, gudang yang
 * menghitung retur, dan pemegang `receivables:manage` saja tidak pernah
 * menemukan halaman yang boleh mereka buka. `menu-piutang.spec.ts` mencocokkan
 * daftar ini dengan fungsi pagarnya untuk setiap gabungan izin.
 */
/** `bolehMembacaPiutang`: buku piutang, kontrabon, beban selisih, dasbor. */
const IZIN_BACA_PIUTANG = [PERMISSIONS.RECEIVABLES_VIEW, PERMISSIONS.RECEIVABLES_MANAGE] as const;
/** `bolehMembacaPelunasan`: ditambah keuangan yang memverifikasi BKM. */
const IZIN_BACA_PELUNASAN = [...IZIN_BACA_PIUTANG, PERMISSIONS.JOURNALS_MANAGE] as const;
/** `bolehMembacaRetur`: ditambah gudang yang menghitung dan keuangan. */
const IZIN_BACA_RETUR = [
  ...IZIN_BACA_PIUTANG,
  PERMISSIONS.INVENTORY_OPNAME_COUNT,
  PERMISSIONS.JOURNALS_MANAGE,
] as const;
/** `bolehMembacaArsip`: arsip nota retur dan tugas tagih — `receivables:view` saja. */
const IZIN_BACA_ARSIP = PERMISSIONS.RECEIVABLES_VIEW;

/** Diekspor untuk tes menu (`menu-piutang.spec.ts`). */
export const navItems: NavItem[] = [
  {
    labelKey: "dashboard",
    href: "/backoffice/dashboard",
    icon: LayoutDashboard,
    permission: PERMISSIONS.DASHBOARD_VIEW,
  },

  // ── Operasional ────────────────────────────────────────────────────────────
  {
    section: "secOperations",
    labelKey: "navGroupMasterDataKalimat",
    href: "/backoffice/suppliers",
    icon: Database,
    permission: PERMISSIONS.SUPPLIERS_VIEW,
    children: [
      { labelKey: "masterSuppliers", href: "/backoffice/suppliers", permission: PERMISSIONS.SUPPLIERS_VIEW },
      { labelKey: "supplierType", href: "/backoffice/suppliers/types", permission: PERMISSIONS.SUPPLIER_TYPES_VIEW },
      { labelKey: "masterStores", href: "/backoffice/stores", permission: PERMISSIONS.STORES_VIEW },
      { labelKey: "storeProposals", href: "/backoffice/stores/usulan", permission: PERMISSIONS.STORES_VIEW },
      { labelKey: "navItemsAll", href: "/backoffice/items", permission: PERMISSIONS.ITEMS_VIEW },
      { labelKey: "navItemsCategory", href: "/backoffice/items/categories", permission: PERMISSIONS.ITEMS_VIEW },
      { labelKey: "navSizeChart", href: "/backoffice/items/size-charts", permission: PERMISSIONS.ITEMS_VIEW },
      { labelKey: "navLabelBarcode", href: "/backoffice/items/labels", permission: PERMISSIONS.ITEMS_VIEW },
      { labelKey: "leadTime", href: "/backoffice/lead-time", permission: PERMISSIONS.LEAD_TIME_VIEW },
    ],
  },
  {
    section: "secOperations",
    labelKey: "inventory",
    href: "/backoffice/inventory",
    icon: Package,
    permission: PERMISSIONS.INVENTORY_VIEW,
    children: [
      { labelKey: "inventory", href: "/backoffice/inventory", permission: PERMISSIONS.INVENTORY_VIEW },
      { labelKey: "navStockOpnameKalimat", href: "/backoffice/inventory/stock-opname", permission: PERMISSIONS.INVENTORY_OPNAME_VIEW },
      // Layar gudang menghitung barang retur dari toko — di luar /backoffice
      // (lihat CLAUDE.md "Layar gudang ada di /gudang-retur"); sebelumnya tidak
      // ada satu tautan pun ke sana.
      { labelKey: "navHitungRetur", href: "/gudang-retur", permission: PERMISSIONS.INVENTORY_OPNAME_COUNT },
      { labelKey: "navStockReconciliation", href: "/backoffice/inventory/reconciliation", permission: PERMISSIONS.INVENTORY_RECONCILIATION_VIEW },
      // Barang RUSAK/EXPIRED yang kembali lewat nota retur toko; memutuskan = `inventory:manage`.
      { labelKey: "navGudangRusak", href: "/backoffice/gudang-rusak", permission: PERMISSIONS.INVENTORY_VIEW },
    ],
  },
  {
    section: "secOperations",
    labelKey: "sales",
    href: "/backoffice/sales-orders",
    icon: ShoppingCart,
    permission: PERMISSIONS.SALES_ORDERS_VIEW,
    children: [
      // Label menu = judul halaman tujuannya (audit 2026-10-08: "Pesanan" membuka "Pesanan marketplace").
      { labelKey: "navPesananMarketplace", href: "/backoffice/sales-orders", permission: PERMISSIONS.SALES_ORDERS_VIEW },
      { labelKey: "navFulfillment", href: "/backoffice/fulfillment", permission: PERMISSIONS.SALES_ORDERS_VIEW },
      { labelKey: "navSalesReturns", href: "/backoffice/returns", permission: PERMISSIONS.SALES_ORDERS_VIEW },
      { labelKey: "navPesananLapangan", href: "/backoffice/field-sales-orders", permission: PERMISSIONS.FIELD_SALES_ORDERS_VIEW },
      { labelKey: "navInden", href: "/backoffice/inden", permission: PERMISSIONS.FIELD_SALES_ORDERS_VIEW },
      { labelKey: "navSalesKanvas", href: "/backoffice/canvassing", permission: PERMISSIONS.CANVASSING_MANAGE },
      { labelKey: "navPenjualanKanvas", href: "/backoffice/van-sales", permission: PERMISSIONS.CANVASSING_MANAGE },
      { labelKey: "promos", href: "/backoffice/promos", permission: PERMISSIONS.PROMOS_VIEW },
    ],
  },
  // Pekerjaan MENGAWASI tim lapangan (kehadiran, biaya, ringkasan, komisi) —
  // dipisah dari Penjualan, yang berisi DOKUMEN penjualan. Penjualan sudah
  // sepuluh anak; menambah enam lagi di sana membuatnya tidak terbaca.
  {
    section: "secOperations",
    labelKey: "navGroupFieldTeamKalimat",
    href: "/backoffice/sales-lapangan",
    icon: MapPinned,
    permission: PERMISSIONS.FIELD_SALES_ORDERS_VIEW,
    children: [
      { labelKey: "navKinerjaSalesLapangan", href: "/backoffice/sales-lapangan", permission: PERMISSIONS.FIELD_SALES_ORDERS_VIEW },
      { labelKey: "navJadwalKunjunganSales", href: "/backoffice/jadwal-kunjungan", permission: PERMISSIONS.FIELD_SALES_ORDERS_VIEW },
      { labelKey: "navPengumuman", href: "/backoffice/pengumuman", permission: PERMISSIONS.FIELD_SALES_ORDERS_VIEW },
      { labelKey: "navAbsensi", href: "/backoffice/absensi", permission: PERMISSIONS.FIELD_SALES_ORDERS_VIEW },
      { labelKey: "navIzinDanCuti", href: "/backoffice/izin", permission: PERMISSIONS.FIELD_SALES_ORDERS_VIEW },
      { labelKey: "navTargetPenjualanSales", href: "/backoffice/target-sales", permission: PERMISSIONS.FIELD_SALES_ORDERS_VIEW },
      // Juga untuk keuangan (`journals:manage`) yang membayar biayanya — sama dengan `bolehMelihatBiaya`.
      {
        labelKey: "navBiayaPerjalananSales",
        href: "/backoffice/biaya-perjalanan",
        permission: [PERMISSIONS.FIELD_SALES_ORDERS_VIEW, PERMISSIONS.JOURNALS_MANAGE],
      },
      // Sales menyetujui, gudang (`inventory:manage`) menyelesaikan — sama dengan `bolehMelihatTukar`.
      {
        labelKey: "navTukarBarangToko",
        href: "/backoffice/tukar-barang",
        permission: [PERMISSIONS.FIELD_SALES_ORDERS_VIEW, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE, PERMISSIONS.INVENTORY_MANAGE],
      },
      { labelKey: "navKomisiSalesmanBulanan", href: "/backoffice/laporan/komisi-salesman", permission: PERMISSIONS.FIELD_SALES_ORDERS_APPROVE },
      { labelKey: "navDaftarPeriksaToko", href: "/backoffice/checklist-toko", permission: PERMISSIONS.STORES_VIEW },
      { labelKey: "navLaporanEksekusiToko", href: "/backoffice/checklist-toko/laporan", permission: PERMISSIONS.STORES_VIEW },
      { labelKey: "navPanduanDisplayToko", href: "/backoffice/panduan-display", permission: PERMISSIONS.STORES_VIEW },
      { labelKey: "navHargaPesaingToko", href: "/backoffice/harga-pesaing", permission: PERMISSIONS.STORES_VIEW },
    ],
  },
  // Semua pekerjaan SPG di satu tempat: nota konter, promo konter, tutup hari,
  // pelanggan, jadwal, komisi, kiriman, dan barang rusak.
  {
    section: "secOperations",
    labelKey: "navGroupSpg",
    href: "/backoffice/spg-sales",
    icon: Store,
    // Grup tetap tampil untuk gudang lewat anak "Barang rusak dari kiriman".
    permission: PERMISSIONS.SPG_SALES_VIEW,
    children: [
      { labelKey: "navSpgSales", href: "/backoffice/spg-sales", permission: PERMISSIONS.SPG_SALES_VIEW },
      { labelKey: "navKinerjaSpg", href: "/backoffice/kinerja-spg", permission: PERMISSIONS.SPG_SALES_VIEW },
      { labelKey: "navSpgTutupHariJudul", href: "/backoffice/spg-tutup-hari", permission: PERMISSIONS.SPG_SALES_VIEW },
      { labelKey: "navPromoKonterSpg", href: "/backoffice/promo-konter", permission: PERMISSIONS.PROMOS_VIEW },
      { labelKey: "navSpgPelanggan", href: "/backoffice/spg-pelanggan", permission: PERMISSIONS.SPG_SALES_VIEW },
      { labelKey: "navJadwalShiftSpg", href: "/backoffice/jadwal-spg", permission: PERMISSIONS.SPG_SALES_VIEW },
      { labelKey: "navKomisiSpg", href: "/backoffice/komisi-spg", permission: PERMISSIONS.SPG_SALES_VIEW },
      { labelKey: "navSpgRequests", href: "/backoffice/spg-requests", permission: [PERMISSIONS.SPG_SALES_VIEW, PERMISSIONS.STORES_MANAGE] },
      { labelKey: "navSpgLostSales", href: "/backoffice/spg-lost-sales", permission: PERMISSIONS.SPG_SALES_VIEW },
      // Mutasi antar toko oleh SPG — barang KONSI berpindah rak, bukan dokumen penjualan.
      { labelKey: "navSpgTransfers", href: "/backoffice/spg-transfers", permission: PERMISSIONS.SPG_SALES_VIEW },
      // Pengawas SPG melihat, gudang (`inventory:manage`) yang memutuskan.
      {
        labelKey: "navSpgKirimanRusak",
        href: "/backoffice/spg-kiriman-rusak",
        permission: [PERMISSIONS.SPG_SALES_VIEW, PERMISSIONS.INVENTORY_MANAGE],
      },
      // Pengawas SPG melihat; yang menetapkan penanggung = receivables:manage.
      {
        labelKey: "navBarangHilang",
        href: "/backoffice/barang-hilang",
        permission: [PERMISSIONS.SPG_SALES_VIEW, PERMISSIONS.RECEIVABLES_MANAGE],
      },
    ],
  },
  {
    section: "secOperations",
    labelKey: "production",
    href: "/backoffice/production/planning",
    icon: Factory,
    permission: PERMISSIONS.PRODUCTION_PLANNING_VIEW,
    children: [
      { labelKey: "navForecast", href: "/backoffice/forecast", permission: PERMISSIONS.FORECAST_VIEW },
      { labelKey: "navProductionPlanning", href: "/backoffice/production/planning", permission: PERMISSIONS.PRODUCTION_PLANNING_VIEW },
      { labelKey: "navProductionFollowUp", href: "/backoffice/production/follow-up", permission: PERMISSIONS.PRODUCTION_PLANNING_VIEW },
      { labelKey: "navProductionColors", href: "/backoffice/production/colors", permission: PERMISSIONS.PRODUCTION_COLORS_VIEW },
      { labelKey: "navProductionPalette", href: "/backoffice/production/palette", permission: PERMISSIONS.PRODUCTION_COLORS_VIEW },
      { labelKey: "navWorkOrdersList", href: "/backoffice/work-orders", permission: PERMISSIONS.WORK_ORDERS_VIEW },
      { labelKey: "registerNotaCmt", href: "/backoffice/work-orders/nota-register", permission: PERMISSIONS.NOTA_REGISTER_VIEW },
    ],
  },
  /*
   * Pembelian berdiri sendiri: PO, pembayaran ke pemasok, dan retur ke pemasok
   * dulu terselip di Produksi, padahal dikerjakan bagian pembelian/keuangan.
   * Izin tiap anak SAMA dengan sebelumnya. Master Pemasok tetap di Data Master;
   * daftar GRN tetap tab di Inventori.
   */
  {
    section: "secOperations",
    labelKey: "navGroupPurchasing",
    href: "/backoffice/purchase-orders",
    icon: ShoppingBag,
    permission: PERMISSIONS.PURCHASE_ORDERS_VIEW,
    children: [
      { labelKey: "navPesananPembelian", href: "/backoffice/purchase-orders", permission: PERMISSIONS.PURCHASE_ORDERS_VIEW },
      { labelKey: "navPembayaranPemasok", href: "/backoffice/supplier-payments", permission: PERMISSIONS.SUPPLIER_PAYMENTS_VIEW },
      { labelKey: "navUmurHutang", href: "/backoffice/supplier-payments/umur-hutang", permission: PERMISSIONS.SUPPLIER_PAYMENTS_VIEW },
      { labelKey: "navReturKePemasok", href: "/backoffice/vendor-returns", permission: PERMISSIONS.VENDOR_RETURNS_VIEW },
    ],
  },

  // ── Piutang & konsinyasi ───────────────────────────────────────────────────
  // Berdiri sebagai bagiannya sendiri, bukan diselipkan ke Keuangan: orang yang
  // mengerjakannya berbeda (sales melapor, admin keuangan memverifikasi, gudang
  // menghitung), dan izinnya pun terpisah.
  {
    section: "secReceivablesKalimat",
    labelKey: "navGroupReceivablesKalimat",
    href: "/backoffice/pelunasan-dasbor",
    icon: ReceiptText,
    permission: PERMISSIONS.RECEIVABLES_VIEW,
    children: [
      { labelKey: "navBerandaPiutang", href: "/backoffice/pelunasan-dasbor", permission: IZIN_BACA_PIUTANG },
      { labelKey: "navFakturPiutang", href: "/backoffice/piutang", permission: IZIN_BACA_PIUTANG },
      { labelKey: "collections", href: "/backoffice/kontrabon", permission: IZIN_BACA_PIUTANG },
      { labelKey: "navPelunasanBkm", href: "/backoffice/pelunasan", permission: IZIN_BACA_PELUNASAN },
      { labelKey: "navTugasTagih", href: "/backoffice/tugas-tagih", permission: IZIN_BACA_ARSIP },
      { labelKey: "navReturPencocokan", href: "/backoffice/retur-toko", permission: IZIN_BACA_RETUR },
      { labelKey: "navBebanSelisih", href: "/backoffice/beban-selisih", permission: IZIN_BACA_PIUTANG },
      { labelKey: "navArsipNotaRetur", href: "/backoffice/arsip-retur", permission: IZIN_BACA_ARSIP },
    ],
  },
  {
    section: "secReceivablesKalimat",
    labelKey: "konsinyasi",
    href: "/backoffice/konsinyasi",
    icon: Handshake,
    permission: PERMISSIONS.CONSIGNMENT_VIEW,
  },

  // ── Kreatif ────────────────────────────────────────────────────────────────
  // Bagiannya sendiri, bukan anak Penjualan: orang yang merencanakan konten
  // Instagram bukan orang yang menyetujui pesanan lapangan, dan tidak satu pun
  // dari mereka boleh mewarisi layar yang lain hanya karena keduanya menyentuh
  // kata "marketing". Izinnya pun terpisah.
  // Urutannya sama dengan tab di `app/backoffice/kreatif/KreatifTabs.tsx`;
  // bawaan grup = Hari ini.
  {
    section: "secCreative",
    labelKey: "navGroupCreative",
    href: "/backoffice/kreatif",
    icon: Megaphone,
    permission: PERMISSIONS.CREATIVE_VIEW,
    children: [
      { labelKey: "navKreatifHariIni", href: "/backoffice/kreatif", permission: PERMISSIONS.CREATIVE_VIEW },
      { labelKey: "navKolaborasi", href: "/backoffice/kreatif/kolaborasi", permission: PERMISSIONS.CREATIVE_VIEW },
      { labelKey: "navKolDirectory", href: "/backoffice/kreatif/kol", permission: PERMISSIONS.CREATIVE_VIEW },
      { labelKey: "navKolCampaign", href: "/backoffice/kreatif/campaign", permission: PERMISSIONS.CREATIVE_VIEW },
      { labelKey: "navKolSampel", href: "/backoffice/kreatif/sampel", permission: PERMISSIONS.CREATIVE_VIEW },
      { labelKey: "navKolKonten", href: "/backoffice/kreatif/konten-kol", permission: PERMISSIONS.CREATIVE_VIEW },
      { labelKey: "navKolPembayaran", href: "/backoffice/kreatif/pembayaran", permission: PERMISSIONS.CREATIVE_VIEW },
      { labelKey: "navKolKalender", href: "/backoffice/kreatif/kalender", permission: PERMISSIONS.CREATIVE_VIEW },
      { labelKey: "navKolLaporan", href: "/backoffice/kreatif/laporan", permission: PERMISSIONS.CREATIVE_VIEW },
      { labelKey: "navContentCalendar", href: "/backoffice/kreatif/konten", permission: PERMISSIONS.CREATIVE_VIEW },
      { labelKey: "navKreatifPengaturan", href: "/backoffice/kreatif/pengaturan", permission: PERMISSIONS.CREATIVE_VIEW },
    ],
  },

  // ── Keuangan ───────────────────────────────────────────────────────────────
  // Dipecah dua: yang MENCATAT dan yang MEMBACA. Sebelas anak dalam satu daftar
  // tidak lagi bisa dipindai, dan keduanya memang pekerjaan yang berbeda.
  {
    section: "secFinance",
    labelKey: "navGroupLedgerKalimat",
    href: "/backoffice/finance/journals",
    icon: BookOpenText,
    permission: PERMISSIONS.JOURNALS_VIEW,
    children: [
      { labelKey: "navFinanceJournals", href: "/backoffice/finance/journals", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceBukuBesar", href: "/backoffice/finance/journals/ledger", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceKas", href: "/backoffice/finance/kas", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceRekonsiliasiBank", href: "/backoffice/finance/rekonsiliasi-bank", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceJurnalBerulang", href: "/backoffice/finance/jurnal-berulang", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceAsetTetap", href: "/backoffice/finance/aset-tetap", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceTutupBuku", href: "/backoffice/finance/tutup-buku", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceIntegritas", href: "/backoffice/finance/integritas", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navCoaKalimat", href: "/backoffice/finance/coa", permission: PERMISSIONS.COA_VIEW },
      { labelKey: "navFinanceAccountMappingKalimat", href: "/backoffice/finance/account-mapping", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceMulaiBukuBesar", href: "/backoffice/finance/mulai-buku-besar", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceSaldoAwal", href: "/backoffice/finance/saldo-awal", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceCashFlowSectionsKalimat", href: "/backoffice/finance/cash-flow-sections", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceSettlementsKalimat", href: "/backoffice/finance/settlements", permission: PERMISSIONS.SETTLEMENTS_VIEW },
      { labelKey: "navFakturPajakKalimat", href: "/backoffice/finance/faktur-pajak", permission: PERMISSIONS.TAX_INVOICES_VIEW },
      { labelKey: "navFinancePphDipotong", href: "/backoffice/finance/pph-dipotong", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinancePajak", href: "/backoffice/finance/pajak", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceAnggaran", href: "/backoffice/finance/anggaran", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceRekonsiliasiPiutang", href: "/backoffice/finance/rekonsiliasi-piutang", permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: "navFinanceRekonsiliasiPersediaan", href: "/backoffice/finance/rekonsiliasi-persediaan", permission: PERMISSIONS.JOURNALS_VIEW },
    ],
  },
  {
    section: "secFinance",
    labelKey: "navGroupReports",
    href: "/backoffice/finance/reports/trial-balance",
    icon: BarChart2,
    permission: PERMISSIONS.FINANCE_REPORTS_VIEW,
    children: [
      // Urutan: empat laporan keuangan pokok, lalu analisisnya (perbandingan,
      // rasio, laba per kanal, anggaran), lalu laporan operasional. Umur utang
      // ada di grup Pembelian, di samping Pembayaran pemasok — satu tempat saja.
      { labelKey: "navFinanceTrialBalance", href: "/backoffice/finance/reports/trial-balance", permission: PERMISSIONS.FINANCE_REPORTS_VIEW },
      { labelKey: "navFinanceIncomeStatement", href: "/backoffice/finance/reports/income-statement", permission: PERMISSIONS.FINANCE_REPORTS_VIEW },
      { labelKey: "navFinanceBalanceSheet", href: "/backoffice/finance/reports/balance-sheet", permission: PERMISSIONS.FINANCE_REPORTS_VIEW },
      { labelKey: "navFinanceCashFlow", href: "/backoffice/finance/reports/cash-flow", permission: PERMISSIONS.FINANCE_REPORTS_VIEW },
      { labelKey: "navFinancePerbandingan", href: "/backoffice/finance/reports/perbandingan", permission: PERMISSIONS.FINANCE_REPORTS_VIEW },
      { labelKey: "navFinanceRasio", href: "/backoffice/finance/reports/rasio", permission: PERMISSIONS.FINANCE_REPORTS_VIEW },
      { labelKey: "navFinanceLabaKanal", href: "/backoffice/finance/reports/laba-kanal", permission: PERMISSIONS.FINANCE_REPORTS_VIEW },
      { labelKey: "navFinanceAnggaranRealisasi", href: "/backoffice/finance/anggaran/realisasi", permission: PERMISSIONS.FINANCE_REPORTS_VIEW },
      // Laporan operasional yang dulu jadi tab di bawah beranda — izinnya sama
      // dengan beranda, jadi siapa pun yang dulu melihat tabnya tetap melihatnya.
      { labelKey: "navOperationalReports", href: "/backoffice/laporan", permission: PERMISSIONS.DASHBOARD_VIEW },
      { labelKey: "hppReportKalimat", href: "/backoffice/reports/hpp", permission: PERMISSIONS.REPORTS_HPP_VIEW },
    ],
  },

  // ── Sistem ─────────────────────────────────────────────────────────────────
  {
    section: "secSystem",
    labelKey: "jubelio",
    href: "/backoffice/jubelio/admin",
    icon: Plug,
    permission: PERMISSIONS.JUBELIO_ADMIN_VIEW,
    children: [
      // Urutan penyiapan (audit G8): pengaturan → kategori → migrasi → kurir, lalu pemantauan harian.
      { labelKey: "navJubelioSettings", href: "/backoffice/jubelio/settings", permission: PERMISSIONS.SETTINGS_SECURITY_VIEW },
      { labelKey: "navJubelioCategories", href: "/backoffice/jubelio/categories", permission: PERMISSIONS.SETTINGS_SECURITY_VIEW },
      { labelKey: "navJubelioMigration", href: "/backoffice/jubelio/migration", permission: PERMISSIONS.SETTINGS_SECURITY_VIEW },
      { labelKey: "navJubelioCouriers", href: "/backoffice/jubelio/couriers", permission: PERMISSIONS.SETTINGS_SECURITY_VIEW },
      { labelKey: "navJubelioAdmin", href: "/backoffice/jubelio/admin", permission: PERMISSIONS.JUBELIO_ADMIN_VIEW },
    ],
  },
  {
    section: "secSystem",
    labelKey: "navGroupArchiveKalimat",
    href: "/backoffice/archive",
    icon: FolderArchive,
    permission: PERMISSIONS.PURCHASE_ORDERS_VIEW,
    children: [
      // Sama dengan penjaga halamannya: pembelian ATAU pembaca piutang.
      { labelKey: "archiveKalimat", href: "/backoffice/archive", permission: [PERMISSIONS.PURCHASE_ORDERS_VIEW, PERMISSIONS.RECEIVABLES_VIEW, PERMISSIONS.RECEIVABLES_MANAGE] },
      { labelKey: "auditTrailKalimat", href: "/backoffice/audit-trail", permission: PERMISSIONS.AUDIT_TRAIL_VIEW },
    ],
  },
  {
    section: "secSystem",
    labelKey: "settings",
    href: "/backoffice/settings",
    icon: Settings,
    permission: PERMISSIONS.SETTINGS_SECURITY_VIEW,
  },
  // Penjelasan setiap halaman (keputusan pemilik 2026-10-05: keterangan
  // dipindah dari layar ke sini). Tanpa izin — membaca penjelasan tidak
  // membuka data apa pun.
  {
    labelKey: "bantuan",
    href: "/backoffice/bantuan",
    icon: BookOpen,
  },
];

/**
 * Grup mana yang harus terbuka untuk sebuah rute — DITURUNKAN dari `navItems`.
 *
 * Dulu ini daftar `startsWith` yang ditulis tangan, salinan kedua dari pohon
 * menu yang harus diperbarui setiap kali ada rute baru. Yang lupa diperbarui
 * tidak pernah gagal dengan berisik: grupnya cuma tidak terbuka, dan orang
 * mengira menunya hilang.
 *
 * Kecocokan TERPANJANG menang, supaya `/backoffice/items/categories` menunjuk
 * anaknya sendiri dan bukan induk yang kebetulan berawalan sama.
 */
export function grupUntukRute(path: string): string | null {
  let terbaik: { panjang: number; induk: string } | null = null;
  for (const item of navItems) {
    if (!item.children?.length) continue;
    for (const anak of item.children) {
      if (path !== anak.href && !path.startsWith(`${anak.href}/`)) continue;
      if (!terbaik || anak.href.length > terbaik.panjang) {
        terbaik = { panjang: anak.href.length, induk: item.href };
      }
    }
  }
  return terbaik?.induk ?? null;
}

