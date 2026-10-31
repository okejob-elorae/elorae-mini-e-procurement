import { prisma } from "@elorae/db";
import { KUNCI_PROFIL_PAJAK, PROFIL_PAJAK_BAWAAN, bacaProfilPajakMentah, type ProfilPajak } from "./profil";
import { bacaSetelanPajakSungguhan } from "./setelan-uji";

/**
 * Profil pajak tersimpan (`SystemSetting["pajak.profil"]`), bawaan di kode
 * (`PROFIL_PAJAK_BAWAAN`, semuanya BELUM_DITETAPKAN) bila barisnya belum ada
 * atau rusak. KHUSUS SERVER — komponen klien hanya mengimpor `./profil`.
 * Di bawah vitest selalu bawaan, kecuali `UJI_PENGATURAN_PAJAK=setelan`.
 */
export async function bacaProfilPajak(
  client: { systemSetting: Pick<typeof prisma.systemSetting, "findUnique"> } = prisma,
): Promise<ProfilPajak> {
  if (!bacaSetelanPajakSungguhan()) return { ...PROFIL_PAJAK_BAWAAN };
  const baris = await client.systemSetting.findUnique({ where: { key: KUNCI_PROFIL_PAJAK }, select: { value: true } });
  return bacaProfilPajakMentah(baris?.value);
}
