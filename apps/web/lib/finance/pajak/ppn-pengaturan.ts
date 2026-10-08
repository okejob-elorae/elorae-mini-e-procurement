import { prisma } from "@elorae/db";
import { KUNCI_PENGATURAN_PPN, bacaPengaturanPpnMentah, type PengaturanPpn } from "./ppn";

/**
 * Pengaturan PPN tersimpan (`SystemSetting["pajak.ppn"]`), dengan bawaan di
 * kode (`PPN_BAWAAN`: BELUM_DITETAPKAN → tanpa PPN) bila barisnya belum ada
 * atau rusak. KHUSUS SERVER — menarik Prisma; komponen klien hanya boleh
 * mengimpor `./ppn` (murni).
 *
 * Penulis jurnal yang berjalan di dalam transaksi meneruskan `client` (tx),
 * supaya pengaturan dan jurnalnya terbaca dalam transaksi yang sama.
 */
export async function bacaPengaturanPpn(
  client: { systemSetting: Pick<typeof prisma.systemSetting, "findUnique"> } = prisma,
): Promise<PengaturanPpn> {
  const baris = await client.systemSetting.findUnique({ where: { key: KUNCI_PENGATURAN_PPN }, select: { value: true } });
  return bacaPengaturanPpnMentah(baris?.value);
}
