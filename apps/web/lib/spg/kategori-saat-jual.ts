import type { Prisma } from "@elorae/db";

/**
 * Kategori barang yang BERLAKU saat barang terjual (pemilik P8: "komisi memakai kategori barang
 * saat barang terjual itu benar, dan anda harus menyimpan data tanggalnya").
 *
 * Nota konter dibaca saat terjual, jadi kategori di master barang = kategori saat terjual. Nota
 * dari antrean HP (tanpa sinyal) bisa sampai berhari-hari kemudian, sesudah kantor mengubah
 * kategori barangnya. Kategori saat waktu jualnya dibaca dari jejak perubahan kategori barang:
 * setiap perubahan `Item.categoryId` menulis satu baris `AuditLog` bernama
 * `JEJAK_KATEGORI_BARANG` dengan `changes = { before: { categoryId }, after: { categoryId } }`, di
 * transaksi yang sama dengan perubahannya (penulis barang, `lib/items/mutations.ts`). Perubahan
 * yang tercatat sebelum jejak ini ada tidak terbaca — barang tanpa jejak sesudah waktu jual
 * memakai kategori master seperti sebelumnya.
 */
export const JEJAK_KATEGORI_BARANG = "ITEM_CATEGORY_CHANGED";

/** Satu perubahan kategori barang, urut waktu. */
export type JejakKategori = { createdAt: Date; sebelum: string | null; sesudah: string | null };

/** Kolom kategori satu baris nota SPG. */
export type KategoriBaris = { categoryId: string | null; categoryAt: Date; categoryFilledLater: boolean };

function idKategori(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v === "string" && v !== "") return v;
  return undefined;
}

/** `{ before: { categoryId }, after: { categoryId } }`, atau null kalau bentuknya lain. */
function bacaPerubahan(changes: unknown): { sebelum: string | null; sesudah: string | null } | null {
  if (!changes || typeof changes !== "object") return null;
  const c = changes as { before?: unknown; after?: unknown };
  const sebelum = c.before && typeof c.before === "object" ? idKategori((c.before as { categoryId?: unknown }).categoryId) : undefined;
  const sesudah = c.after && typeof c.after === "object" ? idKategori((c.after as { categoryId?: unknown }).categoryId) : undefined;
  if (sebelum === undefined || sesudah === undefined) return null;
  return { sebelum, sesudah };
}

/**
 * Perubahan kategori barang-barang ini SESUDAH `waktu`, per barang, urut waktu. Barang yang salah
 * satu barisnya berbentuk lain tidak dibawa sama sekali — riwayat yang tidak utuh tidak menebak,
 * barang itu memakai kategori master seperti sebelumnya.
 */
export async function jejakKategoriSesudah(
  tx: Prisma.TransactionClient,
  itemIds: string[],
  waktu: Date,
): Promise<Map<string, JejakKategori[]>> {
  const hasil = new Map<string, JejakKategori[]>();
  if (itemIds.length === 0) return hasil;
  const rows = await tx.auditLog.findMany({
    where: { action: JEJAK_KATEGORI_BARANG, entityType: "Item", entityId: { in: itemIds }, createdAt: { gt: waktu } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { entityId: true, createdAt: true, changes: true },
  });
  const rusak = new Set<string>();
  for (const r of rows) {
    const p = bacaPerubahan(r.changes);
    if (!p) {
      rusak.add(r.entityId);
      continue;
    }
    const daftar = hasil.get(r.entityId) ?? [];
    daftar.push({ createdAt: r.createdAt, ...p });
    hasil.set(r.entityId, daftar);
  }
  for (const id of rusak) hasil.delete(id);
  return hasil;
}

/**
 * Kolom kategori baris nota. `sekarangId` = kategori di master saat nota dibaca (`dibaca`);
 * `jejak` = perubahan kategori barang itu sesudah `waktu` jualnya, urut waktu.
 *
 * - Tanpa perubahan sesudah waktu jual: kategori master, dicatat saat dibaca — seperti nota konter.
 * - Ada perubahan: kategori yang berlaku saat itu (`sebelum` perubahan pertama), dicatat pada waktu
 *   jualnya.
 * - Saat terjual barang itu belum berkategori, lalu diberi kategori sebelum notanya sampai: baris
 *   itu disimpan seperti yang akan terjadi kalau notanya sampai tepat waktu (P69) — kategori
 *   pertama yang diberikan sesudah waktu jual, dicatat pada saat diberikan dan ditandai diisi
 *   kemudian (`isiKategoriPenjualanSpg`).
 */
export function kategoriSaatJual(input: {
  sekarangId: string | null;
  jejak: JejakKategori[] | undefined;
  waktu: Date;
  dibaca: Date;
}): KategoriBaris {
  const jejak = input.jejak ?? [];
  if (jejak.length === 0) return { categoryId: input.sekarangId, categoryAt: input.dibaca, categoryFilledLater: false };
  const berlaku = jejak[0].sebelum;
  if (berlaku !== null) return { categoryId: berlaku, categoryAt: input.waktu, categoryFilledLater: false };
  const diisi = jejak.find((j) => j.sesudah !== null);
  if (diisi) return { categoryId: diisi.sesudah, categoryAt: diisi.createdAt, categoryFilledLater: true };
  return { categoryId: null, categoryAt: input.waktu, categoryFilledLater: false };
}
