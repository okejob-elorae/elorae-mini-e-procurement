import { prisma } from "@elorae/db";
import { KUNCI_IDENTITAS_PAJAK, bacaIdentitasPajakMentah, type IdentitasPajak } from "./identitas";

/** Identitas pajak perusahaan tersimpan — KHUSUS SERVER (komponen klien hanya mengimpor `./identitas`). */
export async function bacaIdentitasPajak(
  client: { systemSetting: Pick<typeof prisma.systemSetting, "findUnique"> } = prisma,
): Promise<IdentitasPajak> {
  const baris = await client.systemSetting.findUnique({ where: { key: KUNCI_IDENTITAS_PAJAK }, select: { value: true } });
  return bacaIdentitasPajakMentah(baris?.value);
}
