import { prisma, seededIds } from "@elorae/db";
import { hariBulan } from "./gaji-pokok";

/**
 * Perlengkapan TES basis data: dasar gaji pokok yang pasti untuk satu SPG × satu bulan kerja, supaya
 * tes pembayaran tidak tertahan (P60) karena hal yang bukan pokok tesnya. Membuat gaji bulanan yang
 * berlaku mulai bulan itu, mengisi tanggal mulai bekerja kalau kosong, dan catatan check-in toko
 * yang SUDAH DIPERIKSA dengan setiap hari KERJA dan hadir — gaji pokoknya tepat `jumlah`
 * (tanpa hari tidak masuk, tanpa hari libur yang dikerjakan).
 *
 * Teardown lewat `hapusGajiUji` dengan id pengguna yang di-seed tes itu sendiri (`seededIds`).
 */
export async function siapkanGajiUji(input: { userId: string; storeId: string; bulan: string; jumlah: number; olehUserId: string }): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: input.userId }, select: { spgStartedOn: true } });
  if (!u?.spgStartedOn) await prisma.user.update({ where: { id: input.userId }, data: { spgStartedOn: `${input.bulan}-01` } });
  await prisma.spgSalary.upsert({
    where: { userId_effectiveFrom: { userId: input.userId, effectiveFrom: input.bulan } },
    create: { userId: input.userId, effectiveFrom: input.bulan, monthlyAmount: input.jumlah, createdById: input.olehUserId },
    update: { monthlyAmount: input.jumlah, updatedById: input.olehUserId },
  });
  const sekarang = new Date();
  await prisma.spgAttendanceRecord.create({
    data: {
      userId: input.userId,
      storeId: input.storeId,
      month: input.bulan,
      status: "DIPERIKSA",
      version: 1,
      source: "MANUAL",
      enteredById: input.olehUserId,
      enteredAt: sekarang,
      checkedById: input.olehUserId,
      checkedAt: sekarang,
      days: { create: hariBulan(input.bulan).map((day) => ({ day, kind: "KERJA", present: true })) },
    },
  });
}

export async function hapusGajiUji(userIds: readonly string[]): Promise<void> {
  const ids = seededIds(userIds.filter(Boolean));
  const catatan = await prisma.spgAttendanceRecord.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  await prisma.spgAttendanceRecordDay.deleteMany({ where: { recordId: { in: seededIds(catatan.map((c) => c.id)) } } });
  await prisma.spgAttendanceRecord.deleteMany({ where: { userId: { in: ids } } });
  await prisma.spgMonthSchedule.deleteMany({ where: { userId: { in: ids } } });
  await prisma.spgSalary.deleteMany({ where: { userId: { in: ids } } });
}
