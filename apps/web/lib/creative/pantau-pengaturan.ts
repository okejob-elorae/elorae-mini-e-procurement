import { prisma, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { bacaPantau, JEJAK_PANTAU, KUNCI_PANTAU, validasiPantau, type GalatPantau, type PengaturanPantau } from "./pantau-aturan";

/**
 * Pengaturan pantau KOL (`SystemSetting["kreatif.pantau"]`) — KHUSUS SERVER.
 * Klien hanya `import type`; aturan murninya di `pantau-aturan.ts`.
 *
 * Pembaca menerima klien opsional (transaksi pemanggil). Penulis-penulis
 * pantau menerima `pengaturan` sebagai masukan, jadi tes memberi pengaturannya
 * sendiri dan tidak pernah membaca baris sungguhan di basis data bersama.
 */

type KlienBaca = { systemSetting: Pick<typeof prisma.systemSetting, "findUnique"> };

export async function bacaPengaturanPantau(client: KlienBaca = prisma): Promise<PengaturanPantau> {
  const r = await client.systemSetting.findUnique({ where: { key: KUNCI_PANTAU }, select: { value: true } });
  return bacaPantau(r?.value ?? null);
}

export async function simpanPengaturanPantau(
  input: unknown,
  olehUserId: string,
): Promise<{ ok: true; pengaturan: PengaturanPantau } | { ok: false; kode: "TIDAK_VALID"; galat: GalatPantau[] }> {
  const v = validasiPantau(input);
  if (!v.ok) return { ok: false, kode: "TIDAK_VALID", galat: v.galat };
  const isi = JSON.stringify(v.pengaturan);
  await runSerializable(async (tx: Prisma.TransactionClient) => {
    const lama = await tx.systemSetting.findUnique({ where: { key: KUNCI_PANTAU }, select: { value: true } });
    await tx.systemSetting.upsert({ where: { key: KUNCI_PANTAU }, create: { key: KUNCI_PANTAU, value: isi }, update: { value: isi } });
    await tx.auditLog.create({
      data: {
        userId: olehUserId,
        action: JEJAK_PANTAU.PENGATURAN_DIUBAH,
        entityType: "SystemSetting",
        entityId: KUNCI_PANTAU,
        changes: { before: lama?.value ?? null, after: isi },
      },
    });
  });
  return { ok: true, pengaturan: v.pengaturan };
}
