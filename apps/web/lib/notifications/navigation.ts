/**
 * Maps notification type + data to navigation href for click-to-navigate.
 */
export function getNotificationHref(
  type: string,
  data: Record<string, unknown> | null,
  context: 'backoffice' | 'pwa' = 'backoffice',
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
    case 'FIELD_RETURN_MISMATCH': {
      const returnId = data.returnId;
      if (typeof returnId === 'string') {
        return `/backoffice/field-returns/${returnId}`;
      }
      return '/backoffice/field-returns';
    }
    case 'AR_OVERDUE': {
      const receivableId = data.receivableId;
      const base = context === 'pwa' ? '/pwa/collections' : '/backoffice/finance/piutang';
      if (typeof receivableId === 'string') {
        return `${base}/${receivableId}`;
      }
      return base;
    }
    case 'SETTLEMENT_REJECTED': {
      const storeId = data.storeId;
      if (typeof storeId === 'string') {
        return `/pwa/pelunasan/${storeId}`;
      }
      return '/pwa/pelunasan';
    }
    case "FIELD_SALES_ORDER_REJECTED": {
      const storeId = data.storeId;
      if (typeof storeId === "string" && storeId !== "") {
        return `/pwa/stores/${storeId}`;
      }
      return "/pwa/stores";
    }
    case "KONSI_COUNT_DUE":
    case "KONSI_COUNT_OVERDUE": {
      if (context === "pwa") return "/pwa/spg/stocktake";
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
    case "PENDING_ORDER_APPROVAL": {
      const orderId = data.orderId;
      if (typeof orderId === "string" && orderId !== "") {
        return `/backoffice/field-sales-orders/${orderId}`;
      }
      return "/backoffice/field-sales-orders";
    }
    case "STORE_CHANGE_REQUEST": {
      const storeId = data.storeId;
      if (typeof storeId === "string" && storeId !== "") {
        return `/backoffice/stores/${storeId}`;
      }
      return "/backoffice/stores";
    }
    case "JOURNAL_PENDING":
      return getJournalPendingHref(data);
    default:
      return null;
  }
}

/**
 * The sales sweep and the sales-return writer both use kind "revenue"/"cogs", so those are told
 * apart by which id key is present, never by kind alone.
 */
function getJournalPendingHref(data: Record<string, unknown>): string {
  const fallback = "/backoffice/finance/journals";
  const str = (key: string): string | null => {
    const value = data[key];
    return typeof value === "string" && value !== "" ? value : null;
  };
  const kind = str("kind");
  const docId = str("docId");
  const orderId = str("orderId");
  const salesReturnId = str("salesReturnId");
  const opnameId = str("opnameId");
  const woId = str("woId");
  const grnId = str("grnId");

  if (salesReturnId && (kind === "revenue" || kind === "cogs")) {
    return `/backoffice/returns/${salesReturnId}`;
  }
  if (orderId && (kind === "revenue" || kind === "cogs")) {
    return `/backoffice/sales-orders/${orderId}`;
  }
  if (opnameId) return `/backoffice/inventory/stock-opname/${opnameId}`;
  if (kind === "fg_receipt" && woId) return `/backoffice/work-orders/${woId}`;
  if ((kind === "receipt" || kind === "reversal") && grnId) return "/backoffice/inventory?tab=grn";
  if (kind === "van_load") {
    const canvasserId = str("canvasserId");
    return canvasserId ? `/backoffice/canvassing/${canvasserId}` : "/backoffice/canvassing";
  }
  if (kind === "field_delivery_revenue" || kind === "field_delivery_cogs") {
    const receivableId = str("receivableId");
    return receivableId ? `/backoffice/finance/piutang/${receivableId}` : "/backoffice/finance/piutang";
  }
  if (!kind || !docId) return fallback;
  if (kind === "supplier_payment" || kind === "supplier_payment_reversal") {
    return `/backoffice/purchase-orders/${docId}`;
  }
  if (kind === "ar_payment" || kind === "ar_payment_void") return `/backoffice/finance/payments/${docId}`;
  if (kind.startsWith("konsi_sell_through_")) return `/backoffice/konsi-sell-through/${docId}`;
  if (kind === "van_sale") return `/backoffice/van-sales/${docId}`;
  if (kind === "van_reconcile") return `/backoffice/canvassing/reconcile/${docId}`;
  return fallback;
}
