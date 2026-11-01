import { prisma, type Prisma, type PrismaClient } from "@elorae/db";

/**
 * "Admin sistem" = pengguna yang perannya peran SISTEM (`RoleDefinition.isSystem`),
 * aturan yang sama dengan wildcard `*` di lib/auth/segarkan-sesi.ts.
 *
 * JANGAN memilih admin dari kolom peran lama (`User.role = ADMIN`). Kolom itu
 * basi untuk akun yang perannya diubah lewat Pengaturan → Pengguna sebelum
 * Pengguna ikut mengisinya (lihat lib/users/peran-lama.ts): admin yang
 * diangkat di sana masih USER di kolom, admin yang diturunkan masih ADMIN.
 * Pekerjaan tanpa orang yang memilih pelakunya dari kolom itu akan memposting
 * atas nama mantan admin, atau diam-diam tidak memposting apa pun kalau tidak
 * ada satu akun pun yang kolomnya ADMIN.
 */
export const SYARAT_ADMIN_SISTEM = { roleDefinition: { isSystem: true } } satisfies Prisma.UserWhereInput;

/**
 * Admin sistem tertua — pelaku untuk pekerjaan tanpa orang (cron dan skrip):
 * sapuan jurnal, jurnal berulang, penyusutan aset, jurnal penjualan, skrip
 * stok awal. Diurutkan `createdAt` lalu `id` supaya hasilnya pasti.
 * null = belum ada admin sistem.
 */
export async function adminSistemTertua(
  client: Pick<PrismaClient, "user"> = prisma,
): Promise<{ id: string; email: string } | null> {
  return client.user.findFirst({
    where: SYARAT_ADMIN_SISTEM,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, email: true },
  });
}
