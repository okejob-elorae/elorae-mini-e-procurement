/**
 * RBAC (Role-Based Access Control) utilities
 * Permission checking, route mapping, and authorization helpers
 */

/**
 * Check if user has a specific permission
 * @param permissions - Array of permission codes from session
 * @param code - Permission code to check (e.g., "suppliers:create")
 * @returns true if user has permission (wildcard '*' grants all)
 */
export function hasPermission(permissions: string[], code: string): boolean {
  if (!permissions || permissions.length === 0) return false;
  // Wildcard grants all permissions
  if (permissions.includes('*')) return true;
  return permissions.includes(code);
}

/**
 * Check if user can access any permission for a module
 * @param permissions - Array of permission codes from session
 * @param module - Module name (e.g., "suppliers")
 * @returns true if user has any permission for the module
 */
export function canAccess(permissions: string[], module: string): boolean {
  if (!permissions || permissions.length === 0) return false;
  if (permissions.includes('*')) return true;
  return permissions.some(p => p.startsWith(`${module}:`));
}

/**
 * Server-side helper that throws 403 if user lacks permission
 * Use in API routes and server actions
 * @param permissions - Array of permission codes from session
 * @param code - Required permission code
 * @throws {Error} with status 403 if permission denied
 */
export function requirePermission(permissions: string[], code: string): void {
  if (!hasPermission(permissions, code)) {
    const error = new Error('Forbidden: Insufficient permissions');
    (error as any).status = 403;
    throw error;
  }
}

/**
 * Like requirePermission, but passes when the caller holds ANY of the given codes.
 * For shared reads that several pages under different permissions call.
 * @throws {Error} with status 403 if none of the codes is held
 */
export function requireAnyPermission(permissions: string[], codes: string[]): void {
  if (!codes.some((code) => hasPermission(permissions, code))) {
    const error = new Error('Forbidden: Insufficient permissions');
    (error as any).status = 403;
    throw error;
  }
}

/**
 * Route-to-permission mapping for proxy (auth/redirect layer)
 * Maps URL paths to required permission codes
 */
export const ROUTE_PERMISSIONS: Record<string, string> = {
  // Frontend routes
  '/backoffice/dashboard': 'dashboard:view',
  '/backoffice/items': 'items:view',
  '/backoffice/suppliers': 'suppliers:view',
  '/backoffice/suppliers/types': 'supplier_types:view',
  '/backoffice/lead-time': 'lead_time:view',
  '/backoffice/purchase-orders': 'purchase_orders:view',
  '/backoffice/supplier-payments': 'supplier_payments:view',
  '/backoffice/supplier-payments/baru': 'supplier_payments:create',
  '/backoffice/inventory': 'inventory:view',
  '/backoffice/inventory/stock-opname': 'inventory_opname:view',
  '/backoffice/inventory/reconciliation': 'inventory_reconciliation:view',
  '/backoffice/gudang-rusak': 'inventory:view',
  '/backoffice/sales-orders': 'sales_orders:view',
  '/backoffice/fulfillment': 'sales_orders:view',
  '/backoffice/field-sales-orders': 'field_sales_orders:view',
  '/backoffice/promos': 'promos:view',
  '/backoffice/canvassing': 'canvassing:manage',
  '/backoffice/van-sales': 'canvassing:manage',
  '/backoffice/spg-sales': 'spg_sales:view',
  "/backoffice/spg-commission": "spg_sales:view",
  '/packer': 'packer:menu',
  '/packer/record': 'packer:menu',
  '/api/packer': 'packer:menu',
  '/backoffice/spg-sales/[id]': 'spg_sales:view',
  // `/backoffice/spg-requests` sengaja TIDAK dipetakan: terbuka untuk pengawas
  // SPG (`spg_sales:view`) ATAU pengelola toko (`stores:manage`) yang dikabari
  // permintaan dari toko tanpa pemegang; halamannya memagari dirinya sendiri.
  '/backoffice/spg-lost-sales': 'spg_sales:view',
  '/backoffice/spg-transfers': 'spg_sales:view',
  '/backoffice/spg-transfers/[id]': 'spg_sales:view',
  '/backoffice/spg-tutup-hari': 'spg_sales:view',
  '/backoffice/spg-pelanggan': 'spg_sales:view',
  '/backoffice/jadwal-spg': 'spg_sales:view',
  '/backoffice/komisi-spg': 'spg_sales:view',
  '/backoffice/promo-konter': 'promos:view',
  '/backoffice/items/size-charts': 'items:view',
  '/backoffice/settings/spg': 'spg_sales:view',
  '/backoffice/kinerja-spg': 'spg_sales:view',
  // `/backoffice/barang-hilang` sengaja TIDAK dipetakan: terbuka untuk pengawas
  // SPG (`spg_sales:view`) ATAU keuangan yang menetapkan beban
  // (`receivables:manage`); halamannya memagari dirinya sendiri.
  '/backoffice/items/labels': 'items:view',
  // `/backoffice/spg-kiriman-rusak` sengaja TIDAK dipetakan: terbuka untuk
  // pengawas SPG (`spg_sales:view`) ATAU gudang yang memutuskan (`inventory:manage`).
  '/backoffice/inden': 'field_sales_orders:view',
  '/backoffice/sales-lapangan': 'field_sales_orders:view',
  '/backoffice/absensi': 'field_sales_orders:view',
  '/backoffice/target-sales': 'field_sales_orders:view',
  '/backoffice/izin': 'field_sales_orders:view',
  '/backoffice/pengumuman': 'field_sales_orders:view',
  '/backoffice/jadwal-kunjungan': 'field_sales_orders:view',
  '/backoffice/laporan/komisi-salesman': 'field_sales_orders:approve',
  // Laporan operasional yang dulu tab beranda: izin yang sama dengan beranda.
  // Pencocokan awalan memilih rute terpanjang, jadi komisi di atas tetap
  // memakai izinnya sendiri.
  '/backoffice/laporan': 'dashboard:view',
  // `/backoffice/biaya-perjalanan` dan `/backoffice/tukar-barang` sengaja TIDAK
  // dipetakan: masing-masing terbuka untuk dua kelompok (sales ATAU keuangan;
  // sales ATAU gudang), dan peta ini hanya bisa satu izin. Halamannya memagari
  // dirinya sendiri (`bolehMelihatBiaya`, `bolehMelihatTukar`).
  '/backoffice/work-orders': 'work_orders:view',
  '/backoffice/work-orders/nota-register': 'nota_register:view',
  '/backoffice/forecast': 'forecast:view',
  '/backoffice/forecast/import': 'forecast:manage',
  '/backoffice/production/planning': 'production_planning:view',
  '/backoffice/production/follow-up': 'production_planning:view',
  '/backoffice/production/colors': 'production_colors:view',
  '/backoffice/production/palette': 'production_colors:view',
  '/backoffice/vendor-returns': 'vendor_returns:view',
  '/backoffice/returns': 'sales_returns:view',
  '/backoffice/reports/hpp': 'reports_hpp:view',
  '/backoffice/audit-trail': 'audit_trail:view',
  '/backoffice/settings/documents': 'settings_documents:view',
  '/backoffice/settings/item-codes': 'settings_documents:view',
  '/backoffice/settings/tax': 'settings_tax:view',
  '/backoffice/settings/uom': 'settings_uom:view',
  '/backoffice/settings/security': 'settings_security:view',
  '/backoffice/settings/rbac': 'settings_rbac:view',
  '/backoffice/profile-accounts': 'settings_rbac:view',
  '/backoffice/settings/users': 'settings_security:manage',
  '/backoffice/jubelio/admin': 'jubelio_admin:view',
  '/backoffice/jubelio/settings': 'settings_security:view',
  '/backoffice/jubelio/categories': 'settings_security:view',
  '/backoffice/jubelio/migration': 'settings_security:view',
  '/backoffice/jubelio/couriers': 'settings_security:view',
  '/backoffice/finance/coa': 'coa:view',
  '/backoffice/finance/faktur-pajak': 'tax_invoices:view',
  '/backoffice/finance/piutang': 'receivables:view',
  '/backoffice/finance/payments': 'payments:manage',
  '/backoffice/finance/collections': 'collections:manage',
  '/backoffice/settings/piutang': 'collections:manage',
  "/backoffice/settings/purchasing": "purchase_orders:edit",
  "/backoffice/settings/spg-commission": "spg_commission:manage",
  "/backoffice/item-requests": "item_requests:view",
  "/backoffice/vendor-bills": "vendor_bills:view",
  "/backoffice/vendor-payments": "supplier_payments:view",
  '/backoffice/finance/pph-dipotong': 'journals:view',
  // Kas & bank (voucher BKK/BKMK/transfer, kas kecil, kategori) dan rekonsiliasi bank.
  '/backoffice/finance/kas': 'journals:view',
  '/backoffice/finance/kas/baru': 'journals:manage',
  '/backoffice/finance/rekonsiliasi-bank': 'journals:view',
  '/backoffice/finance/tutup-buku': 'journals:view',
  '/backoffice/finance/integritas': 'journals:view',
  '/backoffice/finance/mulai-buku-besar': 'journals:view',
  '/backoffice/finance/pajak': 'journals:view',
  // Ekspor faktur keluaran dibuka pembaca faktur pajak (tim pajak), bukan pembaca jurnal.
  '/backoffice/finance/pajak/faktur-keluaran': 'tax_invoices:view',
  '/backoffice/finance/rekonsiliasi-piutang': 'journals:view',
  '/backoffice/finance/rekonsiliasi-persediaan': 'journals:view',
  '/backoffice/finance/saldo-awal': 'journals:view',
  // Isi anggaran: pembaca jurnal (keuangan); realisasi vs anggaran: pembaca
  // laporan keuangan. Awalan terpanjang menang, jadi `/realisasi` memakai izinnya sendiri.
  '/backoffice/finance/anggaran': 'journals:view',
  '/backoffice/finance/anggaran/realisasi': 'finance_reports:view',
  '/backoffice/finance/reports/perbandingan': 'finance_reports:view',
  '/backoffice/finance/reports/rasio': 'finance_reports:view',
  '/backoffice/finance/reports/laba-kanal': 'finance_reports:view',
  // Aset tetap & jurnal berulang: melihat journals:view; formulir (/baru, /ubah) menjaga journals:manage sendiri.
  '/backoffice/finance/aset-tetap': 'journals:view',
  '/backoffice/finance/jurnal-berulang': 'journals:view',
  // Modul piutang sengaja TIDAK dipetakan — `/backoffice/piutang`, `pelunasan`
  // (termasuk `giro` dan `baru`), `pelunasan-dasbor`, `retur-toko`, `kontrabon`,
  // `beban-selisih`, `tugas-tagih`, `arsip-retur`, `konsinyasi`, dan cetakannya
  // di `/print/{bkm,retur,faktur,konsi}`. Pembaca sahnya lintas tugas (keuangan
  // membuka BKM yang ia verifikasi, gudang membuka nota retur yang ia hitung),
  // sedangkan peta ini hanya bisa satu izin — dan awalan `/backoffice/pelunasan`
  // ikut mencocokkan `/backoffice/pelunasan-dasbor`. Setiap halaman (dan aksi
  // cetaknya) memagari dirinya sendiri lewat `lib/receivables/izin.ts`.
  // `/backoffice/archive` juga tidak: pembelian ATAU pembaca piutang (hanya
  // folder "Nota toko"); halamannya memagari dirinya sendiri.
  // API routes
  '/api/suppliers': 'suppliers:view',
  '/api/supplier-types': 'supplier_types:view',
  '/api/items': 'items:view',
  '/api/uoms': 'settings_uom:view',
  '/api/production/colors': 'production_colors:view',
  // `/api/notifications*` sengaja TIDAK dipetakan: setiap handler-nya memeriksa sesi dan hanya
  // menyentuh baris milik `session.user.id`. Memetakannya ke `dashboard:view` dulu membuat salesman
  // dan SPG (yang tidak punya izin itu) mendapat 403 untuk lonceng, tandai-dibaca, dan daftar push.
};

/**
 * Backoffice UI routes in preferred order (for redirect when user has no dashboard:view)
 */
const BACKOFFICE_ROUTES_ORDER: string[] = [
  '/backoffice/dashboard',
  '/backoffice/items',
  '/backoffice/suppliers',
  '/backoffice/lead-time',
  '/backoffice/purchase-orders',
  '/backoffice/supplier-payments',
  '/backoffice/inventory',
  '/backoffice/inventory/stock-opname',
  '/backoffice/inventory/reconciliation',
  '/backoffice/work-orders',
  '/backoffice/sales-orders',
  '/backoffice/fulfillment',
  '/backoffice/forecast',
  '/backoffice/production/planning',
  '/backoffice/production/follow-up',
  '/backoffice/production/colors',
  '/backoffice/production/palette',
  '/backoffice/vendor-returns',
  '/backoffice/reports/hpp',
  '/backoffice/audit-trail',
  '/backoffice/jubelio/admin',
  '/backoffice/jubelio/settings',
  '/backoffice/jubelio/categories',
  '/backoffice/jubelio/migration',
  '/backoffice/jubelio/couriers',
  '/backoffice/settings/documents',
  '/backoffice/settings/item-codes',
  '/backoffice/settings/tax',
  '/backoffice/settings/uom',
  '/backoffice/settings/security',
  // Profile Accounts / legacy RBAC are ADMIN-gated in the page — omit from
  // first-allowed so a non-ADMIN with settings_rbac:view cannot loop
  // /backoffice → settings/rbac → profile-accounts → /backoffice.
];

/**
 * First backoffice route the user is allowed to access, or null
 */
export function getFirstAllowedBackofficeRoute(permissions: string[]): string | null {
  if (!permissions?.length) return null;
  for (const route of BACKOFFICE_ROUTES_ORDER) {
    const perm = ROUTE_PERMISSIONS[route];
    if (perm && hasPermission(permissions, perm)) return route;
  }
  return null;
}

/**
 * Get required permission for a route path
 * Checks exact match first, then prefix match for nested routes
 * @param pathname - URL pathname
 * @returns Permission code or null if no permission required
 */
export function getRequiredPermission(pathname: string): string | null {
  // Exact match first
  if (ROUTE_PERMISSIONS[pathname]) {
    return ROUTE_PERMISSIONS[pathname];
  }

  // Check prefix matches (for nested routes like /backoffice/suppliers/[id])
  const sortedRoutes = Object.keys(ROUTE_PERMISSIONS).sort((a, b) => b.length - a.length);
  for (const route of sortedRoutes) {
    if (pathname.startsWith(route)) {
      return ROUTE_PERMISSIONS[route];
    }
  }

  return null;
}

/**
 * Permission code constants for type safety
 */
export const PERMISSIONS = {
  // Dashboard
  DASHBOARD_VIEW: 'dashboard:view',
  // Suppliers
  SUPPLIERS_VIEW: 'suppliers:view',
  SUPPLIERS_CREATE: 'suppliers:create',
  SUPPLIERS_EDIT: 'suppliers:edit',
  SUPPLIERS_DELETE: 'suppliers:delete',
  SUPPLIERS_APPROVE: 'suppliers:approve',
  // Supplier Types
  SUPPLIER_TYPES_VIEW: 'supplier_types:view',
  SUPPLIER_TYPES_CREATE: 'supplier_types:create',
  SUPPLIER_TYPES_EDIT: 'supplier_types:edit',
  SUPPLIER_TYPES_DELETE: 'supplier_types:delete',
  // Items
  ITEMS_VIEW: 'items:view',
  ITEMS_MANAGE: 'items:manage',
  ITEMS_CREATE: 'items:create',
  ITEMS_EDIT: 'items:edit',
  ITEMS_DELETE: 'items:delete',
  // Sales Orders
  SALES_ORDERS_VIEW: 'sales_orders:view',
  SALES_ORDERS_FULFILL: 'sales_orders:fulfill',
  // Receivables & collections
  RECEIVABLES_VIEW: 'receivables:view',
  RECEIVABLES_MANAGE: 'receivables:manage',
  // Creative marketing — content calendar, KOL briefs, KOL master.
  // Held apart from sales: the people who plan an Instagram post are not the
  // people who approve a field-sales order, and neither should inherit the
  // other's screens just because both touch "marketing".
  CREATIVE_VIEW: 'creative:view',
  CREATIVE_MANAGE: 'creative:manage',
  // Consignment — held separately so a sales-admin or tax-admin role can be
  // given the consignment cycle WITHOUT being handed the receivables archive,
  // which carries photographed store documents.
  CONSIGNMENT_VIEW: 'consignment:view',
  CONSIGNMENT_MANAGE: 'consignment:manage',
  // Field Sales Orders
  FIELD_SALES_ORDERS_VIEW: 'field_sales_orders:view',
  FIELD_SALES_ORDERS_APPROVE: 'field_sales_orders:approve',
  FIELD_SALES_ORDERS_DELIVER: 'field_sales_orders:deliver',
  FIELD_SALES_ORDERS_CREDIT_OVERRIDE: 'field_sales_orders:credit_override',
  // Delivery Shipments
  DELIVERIES_SHIP: 'deliveries:ship',
  DELIVERIES_POD: 'deliveries:pod',
  // Purchase Orders
  PURCHASE_ORDERS_VIEW: 'purchase_orders:view',
  PURCHASE_ORDERS_CREATE: 'purchase_orders:create',
  PURCHASE_ORDERS_EDIT: 'purchase_orders:edit',
  PURCHASE_ORDERS_APPROVE: 'purchase_orders:approve',
  // Supplier Payments
  SUPPLIER_PAYMENTS_VIEW: 'supplier_payments:view',
  SUPPLIER_PAYMENTS_CREATE: 'supplier_payments:create',
  SUPPLIER_PAYMENTS_EDIT: 'supplier_payments:edit',
  // Inventory
  INVENTORY_VIEW: 'inventory:view',
  INVENTORY_MANAGE: 'inventory:manage',
  INVENTORY_OPNAME_VIEW: 'inventory_opname:view',
  INVENTORY_OPNAME_COUNT: 'inventory_opname:count',
  INVENTORY_OPNAME_APPROVE: 'inventory_opname:approve',
  INVENTORY_RECONCILIATION_VIEW: 'inventory_reconciliation:view',
  INVENTORY_RECONCILIATION_MANAGE: 'inventory_reconciliation:manage',
  // Work Orders
  WORK_ORDERS_VIEW: 'work_orders:view',
  WORK_ORDERS_CREATE: 'work_orders:create',
  WORK_ORDERS_MANAGE: 'work_orders:manage',
  // Nota Register
  NOTA_REGISTER_VIEW: 'nota_register:view',
  // Production Colors (Pantone TCX) + palet warna & warna sablon
  PRODUCTION_COLORS_VIEW: 'production_colors:view',
  PRODUCTION_COLORS_MANAGE: 'production_colors:manage',
  // S&OP Forecast
  FORECAST_VIEW: 'forecast:view',
  FORECAST_MANAGE: 'forecast:manage',
  // Production Planning (Plan Kerja)
  PRODUCTION_PLANNING_VIEW: 'production_planning:view',
  PRODUCTION_PLANNING_MANAGE: 'production_planning:manage',
  // Vendor Returns
  VENDOR_RETURNS_VIEW: 'vendor_returns:view',
  VENDOR_RETURNS_CREATE: 'vendor_returns:create',
  VENDOR_RETURNS_MANAGE: 'vendor_returns:manage',
  // Reports
  REPORTS_HPP_VIEW: 'reports_hpp:view',
  // Audit Trail
  AUDIT_TRAIL_VIEW: 'audit_trail:view',
  // Settings
  SETTINGS_DOCUMENTS_VIEW: 'settings_documents:view',
  SETTINGS_DOCUMENTS_MANAGE: 'settings_documents:manage',
  SETTINGS_TAX_VIEW: 'settings_tax:view',
  SETTINGS_TAX_MANAGE: 'settings_tax:manage',
  SETTINGS_UOM_VIEW: 'settings_uom:view',
  SETTINGS_UOM_MANAGE: 'settings_uom:manage',
  SETTINGS_SECURITY_VIEW: 'settings_security:view',
  SETTINGS_SECURITY_MANAGE: 'settings_security:manage',
  SETTINGS_RBAC_VIEW: 'settings_rbac:view',
  SETTINGS_RBAC_MANAGE: 'settings_rbac:manage',
  SETTINGS_PACK_RATIO_VIEW: 'settings_pack_ratio:view',
  SETTINGS_PACK_RATIO_MANAGE: 'settings_pack_ratio:manage',
  // Sales Returns
  SALES_RETURNS_VIEW: 'sales_returns:view',
  SALES_RETURNS_DECIDE: 'sales_returns:decide',
  // Jubelio admin — admin-only. Not granted to non-admin roles; only the
  // wildcard '*' (system/admin role) satisfies it.
  JUBELIO_ADMIN_VIEW: 'jubelio_admin:view',
  // Chart of Accounts
  COA_VIEW: 'coa:view',
  COA_MANAGE: 'coa:manage',
  // Stores (Field Sales — SFA)
  STORES_VIEW: "stores:view",
  STORES_MANAGE: "stores:manage",
  // Promos
  PROMOS_VIEW: "promos:view",
  PROMOS_MANAGE: "promos:manage",
  // Canvassing (Van Stock)
  CANVASSING_MANAGE: "canvassing:manage",
  // SPG Sales (in-store promoter)
  SPG_SALES_RECORD: "spg_sales:record",
  SPG_SALES_VIEW: "spg_sales:view",
  // SPG Commission (rates per item category)
  SPG_COMMISSION_MANAGE: "spg_commission:manage",
  // Request Item (material requests -> PO)
  ITEM_REQUESTS_VIEW: "item_requests:view",
  ITEM_REQUESTS_MANAGE: "item_requests:manage",
  // Vendor billing (vendor invoices against PO items and WO steps)
  VENDOR_BILLS_VIEW: "vendor_bills:view",
  VENDOR_BILLS_MANAGE: "vendor_bills:manage",
  // Finance — Settlements
  SETTLEMENTS_VIEW: "finance:settlements:view",
  SETTLEMENTS_MANAGE: "finance:settlements:manage",
  // Finance — Journal Engine
  JOURNALS_VIEW: "journals:view",
  JOURNALS_MANAGE: "journals:manage",
  // Finance — Financial Reports
  FINANCE_REPORTS_VIEW: "finance_reports:view",
  // Finance — Faktur Pajak
  TAX_INVOICES_VIEW: "tax_invoices:view",
  TAX_INVOICES_MANAGE: "tax_invoices:manage",
  // Lead Time
  LEAD_TIME_VIEW: "lead_time:view",
  LEAD_TIME_MANAGE: "lead_time:manage",
  // Field Returns
  FIELD_RETURNS_MANAGE: "field_returns:manage",
  FIELD_RETURNS_WRITEOFF: "field_returns:writeoff",
  // Finance — AR (Piutang) + Payments
  PAYMENTS_MANAGE: "payments:manage",
  // Finance — Collections
  COLLECTIONS_COLLECT: "collections:collect",
  COLLECTIONS_MANAGE: "collections:manage",
  COLLECTIONS_AMPLOP: "collections:amplop",
  // Finance — Settlements
  SETTLEMENTS_SUBMIT: "settlements:submit",
  // Record Packer
  PACKER_MENU: "packer:menu",
  PACKER_RECORD: "packer:record",
  PACKER_EDIT: "packer:edit",
} as const;
