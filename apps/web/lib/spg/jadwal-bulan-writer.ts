import { prisma, type AdminNotification, type Prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { capNotificationText } from "@/lib/notifications/text";
import { salesMonthLabelId } from "@/lib/spg-commission/payout";
import { rangkaiDalamBatas } from "./antaran";
import { masaKerjaBulan } from "./gaji-pokok";
import { bulanGajiDibayar } from "./gaji-pokok-queries";
import {
  bulanBolehDiisiSpg,
  ENTITAS_JADWAL_BULAN,
  hariBelumTerisi,
  JEJAK_JADWAL_BULAN,
  KATEGORI_NOTIF_JADWAL_BULAN,
  potretSel,
  rapikanAlasanJadwal,
  rencanakanIsiJadwalBulanSpg,
  statusJadwalBulanDari,
  type KodeTolakIsiBulan,
  type StatusJadwalBulan,
} from "./jadwal-bulan";
import { bacaAturanShift, KUNCI_SHIFT } from "./pengaturan";
import { ENTITAS_JADWAL_SPG, geserHari, JEJAK_SHIFT, kunciSel, type IsianSel, type KodeTolakJadwalSpg, type PerubahanSel } from "./shift";

/**
 * Penulis jadwal bulanan SPG (P7c). Setiap langkah satu `runSerializable` dengan tukar-bandingkan
 * pada (status, version) — `updateMany` bukan tukar-bandingkan atomik di Prisma 7, jadi penjaganya
 * hanya sah di dalam transaksi serializable — dan jejaknya (dengan potret sel bulan itu) di
 * transaksi yang sama. Kabar `JADWAL_SPG` dan sebaran `SPG_SCHEDULE_SUBMITTED` SESUDAH transaksi;
 * yang tertangkap di percobaan yang diulang dibuang di awal setiap percobaan.
 *
 * Toko selalu toko tetap SPG itu, dibaca di server. Tidak ada yang memutuskan jadwalnya sendiri
 * (`PEMOHON_SAMA`, admin juga).
 */

type Tx = Prisma.TransactionClient;

export type KodeJadwalBulan =
  | "BULAN_TIDAK_SAH"
  | "BULAN_TIDAK_BOLEH"
  | "BUKAN_SPG"
  | "SPG_BERHENTI"
  | "JADWAL_BELUM_LENGKAP"
  | "STATUS_BERUBAH"
  | "JADWAL_BERUBAH"
  | "ALASAN_WAJIB"
  | "ALASAN_TERLALU_PANJANG"
  | "SUDAH_DIBAYAR"
  | "PEMOHON_SAMA"
  | "HARI_SUDAH_HADIR"
  | KodeTolakIsiBulan
  | KodeTolakJadwalSpg;

export type HasilJadwalBulan = { ok: true; status: StatusJadwalBulan; versi: number } | { ok: false; kode: KodeJadwalBulan; hari?: string[] };

const POLA_BULAN = /^\d{4}-(0[1-9]|1[0-2])$/;

const bulanDariHari = (hari: readonly string[]) => [...new Set(hari.filter((d) => typeof d === "string" && d.length >= 7).map((d) => d.slice(0, 7)))];

/**
 * Dipanggil DI DALAM transaksi setiap penulis sel `SpgShift`: isian SPG sendiri (`SPG`), kisi
 * mingguan kantor (`KANTOR`), dan tukar shift yang disetujui (`TUKAR`). Untuk setiap bulan yang
 * disentuh: kepala dibuat (DRAF) bila belum ada, `version` naik satu, dan bulan yang sudah
 * DISETUJUI kembali DIAJUKAN kalau pengubahnya tidak memegang `spg_schedules:approve`
 * (`bolehSetujui`) — isian SPG selalu, karena tidak ada yang menyetujui jadwalnya sendiri. Tukar
 * shift yang disetujui (`TUKAR`) mengikuti aturan kisi yang sama: penyetuju tukar tanpa izin
 * menyetujui jadwal menurunkan bulan itu (tinjauan rancangan akhir, butir 4 — tukar shift bisa
 * mengubah hari kerja/libur, jadi pembagi dan hari tambahan bulan yang sudah disetujui).
 */
export async function sentuhJadwalBulan(
  tx: Tx,
  input: { userId: string; storeId: string; hari: readonly string[]; olehUserId: string; sumber: "SPG" | "KANTOR" | "TUKAR"; bolehSetujui: boolean },
): Promise<void> {
  for (const month of bulanDariHari(input.hari)) {
    if (!POLA_BULAN.test(month)) continue;
    const ada = await tx.spgMonthSchedule.findUnique({ where: { userId_month: { userId: input.userId, month } }, select: { id: true, status: true } });
    if (!ada) {
      await tx.spgMonthSchedule.create({ data: { userId: input.userId, storeId: input.storeId, month, status: "DRAF", version: 1 } });
      continue;
    }
    const turun = ada.status === "DISETUJUI" && (input.sumber === "SPG" || !input.bolehSetujui);
    await tx.spgMonthSchedule.update({
      where: { id: ada.id },
      data: { version: { increment: 1 }, ...(turun ? { status: "DIAJUKAN", submittedAt: new Date(), submittedById: input.olehUserId } : {}) },
    });
  }
}

async function selBulan(tx: Tx, userId: string, storeId: string, month: string) {
  return tx.spgShift.findMany({
    where: { userId, storeId, day: { gte: `${month}-01`, lte: `${month}-31` } },
    select: { day: true, kind: true, shiftCode: true, startTime: true, endTime: true, userId: true },
  });
}

async function spgAktif(tx: Tx, userId: string, storeId: string): Promise<{ ok: true; mulai: string | null; akhir: string | null } | { ok: false; kode: "BUKAN_SPG" | "SPG_BERHENTI" }> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { assignedStoreId: true, spgStartedOn: true, spgEndedOn: true } });
  if (!u) return { ok: false, kode: "BUKAN_SPG" };
  if (u.spgEndedOn) return { ok: false, kode: "SPG_BERHENTI" };
  if (u.assignedStoreId !== storeId) return { ok: false, kode: "BUKAN_SPG" };
  return { ok: true, mulai: u.spgStartedOn, akhir: u.spgEndedOn };
}

function jejakSel(perubahan: readonly PerubahanSel[]): { before: Prisma.InputJsonObject; after: Prisma.InputJsonObject } {
  const before: Record<string, Prisma.InputJsonValue | null> = {};
  const after: Record<string, Prisma.InputJsonValue | null> = {};
  for (const p of perubahan) {
    const k = kunciSel(p.userId, p.day);
    before[k] = p.sebelum;
    after[k] = p.sesudah;
  }
  return { before, after } as { before: Prisma.InputJsonObject; after: Prisma.InputJsonObject };
}

/** SPG mengisi jadwal bulannya sendiri dari HP (bulan berjalan dan berikutnya). */
export async function isiJadwalBulanSaya(input: {
  userId: string;
  storeId: string;
  bulan: string;
  isian: readonly IsianSel[];
  sekarang?: Date;
}): Promise<HasilJadwalBulan> {
  if (!POLA_BULAN.test(input.bulan)) return { ok: false, kode: "BULAN_TIDAK_SAH" };
  const sekarang = input.sekarang ?? new Date();
  const hariIni = kunciHariWib(sekarang);
  return runSerializable(async (tx): Promise<HasilJadwalBulan> => {
    const spg = await spgAktif(tx, input.userId, input.storeId);
    if (!spg.ok) return spg;
    const [aturanRow, sebelum] = await Promise.all([
      tx.systemSetting.findUnique({ where: { key: KUNCI_SHIFT }, select: { value: true } }),
      selBulan(tx, input.userId, input.storeId, input.bulan),
    ]);
    const r = rencanakanIsiJadwalBulanSpg({
      bulan: input.bulan,
      hariIni,
      userId: input.userId,
      mulai: spg.mulai,
      akhir: spg.akhir,
      sebelum,
      isian: input.isian,
      aturan: bacaAturanShift(aturanRow?.value),
    });
    if (!r.ok) return { ok: false, kode: r.kode, ...("day" in r && r.day ? { hari: [r.day] } : {}) };
    const kepalaAda = await tx.spgMonthSchedule.findUnique({ where: { userId_month: { userId: input.userId, month: input.bulan } }, select: { status: true, version: true } });
    if (r.perubahan.length === 0) {
      return { ok: true, status: statusJadwalBulanDari(kepalaAda?.status) ?? "DRAF", versi: kepalaAda?.version ?? 0 };
    }
    // Hari yang sudah ia kerjakan (check-in di tokonya) tidak bisa ia ubah lagi — hari ini masuk
    // libur sesudah check-in akan membayar satu tarif harian tambahan (P65a).
    const hariBerubah = [...new Set(r.perubahan.map((p) => p.day))];
    const hariIniBerubah = hariBerubah.filter((d) => d <= hariIni);
    if (hariIniBerubah.length > 0) {
      const kunjungan = await tx.storeVisit.findMany({
        where: { userId: input.userId, storeId: input.storeId, checkinAt: { gte: new Date(`${hariIniBerubah[0]}T00:00:00+07:00`), lt: new Date(`${geserHari(hariIni, 1)}T00:00:00+07:00`) } },
        select: { checkinAt: true },
      });
      const hadir = new Set(kunjungan.map((k) => kunciHariWib(k.checkinAt)));
      const salah = hariIniBerubah.filter((d) => hadir.has(d));
      if (salah.length > 0) return { ok: false, kode: "HARI_SUDAH_HADIR", hari: salah };
    }

    for (const w of r.tulis) {
      const isi = { storeId: input.storeId, kind: w.kind, shiftCode: w.shiftCode, startTime: w.startTime, endTime: w.endTime };
      await tx.spgShift.upsert({
        where: { userId_day: { userId: input.userId, day: w.day } },
        create: { ...isi, userId: input.userId, day: w.day, createdById: input.userId },
        update: { ...isi, updatedById: input.userId },
      });
    }
    if (r.hapus.length > 0) {
      await tx.spgShift.deleteMany({ where: { OR: r.hapus.map((h) => ({ userId: input.userId, day: h.day })) } });
    }
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: JEJAK_SHIFT.DIUBAH,
        entityType: ENTITAS_JADWAL_SPG,
        entityId: input.storeId,
        changes: jejakSel(r.perubahan),
        metadata: { jumlahSel: r.perubahan.length, hari: hariBerubah, spg: [input.userId], sumber: "SPG", bulan: input.bulan },
      },
    });
    await sentuhJadwalBulan(tx, { userId: input.userId, storeId: input.storeId, hari: hariBerubah, olehUserId: input.userId, sumber: "SPG", bolehSetujui: false });
    const kepala = await tx.spgMonthSchedule.findUnique({ where: { userId_month: { userId: input.userId, month: input.bulan } }, select: { status: true, version: true } });
    return { ok: true, status: statusJadwalBulanDari(kepala?.status) ?? "DRAF", versi: kepala?.version ?? 0 };
  });
}

async function catatJejak(
  tx: Tx,
  isi: { userId: string; action: string; scheduleId: string; before: unknown; after: unknown; metadata: Record<string, unknown>; reason?: string | null },
) {
  await tx.auditLog.create({
    data: {
      userId: isi.userId,
      action: isi.action,
      entityType: ENTITAS_JADWAL_BULAN,
      entityId: isi.scheduleId,
      changes: { before: isi.before, after: isi.after } as Prisma.InputJsonValue,
      metadata: isi.metadata as Prisma.InputJsonValue,
      reason: isi.reason ?? null,
    },
  });
}

async function namaOrang(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return u?.name?.trim() || u?.email || "SPG";
}

/**
 * "Ajukan ke kantor": hanya bulan yang boleh diisi SPG (bulan berjalan dan berikutnya, B9) — bulan
 * yang sudah lewat tidak bisa ia ajukan lagi, hari kosongnya ditutup catatan check-in toko (P7e).
 * Semua hari yang masih bisa diisi harus berisi; DRAF/DITOLAK → DIAJUKAN.
 */
export async function ajukanJadwalBulan(input: { userId: string; storeId: string; bulan: string; sekarang?: Date }): Promise<HasilJadwalBulan> {
  if (!POLA_BULAN.test(input.bulan)) return { ok: false, kode: "BULAN_TIDAK_SAH" };
  const sekarang = input.sekarang ?? new Date();
  const hariIni = kunciHariWib(sekarang);
  if (!bulanBolehDiisiSpg(hariIni).includes(input.bulan)) return { ok: false, kode: "BULAN_TIDAK_BOLEH" };
  const sesudah: { notif: AdminNotification | null } = { notif: null };
  const hasil = await runSerializable(async (tx): Promise<HasilJadwalBulan> => {
    sesudah.notif = null;
    const spg = await spgAktif(tx, input.userId, input.storeId);
    if (!spg.ok) return spg;
    const sel = await selBulan(tx, input.userId, input.storeId, input.bulan);
    const kosong = hariBelumTerisi({
      bulan: input.bulan,
      hariIni,
      masa: masaKerjaBulan(input.bulan, spg.mulai, spg.akhir),
      sel: new Set(sel.map((s) => s.day)),
    });
    if (kosong.length > 0) return { ok: false, kode: "JADWAL_BELUM_LENGKAP", hari: kosong };
    const kepala =
      (await tx.spgMonthSchedule.findUnique({ where: { userId_month: { userId: input.userId, month: input.bulan } }, select: { id: true, status: true, version: true } })) ??
      (await tx.spgMonthSchedule.create({ data: { userId: input.userId, storeId: input.storeId, month: input.bulan, status: "DRAF", version: 0 }, select: { id: true, status: true, version: true } }));
    if (kepala.status === "DIAJUKAN") return { ok: true, status: "DIAJUKAN", versi: kepala.version };
    if (kepala.status === "DISETUJUI") return { ok: false, kode: "STATUS_BERUBAH" };
    const r = await tx.spgMonthSchedule.updateMany({
      where: { id: kepala.id, status: kepala.status, version: kepala.version },
      data: { status: "DIAJUKAN", submittedAt: sekarang, submittedById: input.userId, rejectReason: null },
    });
    if (r.count !== 1) return { ok: false, kode: "JADWAL_BERUBAH" };
    await catatJejak(tx, {
      userId: input.userId,
      action: JEJAK_JADWAL_BULAN.DIAJUKAN,
      scheduleId: kepala.id,
      before: { status: kepala.status, version: kepala.version },
      after: { status: "DIAJUKAN", version: kepala.version, sel: potretSel(sel) },
      metadata: { userId: input.userId, storeId: input.storeId, bulan: input.bulan },
    });
    const label = salesMonthLabelId(input.bulan);
    sesudah.notif = await tx.adminNotification.create({
      data: {
        category: KATEGORI_NOTIF_JADWAL_BULAN,
        severity: "INFO",
        title: capNotificationText(`Jadwal kerja ${label} diajukan SPG`),
        message: capNotificationText(`Jadwal kerja ${label} menunggu persetujuan kantor.`),
        metadata: { userId: input.userId, storeId: input.storeId, bulan: input.bulan },
      },
    });
    return { ok: true, status: "DIAJUKAN", versi: kepala.version };
  });
  if (hasil.ok && sesudah.notif) {
    const n = sesudah.notif;
    const nama = await namaOrang(input.userId);
    await fanOutAdminNotification({ id: n.id, category: n.category, title: capNotificationText(`${nama}: ${n.title}`), message: n.message, metadata: n.metadata });
  }
  return hasil;
}

type Keputusan = "SETUJUI" | "TOLAK" | "BUKA_LAGI";

/**
 * Bulan yang selnya sudah ada tetapi belum berkepala (sel yang ditulis sebelum kepala jadwal
 * bulanan ada): kepalanya dibuat DRAF versi 0 di transaksi keputusan itu, supaya kantor bisa
 * menyetujui atau menolaknya seperti bulan yang ia susun di kisi. Tanpa sel: tidak ada yang
 * diputuskan.
 */
async function kepalaDariSel(tx: Tx, userId: string, month: string): Promise<{ id: string; status: string; version: number; storeId: string } | null> {
  const sel = await tx.spgShift.findFirst({ where: { userId, day: { gte: `${month}-01`, lte: `${month}-31` } }, select: { storeId: true } });
  if (!sel) return null;
  return tx.spgMonthSchedule.create({ data: { userId, storeId: sel.storeId, month, status: "DRAF", version: 0 }, select: { id: true, status: true, version: true, storeId: true } });
}

async function putuskan(input: { userId: string; bulan: string; versi: number; olehUserId: string; alasan?: unknown; keputusan: Keputusan; sekarang?: Date }): Promise<HasilJadwalBulan> {
  if (!POLA_BULAN.test(input.bulan)) return { ok: false, kode: "BULAN_TIDAK_SAH" };
  if (input.userId === input.olehUserId) return { ok: false, kode: "PEMOHON_SAMA" };
  let alasan: string | null = null;
  if (input.keputusan !== "SETUJUI") {
    const a = rapikanAlasanJadwal(input.alasan);
    if (!a.ok) return a;
    alasan = a.teks;
  }
  const sekarang = input.sekarang ?? new Date();
  const sesudah: { kabar: Kabar | null } = { kabar: null };
  const hasil = await runSerializable(async (tx): Promise<HasilJadwalBulan> => {
    sesudah.kabar = null;
    const kepala =
      (await tx.spgMonthSchedule.findUnique({
        where: { userId_month: { userId: input.userId, month: input.bulan } },
        select: { id: true, status: true, version: true, storeId: true },
      })) ?? (input.keputusan !== "BUKA_LAGI" && input.versi === 0 ? await kepalaDariSel(tx, input.userId, input.bulan) : null);
    if (!kepala || kepala.version !== input.versi) return { ok: false, kode: "JADWAL_BERUBAH" };
    const dari: string[] = input.keputusan === "BUKA_LAGI" ? ["DISETUJUI"] : ["DRAF", "DIAJUKAN"];
    if (!dari.includes(kepala.status)) return { ok: false, kode: "STATUS_BERUBAH" };
    if (input.keputusan === "BUKA_LAGI") {
      const dibayar = (await bulanGajiDibayar(tx, [input.userId])).get(input.userId);
      if (dibayar?.has(input.bulan)) return { ok: false, kode: "SUDAH_DIBAYAR" };
    }
    const ke: StatusJadwalBulan = input.keputusan === "SETUJUI" ? "DISETUJUI" : input.keputusan === "TOLAK" ? "DITOLAK" : "DIAJUKAN";
    const r = await tx.spgMonthSchedule.updateMany({
      where: { id: kepala.id, status: kepala.status, version: input.versi },
      data: {
        status: ke,
        ...(input.keputusan === "BUKA_LAGI" ? { decidedAt: null, decidedById: null } : { decidedAt: sekarang, decidedById: input.olehUserId }),
        rejectReason: input.keputusan === "TOLAK" ? alasan : null,
      },
    });
    if (r.count !== 1) return { ok: false, kode: "JADWAL_BERUBAH" };
    const sel = await selBulan(tx, input.userId, kepala.storeId, input.bulan);
    const action =
      input.keputusan === "SETUJUI" ? JEJAK_JADWAL_BULAN.DISETUJUI : input.keputusan === "TOLAK" ? JEJAK_JADWAL_BULAN.DITOLAK : JEJAK_JADWAL_BULAN.DIBUKA_LAGI;
    await catatJejak(tx, {
      userId: input.olehUserId,
      action,
      scheduleId: kepala.id,
      before: { status: kepala.status, version: kepala.version },
      after: { status: ke, version: kepala.version, sel: potretSel(sel) },
      metadata: { userId: input.userId, storeId: kepala.storeId, bulan: input.bulan },
      reason: alasan,
    });
    const label = salesMonthLabelId(input.bulan);
    const isi =
      input.keputusan === "SETUJUI"
        ? `Jadwal kerja ${label} disetujui kantor.`
        : input.keputusan === "TOLAK"
          ? rangkaiDalamBatas([`Jadwal kerja ${label} dikembalikan: ${alasan}.`, "Silakan perbaiki lalu ajukan lagi."], 191)
          : rangkaiDalamBatas([`Kantor membuka lagi jadwal kerja ${label}: ${alasan}.`, "Jadwal itu menunggu persetujuan lagi."], 191);
    sesudah.kabar = {
      jenis: JENIS_KABAR.JADWAL_SPG,
      judul:
        input.keputusan === "SETUJUI" ? `Jadwal ${label} disetujui` : input.keputusan === "TOLAK" ? `Jadwal ${label} dikembalikan` : `Jadwal ${label} dibuka lagi`,
      isi,
      data: { bulan: input.bulan },
    };
    return { ok: true, status: ke, versi: kepala.version };
  });
  if (hasil.ok && sesudah.kabar) await kabariPengguna(input.userId, sesudah.kabar);
  return hasil;
}

export function setujuiJadwalBulan(input: { userId: string; bulan: string; versi: number; olehUserId: string; sekarang?: Date }): Promise<HasilJadwalBulan> {
  return putuskan({ ...input, keputusan: "SETUJUI" });
}

export function tolakJadwalBulan(input: { userId: string; bulan: string; versi: number; olehUserId: string; alasan: unknown; sekarang?: Date }): Promise<HasilJadwalBulan> {
  return putuskan({ ...input, keputusan: "TOLAK" });
}

export function bukaLagiJadwalBulan(input: { userId: string; bulan: string; versi: number; olehUserId: string; alasan: unknown; sekarang?: Date }): Promise<HasilJadwalBulan> {
  return putuskan({ ...input, keputusan: "BUKA_LAGI" });
}
