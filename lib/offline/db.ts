import Dexie, { Table } from 'dexie';

export interface PendingOperation {
  id?: number;
  type: 'SUPPLIER_CREATE' | 'SUPPLIER_UPDATE' | 'PO_CREATE' | 'GRN_CREATE' | 'WO_CREATE';
  payload: any;
  timestamp: Date;
  retries: number;
  error?: string;
}

export interface CachedSupplier {
  id: string;
  code: string;
  name: string;
  type: string;
  categoryId?: string;
  address?: string;
  phone?: string;
  email?: string;
  bankName?: string;
  bankAccountName?: string;
  isActive: boolean;
  syncAt: Date;
}

export interface CachedItem {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type: string;
  uomId: string;
  uomCode?: string;
  isActive: boolean;
  syncAt: Date;
}

export interface CachedUOM {
  id: string;
  code: string;
  nameId: string;
  nameEn: string;
}

export interface PendingPO {
  localId?: number;
  supplierId: string;
  supplierName?: string;
  etaDate?: Date;
  items: Array<{
    itemId: string;
    itemName?: string;
    sku?: string;
    qty: number;
    price: number;
    uomId: string;
  }>;
  totalAmount: number;
  notes?: string;
  status: 'DRAFT' | 'PENDING_SYNC';
  createdAt: Date;
  syncError?: string;
}

export interface PendingGRN {
  localId?: number;
  poId?: string;
  supplierId: string;
  items: Array<{
    itemId: string;
    sku?: string;
    name?: string;
    qty: number;
    unitCost: number;
    uomId: string;
  }>;
  notes?: string;
  photoBase64?: string[];
  totalAmount: number;
  status: 'PENDING' | 'SYNCING' | 'ERROR';
  errorMsg?: string;
  createdAt: Date;
}

export interface DocumentQueue {
  id?: number;
  docType: string;
  docNumber: string;
  status: 'PENDING' | 'SYNCED' | 'ERROR';
  data: any;
  createdAt: Date;
}

/** Phase 4: material issue created offline, to sync when online */
export interface PendingMaterialIssue {
  localId?: number;
  woId: string;
  issueType: 'FABRIC' | 'ACCESSORIES';
  isPartial: boolean;
  items: Array<{ itemId: string; qty: number; uomId: string }>;
  notes?: string;
  createdAt: Date;
  status: 'PENDING' | 'SYNCED' | 'ERROR';
  errorMsg?: string;
}

/** Phase 4: FG receipt created offline, to sync when online */
export interface PendingFGReceipt {
  localId?: number;
  woId: string;
  qtyReceived: number;
  qtyRejected: number;
  qcNotes?: string;
  createdAt: Date;
  status: 'PENDING' | 'SYNCED' | 'ERROR';
  errorMsg?: string;
}

/** Optional: cache work order header for offline issue/receive forms */
export interface WorkOrderCache {
  id: string;
  docNumber: string;
  status: string;
  finishedGoodId?: string;
  consumptionPlan?: string;
  syncedAt: Date;
}

export class EloraeOfflineDB extends Dexie {
  pendingOperations!: Table<PendingOperation, number>;
  suppliers!: Table<CachedSupplier, string>;
  items!: Table<CachedItem, string>;
  documentQueue!: Table<DocumentQueue, number>;
  uoms!: Table<CachedUOM, string>;
  pendingPOs!: Table<PendingPO, number>;
  pendingGRNs!: Table<PendingGRN, number>;
  pendingIssues!: Table<PendingMaterialIssue, number>;
  pendingReceipts!: Table<PendingFGReceipt, number>;
  workOrderCache!: Table<WorkOrderCache, string>;

  constructor() {
    super('EloraeDB');
    this.version(1).stores({
      pendingOperations: '++id, type, timestamp',
      suppliers: 'id, type, name, syncAt',
      items: 'id, sku, type, syncAt',
      documentQueue: '++id, docType, status',
    });
    // Version 2: add createdAt index for documentQueue (required by orderBy('createdAt') in getSyncStatus)
    this.version(2).stores({
      pendingOperations: '++id, type, timestamp',
      suppliers: 'id, type, name, syncAt',
      items: 'id, sku, type, syncAt',
      documentQueue: '++id, docType, status, createdAt',
    });
    // Version 3: add uoms and pendingPOs stores for Phase 2
    this.version(3).stores({
      pendingOperations: '++id, type, timestamp',
      suppliers: 'id, type, name, syncAt',
      items: 'id, sku, type, syncAt',
      documentQueue: '++id, docType, status, createdAt',
      uoms: 'id, code',
      pendingPOs: '++localId, status, createdAt',
    });
    // Version 4: add pendingGRNs for Phase 3 offline GRN
    this.version(4).stores({
      pendingOperations: '++id, type, timestamp',
      suppliers: 'id, type, name, syncAt',
      items: 'id, sku, type, syncAt',
      documentQueue: '++id, docType, status, createdAt',
      uoms: 'id, code',
      pendingPOs: '++localId, status, createdAt',
      pendingGRNs: '++localId, status, createdAt',
    });
    // Version 5: Phase 4 – pending material issues, FG receipts, work order cache
    this.version(5).stores({
      pendingOperations: '++id, type, timestamp',
      suppliers: 'id, type, name, syncAt',
      items: 'id, sku, type, syncAt',
      documentQueue: '++id, docType, status, createdAt',
      uoms: 'id, code',
      pendingPOs: '++localId, status, createdAt',
      pendingGRNs: '++localId, status, createdAt',
      pendingIssues: '++localId, woId, status, createdAt',
      pendingReceipts: '++localId, woId, status, createdAt',
      workOrderCache: 'id, syncedAt',
    });
  }
}

export const offlineDB = new EloraeOfflineDB();

// Queue operation for sync
export async function queueOperation(
  type: PendingOperation['type'],
  payload: any
): Promise<number> {
  return await offlineDB.pendingOperations.add({
    type,
    payload,
    timestamp: new Date(),
    retries: 0,
  });
}

// Get pending operations
export async function getPendingOperations(): Promise<PendingOperation[]> {
  return await offlineDB.pendingOperations
    .where('retries')
    .below(3)
    .toArray();
}

// Remove completed operation
export async function removeOperation(id: number): Promise<void> {
  await offlineDB.pendingOperations.delete(id);
}

// Update operation error
export async function updateOperationError(
  id: number,
  error: string
): Promise<void> {
  await offlineDB.pendingOperations.update(id, {
    error,
    retries: (await offlineDB.pendingOperations.get(id))?.retries || 0 + 1,
  });
}

// Cache suppliers
export async function cacheSuppliers(suppliers: CachedSupplier[]): Promise<void> {
  await offlineDB.suppliers.bulkPut(
    suppliers.map((s) => ({ ...s, syncAt: new Date() }))
  );
}

// Get cached suppliers
export async function getCachedSuppliers(): Promise<CachedSupplier[]> {
  return await offlineDB.suppliers.toArray();
}

// Cache items
export async function cacheItems(items: CachedItem[]): Promise<void> {
  await offlineDB.items.bulkPut(
    items.map((i) => ({ ...i, syncAt: new Date() }))
  );
}

// Get cached items
export async function getCachedItems(): Promise<CachedItem[]> {
  return await offlineDB.items.toArray();
}

// Cache UOMs
export async function cacheUOMs(uoms: CachedUOM[]): Promise<void> {
  await offlineDB.uoms.bulkPut(uoms);
}

// Get cached UOMs
export async function getCachedUOMs(): Promise<CachedUOM[]> {
  return await offlineDB.uoms.toArray();
}

// Save PO locally (offline)
export async function savePOLocally(po: Omit<PendingPO, 'localId' | 'createdAt'>): Promise<number> {
  return await offlineDB.pendingPOs.add({
    ...po,
    createdAt: new Date(),
  });
}

// Get pending POs
export async function getPendingPOs(): Promise<PendingPO[]> {
  return await offlineDB.pendingPOs
    .where('status')
    .equals('PENDING_SYNC')
    .toArray();
}

// Remove synced PO
export async function removePendingPO(localId: number): Promise<void> {
  await offlineDB.pendingPOs.delete(localId);
}

// Update pending PO error
export async function updatePendingPOError(
  localId: number,
  error: string
): Promise<void> {
  await offlineDB.pendingPOs.update(localId, {
    syncError: error,
  });
}

// Save GRN locally (offline)
export async function savePendingGRN(
  grn: Omit<PendingGRN, 'localId' | 'createdAt'>
): Promise<number> {
  return await offlineDB.pendingGRNs.add({
    ...grn,
    createdAt: new Date(),
  });
}

// Get pending GRNs
export async function getPendingGRNs(): Promise<PendingGRN[]> {
  return await offlineDB.pendingGRNs
    .orderBy('createdAt')
    .toArray();
}

// Remove synced GRN
export async function removePendingGRN(localId: number): Promise<void> {
  await offlineDB.pendingGRNs.delete(localId);
}

// Update pending GRN status
export async function updatePendingGRNStatus(
  localId: number,
  status: PendingGRN['status']
): Promise<void> {
  await offlineDB.pendingGRNs.update(localId, { status });
}

// Update pending GRN error
export async function updatePendingGRNError(
  localId: number,
  errorMsg: string
): Promise<void> {
  await offlineDB.pendingGRNs.update(localId, {
    status: 'ERROR',
    errorMsg,
  });
}

// --- Phase 4: Pending material issues ---

export async function savePendingIssue(
  issue: Omit<PendingMaterialIssue, 'localId' | 'createdAt' | 'status'>
): Promise<number> {
  return await offlineDB.pendingIssues.add({
    ...issue,
    createdAt: new Date(),
    status: 'PENDING',
  });
}

export async function getPendingIssues(woId?: string): Promise<PendingMaterialIssue[]> {
  if (woId) {
    return await offlineDB.pendingIssues.where('woId').equals(woId).toArray();
  }
  return await offlineDB.pendingIssues.orderBy('createdAt').toArray();
}

export async function removePendingIssue(localId: number): Promise<void> {
  await offlineDB.pendingIssues.delete(localId);
}

export async function updatePendingIssueStatus(
  localId: number,
  status: PendingMaterialIssue['status'],
  errorMsg?: string
): Promise<void> {
  await offlineDB.pendingIssues.update(localId, { status, errorMsg });
}

// --- Phase 4: Pending FG receipts ---

export async function savePendingReceipt(
  receipt: Omit<PendingFGReceipt, 'localId' | 'createdAt' | 'status'>
): Promise<number> {
  return await offlineDB.pendingReceipts.add({
    ...receipt,
    createdAt: new Date(),
    status: 'PENDING',
  });
}

export async function getPendingReceipts(woId?: string): Promise<PendingFGReceipt[]> {
  if (woId) {
    return await offlineDB.pendingReceipts.where('woId').equals(woId).toArray();
  }
  return await offlineDB.pendingReceipts.orderBy('createdAt').toArray();
}

export async function removePendingReceipt(localId: number): Promise<void> {
  await offlineDB.pendingReceipts.delete(localId);
}

export async function updatePendingReceiptStatus(
  localId: number,
  status: PendingFGReceipt['status'],
  errorMsg?: string
): Promise<void> {
  await offlineDB.pendingReceipts.update(localId, { status, errorMsg });
}

// --- Phase 4: Work order cache (optional) ---

export async function cacheWorkOrder(wo: WorkOrderCache): Promise<void> {
  await offlineDB.workOrderCache.put({ ...wo, syncedAt: new Date() });
}

export async function getCachedWorkOrder(woId: string): Promise<WorkOrderCache | undefined> {
  return await offlineDB.workOrderCache.get(woId);
}
