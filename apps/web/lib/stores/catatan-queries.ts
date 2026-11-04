import { prisma } from "@elorae/db";
import { formatDisplayDateTime } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { bolehAksesCatatan, hakCatatan, ringkasCatatan, urutkanCatatan } from "./catatan";

/**
 * Bacaan catatan toko: siapa boleh, daftar untuk halaman toko (HP dan kantor),
 * dan catatan tersemat per toko untuk rencana kunjungan/rute.
 */

export type AksesCatatan = { boleh: boolean; kelolaSemua: boolean };

/**
 * Hak orang ini atas catatan sebuah toko — satu penilaian untuk halaman HP,
 * halaman kantor, dan setiap aksi (aksi memanggilnya ulang; komponen hanya
 * menyembunyikan tombol). Toko yang tidak ada → tidak boleh.
 */
export async function aksesCatatanToko(
  user: { id: string; permissions?: string[] },
  storeId: string,
): Promise<AksesCatatan> {
  const perms = user.permissions ?? [];
  const kantorLihat = hasPermission(perms, PERMISSIONS.STORES_VIEW);
  const kelolaSemua = hasPermission(perms, PERMISSIONS.STORES_MANAGE);
  const lapanganBoleh = pwaAccessGuard(perms) === "render";

  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, salesmanId: true } });
  if (!store) return { boleh: false, kelolaSemua: false };

  let lapangan: { tokoTetap: string | null; terkunci: boolean; penanggungJawabId: string | null } | null = null;
  if (!kantorLihat && lapanganBoleh) {
    const tokoTetap = await ambilTokoTetap(user.id);
    lapangan = { tokoTetap, terkunci: tokoTetap ? false : await tokoTerkunci(), penanggungJawabId: store.salesmanId };
  }
  const boleh = bolehAksesCatatan({ userId: user.id, storeId: store.id, kantorLihat, lapangan });
  return { boleh, kelolaSemua: boleh && kelolaSemua };
}

/** Satu catatan untuk layar; tanggal sudah diformat di server (WIB). */
export type CatatanTampil = {
  id: string;
  body: string;
  pinned: boolean;
  penulis: string;
  milikSaya: boolean;
  dibuat: string;
  /** Terisi bila barisnya diubah sesudah dibuat (isi atau semat). */
  diperbarui: string | null;
  /** Ubah, hapus, sematkan — milik sendiri atau `stores:manage`. */
  bolehKelola: boolean;
};

/** Selisih minimal agar "diperbarui" tampil — `createdAt`/`updatedAt` baris baru bisa berbeda beberapa milidetik. */
const AMBANG_DIPERBARUI_MS = 60_000;

/** Batas catatan yang dimuat per halaman toko; yang tersemat selalu termasuk karena terurut di atas. */
export const BATAS_CATATAN_TAMPIL = 100;

/**
 * Catatan sebuah toko untuk penonton ini: yang dihapus tidak ikut, tersemat di
 * atas, lalu terbaru. Pemanggil sudah memastikan `aksesCatatanToko(...).boleh`.
 */
export async function catatanTokoUntuk(
  storeId: string,
  penonton: { userId: string; kelolaSemua: boolean },
): Promise<CatatanTampil[]> {
  const rows = await prisma.storeNote.findMany({
    where: { storeId, deletedAt: null },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: BATAS_CATATAN_TAMPIL,
  });
  if (rows.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } },
    select: { id: true, name: true, email: true },
  });
  const nama = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  return urutkanCatatan(rows).map((r) => ({
    id: r.id,
    body: r.body,
    pinned: r.pinned,
    penulis: nama.get(r.authorId) ?? "—",
    milikSaya: r.authorId === penonton.userId,
    dibuat: formatDisplayDateTime(r.createdAt),
    diperbarui: r.updatedAt.getTime() - r.createdAt.getTime() > AMBANG_DIPERBARUI_MS ? formatDisplayDateTime(r.updatedAt) : null,
    bolehKelola: hakCatatan({ userId: penonton.userId, authorId: r.authorId, kelolaSemua: penonton.kelolaSemua }),
  }));
}

export type CatatanTersemat = { noteId: string; teks: string; jumlahTersemat: number };

/**
 * Catatan tersemat TERBARU per toko (teks satu baris, ≤ 80 karakter) untuk
 * rencana kunjungan dan rute. Toko tanpa catatan tersemat tidak ada di peta.
 * `jumlahTersemat` > 1 berarti ada catatan tersemat lain di halaman toko.
 */
export async function catatanTersematPerToko(storeIds: readonly string[]): Promise<Map<string, CatatanTersemat>> {
  const ids = [...new Set(storeIds.filter(Boolean))];
  const hasil = new Map<string, CatatanTersemat>();
  if (ids.length === 0) return hasil;
  const rows = await prisma.storeNote.findMany({
    where: { storeId: { in: ids }, pinned: true, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { id: true, storeId: true, body: true },
  });
  for (const r of rows) {
    const ada = hasil.get(r.storeId);
    if (ada) ada.jumlahTersemat += 1;
    else hasil.set(r.storeId, { noteId: r.id, teks: ringkasCatatan(r.body, 80), jumlahTersemat: 1 });
  }
  return hasil;
}
