/*
 * Satu-satunya impor, dan modulnya bebas impor nilai: berkas ini ikut dibundel ke service worker
 * HP (`lib/pwa/push-payload.ts`), yang hanya boleh menarik modul relatif tanpa ketergantungan.
 */
import { tautanKabar } from "./tautan-kabar";

/**
 * Every notification type this module routes. Adding a member without a matching `case` below is
 * a type error, because the `default` branch assigns the narrowed type to `never` — and so is
 * leaving it out of `TUJUAN_HP` (`Record<NotificationType, …>`), which decides where the same type
 * opens on the phone. The types stored in `Notification.type` are a plain string column, so the
 * guard narrows an arbitrary string before the switch and an unrecognised one has no destination.
 * Exported for the sweep in `navigation.test.ts`.
 */
export const NOTIFICATION_TYPES = [
  "PO_OVERDUE",
  "WO_OVERDUE",
  "MATERIAL_ARRIVED",
  "WO_COMPLETED",
  "ACCESSORIES_PENDING_CMT",
  "TEST",
  "SUPPLIER_CREATED",
  "SUPPLIER_APPROVED",
  "ITEM_CREATED",
  "PO_CREATED",
  "PO_STATUS_UPDATED",
  "PO_PAYMENT_TOGGLED",
  "GRN_CREATED",
  "STOCK_ADJUSTMENT_CREATED",
  "WO_CREATED",
  "WO_STATUS_UPDATED",
  "WO_MATERIALS_ISSUED",
  "VENDOR_RETURN_CREATED",
  "VENDOR_RETURN_STATUS_UPDATED",
  "DOC_NUMBER_ALTERED",
  "TAX_INVOICE_PENDING",
  "FIELD_RETURN_MISMATCH",
  "AR_OVERDUE",
  "PO_PAYMENT_DUE",
  "SALES_RETURN_RECEIVED",
  "FULFILLMENT_PUSH_STUCK",
  "SETTLEMENT_REJECTED",
  "SETTLEMENT_APPROVED",
  "COLLECTOR_ASSIGNED",
  "FIELD_SALES_ORDER_REJECTED",
  "KONSI_ORDER_PUSHED",
  "KONSI_COUNT_DUE",
  "KONSI_COUNT_OVERDUE",
  "KONSI_REPORT_READY",
  "KONSI_REPORT_HELD",
  "KONSI_REPORT_BLOCKED",
  "PENDING_ORDER_APPROVAL",
  "STORE_CHANGE_REQUEST",
  "JOURNAL_PENDING",
  "CREDIT_LIMIT_HOLD",
  "COLLECTION_PENDING_VERIFICATION",
  "DELIVERY_COMPLETION_STUCK",
  "GIRO_JATUH_TEMPO",
  "KOREKSI_DIMINTA_BKM",
  "KLAIM_DIBATALKAN_SALES",
  "KOREKSI_DIMINTA_RETUR",
  "RETUR_SPG_TANPA_PEMEGANG",
  "RETUR_DIBATALKAN_SALES",
  "STORE_PROPOSAL",
  "EXPENSE_CLAIM_SUBMITTED",
  "EXPENSE_CLAIM_TO_PAY",
  "STORE_EXCHANGE_PROPOSED",
  "STORE_EXCHANGE_TO_COMPLETE",
  "STORE_TRANSFER_PROPOSED",
  "STORE_TRANSFER_DISCREPANCY",
  "STORE_TRANSFER_TO_RECEIVE",
  "STORE_TRANSFER_STALE",
  "LEAVE_REQUEST_SUBMITTED",
  "RINGKASAN_SALES_HARIAN",
  "STORE_RECEIPT_DAMAGED",
  "SPG_SHIFT_SWAP",
  "SPG_STOCK_REQUEST_UNHELD",
  "STOCK_LOSS_OPEN",
  "JOURNAL_APPROVAL",
  "PELUNASAN_TERVERIFIKASI",
  "PELUNASAN_DITOLAK",
  "PELUNASAN_DIBATALKAN",
  "GIRO_CAIR",
  "GIRO_DITOLAK",
  "RETUR_DIHITUNG",
  "RETUR_DIPINDAH_TOKO",
  "RETUR_DIBATALKAN",
  "RETUR_DIBEBANKAN",
  "PESANAN_DISETUJUI",
  "PESANAN_DITOLAK",
  "PESANAN_DIKIRIM",
  "PESANAN_DITUTUP",
  "PESANAN_PORTAL",
  "RETUR_PEMBELI_MENUNGGU",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

function isNotificationType(type: string): type is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/**
 * Maps notification type + data to navigation href for click-to-navigate.
 *
 * Murni, tanpa basis data: dipakai komponen klien lonceng. `data` bisa null
 * (baris lama) atau teks JSON (kolom JSON di MariaDB) — keduanya dibaca sebagai
 * objek, supaya jenis yang dikenal tetap membawa ke daftarnya.
 *
 * `context: "pwa"` (layar Kabar, ketukan pemberitahuan HP, kapsul kabar baru)
 * dijawab `tujuanDiHp`: selalu alamat `/pwa/…` atau `null`, tidak pernah
 * halaman kantor.
 */
export function getNotificationHref(
  type: string,
  raw: unknown,
  context: "backoffice" | "pwa" = "backoffice",
): string | null {
  if (context === "pwa") return tujuanDiHp(type, raw);
  if (!isNotificationType(type)) return null;
  const data = bacaData(raw);

  switch (type) {
    case 'PO_OVERDUE': {
      const poId = data.poId;
      if (typeof poId === 'string') {
        return `/backoffice/purchase-orders/${poId}`;
      }
      return '/backoffice/purchase-orders';
    }
    case 'WO_OVERDUE':
    case 'MATERIAL_ARRIVED': {
      const woId = data.woId;
      if (typeof woId === 'string') {
        return `/backoffice/work-orders/${woId}`;
      }
      return '/backoffice/work-orders';
    }
    case 'WO_COMPLETED': {
      const woId = data.woId;
      if (typeof woId === 'string') {
        return `/backoffice/work-orders/${woId}`;
      }
      return '/backoffice/work-orders';
    }
    case 'ACCESSORIES_PENDING_CMT': {
      const woIds = data.woIds;
      if (Array.isArray(woIds) && woIds.length > 0 && typeof woIds[0] === 'string') {
        return `/backoffice/work-orders/${woIds[0]}`;
      }
      return '/backoffice/work-orders';
    }
    case 'TEST': {
      const href = data.href;
      if (typeof href === 'string' && href.startsWith('/')) {
        return href;
      }
      return '/backoffice/dashboard';
    }
    case 'SUPPLIER_CREATED':
    case 'SUPPLIER_APPROVED': {
      const supplierId = data.supplierId;
      if (typeof supplierId === 'string') {
        return `/backoffice/suppliers/${supplierId}`;
      }
      return '/backoffice/suppliers';
    }
    case 'ITEM_CREATED': {
      const itemId = data.itemId;
      if (typeof itemId === 'string') {
        return `/backoffice/items/${itemId}`;
      }
      return '/backoffice/items';
    }
    case 'PO_CREATED':
    case 'PO_STATUS_UPDATED':
    case 'PO_PAYMENT_TOGGLED': {
      const poId = data.poId;
      if (typeof poId === 'string') {
        return `/backoffice/purchase-orders/${poId}`;
      }
      return '/backoffice/purchase-orders';
    }
    case 'GRN_CREATED':
      // Daftar GRN ada di tab-nya sendiri; tanpa `tab` halaman membuka tab stok.
      return TAUTAN_GRN;
    case 'STOCK_ADJUSTMENT_CREATED': {
      const adjustmentId = data.adjustmentId;
      if (typeof adjustmentId === 'string') {
        return `/backoffice/inventory/adjustment/${adjustmentId}`;
      }
      return '/backoffice/inventory';
    }
    case 'WO_CREATED':
    case 'WO_STATUS_UPDATED':
    case 'WO_MATERIALS_ISSUED': {
      const woId = data.woId;
      if (typeof woId === 'string') {
        return `/backoffice/work-orders/${woId}`;
      }
      return '/backoffice/work-orders';
    }
    case 'VENDOR_RETURN_CREATED':
    case 'VENDOR_RETURN_STATUS_UPDATED': {
      const vendorReturnId = data.vendorReturnId;
      if (typeof vendorReturnId === 'string') {
        return `/backoffice/vendor-returns/${vendorReturnId}`;
      }
      return '/backoffice/vendor-returns';
    }
    case 'DOC_NUMBER_ALTERED':
      return '/backoffice/settings/documents';
    case 'TAX_INVOICE_PENDING': {
      return '/backoffice/finance/faktur-pajak';
    }
    case 'FIELD_RETURN_MISMATCH': {
      const returnId = data.returnId;
      if (typeof returnId === 'string') {
        return `/backoffice/field-returns/${returnId}`;
      }
      return '/backoffice/field-returns';
    }
    case 'AR_OVERDUE': {
      const receivableId = data.receivableId;
      if (typeof receivableId === 'string') {
        return `/backoffice/finance/piutang/${receivableId}`;
      }
      return '/backoffice/finance/piutang';
    }
    case "PO_PAYMENT_DUE": {
      const poId = data.poId;
      if (typeof poId === "string" && poId !== "") {
        return `/backoffice/purchase-orders/${poId}`;
      }
      return "/backoffice/purchase-orders";
    }
    case "SALES_RETURN_RECEIVED": {
      const salesReturnId = data.salesReturnId;
      if (typeof salesReturnId === "string" && salesReturnId !== "") {
        return `/backoffice/returns/${salesReturnId}`;
      }
      return "/backoffice/returns";
    }
    case 'FULFILLMENT_PUSH_STUCK': {
      const salesOrderId = data.salesOrderId;
      if (typeof salesOrderId === 'string') {
        return `/backoffice/sales-orders/${salesOrderId}`;
      }
      return '/backoffice/sales-orders';
    }
    case 'SETTLEMENT_REJECTED':
    case 'SETTLEMENT_APPROVED': {
      const storeId = data.storeId;
      if (typeof storeId === 'string') {
        return `/pwa/pelunasan/${storeId}`;
      }
      return '/pwa/pelunasan';
    }
    case "COLLECTOR_ASSIGNED": {
      const receivableId = data.receivableId;
      if (typeof receivableId === "string" && receivableId !== "") {
        return `/pwa/collections/${receivableId}`;
      }
      return "/pwa/collections";
    }
    case "FIELD_SALES_ORDER_REJECTED":
    case "KONSI_ORDER_PUSHED": {
      const storeId = data.storeId;
      if (typeof storeId === "string" && storeId !== "") {
        return `/pwa/stores/${storeId}`;
      }
      return "/pwa/stores";
    }
    case "KONSI_COUNT_DUE":
    case "KONSI_COUNT_OVERDUE": {
      const stocktakeId = data.stocktakeId;
      if (typeof stocktakeId === "string" && stocktakeId !== "") {
        return `/backoffice/store-stocktakes/${stocktakeId}`;
      }
      const storeId = data.storeId;
      if (typeof storeId === "string" && storeId !== "") {
        return `/backoffice/stores/${storeId}`;
      }
      return "/backoffice/store-stocktakes";
    }
    case "KONSI_REPORT_READY":
    case "KONSI_REPORT_HELD": {
      const sellThroughId = data.sellThroughId;
      if (typeof sellThroughId === "string" && sellThroughId !== "") {
        return `/backoffice/konsi-sell-through/${sellThroughId}`;
      }
      return "/backoffice/konsi-sell-through";
    }
    case "KONSI_REPORT_BLOCKED": {
      const stocktakeId = data.stocktakeId;
      if (typeof stocktakeId === "string" && stocktakeId !== "") {
        return `/backoffice/store-stocktakes/${stocktakeId}`;
      }
      return "/backoffice/store-stocktakes";
    }
    case 'GIRO_JATUH_TEMPO':
      return '/backoffice/pelunasan/giro';
    case 'KOREKSI_DIMINTA_BKM':
    case 'KLAIM_DIBATALKAN_SALES': {
      const id = typeof data?.paymentClaimId === 'string' ? data.paymentClaimId : null;
      return id ? `/backoffice/pelunasan/${id}` : '/backoffice/pelunasan';
    }
    case 'KOREKSI_DIMINTA_RETUR':
    case 'RETUR_SPG_TANPA_PEMEGANG':
    case 'RETUR_DIBATALKAN_SALES': {
      const id = typeof data?.storeReturnId === 'string' ? data.storeReturnId : null;
      return id ? `/backoffice/retur-toko/${id}` : '/backoffice/retur-toko';
    }
    case 'STORE_PROPOSAL': {
      const id = typeof data?.storeProposalId === 'string' ? data.storeProposalId : null;
      return id ? `/backoffice/stores/usulan/${id}` : '/backoffice/stores/usulan';
    }
    case 'EXPENSE_CLAIM_SUBMITTED':
    case 'EXPENSE_CLAIM_TO_PAY': {
      const id = typeof data?.claimId === 'string' ? data.claimId : null;
      return id ? `/backoffice/biaya-perjalanan/${id}` : '/backoffice/biaya-perjalanan';
    }
    case 'STORE_EXCHANGE_PROPOSED':
    case 'STORE_EXCHANGE_TO_COMPLETE': {
      const id = typeof data?.exchangeId === 'string' ? data.exchangeId : null;
      return id ? `/backoffice/tukar-barang/${id}` : '/backoffice/tukar-barang';
    }
    case 'STORE_TRANSFER_PROPOSED':
    case 'STORE_TRANSFER_DISCREPANCY':
    case 'STORE_TRANSFER_TO_RECEIVE':
    case 'STORE_TRANSFER_STALE': {
      const id = typeof data?.transferId === 'string' ? data.transferId : null;
      return id ? `/backoffice/spg-transfers/${id}` : '/backoffice/spg-transfers';
    }
    case 'LEAVE_REQUEST_SUBMITTED': {
      const id = typeof data?.leaveRequestId === 'string' ? data.leaveRequestId : null;
      return id ? `/backoffice/izin?id=${encodeURIComponent(id)}` : '/backoffice/izin';
    }
    case 'RINGKASAN_SALES_HARIAN': {
      // Tautan ke hari yang diringkas, dibuat penulisnya. Hanya alamat backoffice yang dipercaya.
      const href = typeof data?.href === 'string' && data.href.startsWith('/backoffice/') ? data.href : null;
      return href ?? '/backoffice/sales-lapangan';
    }
    case 'STORE_RECEIPT_DAMAGED':
      return '/backoffice/spg-kiriman-rusak';
    case 'SPG_SHIFT_SWAP':
      return '/backoffice/jadwal-spg?tab=tukar';
    case 'SPG_STOCK_REQUEST_UNHELD':
      // Saringan "toko tanpa pemegang" — daftarnya tidak punya halaman per permintaan.
      return '/backoffice/spg-requests?pemegang=tanpa';
    case 'STOCK_LOSS_OPEN': {
      const id = typeof data?.lossId === 'string' ? data.lossId : null;
      return id ? `/backoffice/barang-hilang/${encodeURIComponent(id)}` : '/backoffice/barang-hilang';
    }
    case "RETUR_PEMBELI_MENUNGGU": {
      // Laporan retur pembeli SPG yang menunggu disetujui; tanpa id → tab "Menunggu" daftarnya.
      const id = idAman(data, "returnId");
      return id ? `/backoffice/retur-spg/${id}` : "/backoffice/retur-spg?status=MENUNGGU";
    }
    case 'PENDING_ORDER_APPROVAL': {
      const id = idAman(data, 'orderId');
      return id ? `/backoffice/field-sales-orders/${id}` : '/backoffice/field-sales-orders';
    }
    case 'STORE_CHANGE_REQUEST': {
      // Kartu tinjauan perubahan ada di rincian toko, bukan halaman sendiri.
      const id = idAman(data, 'storeId');
      return id ? `/backoffice/stores/${id}` : '/backoffice/stores';
    }
    case 'JOURNAL_PENDING':
      return tautanJurnalTertunda(data);
    case 'JOURNAL_APPROVAL': {
      // Jurnal manual (atau pembalik) / templat jurnal berulang yang menunggu persetujuan orang lain.
      const templat = idAman(data, 'templatId');
      if (templat) return `/backoffice/finance/jurnal-berulang/${templat}`;
      const id = idAman(data, 'journalId');
      return id ? `/backoffice/finance/journals/${id}` : '/backoffice/finance/journals?status=draf';
    }

    /*
     * Kabar (`kabariPengguna`) yang sampai ke lonceng KANTOR: BKM/NRT yang dicatat
     * dari kantor menjadikan pencatatnya pelapor, jadi keputusannya kembali ke
     * orang kantor itu. Tautan HP-nya (`tautanKabar`) tidak berguna di sini.
     * Kabar khusus HP (jadwal, SPG, ringkasan) sengaja tetap null.
     */
    case 'PELUNASAN_TERVERIFIKASI':
    case 'PELUNASAN_DITOLAK':
    case 'PELUNASAN_DIBATALKAN':
    case 'GIRO_CAIR':
    case 'GIRO_DITOLAK': {
      const id = idAman(data, 'claimId');
      return id ? `/backoffice/pelunasan/${id}` : '/backoffice/pelunasan';
    }
    case 'RETUR_DIHITUNG':
    case 'RETUR_DIPINDAH_TOKO':
    case 'RETUR_DIBATALKAN': {
      const id = idAman(data, 'returnId');
      return id ? `/backoffice/retur-toko/${id}` : '/backoffice/retur-toko';
    }
    case 'RETUR_DIBEBANKAN': {
      // Beban tanpa nota retur (selisih lain) hanya punya daftar bebannya.
      const id = idAman(data, 'returnId');
      return id ? `/backoffice/retur-toko/${id}` : '/backoffice/beban-selisih';
    }
    case 'PESANAN_DISETUJUI':
    case 'PESANAN_DITOLAK':
    case 'PESANAN_DIKIRIM':
    case 'PESANAN_DITUTUP':
    case 'PESANAN_PORTAL': {
      const id = idAman(data, 'orderId');
      return id ? `/backoffice/field-sales-orders/${id}` : '/backoffice/field-sales-orders';
    }
    case "CREDIT_LIMIT_HOLD":
    case "COLLECTION_PENDING_VERIFICATION":
    case "DELIVERY_COMPLETION_STUCK":
      return null;
    default: {
      const unrouted: never = type;
      return unrouted;
    }
  }
}

const TAUTAN_GRN = '/backoffice/inventory?tab=grn';
const TAUTAN_BUKU_JURNAL = '/backoffice/finance/journals?status=tertunda';
const TAUTAN_REKONSILIASI_PIUTANG = '/backoffice/finance/rekonsiliasi-piutang#tertunda';
const TAUTAN_REKONSILIASI_PERSEDIAAN = '/backoffice/finance/rekonsiliasi-persediaan#tertunda';

/** `data` notifikasi sebagai objek — juga dipakai teks lonceng (`tampilan-lonceng.ts`). */
export function bacaDataNotifikasi(raw: unknown): Record<string, unknown> {
  return bacaData(raw);
}

function bacaData(raw: unknown): Record<string, unknown> {
  let nilai = raw;
  if (typeof nilai === 'string') {
    try {
      nilai = JSON.parse(nilai);
    } catch {
      return {};
    }
  }
  return nilai !== null && typeof nilai === 'object' && !Array.isArray(nilai)
    ? (nilai as Record<string, unknown>)
    : {};
}

/** Id dari `data` siap ditempel ke alamat — hanya teks tak kosong, di-encode. */
function idAman(data: Record<string, unknown>, kunci: string): string | null {
  const v = data[kunci];
  return typeof v === 'string' && v.trim() !== '' ? encodeURIComponent(v.trim()) : null;
}

// ─── Tujuan di HP (salesman, SPG, pengantar) ────────────────────────────────

type TujuanHp = (data: Record<string, unknown>) => string | null;

/**
 * Pekerjaan kantor yang tidak punya layar di HP. Akun lapangan dipentalkan dari
 * backoffice, jadi ketukannya cukup menandai dibaca — lebih jujur daripada
 * membuka halaman yang menolaknya.
 */
const DI_KANTOR: TujuanHp = () => null;

/**
 * Kabar Max yang juga punya tujuan kantor di atas (pencatat BKM/NRT dari kantor).
 * Di HP sudah dijawab `tautanKabar` sebelum peta ini dibaca.
 */
const LEWAT_TAUTAN_KABAR: TujuanHp = () => null;

/** Pesanan lapangan milik salesman penerimanya → layar pesanannya; tanpa id → tokonya → daftar pesanan. */
const pesananSaya: TujuanHp = (d) => {
  const pesanan = idAman(d, "orderId");
  if (pesanan) return `/pwa/orders/${pesanan}`;
  const toko = idAman(d, "storeId");
  return toko ? `/pwa/stores/${toko}` : "/pwa/orders";
};

const TUJUAN_HP: Record<NotificationType, TujuanHp> = {
  /* Retur lapangan tidak punya halaman rincian di HP: ke toko tempat salesman menaikkannya. */
  FIELD_RETURN_MISMATCH: (d) => {
    const toko = idAman(d, "storeId");
    return toko ? `/pwa/stores/${toko}` : null;
  },
  /*
   * Kabar jatuh tempo yang membawa `storeId` dikirim ke pemegang toko (aturan Max): buka tagihan
   * toko itu. Tanpa `storeId` ia kiriman ke penagih yang ditunjuk di Penagihan: buka tagihannya.
   */
  AR_OVERDUE: (d) => {
    const toko = idAman(d, "storeId");
    if (toko) return `/pwa/piutang/${toko}`;
    const piutang = idAman(d, "receivableId");
    return piutang ? `/pwa/collections/${piutang}` : "/pwa/piutang";
  },
  COLLECTOR_ASSIGNED: (d) => {
    const piutang = idAman(d, "receivableId");
    return piutang ? `/pwa/collections/${piutang}` : "/pwa/collections";
  },
  SETTLEMENT_REJECTED: (d) => {
    const toko = idAman(d, "storeId");
    return toko ? `/pwa/pelunasan/${toko}` : "/pwa/pelunasan";
  },
  SETTLEMENT_APPROVED: (d) => {
    const toko = idAman(d, "storeId");
    return toko ? `/pwa/pelunasan/${toko}` : "/pwa/pelunasan";
  },
  FIELD_SALES_ORDER_REJECTED: pesananSaya,
  // Layar pesanan HP tidak pernah menampilkan harga konsinyasi (`nilaiTampil`).
  KONSI_ORDER_PUSHED: pesananSaya,
  // SPG toko konsi: layar hitung stok tokonya.
  KONSI_COUNT_DUE: () => "/pwa/spg/stocktake",
  KONSI_COUNT_OVERDUE: () => "/pwa/spg/stocktake",
  // Kirim uji hanya membawa ke alamat HP; alamat kantor bawaannya diabaikan.
  TEST: (d) => (typeof d.href === "string" && d.href.startsWith("/pwa") ? d.href : null),

  PELUNASAN_TERVERIFIKASI: LEWAT_TAUTAN_KABAR,
  PELUNASAN_DITOLAK: LEWAT_TAUTAN_KABAR,
  PELUNASAN_DIBATALKAN: LEWAT_TAUTAN_KABAR,
  GIRO_CAIR: LEWAT_TAUTAN_KABAR,
  GIRO_DITOLAK: LEWAT_TAUTAN_KABAR,
  RETUR_DIHITUNG: LEWAT_TAUTAN_KABAR,
  RETUR_DIPINDAH_TOKO: LEWAT_TAUTAN_KABAR,
  RETUR_DIBATALKAN: LEWAT_TAUTAN_KABAR,
  RETUR_DIBEBANKAN: LEWAT_TAUTAN_KABAR,
  PESANAN_DISETUJUI: LEWAT_TAUTAN_KABAR,
  PESANAN_DITOLAK: LEWAT_TAUTAN_KABAR,
  PESANAN_DIKIRIM: LEWAT_TAUTAN_KABAR,
  PESANAN_DITUTUP: LEWAT_TAUTAN_KABAR,
  PESANAN_PORTAL: LEWAT_TAUTAN_KABAR,

  PO_OVERDUE: DI_KANTOR,
  WO_OVERDUE: DI_KANTOR,
  MATERIAL_ARRIVED: DI_KANTOR,
  WO_COMPLETED: DI_KANTOR,
  ACCESSORIES_PENDING_CMT: DI_KANTOR,
  SUPPLIER_CREATED: DI_KANTOR,
  SUPPLIER_APPROVED: DI_KANTOR,
  ITEM_CREATED: DI_KANTOR,
  PO_CREATED: DI_KANTOR,
  PO_STATUS_UPDATED: DI_KANTOR,
  PO_PAYMENT_TOGGLED: DI_KANTOR,
  GRN_CREATED: DI_KANTOR,
  STOCK_ADJUSTMENT_CREATED: DI_KANTOR,
  WO_CREATED: DI_KANTOR,
  WO_STATUS_UPDATED: DI_KANTOR,
  WO_MATERIALS_ISSUED: DI_KANTOR,
  VENDOR_RETURN_CREATED: DI_KANTOR,
  VENDOR_RETURN_STATUS_UPDATED: DI_KANTOR,
  DOC_NUMBER_ALTERED: DI_KANTOR,
  TAX_INVOICE_PENDING: DI_KANTOR,
  PO_PAYMENT_DUE: DI_KANTOR,
  SALES_RETURN_RECEIVED: DI_KANTOR,
  FULFILLMENT_PUSH_STUCK: DI_KANTOR,
  KONSI_REPORT_READY: DI_KANTOR,
  KONSI_REPORT_HELD: DI_KANTOR,
  KONSI_REPORT_BLOCKED: DI_KANTOR,
  PENDING_ORDER_APPROVAL: DI_KANTOR,
  STORE_CHANGE_REQUEST: DI_KANTOR,
  JOURNAL_PENDING: DI_KANTOR,
  JOURNAL_APPROVAL: DI_KANTOR,
  CREDIT_LIMIT_HOLD: DI_KANTOR,
  COLLECTION_PENDING_VERIFICATION: DI_KANTOR,
  DELIVERY_COMPLETION_STUCK: DI_KANTOR,
  GIRO_JATUH_TEMPO: DI_KANTOR,
  KOREKSI_DIMINTA_BKM: DI_KANTOR,
  KLAIM_DIBATALKAN_SALES: DI_KANTOR,
  KOREKSI_DIMINTA_RETUR: DI_KANTOR,
  RETUR_SPG_TANPA_PEMEGANG: DI_KANTOR,
  RETUR_DIBATALKAN_SALES: DI_KANTOR,
  STORE_PROPOSAL: DI_KANTOR,
  EXPENSE_CLAIM_SUBMITTED: DI_KANTOR,
  EXPENSE_CLAIM_TO_PAY: DI_KANTOR,
  STORE_EXCHANGE_PROPOSED: DI_KANTOR,
  STORE_EXCHANGE_TO_COMPLETE: DI_KANTOR,
  STORE_TRANSFER_PROPOSED: DI_KANTOR,
  STORE_TRANSFER_DISCREPANCY: DI_KANTOR,
  STORE_TRANSFER_TO_RECEIVE: DI_KANTOR,
  STORE_TRANSFER_STALE: DI_KANTOR,
  LEAVE_REQUEST_SUBMITTED: DI_KANTOR,
  RINGKASAN_SALES_HARIAN: DI_KANTOR,
  STORE_RECEIPT_DAMAGED: DI_KANTOR,
  SPG_SHIFT_SWAP: DI_KANTOR,
  SPG_STOCK_REQUEST_UNHELD: DI_KANTOR,
  STOCK_LOSS_OPEN: DI_KANTOR,
  RETUR_PEMBELI_MENUNGGU: DI_KANTOR,
};

/**
 * Hanya layar HP yang lolos: `/pwa` atau di bawahnya, tidak pernah `//host`, dan
 * tidak pernah Kabar sendiri (atau Notifikasi lama, yang dialihkan ke Kabar) —
 * ketukan di Kabar yang membuka Kabar tidak membawa ke mana pun.
 */
function hanyaLayarHp(href: string | null): string | null {
  if (href === null || !/^\/pwa(?:[/?#]|$)/.test(href)) return null;
  if (/^\/pwa\/(?:kabar|notifications)(?:[/?#]|$)/.test(href)) return null;
  return href;
}

/**
 * Tujuan sebuah notifikasi di HP. Kabar Max (`tautanKabar`) didahulukan, lalu
 * jenis tim lewat `TUJUAN_HP`; jenis yang tidak dikenal keduanya → `null`.
 */
function tujuanDiHp(type: string, raw: unknown): string | null {
  const data = bacaData(raw);
  const kabar = hanyaLayarHp(tautanKabar(type, data));
  if (kabar) return kabar;
  if (!isNotificationType(type)) return null;
  const tujuan = TUJUAN_HP[type];
  return tujuan ? hanyaLayarHp(tujuan(data)) : null;
}

/**
 * Dokumen yang jurnalnya gagal, dari metadata penulis `JOURNAL_PENDING` (yang
 * tiba di lonceng sudah diratakan `toFcmData`). Urutan pemeriksaannya sama
 * dengan `sumberNotifikasiJurnal` (`lib/finance/jurnal-tertunda.ts`) — modul itu
 * menarik Prisma jadi tidak bisa diimpor ke sini; `navigation.test.ts` menjaga
 * keduanya tetap sepakat. Tombol "Post journal" ada di halaman yang dituju.
 */
function tautanJurnalTertunda(data: Record<string, unknown>): string {
  const kind = typeof data.kind === 'string' ? data.kind : null;

  if (kind === 'field_delivery_revenue' || kind === 'field_delivery_cogs') {
    const piutang = idAman(data, 'receivableId');
    return piutang ? `/backoffice/finance/piutang/${piutang}` : '/backoffice/finance/piutang';
  }

  const docId = idAman(data, 'docId');
  if (docId && kind) {
    switch (kind) {
      case 'van_sale':
        return `/backoffice/van-sales/${docId}`;
      case 'van_reconcile':
        return `/backoffice/canvassing/reconcile/${docId}`;
      case 'van_load': {
        // Muatan van tidak punya halaman sendiri: riwayatnya ada di halaman van
        // kanvasernya. `canvasserId` dilengkapi GET /api/notifications.
        const kanvaser = idAman(data, 'canvasserId');
        return kanvaser ? `/backoffice/canvassing/${kanvaser}` : '/backoffice/canvassing';
      }
      case 'supplier_payment':
      case 'supplier_payment_reversal':
        return `/backoffice/purchase-orders/${docId}`;
      case 'ar_payment':
      case 'ar_payment_void':
        return `/backoffice/finance/payments/${docId}`;
      case 'kol_kolaborasi':
        return `/backoffice/kreatif/kolaborasi/${docId}?tab=pembayaran`;
      case 'kol_sampel': {
        // Pengiriman sampel tampil di kolaborasinya; tombol posting ulang ada di tab Pembayaran.
        const kolaborasi = idAman(data, 'collabId');
        return kolaborasi ? `/backoffice/kreatif/kolaborasi/${kolaborasi}?tab=pembayaran` : '/backoffice/kreatif/sampel';
      }
      // Jurnal penjualan lapangan & piutang toko: posting ulangnya di layar rekonsiliasi piutang.
      case 'nota_putus':
      case 'bkm_lapangan':
      case 'retur_toko':
      case 'tukar_barang':
      case 'faktur_piutang':
        return TAUTAN_REKONSILIASI_PIUTANG;
      // Jurnal operasional (konsinyasi, komisi, barang hilang, gudang rusak, stok manual,
      // retur pemasok, biaya perjalanan): posting ulangnya di layar rekonsiliasi persediaan.
      // Daftarnya = nilai `JENIS_TERTUNDA_OPERASIONAL` (lib/finance/operasional/aturan.ts) —
      // tidak bisa diimpor ke sini (service worker); navigation.test.ts menyapu seluruhnya.
      case 'konsi_kirim':
      case 'konsi_pesanan':
      case 'konsi_pindah':
      case 'konsi_retur':
      case 'konsi_retur_lapangan':
      case 'konsi_siklus':
      case 'konsi_komisi':
      case 'konsi_gaji_bayar':
      case 'konsi_bayar_toko':
      case 'komisi_spg':
      case 'komisi_spg_bayar':
      case 'barang_hilang':
      case 'potong_sales':
      case 'gudang_rusak':
      case 'stok_manual':
      case 'retur_pemasok':
      case 'biaya_perjalanan':
      case 'biaya_perjalanan_bayar':
        return TAUTAN_REKONSILIASI_PERSEDIAAN;
      // Penyusutan aset (`<aset>/<YYYY-MM>`) dan jurnal berulang (`<templat>/<YYYY-MM>`):
      // posting ulangnya di halaman aset / templatnya.
      case 'penyusutan':
      case 'jurnal_berulang': {
        const induk = String(data.docId).trim().split('/')[0];
        const dasar = kind === 'penyusutan' ? '/backoffice/finance/aset-tetap' : '/backoffice/finance/jurnal-berulang';
        return induk ? `${dasar}/${encodeURIComponent(induk)}` : dasar;
      }
      default:
        if (kind.startsWith('konsi_sell_through_')) return `/backoffice/konsi-sell-through/${docId}`;
        return TAUTAN_BUKU_JURNAL;
    }
  }

  if (idAman(data, 'grnId')) return TAUTAN_GRN;

  if (idAman(data, 'receiptId')) {
    // Penerimaan barang jadi dicatat dan dijurnal ulang dari SPK-nya.
    const wo = idAman(data, 'woId');
    return wo ? `/backoffice/work-orders/${wo}` : '/backoffice/work-orders';
  }

  const opname = idAman(data, 'opnameId');
  if (opname) return `/backoffice/inventory/stock-opname/${opname}`;

  const retur = idAman(data, 'salesReturnId');
  if (retur) return `/backoffice/returns/${retur}`;

  const pesanan = idAman(data, 'orderId');
  if (pesanan) return `/backoffice/sales-orders/${pesanan}`;

  return TAUTAN_BUKU_JURNAL;
}
