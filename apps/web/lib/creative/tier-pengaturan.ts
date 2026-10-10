import { prisma, type Prisma, type PrismaClient } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { bacaAmbangTier, KUNCI_TIER, validasiAmbangTier, type AmbangTier, type GalatTier } from "./tier";

/*
 * Ambang tier KOL (`SystemSetting["kreatif.tier"]`) — KHUSUS SERVER.
 * Klien hanya `import type`; pembaca/validasi murninya di `tier.ts`.
 *
 * Setiap pemanggil server yang menghitung tier (daftar KOL, profil KOL,
 * saringan) membaca setelan ini lalu meneruskannya ke `tierKol`, supaya
 * seluruh layar memakai batas yang sama.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export async function bacaAmbangTierKreatif(client: Klien = prisma): Promise<AmbangTier> {
  const r = await client.systemSetting.findUnique({ where: { key: KUNCI_TIER }, select: { value: true } });
  return bacaAmbangTier(r?.value ?? null);
}

export type HasilSimpanTier = { ok: true; ambang: AmbangTier } | { ok: false; kode: "TIDAK_VALID"; galat: GalatTier[] };

/** Simpan ambang tier; jejak `CREATIVE_SETTINGS_UPDATED` (sebelum/sesudah) di transaksi yang sama. */
export async function simpanAmbangTierKreatif(input: unknown, olehUserId: string): Promise<HasilSimpanTier> {
  const v = validasiAmbangTier(input);
  if (!v.ok) return { ok: false, kode: "TIDAK_VALID", galat: v.galat };
  const isi = JSON.stringify(v.ambang);
  await runSerializable(async (tx) => {
    const lama = await tx.systemSetting.findUnique({ where: { key: KUNCI_TIER }, select: { value: true } });
    await tx.systemSetting.upsert({ where: { key: KUNCI_TIER }, create: { key: KUNCI_TIER, value: isi }, update: { value: isi } });
    await catatJejak(tx, {
      userId: olehUserId,
      action: JEJAK.PENGATURAN_KREATIF_DIUBAH,
      entityType: "SystemSetting",
      entityId: KUNCI_TIER,
      changes: { before: lama?.value ?? null, after: isi },
    });
  });
  return { ok: true, ambang: v.ambang };
}
