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
    default:
      return null;
  }
}
