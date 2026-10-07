import { PERMISSIONS } from "@/lib/rbac";

/**
 * Penjelasan setiap izin untuk editor Peran & Izin.
 *
 * Pemilik membuat peran sendiri dan tidak bisa menebak arti kode seperti
 * `field_sales_orders:approve`. Di sini setiap kode diberi grup menurut BIDANG
 * KERJA (bukan modul kode), label dan satu kalimat keterangan (kunci i18n di
 * namespace `izinPeran`), dan halaman kantor yang dibukanya.
 *
 * `halaman` mencantumkan setiap rute `ROUTE_PERMISSIONS` milik izin itu
 * (dijaga `penjelasan-izin.test.ts`) ditambah halaman yang memagari dirinya
 * sendiri dengan izin itu. Izin tindakan (buat/ubah/setujui) yang bekerja di
 * halaman milik izin lain memakai `butuh`, supaya editor bisa mengingatkan.
 *
 * Murni — tanpa React, tanpa Prisma — supaya bisa dites dan dimuat di klien.
 */

/** Izin aplikasi HP: dicek langsung sebagai teks, tidak ada di `PERMISSIONS`. */
export const IZIN_AKSES_HP = "pwa:access";

export type KodeIzin = (typeof PERMISSIONS)[keyof typeof PERMISSIONS] | typeof IZIN_AKSES_HP;

/** Urutan grup di editor dan di ringkasan kartu peran. */
export const GRUP_IZIN = [
  "beranda",
  "marketplace",
  "pesananLapangan",
  "timLapangan",
  "spg",
  "piutang",
  "konsinyasi",
  "keuangan",
  "pembelian",
  "gudang",
  "produksi",
  "kreatif",
  "dataMaster",
  "pengaturan",
  "sistem",
] as const;

export type GrupIzin = (typeof GRUP_IZIN)[number];

/** Kode yang ada di basis data tapi belum dijelaskan di sini. */
export const GRUP_LAINNYA = "lainnya";
export type GrupTampil = GrupIzin | typeof GRUP_LAINNYA;

export type PenjelasanIzin = {
  grup: GrupIzin;
  /** Kunci i18n relatif ke namespace `izinPeran`. */
  label: string;
  /** Kunci i18n relatif ke namespace `izinPeran`. */
  keterangan: string;
  /** Rute halaman yang dibuka izin ini ("/pwa" = aplikasi HP). */
  halaman: readonly string[];
  /** Izin lain yang perlu ikut dipilih supaya izin ini bisa dipakai. */
  butuh?: KodeIzin;
};

type Isian = { grup: GrupIzin; halaman?: readonly string[]; butuh?: KodeIzin };

const P = PERMISSIONS;

/** Rute modul piutang yang memagari dirinya sendiri (`lib/receivables/izin.ts`). */
const HALAMAN_BACA_PIUTANG = [
  "/backoffice/pelunasan-dasbor",
  "/backoffice/piutang",
  "/backoffice/kontrabon",
  "/backoffice/pelunasan",
  "/backoffice/retur-toko",
  "/backoffice/beban-selisih",
] as const;

/*
 * Urutan kunci = urutan tampil di dalam grup: lihat dulu, lalu tindakannya.
 * Kunci objek berupa teks (bukan angka) mempertahankan urutan sisipnya.
 */
const ISIAN: Record<KodeIzin, Isian> = {
  // ── Beranda & laporan ──
  [P.DASHBOARD_VIEW]: { grup: "beranda", halaman: ["/backoffice/dashboard", "/backoffice/laporan"] },
  [P.REPORTS_HPP_VIEW]: { grup: "beranda", halaman: ["/backoffice/reports/hpp"] },

  // ── Penjualan marketplace ──
  [P.SALES_ORDERS_VIEW]: {
    grup: "marketplace",
    halaman: [
      "/backoffice/sales-orders",
      "/backoffice/sales-orders/[id]/pick-list",
      "/backoffice/sales-orders/[id]/packing-slip",
      "/backoffice/fulfillment",
    ],
  },
  [P.SALES_ORDERS_FULFILL]: { grup: "marketplace", butuh: P.SALES_ORDERS_VIEW },
  // Menu "Pengembalian" ada di grup Penjualan, yang hanya tampil dengan izin pesanan.
  [P.SALES_RETURNS_VIEW]: {
    grup: "marketplace",
    halaman: ["/backoffice/returns", "/backoffice/returns/[id]"],
    butuh: P.SALES_ORDERS_VIEW,
  },
  [P.SALES_RETURNS_DECIDE]: { grup: "marketplace", butuh: P.SALES_RETURNS_VIEW },

  // ── Pesanan lapangan & toko ──
  [P.FIELD_SALES_ORDERS_VIEW]: {
    grup: "pesananLapangan",
    halaman: [
      "/backoffice/field-sales-orders",
      "/backoffice/inden",
      "/backoffice/sales-lapangan",
      "/backoffice/jadwal-kunjungan",
      "/backoffice/pengumuman",
      "/backoffice/absensi",
      "/backoffice/izin",
      "/backoffice/target-sales",
      "/backoffice/biaya-perjalanan",
      "/backoffice/tukar-barang",
      "/backoffice/settings/salesman",
    ],
  },
  [P.FIELD_SALES_ORDERS_APPROVE]: {
    grup: "pesananLapangan",
    halaman: ["/backoffice/laporan/komisi-salesman", "/backoffice/tukar-barang"],
    butuh: P.FIELD_SALES_ORDERS_VIEW,
  },
  [P.FIELD_SALES_ORDERS_DELIVER]: { grup: "pesananLapangan", butuh: P.FIELD_SALES_ORDERS_VIEW },
  [P.STORES_VIEW]: {
    grup: "pesananLapangan",
    halaman: [
      "/backoffice/stores",
      "/backoffice/stores/usulan",
      "/backoffice/checklist-toko",
      "/backoffice/checklist-toko/laporan",
      "/backoffice/panduan-display",
      "/backoffice/harga-pesaing",
    ],
  },
  [P.STORES_MANAGE]: {
    grup: "pesananLapangan",
    halaman: ["/backoffice/stores/new", "/backoffice/spg-requests"],
    butuh: P.STORES_VIEW,
  },
  [P.PROMOS_VIEW]: { grup: "pesananLapangan", halaman: ["/backoffice/promos", "/backoffice/promo-konter"] },
  [P.PROMOS_MANAGE]: {
    grup: "pesananLapangan",
    halaman: ["/backoffice/promos/new", "/backoffice/promo-konter/baru"],
    butuh: P.PROMOS_VIEW,
  },
  [P.CANVASSING_MANAGE]: {
    grup: "pesananLapangan",
    halaman: [
      "/backoffice/canvassing",
      "/backoffice/canvassing/reconcile/[id]",
      "/backoffice/van-sales",
      "/backoffice/van-sales/[id]",
    ],
  },

  // ── Tim lapangan (HP) ──
  [IZIN_AKSES_HP]: { grup: "timLapangan", halaman: ["/pwa"] },

  // ── SPG ──
  [P.SPG_SALES_RECORD]: { grup: "spg", butuh: IZIN_AKSES_HP },
  [P.SPG_SALES_VIEW]: {
    grup: "spg",
    halaman: [
      "/backoffice/spg-sales",
      "/backoffice/spg-sales/[id]",
      "/backoffice/kinerja-spg",
      "/backoffice/spg-tutup-hari",
      "/backoffice/spg-pelanggan",
      "/backoffice/jadwal-spg",
      "/backoffice/komisi-spg",
      "/backoffice/spg-requests",
      "/backoffice/spg-lost-sales",
      "/backoffice/spg-transfers",
      "/backoffice/spg-transfers/[id]",
      "/backoffice/spg-kiriman-rusak",
      "/backoffice/barang-hilang",
      "/backoffice/settings/spg",
    ],
  },

  // ── Piutang & pelunasan ──
  [P.RECEIVABLES_VIEW]: {
    grup: "piutang",
    halaman: [...HALAMAN_BACA_PIUTANG, "/backoffice/tugas-tagih", "/backoffice/arsip-retur", "/backoffice/archive"],
  },
  [P.RECEIVABLES_MANAGE]: {
    grup: "piutang",
    halaman: [
      ...HALAMAN_BACA_PIUTANG,
      "/backoffice/piutang/impor",
      "/backoffice/barang-hilang",
      "/backoffice/settings/jenis-potongan",
    ],
    butuh: P.RECEIVABLES_VIEW,
  },

  // ── Konsinyasi ──
  [P.CONSIGNMENT_VIEW]: { grup: "konsinyasi", halaman: ["/backoffice/konsinyasi"] },
  [P.CONSIGNMENT_MANAGE]: { grup: "konsinyasi", butuh: P.CONSIGNMENT_VIEW },

  // ── Keuangan & pajak ──
  [P.JOURNALS_VIEW]: {
    grup: "keuangan",
    halaman: [
      "/backoffice/finance/journals",
      "/backoffice/finance/account-mapping",
      "/backoffice/finance/cash-flow-sections",
      "/backoffice/finance/pph-dipotong",
    ],
  },
  [P.JOURNALS_MANAGE]: {
    grup: "keuangan",
    halaman: [
      "/backoffice/finance/journals/new",
      "/backoffice/pelunasan",
      "/backoffice/retur-toko",
      "/backoffice/biaya-perjalanan",
    ],
  },
  [P.COA_VIEW]: { grup: "keuangan", halaman: ["/backoffice/finance/coa"] },
  [P.COA_MANAGE]: { grup: "keuangan", butuh: P.COA_VIEW },
  [P.SETTLEMENTS_VIEW]: { grup: "keuangan", halaman: ["/backoffice/finance/settlements"] },
  [P.SETTLEMENTS_MANAGE]: { grup: "keuangan", butuh: P.SETTLEMENTS_VIEW },
  [P.FINANCE_REPORTS_VIEW]: {
    grup: "keuangan",
    halaman: [
      "/backoffice/finance/reports/trial-balance",
      "/backoffice/finance/reports/income-statement",
      "/backoffice/finance/reports/balance-sheet",
      "/backoffice/finance/reports/cash-flow",
    ],
  },
  [P.TAX_INVOICES_VIEW]: { grup: "keuangan", halaman: ["/backoffice/finance/faktur-pajak"] },
  [P.TAX_INVOICES_MANAGE]: { grup: "keuangan", butuh: P.TAX_INVOICES_VIEW },

  // ── Pembelian & pemasok ──
  [P.PURCHASE_ORDERS_VIEW]: { grup: "pembelian", halaman: ["/backoffice/purchase-orders", "/backoffice/archive"] },
  [P.PURCHASE_ORDERS_CREATE]: {
    grup: "pembelian",
    halaman: ["/backoffice/purchase-orders/new"],
    butuh: P.PURCHASE_ORDERS_VIEW,
  },
  [P.PURCHASE_ORDERS_EDIT]: { grup: "pembelian", butuh: P.PURCHASE_ORDERS_VIEW },
  [P.PURCHASE_ORDERS_APPROVE]: { grup: "pembelian", butuh: P.PURCHASE_ORDERS_VIEW },
  [P.SUPPLIER_PAYMENTS_VIEW]: { grup: "pembelian", halaman: ["/backoffice/supplier-payments"] },
  [P.SUPPLIER_PAYMENTS_CREATE]: { grup: "pembelian", butuh: P.SUPPLIER_PAYMENTS_VIEW },
  [P.SUPPLIER_PAYMENTS_EDIT]: { grup: "pembelian", butuh: P.SUPPLIER_PAYMENTS_VIEW },
  [P.VENDOR_RETURNS_VIEW]: { grup: "pembelian", halaman: ["/backoffice/vendor-returns"] },
  [P.VENDOR_RETURNS_CREATE]: {
    grup: "pembelian",
    halaman: ["/backoffice/vendor-returns/new"],
    butuh: P.VENDOR_RETURNS_VIEW,
  },
  [P.VENDOR_RETURNS_MANAGE]: { grup: "pembelian", butuh: P.VENDOR_RETURNS_VIEW },
  [P.SUPPLIERS_VIEW]: { grup: "pembelian", halaman: ["/backoffice/suppliers"] },
  [P.SUPPLIERS_CREATE]: { grup: "pembelian", butuh: P.SUPPLIERS_VIEW },
  [P.SUPPLIERS_EDIT]: { grup: "pembelian", butuh: P.SUPPLIERS_VIEW },
  [P.SUPPLIERS_DELETE]: { grup: "pembelian", butuh: P.SUPPLIERS_VIEW },
  [P.SUPPLIERS_APPROVE]: { grup: "pembelian", butuh: P.SUPPLIERS_VIEW },
  [P.SUPPLIER_TYPES_VIEW]: { grup: "pembelian", halaman: ["/backoffice/suppliers/types"] },
  [P.SUPPLIER_TYPES_CREATE]: { grup: "pembelian", butuh: P.SUPPLIER_TYPES_VIEW },
  [P.SUPPLIER_TYPES_EDIT]: { grup: "pembelian", butuh: P.SUPPLIER_TYPES_VIEW },
  [P.SUPPLIER_TYPES_DELETE]: { grup: "pembelian", butuh: P.SUPPLIER_TYPES_VIEW },
  [P.LEAD_TIME_VIEW]: { grup: "pembelian", halaman: ["/backoffice/lead-time"] },
  [P.LEAD_TIME_MANAGE]: { grup: "pembelian", butuh: P.LEAD_TIME_VIEW },

  // ── Gudang & stok ──
  [P.INVENTORY_VIEW]: { grup: "gudang", halaman: ["/backoffice/inventory", "/backoffice/gudang-rusak"] },
  [P.INVENTORY_MANAGE]: {
    grup: "gudang",
    halaman: [
      "/backoffice/inventory/grn/new",
      "/backoffice/inventory/adjustment/new",
      "/backoffice/spg-kiriman-rusak",
      "/backoffice/tukar-barang",
    ],
    butuh: P.INVENTORY_VIEW,
  },
  [P.INVENTORY_OPNAME_VIEW]: { grup: "gudang", halaman: ["/backoffice/inventory/stock-opname"] },
  [P.INVENTORY_OPNAME_COUNT]: {
    grup: "gudang",
    halaman: ["/backoffice/inventory/stock-opname/new", "/gudang-retur", "/backoffice/retur-toko"],
    butuh: P.INVENTORY_OPNAME_VIEW,
  },
  [P.INVENTORY_OPNAME_APPROVE]: { grup: "gudang", butuh: P.INVENTORY_OPNAME_VIEW },
  [P.INVENTORY_RECONCILIATION_VIEW]: { grup: "gudang", halaman: ["/backoffice/inventory/reconciliation"] },
  [P.INVENTORY_RECONCILIATION_MANAGE]: { grup: "gudang", butuh: P.INVENTORY_RECONCILIATION_VIEW },

  // ── Produksi ──
  [P.FORECAST_VIEW]: { grup: "produksi", halaman: ["/backoffice/forecast", "/backoffice/forecast/reconciliation"] },
  [P.FORECAST_MANAGE]: { grup: "produksi", halaman: ["/backoffice/forecast/import"], butuh: P.FORECAST_VIEW },
  [P.PRODUCTION_PLANNING_VIEW]: {
    grup: "produksi",
    halaman: ["/backoffice/production/planning", "/backoffice/production/follow-up"],
  },
  [P.PRODUCTION_PLANNING_MANAGE]: { grup: "produksi", butuh: P.PRODUCTION_PLANNING_VIEW },
  [P.WORK_ORDERS_VIEW]: { grup: "produksi", halaman: ["/backoffice/work-orders"] },
  [P.WORK_ORDERS_CREATE]: { grup: "produksi", halaman: ["/backoffice/work-orders/new"], butuh: P.WORK_ORDERS_VIEW },
  [P.WORK_ORDERS_MANAGE]: { grup: "produksi", butuh: P.WORK_ORDERS_VIEW },
  [P.NOTA_REGISTER_VIEW]: { grup: "produksi", halaman: ["/backoffice/work-orders/nota-register"] },
  [P.PRODUCTION_COLORS_VIEW]: {
    grup: "produksi",
    halaman: ["/backoffice/production/colors", "/backoffice/production/palette"],
  },
  [P.PRODUCTION_COLORS_MANAGE]: { grup: "produksi", butuh: P.PRODUCTION_COLORS_VIEW },

  // ── Kreatif ──
  [P.CREATIVE_VIEW]: {
    grup: "kreatif",
    halaman: [
      "/backoffice/kreatif",
      "/backoffice/kreatif/kolaborasi",
      "/backoffice/kreatif/kol",
      "/backoffice/kreatif/campaign",
      "/backoffice/kreatif/sampel",
      "/backoffice/kreatif/konten-kol",
      "/backoffice/kreatif/pembayaran",
      "/backoffice/kreatif/kalender",
      "/backoffice/kreatif/laporan",
      "/backoffice/kreatif/konten",
      "/backoffice/kreatif/pengaturan",
    ],
  },
  [P.CREATIVE_MANAGE]: { grup: "kreatif", butuh: P.CREATIVE_VIEW },

  // ── Data master ──
  [P.ITEMS_VIEW]: {
    grup: "dataMaster",
    halaman: [
      "/backoffice/items",
      "/backoffice/items/categories",
      "/backoffice/items/size-charts",
      "/backoffice/items/labels",
    ],
  },
  [P.ITEMS_CREATE]: { grup: "dataMaster", halaman: ["/backoffice/items/new"], butuh: P.ITEMS_VIEW },
  [P.ITEMS_EDIT]: { grup: "dataMaster", butuh: P.ITEMS_VIEW },
  [P.ITEMS_DELETE]: { grup: "dataMaster", butuh: P.ITEMS_VIEW },
  [P.ITEMS_MANAGE]: { grup: "dataMaster", butuh: P.ITEMS_VIEW },

  // ── Pengaturan & keamanan ──
  [P.SETTINGS_SECURITY_VIEW]: {
    grup: "pengaturan",
    halaman: [
      "/backoffice/settings",
      "/backoffice/settings/security",
      "/backoffice/jubelio/settings",
      "/backoffice/jubelio/categories",
      "/backoffice/jubelio/migration",
      "/backoffice/jubelio/couriers",
    ],
  },
  [P.SETTINGS_SECURITY_MANAGE]: {
    grup: "pengaturan",
    halaman: ["/backoffice/settings/users"],
    butuh: P.SETTINGS_SECURITY_VIEW,
  },
  [P.SETTINGS_RBAC_VIEW]: { grup: "pengaturan", halaman: ["/backoffice/settings/rbac"] },
  [P.SETTINGS_RBAC_MANAGE]: { grup: "pengaturan", butuh: P.SETTINGS_RBAC_VIEW },
  [P.SETTINGS_DOCUMENTS_VIEW]: {
    grup: "pengaturan",
    halaman: ["/backoffice/settings/documents", "/backoffice/settings/item-codes"],
  },
  [P.SETTINGS_DOCUMENTS_MANAGE]: { grup: "pengaturan", butuh: P.SETTINGS_DOCUMENTS_VIEW },
  [P.SETTINGS_TAX_VIEW]: { grup: "pengaturan", halaman: ["/backoffice/settings/tax"] },
  [P.SETTINGS_TAX_MANAGE]: { grup: "pengaturan", butuh: P.SETTINGS_TAX_VIEW },
  [P.SETTINGS_UOM_VIEW]: { grup: "pengaturan", halaman: ["/backoffice/settings/uom"] },
  [P.SETTINGS_UOM_MANAGE]: { grup: "pengaturan", butuh: P.SETTINGS_UOM_VIEW },
  [P.SETTINGS_PACK_RATIO_VIEW]: { grup: "pengaturan", halaman: ["/backoffice/settings/pack-ratio"] },
  [P.SETTINGS_PACK_RATIO_MANAGE]: { grup: "pengaturan", butuh: P.SETTINGS_PACK_RATIO_VIEW },

  // ── Sistem ──
  [P.AUDIT_TRAIL_VIEW]: { grup: "sistem", halaman: ["/backoffice/audit-trail"] },
  [P.JUBELIO_ADMIN_VIEW]: { grup: "sistem", halaman: ["/backoffice/jubelio/admin"] },
};

/** Kode izin → potongan kunci i18n (titik dua tidak dipakai di kunci). */
export function kunciIzin(kode: string): string {
  return kode.replace(/:/g, "_");
}

export const PENJELASAN_IZIN: Readonly<Record<KodeIzin, PenjelasanIzin>> = Object.fromEntries(
  Object.entries(ISIAN).map(([kode, isian]) => {
    const k = kunciIzin(kode);
    const entri: PenjelasanIzin = {
      grup: isian.grup,
      label: `izin.${k}.label`,
      keterangan: `izin.${k}.keterangan`,
      halaman: isian.halaman ?? [],
      ...(isian.butuh ? { butuh: isian.butuh } : {}),
    };
    return [kode, entri];
  }),
) as Record<KodeIzin, PenjelasanIzin>;

const URUTAN_KODE = new Map(Object.keys(ISIAN).map((kode, i) => [kode, i]));

export function penjelasanIzin(kode: string): PenjelasanIzin | null {
  return Object.prototype.hasOwnProperty.call(PENJELASAN_IZIN, kode)
    ? PENJELASAN_IZIN[kode as KodeIzin]
    : null;
}

export function grupIzin(kode: string): GrupTampil {
  return penjelasanIzin(kode)?.grup ?? GRUP_LAINNYA;
}

/** Urutan tampil: grup menurut `GRUP_IZIN` (lainnya di akhir), lalu urutan entri. */
export function bandingkanIzin(a: string, b: string): number {
  const ga = grupIzin(a);
  const gb = grupIzin(b);
  const ia = ga === GRUP_LAINNYA ? GRUP_IZIN.length : GRUP_IZIN.indexOf(ga);
  const ib = gb === GRUP_LAINNYA ? GRUP_IZIN.length : GRUP_IZIN.indexOf(gb);
  if (ia !== ib) return ia - ib;
  const ua = URUTAN_KODE.get(a) ?? Number.MAX_SAFE_INTEGER;
  const ub = URUTAN_KODE.get(b) ?? Number.MAX_SAFE_INTEGER;
  return ua !== ub ? ua - ub : a.localeCompare(b);
}

/** Grup pekerjaan yang tercakup sekumpulan kode izin, berurutan, tanpa ganda. */
export function grupTercakup(kode: readonly string[]): GrupTampil[] {
  const ada = new Set<GrupTampil>(kode.map(grupIzin));
  const urutan: readonly GrupTampil[] = [...GRUP_IZIN, GRUP_LAINNYA];
  return urutan.filter((g) => ada.has(g));
}

/**
 * Rute untuk baris "Membuka": rute rincian (`[id]`) dibuang bila halaman
 * induknya sudah tercantum — "Pesanan" sudah mencakup daftar ambilnya.
 */
export function halamanRingkas(halaman: readonly string[]): string[] {
  const unik = [...new Set(halaman)];
  return unik.filter(
    (r) => !r.includes("[") || !unik.some((lain) => lain !== r && !lain.includes("[") && r.startsWith(`${lain}/`)),
  );
}

/** Pohon menu kantor seperlunya (`navItems` di BackofficeShell). */
export type MenuRingkas = readonly {
  labelKey: string;
  href: string;
  children?: readonly { labelKey: string; href: string }[];
}[];

/**
 * Letak sebuah rute di menu samping, sebagai daftar kunci `navigation.*`
 * (grup lalu anak). `tepat` = rute itu sendiri entri menu; selain itu entri
 * menu dengan awalan terpanjang, dan pemanggil menambahkan nama halamannya.
 * Null bila rute tidak berada di bawah menu mana pun.
 */
export function letakDiMenu(
  rute: string,
  menu: MenuRingkas,
): { jalur: string[]; tepat: boolean } | null {
  let terbaik: { jalur: string[]; panjang: number; tepat: boolean } | null = null;
  const pertimbangkan = (href: string, jalur: string[]) => {
    const tepat = rute === href;
    if (!tepat && !rute.startsWith(`${href}/`)) return;
    if (!terbaik || href.length > terbaik.panjang || (href.length === terbaik.panjang && jalur.length > terbaik.jalur.length)) {
      terbaik = { jalur, panjang: href.length, tepat };
    }
  };
  for (const item of menu) {
    if (item.children?.length) {
      for (const anak of item.children) {
        // Anak yang namanya sama dengan grupnya (Inventori › Inventori) cukup sekali.
        pertimbangkan(anak.href, anak.labelKey === item.labelKey ? [item.labelKey] : [item.labelKey, anak.labelKey]);
      }
    }
    pertimbangkan(item.href, [item.labelKey]);
  }
  const hasil = terbaik as { jalur: string[]; panjang: number; tepat: boolean } | null;
  return hasil ? { jalur: hasil.jalur, tepat: hasil.tepat } : null;
}

/** Pencarian tanpa membedakan huruf besar dan tanda aksen; semua kata harus ada. */
export function cocokCari(kueri: string, teks: readonly string[]): boolean {
  const rata = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  const kata = rata(kueri).split(/\s+/).filter(Boolean);
  if (kata.length === 0) return true;
  const isi = rata(teks.join(" "));
  return kata.every((k) => isi.includes(k));
}

/**
 * Keterangan bawaan seed (bahasa Inggris) untuk peran yang dibuat sistem.
 * Hanya bila keterangan di basis data SAMA PERSIS dengan ini, layar memakai
 * terjemahannya — keterangan yang diketik pemilik tidak pernah ditimpa.
 */
export const DESKRIPSI_PERAN_BAWAAN: Readonly<Record<string, string>> = {
  ADMIN: "System administrator with full access",
  PURCHASER: "Purchasing staff - manages suppliers, POs, and payments",
  WAREHOUSE: "Warehouse staff - manages inventory",
  PRODUCTION: "Production staff - manages work orders",
  SALESMAN: "Field salesman — PWA-only access",
  SPG: "In-store promoter — PWA-only access, fixed to one store",
};

/** Kunci i18n (namespace `izinPeran`) terjemahan keterangan peran bawaan, atau null. */
export function kunciDeskripsiPeran(nama: string, deskripsi: string | null | undefined): string | null {
  const bawaan = Object.prototype.hasOwnProperty.call(DESKRIPSI_PERAN_BAWAAN, nama) ? DESKRIPSI_PERAN_BAWAAN[nama] : null;
  if (!bawaan || (deskripsi ?? "").trim() !== bawaan) return null;
  return `peranBawaan.${nama}`;
}
