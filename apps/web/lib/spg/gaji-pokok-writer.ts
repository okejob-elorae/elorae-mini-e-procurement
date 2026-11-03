import { type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { bulanSahGaji, ENTITAS_GAJI_SPG, gajiBulananBerlaku, JEJAK_GAJI_SPG } from "./gaji-pokok";
import { bulanGajiDibayar } from "./gaji-pokok-queries";

/**
 * Gaji bulanan SPG di Pengaturan → Komisi SPG (keputusan pemilik 2026-11-02, P63: "gaji pokok tiap
 * SPG dicatat di Pengaturan, berlaku mulai bulan tertentu"; SPG toko putus juga digaji lewat
 * sistem). Satu baris per SPG × bulan mulai berlaku (`SpgSalary`), dicatat ulang (diubah) kalau
 * bulannya sama.
 *
 * Bulan yang SUDAH dibayar tidak pernah berubah: penulisan ditolak (`BULAN_SUDAH_DIBAYAR`) kalau
 * ia MENGGESER gaji yang berlaku di bulan kerja mana pun yang barisnya sudah dibayar. Menambah
 * gaji untuk bulan yang lebih tua dari bulan yang sudah dibayar boleh selama tidak menggeser bulan
 * yang dibayar itu — SPG yang mulai 10 Oktober tetapi gajinya baru diatur mulai November masih bisa
 * diberi gaji Oktober. Jejak `SPG_SALARY_SET` (sebelum/sesudah) di transaksi yang sama.
 */

/** Batas atas gaji bulanan: Decimal(15,2) → 13 digit rupiah. */
export const MAKS_GAJI_BULANAN = 9_999_999_999_999;

export type KodeTolakGaji = "JUMLAH_TIDAK_SAH" | "BULAN_TIDAK_SAH" | "BUKAN_SPG" | "BULAN_SUDAH_DIBAYAR";

type Tx = Prisma.TransactionClient;

/** Rupiah bulat 0 … `MAKS_GAJI_BULANAN`, dari angka atau teks angka; null kalau bukan. */
export function bacaJumlahGaji(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x.trim()) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAKS_GAJI_BULANAN) return null;
  return n;
}

/**
 * Bulan kerja sudah-dibayar yang gaji berlakunya akan bergeser kalau `baru` ditulis, atau null.
 * Murni: dipakai penulis dan dites sendiri.
 */
export function bulanDibayarYangBergeser(
  lama: ReadonlyArray<{ effectiveFrom: string; monthlyAmount: number }>,
  baru: { effectiveFrom: string; monthlyAmount: number },
  bulanDibayar: ReadonlySet<string>,
): string | null {
  const sesudah = [...lama.filter((r) => r.effectiveFrom !== baru.effectiveFrom), baru];
  for (const b of [...bulanDibayar].sort()) {
    if (b < baru.effectiveFrom) continue;
    if (gajiBulananBerlaku(lama, b) !== gajiBulananBerlaku(sesudah, b)) return b;
  }
  return null;
}

export async function aturGajiBulananSpg(input: {
  userId: string;
  jumlah: unknown;
  berlakuMulai: unknown;
  olehUserId: string;
}): Promise<{ ok: true } | { ok: false; kode: KodeTolakGaji; bulan?: string }> {
  const jumlah = bacaJumlahGaji(input.jumlah);
  if (jumlah === null) return { ok: false, kode: "JUMLAH_TIDAK_SAH" };
  if (!bulanSahGaji(input.berlakuMulai)) return { ok: false, kode: "BULAN_TIDAK_SAH" };
  const berlakuMulai = input.berlakuMulai;

  return runSerializable(async (tx: Tx) => {
    const u = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, assignedStoreId: true, spgEndedStoreId: true } });
    if (!u || (!u.assignedStoreId && !u.spgEndedStoreId)) return { ok: false as const, kode: "BUKAN_SPG" as const };
    const rows = await tx.spgSalary.findMany({ where: { userId: u.id }, select: { id: true, effectiveFrom: true, monthlyAmount: true } });
    const lama = rows.map((r) => ({ effectiveFrom: r.effectiveFrom, monthlyAmount: Number(r.monthlyAmount) }));
    const dibayar = (await bulanGajiDibayar(tx, [u.id])).get(u.id) ?? new Set<string>();
    const bergeser = bulanDibayarYangBergeser(lama, { effectiveFrom: berlakuMulai, monthlyAmount: jumlah }, dibayar);
    if (bergeser) return { ok: false as const, kode: "BULAN_SUDAH_DIBAYAR" as const, bulan: bergeser };

    const ada = rows.find((r) => r.effectiveFrom === berlakuMulai) ?? null;
    if (ada && Number(ada.monthlyAmount) === jumlah) return { ok: true as const };
    const baris = ada
      ? await tx.spgSalary.update({ where: { id: ada.id }, data: { monthlyAmount: jumlah, updatedById: input.olehUserId }, select: { id: true } })
      : await tx.spgSalary.create({
          data: { userId: u.id, monthlyAmount: jumlah, effectiveFrom: berlakuMulai, createdById: input.olehUserId },
          select: { id: true },
        });
    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_GAJI_SPG.DIATUR,
        entityType: ENTITAS_GAJI_SPG,
        entityId: baris.id,
        changes: {
          before: ada ? { effectiveFrom: berlakuMulai, monthlyAmount: Number(ada.monthlyAmount) } : null,
          after: { effectiveFrom: berlakuMulai, monthlyAmount: jumlah },
        } as Prisma.InputJsonValue,
        metadata: { spgUserId: u.id, effectiveFrom: berlakuMulai } as Prisma.InputJsonValue,
      },
    });
    return { ok: true as const };
  });
}
