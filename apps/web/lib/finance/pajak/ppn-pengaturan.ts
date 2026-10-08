import { prisma } from "@elorae/db";
import { KUNCI_PENGATURAN_PPN, PPN_BAWAAN, bacaPengaturanPpnMentah, type PengaturanPpn } from "./ppn";
import { bacaSetelanPajakSungguhan } from "./setelan-uji";

/**
 * Pengaturan PPN tersimpan (`SystemSetting["pajak.ppn"]`), dengan bawaan di
 * kode (`PPN_BAWAAN`: BELUM_DITETAPKAN → tanpa PPN) bila barisnya belum ada
 * atau rusak. KHUSUS SERVER — menarik Prisma; komponen klien hanya boleh
 * mengimpor `./ppn` (murni).
 *
 * Penulis jurnal yang berjalan di dalam transaksi meneruskan `client` (tx),
 * supaya pengaturan dan jurnalnya terbaca dalam transaksi yang sama.
 *
 * Di bawah vitest selalu bawaan, kecuali `UJI_PENGATURAN_PAJAK=setelan`
 * (lihat `./setelan-uji`).
 */
export async function bacaPengaturanPpn(
  client: { systemSetting: Pick<typeof prisma.systemSetting, "findUnique"> } = prisma,
): Promise<PengaturanPpn> {
  if (!bacaSetelanPajakSungguhan()) return { ...PPN_BAWAAN };
  const baris = await client.systemSetting.findUnique({ where: { key: KUNCI_PENGATURAN_PPN }, select: { value: true } });
  return bacaPengaturanPpnMentah(baris?.value);
}
