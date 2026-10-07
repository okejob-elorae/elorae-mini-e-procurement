/**
 * Maps notification type + data to navigation href for click-to-navigate.
 *
 * Murni, tanpa basis data: dipakai komponen klien lonceng. `data` bisa null
 * (baris lama) atau teks JSON (kolom JSON di MariaDB) — keduanya dibaca sebagai
 * objek, supaya jenis yang dikenal tetap membawa ke daftarnya.
 */
export function getNotificationHref(type: string, raw: unknown): string | null {
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
    default:
      return null;
  }
}

const TAUTAN_GRN = '/backoffice/inventory?tab=grn';
const TAUTAN_BUKU_JURNAL = '/backoffice/finance/journals?status=tertunda';

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

/**
 * Dokumen yang jurnalnya gagal, dari metadata penulis `JOURNAL_PENDING` (yang
 * tiba di lonceng sudah diratakan `toFcmData`). Urutan pemeriksaannya sama
 * dengan `sumberNotifikasiJurnal` (`lib/finance/jurnal-tertunda.ts`) — modul itu
 * menarik Prisma jadi tidak bisa diimpor ke sini; `navigation.test.ts` menjaga
 * keduanya tetap sepakat. Tombol "Post journal" ada di halaman yang dituju.
 */
function tautanJurnalTertunda(data: Record<string, unknown>): string {
  const kind = typeof data.kind === 'string' ? data.kind : null;

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
      default:
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
