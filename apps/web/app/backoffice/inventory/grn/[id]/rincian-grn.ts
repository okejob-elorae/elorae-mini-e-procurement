import { variantDetailForSku } from "@/lib/items/variants";

/*
 * Bahan halaman rincian GRN. Murni (tanpa Prisma) supaya bisa dites dan
 * dipakai aksi server `getRincianGRN`.
 *
 * `GRN.items` ditulis `createGRN` sebagai teks JSON: satu baris per barang
 * dengan qty, harga satuan, total, dan roll kain. `GRN.photoUrls` juga teks
 * JSON (larik URL).
 */

export type BarangGrn = { sku: string; nameId: string; uomCode: string; variants: unknown };

export type BarisRincianGrn = {
  itemId: string;
  sku: string;
  nama: string;
  varianSku: string | null;
  varianLabel: string | null;
  satuan: string;
  qty: number;
  hargaSatuan: number;
  total: number;
  jumlahRoll: number;
};

function bacaJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function angka(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function susunBarisGrn(raw: unknown, barang: ReadonlyMap<string, BarangGrn>): BarisRincianGrn[] {
  const larik = bacaJson(raw);
  if (!Array.isArray(larik)) return [];
  const hasil: BarisRincianGrn[] = [];
  for (const b of larik) {
    if (b == null || typeof b !== "object") continue;
    const baris = b as Record<string, unknown>;
    const itemId = typeof baris.itemId === "string" ? baris.itemId : "";
    if (!itemId) continue;
    const info = barang.get(itemId);
    const varianSku = typeof baris.variantSku === "string" && baris.variantSku.trim() ? baris.variantSku.trim() : null;
    const qty = angka(baris.qty);
    const hargaSatuan = angka(baris.unitCost);
    const total = baris.totalCost != null ? angka(baris.totalCost) : Math.round(qty * hargaSatuan * 100) / 100;
    hasil.push({
      itemId,
      sku: info?.sku ?? itemId,
      nama: info?.nameId ?? "",
      varianSku,
      varianLabel: info ? variantDetailForSku(info.variants, varianSku) : null,
      satuan: info?.uomCode ?? "",
      qty,
      hargaSatuan,
      total,
      jumlahRoll: Array.isArray(baris.rolls) ? baris.rolls.length : 0,
    });
  }
  return hasil;
}

export function fotoGrn(photoUrls: string | null | undefined): string[] {
  const larik = bacaJson(photoUrls ?? null);
  if (!Array.isArray(larik)) return [];
  return larik.filter((u): u is string => typeof u === "string" && u.trim() !== "");
}

/** Keadaan terima-lebih: menunggu pemilik, disetujui, ditolak, atau bukan terima-lebih (null). */
export function keadaanPemilikGrn(g: {
  requiresOwnerApproval: boolean;
  ownerApprovedAt: unknown;
  ownerDeclinedAt: unknown;
}): "menunggu" | "disetujui" | "ditolak" | null {
  if (g.ownerDeclinedAt) return "ditolak";
  if (g.ownerApprovedAt) return "disetujui";
  if (g.requiresOwnerApproval) return "menunggu";
  return null;
}
