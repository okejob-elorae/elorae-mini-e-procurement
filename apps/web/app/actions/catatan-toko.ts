"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { aksesCatatanToko } from "@/lib/stores/catatan-queries";
import {
  hapusCatatanToko,
  sematCatatanToko,
  tambahCatatanToko,
  tokoDariCatatan,
  ubahCatatanToko,
  type GagalCatatan,
} from "@/lib/stores/catatan-writer";

/**
 * Aksi catatan toko — dipakai halaman toko di HP dan di kantor.
 *
 * Membaca dan menambah: siapa pun yang boleh melihat toko itu
 * (`aksesCatatanToko`: kantor `stores:view`, salesman menurut kunci "hanya toko
 * sendiri", SPG di toko tetapnya). Mengubah, menghapus, menyematkan: penulisnya,
 * atau `stores:manage` untuk semua catatan — dijaga di penulis.
 *
 * Mengembalikan `{ ok: false, kode }`, tidak melempar.
 */

export type KodeAksiCatatan = GagalCatatan | "TANPA_AKSES" | "GAGAL";
export type HasilAksiCatatan = { ok: true; id: string } | { ok: false; kode: KodeAksiCatatan };

function bacaId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

function segarkan(storeId: string) {
  revalidatePath(`/pwa/stores/${storeId}`);
  revalidatePath(`/backoffice/stores/${storeId}`);
  // Catatan tersemat ikut tampil di rencana kunjungan (beranda) dan rute.
  revalidatePath("/pwa");
  revalidatePath("/pwa/rute");
}

async function sesi() {
  const session = await auth();
  return session?.user?.id ? { id: session.user.id, permissions: session.user.permissions ?? [] } : null;
}

export async function tambahCatatanTokoAction(storeId: unknown, body: unknown): Promise<HasilAksiCatatan> {
  const user = await sesi();
  const sid = bacaId(storeId);
  if (!user || !sid) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const akses = await aksesCatatanToko(user, sid);
    if (!akses.boleh) return { ok: false, kode: "TANPA_AKSES" };
    const r = await tambahCatatanToko({ storeId: sid, authorId: user.id, body });
    if (!r.ok) return r;
    segarkan(r.storeId);
    return { ok: true, id: r.id };
  } catch (err) {
    console.error("[catatan-toko] tambah gagal", sid, err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Nilai akses atas toko pemilik catatan, lalu jalankan penulisnya. */
async function denganCatatan(
  noteId: unknown,
  jalankan: (o: { noteId: string; userId: string; kelolaSemua: boolean }) => ReturnType<typeof ubahCatatanToko>,
): Promise<HasilAksiCatatan> {
  const user = await sesi();
  const nid = bacaId(noteId);
  if (!user) return { ok: false, kode: "TANPA_AKSES" };
  if (!nid) return { ok: false, kode: "TIDAK_ADA" };
  try {
    const storeId = await tokoDariCatatan(nid);
    if (!storeId) return { ok: false, kode: "TIDAK_ADA" };
    const akses = await aksesCatatanToko(user, storeId);
    if (!akses.boleh) return { ok: false, kode: "TANPA_AKSES" };
    const r = await jalankan({ noteId: nid, userId: user.id, kelolaSemua: akses.kelolaSemua });
    if (!r.ok) return r;
    segarkan(r.storeId);
    return { ok: true, id: r.id };
  } catch (err) {
    console.error("[catatan-toko] tulis gagal", nid, err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function ubahCatatanTokoAction(noteId: unknown, body: unknown): Promise<HasilAksiCatatan> {
  return denganCatatan(noteId, (o) => ubahCatatanToko({ ...o, body }));
}

export async function hapusCatatanTokoAction(noteId: unknown): Promise<HasilAksiCatatan> {
  return denganCatatan(noteId, (o) => hapusCatatanToko(o));
}

export async function sematCatatanTokoAction(noteId: unknown, pinned: unknown): Promise<HasilAksiCatatan> {
  return denganCatatan(noteId, (o) => sematCatatanToko({ ...o, pinned: pinned === true }));
}
