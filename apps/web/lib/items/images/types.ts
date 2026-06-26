export type ItemImageSource = "ERP_UPLOAD" | "JUBELIO_INGEST";

export type ItemImageDto = {
  id: string;
  itemId: string;
  variantSku: string | null;
  url: string;
  sortOrder: number;
  jubelioImageId: string | null;
  syncedAt: Date | null;
  source: ItemImageSource;
};

// Submitted from client to server action — id is present for existing, absent for new
export type ItemImageSubmission = {
  id?: string;
  url: string;
  variantSku: string | null;
  sortOrder: number;
};

export type ItemImageDiff = {
  inserts: Array<{ url: string; variantSku: string | null; sortOrder: number }>;
  updates: Array<{ id: string; sortOrder: number }>;
  deletes: Array<{ id: string; url: string; source: ItemImageSource }>;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export type ReplaceImagesActionResult =
  | { ok: true; counts: { inserted: number; updated: number; deleted: number } }
  | { ok: false; code: string; message: string };
