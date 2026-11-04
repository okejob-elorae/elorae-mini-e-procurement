import { prisma, type Prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { runSerializable } from "@/lib/db/tx-retry";
import { ENTITAS_TUKAR_SHIFT, JEJAK_SHIFT, STATUS_TUKAR_TERBUKA } from "@/lib/spg/shift";
import { bulanGajiDibayar } from "@/lib/spg/gaji-pokok-queries";
import { keadaanSesudahAkhir } from "@/lib/spg/utang-queries";
import { JEJAK_SPG_BERHENTI, MAKS_ALASAN_BERHENTI, periksaBerhentiSpg, periksaMulaiSpg, type KodeTolakBerhenti, type KodeTolakMulai } from "./spg-berhenti";

/**
 * Penulis "SPG berhenti", pembatalannya, dan tanggal mulai bekerja SPG (Pengaturan → Pengguna,
 * `settings_security:manage`, diperiksa aksinya). Setiap langkah satu `runSerializable` dengan
 * tukar-bandingkan pada keadaan penggunanya (`updateMany` bukan tukar-bandingkan atomik di Prisma 7)
 * dan jejaknya di transaksi yang sama.
 */

type Tx = Prisma.TransactionClient;

/** Hari WIB check-in / penjualan pertama dan terakhir SPG ini di tokonya. */
async function kegiatanDiToko(tx: Tx, userId: string, storeId: string): Promise<{ pertama: string | null; terakhir: string | null }> {
  const [kunjungan, jual] = await Promise.all([
    tx.storeVisit.aggregate({ where: { userId, storeId }, _min: { checkinAt: true }, _max: { checkinAt: true } }),
    tx.spgSale.aggregate({ where: { salesmanId: userId, storeId }, _min: { createdAt: true }, _max: { createdAt: true } }),
  ]);
  const hari = (d: Date | null | undefined) => (d ? kunciHariWib(d) : null);
  const semua = [hari(kunjungan._min?.checkinAt), hari(kunjungan._max?.checkinAt), hari(jual._min?.createdAt), hari(jual._max?.createdAt)].filter(
    (x): x is string => Boolean(x),
  );
  if (semua.length === 0) return { pertama: null, terakhir: null };
  semua.sort();
  return { pertama: semua[0], terakhir: semua[semua.length - 1] };
}

/**
 * Tandai SPG berhenti (B25). Hari terakhirnya tidak di depan, tidak sebelum tanggal mulainya, dan
 * tidak sebelum check-in atau penjualan terakhirnya. Toko dilepas, ajuan tukar shift yang masih
 * terbuka dibatalkan; sel jadwalnya DIBIARKAN (setiap pembaca mengabaikan sel sesudah hari terakhir).
 */
export async function tandaiSpgBerhenti(input: {
  userId: string;
  hariTerakhir: unknown;
  alasan: unknown;
  olehUserId: string;
  sekarang?: Date;
}): Promise<{ ok: true } | { ok: false; kode: KodeTolakBerhenti }> {
  const hariIni = kunciHariWib(input.sekarang ?? new Date());
  return runSerializable(async (tx): Promise<{ ok: true } | { ok: false; kode: KodeTolakBerhenti }> => {
    const u = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, assignedStoreId: true, spgStartedOn: true, spgEndedOn: true } });
    if (!u) return { ok: false, kode: "BUKAN_SPG" };
    if (u.spgEndedOn) return { ok: false, kode: "SUDAH_BERHENTI" };
    if (!u.assignedStoreId) return { ok: false, kode: "BUKAN_SPG" };
    const kegiatan = await kegiatanDiToko(tx, u.id, u.assignedStoreId);
    const p = periksaBerhentiSpg({ hariTerakhir: input.hariTerakhir, alasan: input.alasan, hariIni, mulai: u.spgStartedOn, kegiatanTerakhir: kegiatan.terakhir });
    if (!p.ok) return p;
    const r = await tx.user.updateMany({
      where: { id: u.id, spgEndedOn: null, assignedStoreId: u.assignedStoreId },
      data: { spgEndedOn: p.hariTerakhir, spgEndedStoreId: u.assignedStoreId, assignedStoreId: null },
    });
    if (r.count !== 1) return { ok: false, kode: "SUDAH_BERHENTI" };
    const terbuka = await tx.spgShiftSwap.findMany({
      where: { status: { in: [...STATUS_TUKAR_TERBUKA] }, OR: [{ requesterId: u.id }, { partnerId: u.id }] },
      select: { id: true, status: true },
    });
    for (const s of terbuka) {
      const b = await tx.spgShiftSwap.updateMany({ where: { id: s.id, status: s.status }, data: { status: "DIBATALKAN" } });
      if (b.count !== 1) continue;
      await tx.auditLog.create({
        data: {
          userId: input.olehUserId,
          action: JEJAK_SHIFT.TUKAR_DIBATALKAN,
          entityType: ENTITAS_TUKAR_SHIFT,
          entityId: s.id,
          changes: { before: { status: s.status }, after: { status: "DIBATALKAN" } } as Prisma.InputJsonValue,
          reason: "SPG berhenti",
        },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_SPG_BERHENTI.DITANDAI,
        entityType: "User",
        entityId: u.id,
        changes: {
          before: { assignedStoreId: u.assignedStoreId, spgEndedOn: null, spgEndedStoreId: null },
          after: { assignedStoreId: null, spgEndedOn: p.hariTerakhir, spgEndedStoreId: u.assignedStoreId },
        } as Prisma.InputJsonValue,
        metadata: { tukarDibatalkan: terbuka.map((s) => s.id) } as Prisma.InputJsonValue,
        reason: p.alasan,
      },
    });
    return { ok: true };
  });
}

/**
 * Batalkan penanda berhenti: tokonya kembali, hari terakhirnya dihapus. Ditolak begitu ada utang SPG
 * atas namanya atau pembayaran terakhirnya sudah terjadi (`SUDAH_DISELESAIKAN`) — pembayaran yang
 * sungguh dibayar: SPG yang ditandai berhenti tanpa satu pun baris gaji yang dibayar (misalnya
 * salah tandai sebelum ia sempat bekerja) masih bisa dibatalkan. Ajuan tukar shift yang dibatalkan
 * tidak dikembalikan.
 */
export async function batalkanSpgBerhenti(input: {
  userId: string;
  alasan: unknown;
  olehUserId: string;
}): Promise<{ ok: true } | { ok: false; kode: "BELUM_BERHENTI" | "SUDAH_DISELESAIKAN" | "ALASAN_WAJIB" | "ALASAN_TERLALU_PANJANG" }> {
  const alasan = typeof input.alasan === "string" ? input.alasan.trim() : "";
  if (!alasan) return { ok: false, kode: "ALASAN_WAJIB" };
  if (alasan.length > MAKS_ALASAN_BERHENTI) return { ok: false, kode: "ALASAN_TERLALU_PANJANG" };
  return runSerializable(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, spgEndedOn: true, spgEndedStoreId: true } });
    if (!u?.spgEndedOn || !u.spgEndedStoreId) return { ok: false as const, kode: "BELUM_BERHENTI" as const };
    const [utang, dibayar] = await Promise.all([
      tx.spgDebt.findFirst({ where: { spgUserId: u.id }, select: { id: true } }),
      bulanGajiDibayar(tx, [u.id]),
    ]);
    const adaDibayar = (dibayar.get(u.id)?.size ?? 0) > 0;
    if (utang || (adaDibayar && (await keadaanSesudahAkhir(tx, u.id)).akhirDibayar)) return { ok: false as const, kode: "SUDAH_DISELESAIKAN" as const };
    const r = await tx.user.updateMany({
      where: { id: u.id, spgEndedOn: u.spgEndedOn, assignedStoreId: null },
      data: { assignedStoreId: u.spgEndedStoreId, spgEndedOn: null, spgEndedStoreId: null },
    });
    if (r.count !== 1) return { ok: false as const, kode: "BELUM_BERHENTI" as const };
    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_SPG_BERHENTI.DIBATALKAN,
        entityType: "User",
        entityId: u.id,
        changes: {
          before: { assignedStoreId: null, spgEndedOn: u.spgEndedOn, spgEndedStoreId: u.spgEndedStoreId },
          after: { assignedStoreId: u.spgEndedStoreId, spgEndedOn: null, spgEndedStoreId: null },
        } as Prisma.InputJsonValue,
        reason: alasan,
      },
    });
    return { ok: true as const };
  });
}

/**
 * Tanggal mulai bekerja SPG di tokonya (B27, P62). Hanya selama belum ada gaji & komisi yang dibayar
 * (`MULAI_TERKUNCI`), dan tidak sesudah check-in / penjualan pertamanya di toko itu. Jejak
 * `USER_UPDATED` (spgStartedOn sebelum/sesudah) di transaksi yang sama.
 *
 * `aturMulaiSpgDalamTx` berjalan di dalam transaksi pemanggilnya (formulir Pengguna menulis toko
 * tetap dan tanggal mulai dalam satu transaksi serializable); pemanggil wajib membuka
 * `runSerializable`, karena tukar-bandingkan `updateMany` di bawah bukan tukar-bandingkan atomik.
 * Tombol "Tanggal mulai" memakai `aturMulaiSpg`, yang membuka transaksinya sendiri.
 */
export async function aturMulaiSpgDalamTx(
  tx: Tx,
  input: { userId: string; mulai: unknown; olehUserId: string },
): Promise<{ ok: true } | { ok: false; kode: KodeTolakMulai }> {
  const u = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, assignedStoreId: true, spgEndedStoreId: true, spgStartedOn: true } });
  const storeId = u?.assignedStoreId ?? u?.spgEndedStoreId ?? null;
  if (!u || !storeId) return { ok: false, kode: "BUKAN_SPG" };
  if (((await bulanGajiDibayar(tx, [u.id])).get(u.id)?.size ?? 0) > 0) return { ok: false, kode: "MULAI_TERKUNCI" };
  const p = periksaMulaiSpg({ mulai: input.mulai, kegiatanPertama: (await kegiatanDiToko(tx, u.id, storeId)).pertama });
  if (!p.ok) return p;
  if (u.spgStartedOn === p.mulai) return { ok: true };
  const r = await tx.user.updateMany({ where: { id: u.id, spgStartedOn: u.spgStartedOn }, data: { spgStartedOn: p.mulai } });
  if (r.count !== 1) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  await tx.auditLog.create({
    data: {
      userId: input.olehUserId,
      action: "USER_UPDATED",
      entityType: "User",
      entityId: u.id,
      changes: { before: { spgStartedOn: u.spgStartedOn }, after: { spgStartedOn: p.mulai } } as Prisma.InputJsonValue,
    },
  });
  return { ok: true };
}

export async function aturMulaiSpg(input: { userId: string; mulai: unknown; olehUserId: string }): Promise<{ ok: true } | { ok: false; kode: KodeTolakMulai }> {
  return runSerializable((tx) => aturMulaiSpgDalamTx(tx, input));
}

/**
 * SPG aktif ini sudah punya riwayat di tokonya (check-in, penjualan, jadwal, catatan check-in, atau
 * baris gaji). `klien` = transaksi pemanggil bila penjaganya harus melihat keadaan yang sama dengan
 * penulisannya (formulir Pengguna, ganti peran); tanpa itu dibaca lewat klien biasa.
 */
export async function adaRiwayatSpg(userId: string, storeId: string, klien: Tx | typeof prisma = prisma): Promise<boolean> {
  const [visit, jual, jadwal, catatan, konsi, putus] = await Promise.all([
    klien.storeVisit.findFirst({ where: { userId, storeId }, select: { id: true } }),
    klien.spgSale.findFirst({ where: { salesmanId: userId, storeId }, select: { id: true } }),
    klien.spgMonthSchedule.findFirst({ where: { userId, storeId }, select: { id: true } }),
    klien.spgAttendanceRecord.findFirst({ where: { userId, storeId }, select: { id: true } }),
    klien.consignmentCommission.findFirst({ where: { spgUserId: userId }, select: { id: true } }),
    klien.spgCommission.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  return Boolean(visit || jual || jadwal || catatan || konsi || putus);
}
