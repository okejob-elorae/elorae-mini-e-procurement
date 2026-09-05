import Dexie, { Table } from "dexie";

export interface PendingOrder {
  localId: string;
  storeId: string;
  storeName: string;
  visitId: string | null;
  note?: string;
  lines: Array<{
    itemId: string;
    variantSku: string;
    productName: string;
    qty: number;
    unitPrice: number;
    requestedUnitPrice?: number | null;
    appealReason?: string | null;
  }>;
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

export interface PendingCompletion {
  shipmentId: string; // primary key — one queued completion per shipment, matching the 1:1 reality
  storeName: string;
  docNo: string;
  goodsPhotoBlob: Blob;
  notaPhotoBlob: Blob;
  signedByName: string;
  gpsLat: number;
  gpsLng: number;
  lines: Array<{ shipmentLineId: string; deliveredQty: number }>;
  capturedAt: number; // Date.now() at the moment the salesman finished the form
  syncState: "pending" | "syncing" | "failed";
  error?: string;
  attempts: number;
  notified?: boolean; // whether the admin rescue notification for a "failed" row is confirmed delivered
}

// Separate DB from the backoffice EloraeOfflineDB (different scope: PWA field orders).
// A pendingPhotos table will be added here for EPIC-17-07 (visit photos).
export class PwaOfflineDB extends Dexie {
  pendingOrders!: Table<PendingOrder, string>;
  pendingPhotos!: Table<PendingPhoto, string>;
  pendingCompletions!: Table<PendingCompletion, string>;
  constructor() {
    super("elorae-pwa-offline");
    this.version(1).stores({ pendingOrders: "localId, syncState, storeId, capturedAt" });
    this.version(2).stores({
      pendingOrders: "localId, syncState, storeId, capturedAt",
      pendingPhotos: "localId, syncState, visitId, capturedAt",
    });
    this.version(3).stores({
      pendingOrders: "localId, syncState, storeId, capturedAt",
      pendingPhotos: "localId, syncState, visitId, capturedAt",
      pendingCompletions: "shipmentId, syncState, capturedAt",
    });
  }
}

export const pwaDb = new PwaOfflineDB();
