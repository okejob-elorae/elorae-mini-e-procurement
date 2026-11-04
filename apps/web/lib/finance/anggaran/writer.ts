import { Prisma } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";
import { runSerializable } from "@/lib/db/tx-retry";
import { BULAN, JENIS_AKUN_ANGGARAN, type IsianAnggaran, type KodeTolakAnggaran } from "./aturan";

/** Nama tindakan jejak — dicari di Jejak Audit. */
export const JEJAK_ANGGARAN = { DIUBAH: "BUDGET_UPDATED" } as const;

type PerubahanSel = { akun: string; kodeAkun: string; bulan: number; sebelum: number | null; sesudah: number | null };

export type HasilSimpanAnggaran =
  | { ok: true; diubah: number }
  | { ok: false; kode: KodeTolakAnggaran };

const keSen = (v: number): number => Math.round(Number((v * 100).toFixed(4)));

/**
 * Simpan isian anggaran satu tahun (hanya akun yang dikirim). Sel kosong
 * menghapus anggaran bulan itu; angka (termasuk 0) disimpan. Hanya sel yang
 * BERUBAH yang ditulis, dan semuanya + satu baris jejak (`BUDGET_UPDATED`,
 * berisi pasangan sebelum/sesudah per sel) dalam SATU transaksi serializable —
 * dua orang yang menyimpan bersamaan tidak saling menimpa tanpa jejak.
 *
 * Akun harus akun laba rugi yang bisa diposting (bukan induk).
 */
export async function simpanAnggaran(isian: IsianAnggaran, opsi: { olehUserId: string }): Promise<HasilSimpanAnggaran> {
  if (isian.baris.length === 0) return { ok: true, diubah: 0 };
  const ids = isian.baris.map((b) => b.chartAccountId);

  return runSerializable(async (tx) => {
    const [akun, anak, lama] = await Promise.all([
      tx.chartAccount.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, type: true } }),
      tx.chartAccount.findMany({ where: { parentId: { in: ids } }, select: { parentId: true } }),
      tx.budget.findMany({
        where: { year: isian.tahun, chartAccountId: { in: ids } },
        select: { id: true, chartAccountId: true, month: true, amount: true },
      }),
    ]);
    const kode = new Map(akun.map((a) => [a.id, a]));
    const induk = new Set(anak.map((a) => a.parentId));
    for (const id of ids) {
      const a = kode.get(id);
      if (!a || !JENIS_AKUN_ANGGARAN.includes(a.type as AccountType) || induk.has(id)) return { ok: false, kode: "AKUN_TIDAK_SAH" } as const;
    }
    const ada = new Map(lama.map((b) => [`${b.chartAccountId}|${b.month}`, b]));

    const perubahan: PerubahanSel[] = [];
    for (const baris of isian.baris) {
      for (const bulan of BULAN) {
        const sesudah = baris.bulan[bulan - 1];
        const rekam = ada.get(`${baris.chartAccountId}|${bulan}`);
        const sebelum = rekam ? Number(rekam.amount) : null;
        const sama = sebelum === null ? sesudah === null : sesudah !== null && keSen(sebelum) === keSen(sesudah);
        if (sama) continue;
        if (sesudah === null) {
          await tx.budget.delete({ where: { id: rekam!.id } });
        } else if (rekam) {
          await tx.budget.update({
            where: { id: rekam.id },
            data: { amount: new Prisma.Decimal(sesudah), updatedById: opsi.olehUserId },
          });
        } else {
          await tx.budget.create({
            data: {
              chartAccountId: baris.chartAccountId,
              year: isian.tahun,
              month: bulan,
              amount: new Prisma.Decimal(sesudah),
              updatedById: opsi.olehUserId,
            },
          });
        }
        perubahan.push({ akun: baris.chartAccountId, kodeAkun: kode.get(baris.chartAccountId)!.code, bulan, sebelum, sesudah });
      }
    }

    if (perubahan.length > 0) {
      await tx.auditLog.create({
        data: {
          userId: opsi.olehUserId,
          action: JEJAK_ANGGARAN.DIUBAH,
          entityType: "Budget",
          entityId: String(isian.tahun),
          changes: { sel: perubahan } as unknown as Prisma.InputJsonValue,
          metadata: { tahun: isian.tahun, jumlahSel: perubahan.length } as Prisma.InputJsonValue,
        },
      });
    }
    return { ok: true, diubah: perubahan.length } as const;
  });
}
