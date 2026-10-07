import { prisma, type Prisma, type PrismaClient } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { hitungUlangTerminBelumDibayar } from "./termin-writer";
import { bacaTarifPajak, KUNCI_PAJAK, validasiTarifPajak, type GalatTarif, type TarifPajakKreatif } from "./pph";

/*
 * Tarif PPh fee KOL (`SystemSetting["kreatif.pajak"]`) — KHUSUS SERVER.
 * Baris kosong atau rusak jatuh ke bawaan di kode (`TARIF_PAJAK_BAWAAN`).
 * Bawaan = keputusan sementara; WAJIB dikonfirmasi konsultan pajak.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export async function bacaTarifPajakKreatif(client: Klien = prisma): Promise<TarifPajakKreatif> {
  const r = await client.systemSetting.findUnique({ where: { key: KUNCI_PAJAK }, select: { value: true } });
  return bacaTarifPajak(r?.value ?? null);
}

export type HasilSimpanTarif =
  | { ok: true; tarif: TarifPajakKreatif; dihitungUlang: number }
  | { ok: false; kode: "TIDAK_VALID"; galat: GalatTarif[] };

/**
 * Simpan tarif, lalu hitung ulang SEMUA termin yang belum dibayar dengan tarif
 * baru (termin dibayar terkunci — tarifnya sudah tercatat di `tarifInfo`).
 * Hitung ulang per kolaborasi di transaksinya sendiri, sesudah tarif tersimpan.
 */
export async function simpanTarifPajakKreatif(input: unknown, olehUserId: string): Promise<HasilSimpanTarif> {
  const v = validasiTarifPajak(input);
  if (!v.ok) return { ok: false, kode: "TIDAK_VALID", galat: v.galat };
  const isi = JSON.stringify(v.tarif);
  await runSerializable(async (tx) => {
    const lama = await tx.systemSetting.findUnique({ where: { key: KUNCI_PAJAK }, select: { value: true } });
    await tx.systemSetting.upsert({ where: { key: KUNCI_PAJAK }, create: { key: KUNCI_PAJAK, value: isi }, update: { value: isi } });
    await catatJejak(tx, {
      userId: olehUserId,
      action: JEJAK.PENGATURAN_KREATIF_DIUBAH,
      entityType: "SystemSetting",
      entityId: KUNCI_PAJAK,
      changes: { before: lama?.value ?? null, after: isi },
    });
  });
  const dihitungUlang = await hitungUlangTerminBelumDibayar({ olehUserId, sebab: "Tarif pajak diubah" });
  return { ok: true, tarif: v.tarif, dihitungUlang };
}
