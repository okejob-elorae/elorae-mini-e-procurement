import { prisma } from "@elorae/db";
import { KUNCI_PROFIL_PAJAK, bacaProfilPajakMentah, type ProfilPajak } from "./profil";

/**
 * Profil pajak tersimpan (`SystemSetting["pajak.profil"]`), bawaan di kode
 * (`PROFIL_PAJAK_BAWAAN`, semuanya BELUM_DITETAPKAN) bila barisnya belum ada
 * atau rusak. KHUSUS SERVER — komponen klien hanya mengimpor `./profil`.
 */
export async function bacaProfilPajak(
  client: { systemSetting: Pick<typeof prisma.systemSetting, "findUnique"> } = prisma,
): Promise<ProfilPajak> {
  const baris = await client.systemSetting.findUnique({ where: { key: KUNCI_PROFIL_PAJAK }, select: { value: true } });
  return bacaProfilPajakMentah(baris?.value);
}
