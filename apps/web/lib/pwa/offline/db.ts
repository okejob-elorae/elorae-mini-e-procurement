import Dexie, { Table } from "dexie";

export interface PendingOrder {
  localId: string;
  storeId: string;
  visitId: string | null;
  note?: string;
  lines: Array<{ itemId: string; variantSku: string; productName: string; qty: number; unitPrice: number }>;
  capturedAt: number;
  syncState: "pending" | "syncing" | "failed";
  error?: string;
  attempts: number;
}

// Separate DB from the backoffice EloraeOfflineDB (different scope: PWA field orders).
// A pendingPhotos table will be added here for EPIC-17-07 (visit photos).
export class PwaOfflineDB extends Dexie {
  pendingOrders!: Table<PendingOrder, string>;
  constructor() {
    super("elorae-pwa-offline");
    this.version(1).stores({ pendingOrders: "localId, syncState, storeId, capturedAt" });
  }
}

export const pwaDb = new PwaOfflineDB();
