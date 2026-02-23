import {
  offlineDB,
  getPendingOperations,
  removeOperation,
  updateOperationError,
  cacheSuppliers,
  cacheItems,
  getPendingPOs,
  removePendingPO,
  updatePendingPOError,
  cacheUOMs,
} from './db';

// Check if online
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

// Sync pending operations
export async function syncPendingOperations(): Promise<{
  success: number;
  failed: number;
}> {
  if (!isOnline()) {
    return { success: 0, failed: 0 };
  }

  const operations = await getPendingOperations();
  let success = 0;
  let failed = 0;

  for (const op of operations) {
    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(op),
      });

      if (response.ok) {
        await removeOperation(op.id!);
        success++;
      } else {
        const error = await response.text();
        await updateOperationError(op.id!, error);
        failed++;
      }
    } catch (error) {
      await updateOperationError(
        op.id!,
        error instanceof Error ? error.message : 'Unknown error'
      );
      failed++;
    }
  }

  return { success, failed };
}

// Sync reference data (suppliers, items, UOMs)
export async function syncReferenceData(): Promise<void> {
  if (!isOnline()) return;

  try {
    // Sync suppliers
    const suppliersResponse = await fetch('/api/suppliers?sync=true');
    if (suppliersResponse.ok) {
      const suppliers = await suppliersResponse.json();
      await cacheSuppliers(
        suppliers.map((s: { typeId: string; type?: { name: string } | null }) => ({
          ...s,
          type: s.type?.name ?? '',
        }))
      );
    }

    // Sync items
    const itemsResponse = await fetch('/api/items?sync=true');
    if (itemsResponse.ok) {
      const items = await itemsResponse.json();
      await cacheItems(items);
    }

    // Sync UOMs
    const uomsResponse = await fetch('/api/uoms?sync=true');
    if (uomsResponse.ok) {
      const uoms = await uomsResponse.json();
      await cacheUOMs(uoms);
    }
  } catch (error) {
    console.error('Failed to sync reference data:', error);
  }
}

// Sync pending POs
export async function syncPendingPOs(): Promise<{
  success: number;
  failed: number;
}> {
  if (!isOnline()) {
    return { success: 0, failed: 0 };
  }

  const pendingPOs = await getPendingPOs();
  let success = 0;
  let failed = 0;

  for (const po of pendingPOs) {
    try {
      const response = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: po.supplierId,
          etaDate: po.etaDate,
          paymentDueDate: po.paymentDueDate,
          notes: po.notes,
          items: po.items,
        }),
      });

      if (response.ok) {
        await removePendingPO(po.localId!);
        success++;
      } else {
        const error = await response.text();
        await updatePendingPOError(po.localId!, error);
        failed++;
      }
    } catch (error) {
      await updatePendingPOError(
        po.localId!,
        error instanceof Error ? error.message : 'Unknown error'
      );
      failed++;
    }
  }

  return { success, failed };
}

// Setup online/offline listeners
export function setupSyncListeners(
  onStatusChange?: (online: boolean) => void
): () => void {
  const handleOnline = () => {
    onStatusChange?.(true);
    syncPendingOperations();
    syncPendingPOs();
    syncReferenceData();
  };

  const handleOffline = () => {
    onStatusChange?.(false);
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}

// Get sync status
export async function getSyncStatus(): Promise<{
  pendingCount: number;
  pendingPOCount: number;
  isOnline: boolean;
  lastSync?: Date;
}> {
  const pendingCount = await offlineDB.pendingOperations.count();
  const pendingPOCount = await offlineDB.pendingPOs
    .where('status')
    .equals('PENDING_SYNC')
    .count();
  const lastDoc = await offlineDB.documentQueue
    .orderBy('createdAt')
    .last();

  return {
    pendingCount,
    pendingPOCount,
    isOnline: isOnline(),
    lastSync: lastDoc?.createdAt,
  };
}
