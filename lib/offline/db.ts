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
  isActive: boolean;
  syncAt: Date;
}

export interface DocumentQueue {
  id?: number;
  docType: string;
  docNumber: string;
  status: 'PENDING' | 'SYNCED' | 'ERROR';
  data: any;
  createdAt: Date;
}

export class EloraeOfflineDB extends Dexie {
  pendingOperations!: Table<PendingOperation, number>;
  suppliers!: Table<CachedSupplier, string>;
  items!: Table<CachedItem, string>;
  documentQueue!: Table<DocumentQueue, number>;

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
