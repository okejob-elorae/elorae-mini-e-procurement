import type { prisma, Prisma } from "@elorae/db";
import type { GantiPemegang } from "@/lib/salesman/penjualan-konsi";
import { AKSI_PINDAH_TOKO } from "./penanggung-jawab-writer";

type Klien = Prisma.TransactionClient | typeof prisma;

/**
 * Riwayat pemegang toko, dibaca dari jejak pindah pemegang (`STORE_SALESMAN_CHANGED`).
 *
 * Kolom `Store.salesmanId` hanya menyimpan pemegang TERAKHIR; siapa memegang toko pada tanggal
 * tertentu hanya bisa dibaca mundur dari jejak ini (`pemegangPada` di
 * `lib/salesman/penjualan-konsi.ts`). Satu pembaca untuk semua pemakai — omzet konsinyasi
 * salesman dan pemegang saat retur toko — supaya tidak ada dua penafsir jejak yang sama.
 */

/** Pergantian pemegang satu toko: kapan, pemegang sebelum, dan pemegang sesudahnya. */
export type GantiPemegangJejak = GantiPemegang & { sesudah: string | null };

/** `changes` jejak sebagai objek — kolom JSON bisa saja terbaca sebagai teks. */
export function objekJejak(changes: unknown): { before?: { salesmanId?: unknown }; after?: { salesmanId?: unknown } } | null {
  let x = changes;
  if (typeof x === "string") {
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  return x && typeof x === "object" ? (x as { before?: { salesmanId?: unknown }; after?: { salesmanId?: unknown } }) : null;
}

export function sebelumDariJejak(changes: unknown): string | null {
  const before = objekJejak(changes)?.before;
  return typeof before?.salesmanId === "string" && before.salesmanId ? before.salesmanId : null;
}

export function sesudahDariJejak(changes: unknown): string | null {
  const after = objekJejak(changes)?.after;
  return typeof after?.salesmanId === "string" && after.salesmanId ? after.salesmanId : null;
}

/**
 * Semua pergantian pemegang toko-toko ini, per toko, dalam urutan jejaknya. Toko tanpa jejak tidak
 * punya entri (pemegangnya tidak pernah berganti sejak jejak dicatat).
 */
export async function riwayatPemegang(klien: Klien, storeIds: readonly string[]): Promise<Map<string, GantiPemegangJejak[]>> {
  const riwayat = new Map<string, GantiPemegangJejak[]>();
  const ids = [...new Set(storeIds)];
  if (ids.length === 0) return riwayat;
  const jejak = await klien.auditLog.findMany({
    where: { action: AKSI_PINDAH_TOKO, entityType: "Store", entityId: { in: ids } },
    select: { entityId: true, createdAt: true, changes: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const j of jejak) {
    const baris: GantiPemegangJejak = { pada: j.createdAt, sebelum: sebelumDariJejak(j.changes), sesudah: sesudahDariJejak(j.changes) };
    const d = riwayat.get(j.entityId);
    if (d) d.push(baris);
    else riwayat.set(j.entityId, [baris]);
  }
  return riwayat;
}
