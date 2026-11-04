import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/rbac";

/**
 * Penjaga aksi laporan: sesi + SALAH SATU izin, diperiksa sebelum kueri apa pun.
 *
 * Melempar seperti `requirePermission` (bukan `{ ok:false }`) supaya bentuk
 * kembalian untuk yang sah tidak berubah; layar Laporan dan Inventori sudah
 * menangkap lemparannya menjadi toast. Izinnya izin MODUL datanya, bukan
 * `dashboard:view`: halaman Laporan terbuka bagi semua pemegang beranda,
 * tetapi nilai persediaan, harga PO, dan biaya bahan per vendor bukan milik
 * semua orang itu.
 */
export async function wajibIzinLaporan(...codes: string[]): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const perms = session.user.permissions ?? [];
  if (!codes.some((c) => hasPermission(perms, c))) requirePermission(perms, codes[0]);
}
