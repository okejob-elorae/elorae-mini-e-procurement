import { prisma } from "@elorae/db";
import { validasiCatatan, type KodeGalatCatatan } from "./catatan";

/**
 * Penulis catatan toko. Hak baca/tulis di toko (`aksesCatatanToko`) dinilai
 * aksi SEBELUM memanggil ini; hak atas satu catatan (milik sendiri atau
 * `stores:manage`) dijaga DI SINI, di dalam syarat `updateMany` yang sama
 * dengan penulisannya — tidak ada jeda antara memeriksa dan menulis.
 *
 * Tanpa `AuditLog`: catatan bukan keputusan uang atau stok. Hapus = lunak.
 */

export type GagalCatatan = KodeGalatCatatan | "TIDAK_ADA" | "BUKAN_MILIK";
export type HasilCatatan = { ok: true; id: string; storeId: string } | { ok: false; kode: GagalCatatan };

export async function tambahCatatanToko(input: { storeId: string; authorId: string; body: unknown }): Promise<HasilCatatan> {
  const v = validasiCatatan(input.body);
  if (!v.ok) return v;
  const store = await prisma.store.findUnique({ where: { id: input.storeId }, select: { id: true } });
  if (!store) return { ok: false, kode: "TIDAK_ADA" };
  const r = await prisma.storeNote.create({
    data: { storeId: store.id, authorId: input.authorId, body: v.body },
    select: { id: true, storeId: true },
  });
  return { ok: true, id: r.id, storeId: r.storeId };
}

type PenulisCatatan = { noteId: string; userId: string; kelolaSemua: boolean };

/** Syarat baris yang boleh disentuh orang ini — hak dan "belum dihapus" sekaligus. */
function milik(o: PenulisCatatan) {
  return { id: o.noteId, deletedAt: null, ...(o.kelolaSemua ? {} : { authorId: o.userId }) };
}

/** Sesudah `updateMany` tidak mengena apa pun: catatannya tidak ada (atau terhapus), atau bukan miliknya. */
async function sebabGagal(noteId: string): Promise<{ ok: false; kode: "TIDAK_ADA" | "BUKAN_MILIK" }> {
  const ada = await prisma.storeNote.findFirst({ where: { id: noteId, deletedAt: null }, select: { id: true } });
  return { ok: false, kode: ada ? "BUKAN_MILIK" : "TIDAK_ADA" };
}

async function tulis(o: PenulisCatatan, data: { body?: string; pinned?: boolean; deletedAt?: Date }): Promise<HasilCatatan> {
  const r = await prisma.storeNote.updateMany({ where: milik(o), data });
  if (r.count === 0) return sebabGagal(o.noteId);
  const row = await prisma.storeNote.findUnique({ where: { id: o.noteId }, select: { id: true, storeId: true } });
  return row ? { ok: true, id: row.id, storeId: row.storeId } : { ok: false, kode: "TIDAK_ADA" };
}

export async function ubahCatatanToko(input: PenulisCatatan & { body: unknown }): Promise<HasilCatatan> {
  const v = validasiCatatan(input.body);
  if (!v.ok) return v;
  return tulis(input, { body: v.body });
}

export async function sematCatatanToko(input: PenulisCatatan & { pinned: boolean }): Promise<HasilCatatan> {
  return tulis(input, { pinned: input.pinned === true });
}

/** Hapus lunak. Menghapus yang sudah terhapus = `TIDAK_ADA`. */
export async function hapusCatatanToko(input: PenulisCatatan & { sekarang?: Date }): Promise<HasilCatatan> {
  return tulis(input, { deletedAt: input.sekarang ?? new Date() });
}

/** Toko pemilik sebuah catatan (yang belum dihapus) — aksi memakainya untuk menilai akses sebelum menulis. */
export async function tokoDariCatatan(noteId: string): Promise<string | null> {
  const r = await prisma.storeNote.findFirst({ where: { id: noteId, deletedAt: null }, select: { storeId: true } });
  return r?.storeId ?? null;
}
