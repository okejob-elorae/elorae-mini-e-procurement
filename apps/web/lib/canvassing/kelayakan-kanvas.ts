import { prisma } from "@elorae/db";

/**
 * Siapa yang boleh memegang stok mobil kanvas. Mobil hanya berguna di tangan salesman:
 * SPG terikat satu toko dan tidak bisa menjual dari mobil (aksi penjualan salesman
 * menolaknya), dan akun admin sistem bukan orang lapangan — barang yang dimuat ke sana
 * terjebak. Satu tempat untuk daftar sales kanvas DAN penolakan muat mobil.
 */
export type AlasanBukanKanvas = "TIDAK_ADA" | "SPG" | "ADMIN_SISTEM" | "TANPA_AKSES_HP";

/** Izin aplikasi HP lapangan — syarat dasar sales kanvas (sama dengan `listCanvassers`). */
export const IZIN_HP = "pwa:access";

type BahanPengguna = {
  assignedStoreId: string | null;
  roleDefinition: { isSystem: boolean; punyaAksesHp: boolean } | null;
} | null;

/** Murni: null = boleh menjadi sales kanvas. */
export function alasanBukanKanvas(u: BahanPengguna): AlasanBukanKanvas | null {
  if (!u) return "TIDAK_ADA";
  if (u.assignedStoreId) return "SPG";
  if (u.roleDefinition?.isSystem) return "ADMIN_SISTEM";
  if (!u.roleDefinition?.punyaAksesHp) return "TANPA_AKSES_HP";
  return null;
}

const PILIH = {
  id: true,
  assignedStoreId: true,
  roleDefinition: {
    select: { isSystem: true, permissions: { where: { permission: { code: IZIN_HP } }, select: { permissionId: true } } },
  },
} as const;

type Baris = { id: string; assignedStoreId: string | null; roleDefinition: { isSystem: boolean; permissions: { permissionId: string }[] } | null };

const keBahan = (u: Baris): BahanPengguna => ({
  assignedStoreId: u.assignedStoreId,
  roleDefinition: u.roleDefinition ? { isSystem: u.roleDefinition.isSystem, punyaAksesHp: u.roleDefinition.permissions.length > 0 } : null,
});

/** Alasan satu pengguna tidak boleh dimuati mobil; null = boleh. */
export async function periksaKanvas(userId: string): Promise<AlasanBukanKanvas | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: PILIH });
  return alasanBukanKanvas(u ? keBahan(u) : null);
}

/** Peta alasan untuk banyak pengguna sekaligus (satu kueri); yang boleh tidak ada di peta. */
export async function petaBukanKanvas(userIds: string[]): Promise<Map<string, AlasanBukanKanvas>> {
  const peta = new Map<string, AlasanBukanKanvas>();
  if (userIds.length === 0) return peta;
  const rows = await prisma.user.findMany({ where: { id: { in: userIds } }, select: PILIH });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of userIds) {
    const r = byId.get(id);
    const alasan = alasanBukanKanvas(r ? keBahan(r) : null);
    if (alasan) peta.set(id, alasan);
  }
  return peta;
}
