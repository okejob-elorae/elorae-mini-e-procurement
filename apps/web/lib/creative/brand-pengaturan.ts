import { prisma, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { bacaBrand, KUNCI_BRAND, validasiBrand, type HasilValidasiBrand, type PengaturanBrand } from "./brand-collab";

/**
 * Pengaturan "Brand & kompetitor" (`SystemSetting["kreatif.brand"]`) — KHUSUS
 * SERVER. Klien hanya `import type`; aturan murninya di `brand-collab.ts`.
 *
 * Pembaca menerima klien opsional (transaksi pemanggil) dan selalu
 * mengembalikan nilai yang bisa dipakai (baris kosong/rusak → bawaan di kode).
 * Penyimpan menulis jejak `CREATIVE_SETTINGS_UPDATED` (sebelum/sesudah) di
 * transaksi yang sama, seperti pengaturan Kreatif yang lain.
 *
 * Penulis pantau menerima pengaturan ini sebagai masukan, jadi tes memberi
 * pengaturannya sendiri dan tidak pernah membaca atau menulis baris sungguhan.
 */

type KlienBaca = { systemSetting: Pick<typeof prisma.systemSetting, "findUnique"> };

export async function bacaPengaturanBrand(client: KlienBaca = prisma): Promise<PengaturanBrand> {
  const r = await client.systemSetting.findUnique({ where: { key: KUNCI_BRAND }, select: { value: true } });
  return bacaBrand(r?.value ?? null);
}

export async function simpanPengaturanBrand(
  input: unknown,
  olehUserId: string,
): Promise<{ ok: true; pengaturan: PengaturanBrand } | Extract<HasilValidasiBrand, { ok: false }>> {
  const v = validasiBrand(input);
  if (!v.ok) return v;
  const isi = JSON.stringify(v.pengaturan);
  await runSerializable(async (tx: Prisma.TransactionClient) => {
    const lama = await tx.systemSetting.findUnique({ where: { key: KUNCI_BRAND }, select: { value: true } });
    await tx.systemSetting.upsert({ where: { key: KUNCI_BRAND }, create: { key: KUNCI_BRAND, value: isi }, update: { value: isi } });
    await catatJejak(tx, {
      userId: olehUserId,
      action: JEJAK.PENGATURAN_KREATIF_DIUBAH,
      entityType: "SystemSetting",
      entityId: KUNCI_BRAND,
      changes: { before: lama?.value ?? null, after: isi },
    });
  });
  return { ok: true, pengaturan: v.pengaturan };
}
