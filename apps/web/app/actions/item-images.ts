"use server";

import { replaceItemImagesAction as gantiGambarBarang } from "@/lib/items/images/mutations";
import type { ItemImageSubmission, ReplaceImagesActionResult } from "@/lib/items/images/types";

/** Butir galeri minimal: objek dengan `url` teks (pustaka membaca `s.id`/`s.url`). */
function butirSah(s: unknown): boolean {
  return s !== null && typeof s === "object" && typeof (s as { url?: unknown }).url === "string";
}

/**
 * Ganti galeri foto sebuah barang — pintu klien `ItemGalleryEditor`.
 *
 * Pustakanya (`lib/items/images/mutations.ts`) dulu ber-"use server" sendiri;
 * kini pustaka biasa yang memeriksa `items:manage`, dan hanya aksi ini yang
 * menjadi titik akhir. Isian yang bentuknya salah ditolak di sini.
 */
export async function replaceItemImagesAction(
  itemId: string,
  submitted: ItemImageSubmission[],
): Promise<ReplaceImagesActionResult> {
  if (typeof itemId !== "string" || !itemId || !Array.isArray(submitted) || !submitted.every(butirSah)) {
    return { ok: false, code: "invalid_request", message: "Invalid request." };
  }
  return gantiGambarBarang(itemId, submitted);
}
