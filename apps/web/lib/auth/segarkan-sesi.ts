import { prisma } from "@elorae/db";
import type { Role } from "@elorae/db";

/**
 * Isi sesi (peran, izin, toko tetap SPG) dibaca ulang dari basis data.
 *
 * Dulu isi ini hanya dibaca saat masuk, jadi mencabut izin seseorang — atau
 * menghapus akunnya — baru berlaku saat JWT-nya kedaluwarsa (hingga 8 jam).
 * Sekarang callback `jwt` di lib/auth.ts membaca ulang token yang lebih tua
 * dari `UMUR_SEGAR_SESI_MS`; akun yang sudah tidak ada membuat sesinya tidak sah.
 *
 * Singgahan per proses: `auth()` di komponen server dan aksi server menjalankan
 * callback `jwt` tetapi TIDAK menulis ulang cookie, jadi cap waktu baru di token
 * hilang dan setiap `auth()` berikutnya melihat token basi lagi. Tanpa singgahan,
 * satu halaman = beberapa kueri. Dengan singgahan, paling banyak satu kueri per
 * orang per `UMUR_SEGAR_SESI_MS` per proses — batas basinya tetap sama.
 *
 * Kolom `isActive` pada User belum ada (menonaktifkan pengguna belum dibangun);
 * yang dinilai sekarang hanya: akunnya masih ada.
 */

/** Umur token sebelum isinya dibaca ulang. Ubah di sini saja. */
export const UMUR_SEGAR_SESI_MS = 60_000;

export type IsiSesi = {
  role: Role;
  roleId: string | null;
  roleName: string;
  permissions: string[];
  permissionsVersion: number | undefined;
  assignedStoreId: string | null;
};

type PenggunaBerperan = {
  role: Role;
  assignedStoreId: string | null;
  roleDefinition: {
    id: string;
    name: string;
    isSystem: boolean;
    permissionsVersion: number;
    permissions: Array<{ permission: { code: string } }>;
  } | null;
};

/** Pilihan kolom yang dibutuhkan `isiSesiDari` — sama untuk masuk dan penyegaran. */
export const PILIH_PENGGUNA_SESI = {
  role: true,
  assignedStoreId: true,
  roleDefinition: {
    select: {
      id: true,
      name: true,
      isSystem: true,
      permissionsVersion: true,
      permissions: { select: { permission: { select: { code: true } } } },
    },
  },
} as const;

/** Baris pengguna → isi sesi. Peran sistem (ADMIN) mendapat wildcard `*`. */
export function isiSesiDari(u: PenggunaBerperan): IsiSesi {
  const peran = u.roleDefinition;
  return {
    role: u.role,
    roleId: peran?.id ?? null,
    roleName: peran?.name ?? u.role,
    permissions: !peran ? [] : peran.isSystem ? ["*"] : peran.permissions.map((rp) => rp.permission.code),
    permissionsVersion: peran?.permissionsVersion,
    assignedStoreId: u.assignedStoreId ?? null,
  };
}

/** null di `isi` = akunnya tidak ada lagi. */
type Singgahan = { pada: number; isi: IsiSesi | null };
const singgahan = new Map<string, Singgahan>();

/** Untuk tes. */
export function lupakanSinggahanSesi(): void {
  singgahan.clear();
}

async function muatIsiSesi(userId: string, sekarang: number, paksa: boolean): Promise<Singgahan> {
  const ada = singgahan.get(userId);
  if (!paksa && ada && sekarang - ada.pada < UMUR_SEGAR_SESI_MS) return ada;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: PILIH_PENGGUNA_SESI });
  const baru: Singgahan = { pada: sekarang, isi: u ? isiSesiDari(u) : null };
  singgahan.set(userId, baru);
  return baru;
}

/** Catat isi yang baru dibaca saat masuk, supaya pemakaian pertama sesudahnya tidak mengulang kueri. */
export function ingatIsiSesi(userId: string, isi: IsiSesi, sekarang: number = Date.now()): void {
  singgahan.set(userId, { pada: sekarang, isi });
}

type TokenSesi = {
  id?: unknown;
  disegarkanPada?: unknown;
  [k: string]: unknown;
};

/**
 * Inti callback `jwt` untuk token yang sudah ada (bukan saat masuk).
 * - Token segar (< `UMUR_SEGAR_SESI_MS`) dikembalikan apa adanya, tanpa kueri.
 * - Token basi, atau `paksa` (trigger "update"), dibaca ulang.
 * - Akun tidak ada lagi → null (NextAuth menghapus cookie sesinya).
 * - Basis data gagal → token lama dikembalikan tanpa memajukan cap waktu,
 *   supaya gangguan sesaat tidak mengeluarkan semua orang; dicoba lagi berikutnya.
 */
export async function segarkanToken<T extends TokenSesi>(token: T, opsi: { paksa?: boolean; sekarang?: number } = {}): Promise<T | null> {
  const userId = typeof token.id === "string" ? token.id : null;
  if (!userId) return token;
  const sekarang = opsi.sekarang ?? Date.now();
  const pada = typeof token.disegarkanPada === "number" ? token.disegarkanPada : 0;
  if (!opsi.paksa && sekarang - pada < UMUR_SEGAR_SESI_MS) return token;

  let hasil: Singgahan;
  try {
    hasil = await muatIsiSesi(userId, sekarang, opsi.paksa === true);
  } catch (e) {
    console.error("[auth] isi sesi gagal dibaca ulang; token lama dipakai sementara", e);
    return token;
  }
  if (!hasil.isi) return null;
  return { ...token, ...hasil.isi, disegarkanPada: hasil.pada };
}
