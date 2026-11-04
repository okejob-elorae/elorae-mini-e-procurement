import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { batasHariWib, hariTutupYangBoleh, JEJAK_TUTUP_HARI } from "./tutup-hari";

/**
 * Pengingat laporan tutup hari — dipanggil cron 21:30 WIB (`lib/cron/jobs.ts`),
 * aman dipanggil berulang.
 *
 * Untuk setiap toko SPG yang HARI INI sudah punya nota tapi belum punya
 * laporan tutup hari: kabar `TUTUP_HARI_PENGINGAT` ke SPG toko itu yang
 * check-in hari ini (yang tidak masuk tidak diganggu). Sekali per toko per
 * hari WIB — penandanya jejak `SPG_DAILY_CLOSE_REMINDED` pada toko itu, ditulis
 * di transaksi serializable bersama pemeriksaannya, jadi dua server yang
 * menjalankan cron bersamaan tidak mengabari dua kali. Kabar dikirim SESUDAH
 * transaksi.
 *
 * Toko yang tidak ada satu pun SPG-nya check-in tidak ditandai: tidak ada yang
 * bisa diingatkan, dan penanda tanpa kabar hanya menyembunyikan itu.
 *
 * `storeIds` membatasi sapuan — WAJIB dipakai tes (basis data bersama).
 */
export async function ingatkanTutupHari(opsi: { sekarang?: Date; storeIds?: string[] } = {}): Promise<{ toko: number; orang: number }> {
  const sekarang = opsi.sekarang ?? new Date();
  const { hariIni: day } = hariTutupYangBoleh(sekarang);
  const { awal, akhir } = batasHariWib(day);
  const rentang = { gte: awal, lt: akhir };

  const spg = await prisma.user.findMany({
    where: { assignedStoreId: opsi.storeIds ? { in: opsi.storeIds } : { not: null } },
    select: { id: true, assignedStoreId: true },
    orderBy: { id: "asc" },
  });
  const perToko = new Map<string, string[]>();
  for (const s of spg) {
    if (!s.assignedStoreId) continue;
    perToko.set(s.assignedStoreId, [...(perToko.get(s.assignedStoreId) ?? []), s.id]);
  }
  const storeIds = [...perToko.keys()];
  if (storeIds.length === 0) return { toko: 0, orang: 0 };

  const [jual, tutup] = await Promise.all([
    prisma.spgSale.groupBy({ by: ["storeId"], where: { storeId: { in: storeIds }, createdAt: rentang }, _count: { _all: true } }),
    prisma.spgDailyClose.findMany({ where: { day, storeId: { in: storeIds } }, select: { storeId: true } }),
  ]);
  const sudahTutup = new Set(tutup.map((t) => t.storeId));
  const notaPerToko = new Map(jual.map((j) => [j.storeId, j._count._all]));
  const toko = await prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } });
  const namaToko = new Map(toko.map((t) => [t.id, t.name]));

  let jumlahToko = 0;
  let orang = 0;
  for (const storeId of storeIds) {
    const nota = notaPerToko.get(storeId) ?? 0;
    if (nota === 0 || sudahTutup.has(storeId)) continue;
    const masuk = await prisma.storeVisit.findMany({
      where: { storeId, userId: { in: perToko.get(storeId)! }, checkinAt: rentang },
      select: { userId: true },
      distinct: ["userId"],
    });
    const penerima = masuk.map((v) => v.userId).sort();
    if (penerima.length === 0) continue;

    const ditulis = await runSerializable(async (tx) => {
      const [sudah, kini] = await Promise.all([
        tx.auditLog.findFirst({
          where: { entityType: "Store", entityId: storeId, action: JEJAK_TUTUP_HARI.DIINGATKAN, createdAt: rentang },
          select: { id: true },
        }),
        // Laporan bisa masuk di antara pembacaan di atas dan sekarang.
        tx.spgDailyClose.findUnique({ where: { storeId_day: { storeId, day } }, select: { id: true } }),
      ]);
      if (sudah || kini) return false;
      await tx.auditLog.create({
        data: {
          userId: penerima[0],
          action: JEJAK_TUTUP_HARI.DIINGATKAN,
          entityType: "Store",
          entityId: storeId,
          metadata: { day, nota, penerima: penerima.length, otomatis: true },
          createdAt: sekarang,
        },
      });
      return true;
    });
    if (!ditulis) continue;
    jumlahToko += 1;
    for (const id of penerima) {
      orang += 1;
      await kabariPengguna(id, {
        jenis: JENIS_KABAR.TUTUP_HARI_PENGINGAT,
        judul: "Laporan tutup hari belum dikirim",
        isi: `${namaToko.get(storeId) ?? "Toko Anda"} sudah mencatat ${nota} nota hari ini. Kirim laporan tutup harinya di Lainnya → Tutup hari.`,
        data: { day },
      });
    }
  }
  return { toko: jumlahToko, orang };
}
