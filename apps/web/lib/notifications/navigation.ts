/**
 * Maps notification type + data to navigation href for click-to-navigate.
 */
export function getNotificationHref(
  type: string,
  data: Record<string, unknown> | null
): string | null {
  if (!data || typeof data !== 'object') return null;

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
      return '/backoffice/inventory';
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
    case 'STOCK_LOSS_OPEN': {
      const id = typeof data?.lossId === 'string' ? data.lossId : null;
      return id ? `/backoffice/barang-hilang/${encodeURIComponent(id)}` : '/backoffice/barang-hilang';
    }
    default:
      return null;
  }
}
