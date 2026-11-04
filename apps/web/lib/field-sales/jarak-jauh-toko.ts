import { prisma } from "@elorae/db";
import { bacaAturanJarakJauh, KUNCI_JARAK_JAUH, periksaJarakJauh, type AturanJarakJauh, type PenolakanJarakJauh } from "./jarak-jauh";

type Klien = {
  systemSetting: Pick<typeof prisma.systemSetting, "findUnique">;
  store: Pick<typeof prisma.store, "findUnique">;
};

export async function muatAturanJarakJauh(client: Pick<Klien, "systemSetting"> = prisma): Promise<AturanJarakJauh> {
  const row = await client.systemSetting.findUnique({ where: { key: KUNCI_JARAK_JAUH }, select: { value: true } });
  return bacaAturanJarakJauh(row?.value);
}

/**
 * Boleh tidaknya salesman ini mencatat pesanan jarak jauh untuk toko ini —
 * penilaian yang SAMA dengan penulis pesanan, untuk halaman (tombol, katalog)
 * supaya salesman diberi tahu sebelum mengisi keranjang, bukan sesudah Kirim.
 */
export async function izinJarakJauh(
  storeId: string,
  salesmanId: string,
  client: Klien = prisma,
): Promise<{ boleh: true } | { boleh: false; alasan: PenolakanJarakJauh }> {
  const aturan = await muatAturanJarakJauh(client);
  const toko = await client.store.findUnique({ where: { id: storeId }, select: { salesmanId: true } });
  const alasan = periksaJarakJauh(aturan, { salesmanId, pemegangToko: toko?.salesmanId ?? null });
  return alasan ? { boleh: false, alasan } : { boleh: true };
}
