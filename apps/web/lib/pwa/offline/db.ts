import Dexie, { Table } from "dexie";

export interface PendingOrder {
  localId: string;
  storeId: string;
  storeName: string;
  visitId: string | null;
  note?: string;
  lines: Array<{ itemId: string; variantSku: string; productName: string; qty: number; unitPrice: number }>;
  capturedAt: number;
  syncState: "pending" | "syncing" | "failed";
  error?: string;
  attempts: number;
}

export interface PendingPhoto {
  localId: string;
  visitId: string;
  storeId: string;
  blob: Blob;
  caption?: string;
  capturedAt: number;
  syncState: "pending" | "syncing" | "failed";
  error?: string;
  attempts: number;
}

// Separate DB from the backoffice EloraeOfflineDB (different scope: PWA field orders).
// A pendingPhotos table will be added here for EPIC-17-07 (visit photos).
export class PwaOfflineDB extends Dexie {
  pendingOrders!: Table<PendingOrder, string>;
  pendingPhotos!: Table<PendingPhoto, string>;
  constructor() {
    super("elorae-pwa-offline");
    this.version(1).stores({ pendingOrders: "localId, syncState, storeId, capturedAt" });
    this.version(2).stores({
      pendingOrders: "localId, syncState, storeId, capturedAt",
      pendingPhotos: "localId, syncState, visitId, capturedAt",
    });
  }
}

export const pwaDb = new PwaOfflineDB();
