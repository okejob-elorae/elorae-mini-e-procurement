import type { Prisma } from "@elorae/db";

/*
 * Tautan PO → tahap produksi (`PurchaseOrder.planStageId`, "Buat PO" dari ruang
 * kerja tahap). Dipisah dari `mutations.ts` supaya aksi edit PO dan rute
 * sinkron luring memakai penjaga yang sama tanpa ikut memuat penulis PO.
 * Aman untuk klien: tidak ada impor nilai (Prisma hanya tipe).
 */

/** Tahap produksi PO untuk layar: chip "Untuk tahap" dan "Tahap" di rincian PO. */
export type TahapPo = { id: string; kode: string; nama: string };

export function tahapPo(
  tahap: { id: string; name: string; planCategory?: { code: string } | null } | null | undefined,
): TahapPo | null {
  if (!tahap) return null;
  return { id: tahap.id, kode: tahap.planCategory?.code?.trim() ?? "", nama: tahap.name };
}

/** "{kode jenis} · {nama tahap}"; tanpa kode (jenis hilang) cukup nama tahapnya. */
export function labelTahap(tahap: TahapPo): string {
  return tahap.kode ? `${tahap.kode} · ${tahap.nama}` : tahap.nama;
}

/** Ruang kerja tahap di Plan Kerja. */
export function tautanRuangKerjaTahap(planStageId: string): string {
  return `/backoffice/production/planning/tahap/${encodeURIComponent(planStageId)}`;
}

/** Paling banyak bahan yang dibawa `?bahan=` sekali buka. */
export const MAKS_BAHAN_ISI = 50;

/**
 * Formulir PO baru yang terisi kekurangan bahan tahap ("Buat PO" di kartu
 * Kebutuhan bahan). Tanpa `itemIds` = semua bahan yang masih kurang.
 */
export function tautanPoDariTahap(planStageId: string, itemIds?: readonly string[]): string {
  const q = new URLSearchParams({ planStageId, isi: "kurang" });
  const bahan = [...new Set((itemIds ?? []).map((i) => i.trim()).filter(Boolean))];
  if (bahan.length > 0) q.set("bahan", bahan.join(","));
  return `/backoffice/purchase-orders/new?${q.toString()}`;
}

/** `?bahan=a,b` → id bahan (dirapikan, tanpa kembar, paling banyak `MAKS_BAHAN_ISI`). */
export function bacaPilihanBahan(nilai: string | string[] | undefined): string[] {
  const teks = Array.isArray(nilai) ? nilai.join(",") : (nilai ?? "");
  const hasil: string[] = [];
  for (const bagian of teks.split(",")) {
    const id = bagian.trim();
    if (!id || id.length > 64 || hasil.includes(id)) continue;
    hasil.push(id);
    if (hasil.length >= MAKS_BAHAN_ISI) break;
  }
  return hasil;
}

/**
 * PO ditautkan ke tahap produksi yang sudah tidak ada. Dilempar di dalam
 * transaksi supaya tidak ada yang tertulis; aksi menerjemahkannya ke
 * `{ ok:false, code: "TAHAP_TIDAK_ADA" }`.
 */
export class TahapTidakAdaError extends Error {
  readonly code = "TAHAP_TIDAK_ADA" as const;
  constructor(readonly planStageId: string) {
    super("TAHAP_TIDAK_ADA");
    this.name = "TahapTidakAdaError";
  }
}

/**
 * Tahap yang akan ditautkan ke PO harus ada. `relationMode = "prisma"`: tanpa
 * kunci asing, jadi pemeriksaan ini satu-satunya penjaga tautan menggantung.
 */
export async function pastikanTahapAda(tx: Pick<Prisma.TransactionClient, "planStage">, planStageId: string) {
  const tahap = await tx.planStage.findUnique({ where: { id: planStageId }, select: { id: true } });
  if (!tahap) throw new TahapTidakAdaError(planStageId);
}

/**
 * `planStageId` kiriman formulir: `undefined` = tidak disentuh (edit
 * mempertahankan tautan lama), `null`/teks kosong = dilepas, teks = tautkan.
 */
export function tahapKiriman(nilai: unknown): string | null | undefined {
  if (nilai === undefined) return undefined;
  if (typeof nilai === "string" && nilai.trim()) return nilai.trim();
  return null;
}
