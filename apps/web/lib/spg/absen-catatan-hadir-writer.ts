import type { AdminNotification, Prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { capNotificationText } from "@/lib/notifications/text";
import { salesMonthLabelId } from "@/lib/spg-commission/payout";
import {
  ENTITAS_CATATAN_HADIR,
  JEJAK_CATATAN_HADIR,
  KATEGORI_NOTIF_CATATAN_HADIR,
  MAKS_CATATAN_KEMBALI,
  potretHariCatatan,
  rapikanHariCatatan,
  type GalatBaris,
  type KodeGalatHariCatatan,
  type SumberCatatanHadir,
} from "./absen-catatan-hadir";
import { bulanSahGaji, masaKerjaBulan } from "./gaji-pokok";
import { bulanGajiDibayar } from "./gaji-pokok-queries";

/**
 * Penulis catatan check-in toko SPG (P7d, P7e, P61, P61a).
 *
 * - Simpan (`spg_attendance:record`): seluruh hari catatan diganti, statusnya DIAJUKAN, versinya
 *   naik, pemeriksaan sebelumnya dihapus. Jejak `SPG_ATTENDANCE_RECORD_ENTERED` (potret hari
 *   sebelum/sesudah) di transaksi yang sama; `SPG_ATTENDANCE_SUBMITTED` ke pemegang
 *   `spg_attendance:verify` sesudahnya.
 * - Periksa / kembalikan (`spg_attendance:verify`): tukar-bandingkan (status, version) di dalam
 *   `runSerializable`. Tidak ada yang memeriksa catatan yang ikut ia simpan SEJAK pemeriksaan
 *   terakhir (`PEMERIKSA_SAMA`, admin juga) — dibaca dari jejak simpannya, bukan hanya penyimpan
 *   terakhir, supaya orang yang mengetik sebagian besar hari tidak bisa memeriksanya sesudah orang
 *   lain membetulkan satu hari.
 * - Catatan bulan yang gajinya sudah dibayar tidak bisa diubah atau diperiksa (`SUDAH_DIBAYAR`).
 */

type Tx = Prisma.TransactionClient;

export type KodeSimpanCatatan =
  | "BUKAN_SPG"
  | "BULAN_TIDAK_SAH"
  | KodeGalatHariCatatan
  | "CATATAN_BERUBAH"
  | "SUDAH_DIBAYAR";

export type KodePeriksaCatatan = "TIDAK_DITEMUKAN" | "CATATAN_BERUBAH" | "PEMERIKSA_SAMA" | "SUDAH_DIBAYAR" | "ALASAN_WAJIB" | "ALASAN_TERLALU_PANJANG";

async function fanOut(n: AdminNotification | null) {
  if (n) await fanOutAdminNotification({ id: n.id, category: n.category, title: n.title, message: n.message, metadata: n.metadata });
}

async function namaSpg(tx: Tx, userId: string): Promise<string> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return u?.name?.trim() || u?.email || "SPG";
}

export async function simpanCatatanHadir(input: {
  userId: string;
  bulan: string;
  hari: unknown;
  sumber: SumberCatatanHadir;
  berkasR2Key?: string | null;
  versi: number | null;
  olehUserId: string;
  sekarang?: Date;
}): Promise<{ ok: true; versi: number } | { ok: false; kode: KodeSimpanCatatan; galat?: GalatBaris[] }> {
  if (!bulanSahGaji(input.bulan)) return { ok: false, kode: "BULAN_TIDAK_SAH" };
  const sekarang = input.sekarang ?? new Date();
  const hariIni = kunciHariWib(sekarang);
  const sesudah: { notif: AdminNotification | null } = { notif: null };
  const hasil = await runSerializable(async (tx) => {
    sesudah.notif = null;
    const u = await tx.user.findUnique({
      where: { id: input.userId },
      select: { assignedStoreId: true, spgEndedStoreId: true, spgStartedOn: true, spgEndedOn: true },
    });
    const storeId = u?.assignedStoreId ?? u?.spgEndedStoreId ?? null;
    if (!u || !storeId) return { ok: false as const, kode: "BUKAN_SPG" as const };
    const r = rapikanHariCatatan(input.hari, masaKerjaBulan(input.bulan, u.spgStartedOn, u.spgEndedOn), hariIni);
    if (!r.ok) return { ok: false as const, kode: r.galat[0]?.kode ?? ("HARI_TIDAK_SAH" as const), galat: r.galat };
    if ((await bulanGajiDibayar(tx, [input.userId])).get(input.userId)?.has(input.bulan)) return { ok: false as const, kode: "SUDAH_DIBAYAR" as const };

    const ada = await tx.spgAttendanceRecord.findUnique({
      where: { userId_month: { userId: input.userId, month: input.bulan } },
      select: { id: true, version: true, status: true, fileR2Key: true, days: { select: { day: true, kind: true, present: true } } },
    });
    if ((ada?.version ?? null) !== input.versi) return { ok: false as const, kode: "CATATAN_BERUBAH" as const };
    const isi = {
      storeId,
      status: "DIAJUKAN",
      source: input.sumber,
      // Lampiran lama (berkas atau foto kertasnya) tetap menempel bila simpanan ini tidak membawa yang baru.
      fileR2Key: input.berkasR2Key ?? ada?.fileR2Key ?? null,
      enteredById: input.olehUserId,
      enteredAt: sekarang,
      checkedById: null,
      checkedAt: null,
      returnNote: null,
    };
    let recordId: string;
    let versi: number;
    if (ada) {
      const u2 = await tx.spgAttendanceRecord.updateMany({ where: { id: ada.id, version: ada.version }, data: { ...isi, version: { increment: 1 } } });
      if (u2.count !== 1) return { ok: false as const, kode: "CATATAN_BERUBAH" as const };
      await tx.spgAttendanceRecordDay.deleteMany({ where: { recordId: ada.id } });
      recordId = ada.id;
      versi = ada.version + 1;
    } else {
      const baru = await tx.spgAttendanceRecord.create({ data: { ...isi, userId: input.userId, month: input.bulan, version: 1 }, select: { id: true } });
      recordId = baru.id;
      versi = 1;
    }
    await tx.spgAttendanceRecordDay.createMany({ data: r.hari.map((h) => ({ recordId, day: h.day, kind: h.kind, present: h.present, note: h.note })) });
    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_CATATAN_HADIR.DIMASUKKAN,
        entityType: ENTITAS_CATATAN_HADIR,
        entityId: recordId,
        changes: {
          before: ada ? { status: ada.status, version: ada.version, hari: potretHariCatatan(ada.days) } : null,
          after: { status: "DIAJUKAN", version: versi, hari: potretHariCatatan(r.hari), sumber: input.sumber },
        } as Prisma.InputJsonValue,
        metadata: { userId: input.userId, bulan: input.bulan, storeId, berkas: input.berkasR2Key ?? null } as Prisma.InputJsonValue,
      },
    });
    const nama = await namaSpg(tx, input.userId);
    const label = salesMonthLabelId(input.bulan);
    sesudah.notif = await tx.adminNotification.create({
      data: {
        category: KATEGORI_NOTIF_CATATAN_HADIR.DIAJUKAN,
        title: capNotificationText(`Catatan check-in toko ${nama} ${label} menunggu diperiksa`),
        message: capNotificationText(`Cocokkan dengan kertas atau berkas aslinya sebelum gaji ${label} dihitung.`),
        metadata: { recordId, userId: input.userId, bulan: input.bulan },
      },
    });
    return { ok: true as const, versi };
  });
  if (hasil.ok) await fanOut(sesudah.notif);
  return hasil;
}

/** Penyimpan catatan sejak pemeriksaan terakhirnya (dari jejak simpan). */
async function penyimpanSejakDiperiksa(tx: Tx, recordId: string): Promise<Set<string>> {
  const jejak = await tx.auditLog.findMany({
    where: { entityType: ENTITAS_CATATAN_HADIR, entityId: recordId, action: { in: [JEJAK_CATATAN_HADIR.DIMASUKKAN, JEJAK_CATATAN_HADIR.DIPERIKSA] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { action: true, userId: true },
  });
  let sejak = new Set<string>();
  for (const j of jejak) {
    if (j.action === JEJAK_CATATAN_HADIR.DIPERIKSA) sejak = new Set();
    else if (j.userId) sejak.add(j.userId);
  }
  return sejak;
}

async function putuskanCatatan(input: {
  recordId: string;
  versi: number;
  olehUserId: string;
  hasil: "DIPERIKSA" | "DIKEMBALIKAN";
  catatan?: unknown;
  sekarang?: Date;
}): Promise<{ ok: true } | { ok: false; kode: KodePeriksaCatatan }> {
  let catatan: string | null = null;
  if (input.hasil === "DIKEMBALIKAN") {
    const t = typeof input.catatan === "string" ? input.catatan.trim() : "";
    if (!t) return { ok: false, kode: "ALASAN_WAJIB" };
    if (t.length > MAKS_CATATAN_KEMBALI) return { ok: false, kode: "ALASAN_TERLALU_PANJANG" };
    catatan = t;
  }
  const sekarang = input.sekarang ?? new Date();
  const sesudah: { notif: AdminNotification | null } = { notif: null };
  const hasil = await runSerializable(async (tx): Promise<{ ok: true } | { ok: false; kode: KodePeriksaCatatan }> => {
    sesudah.notif = null;
    const r = await tx.spgAttendanceRecord.findUnique({
      where: { id: input.recordId },
      select: { id: true, userId: true, month: true, status: true, version: true, storeId: true, enteredById: true },
    });
    if (!r) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (r.version !== input.versi || r.status !== "DIAJUKAN") return { ok: false, kode: "CATATAN_BERUBAH" };
    const penyimpan = await penyimpanSejakDiperiksa(tx, r.id);
    if (penyimpan.has(input.olehUserId) || r.enteredById === input.olehUserId) return { ok: false, kode: "PEMERIKSA_SAMA" };
    if ((await bulanGajiDibayar(tx, [r.userId])).get(r.userId)?.has(r.month)) return { ok: false, kode: "SUDAH_DIBAYAR" };
    const u = await tx.spgAttendanceRecord.updateMany({
      where: { id: r.id, status: "DIAJUKAN", version: input.versi },
      data:
        input.hasil === "DIPERIKSA"
          ? { status: "DIPERIKSA", checkedById: input.olehUserId, checkedAt: sekarang, returnNote: null }
          : { status: "DIKEMBALIKAN", checkedById: input.olehUserId, checkedAt: sekarang, returnNote: catatan },
    });
    if (u.count !== 1) return { ok: false, kode: "CATATAN_BERUBAH" };
    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: input.hasil === "DIPERIKSA" ? JEJAK_CATATAN_HADIR.DIPERIKSA : JEJAK_CATATAN_HADIR.DIKEMBALIKAN,
        entityType: ENTITAS_CATATAN_HADIR,
        entityId: r.id,
        changes: { before: { status: r.status, version: r.version }, after: { status: input.hasil, version: r.version } } as Prisma.InputJsonValue,
        metadata: { userId: r.userId, bulan: r.month, storeId: r.storeId } as Prisma.InputJsonValue,
        reason: catatan,
      },
    });
    if (input.hasil === "DIKEMBALIKAN") {
      const nama = await namaSpg(tx, r.userId);
      sesudah.notif = await tx.adminNotification.create({
        data: {
          category: KATEGORI_NOTIF_CATATAN_HADIR.DIKEMBALIKAN,
          title: capNotificationText(`Catatan check-in toko ${nama} ${salesMonthLabelId(r.month)} dikembalikan`),
          message: capNotificationText("Perbaiki sesuai catatan pemeriksa, lalu simpan lagi."),
          metadata: { recordId: r.id, userId: r.userId, bulan: r.month },
        },
      });
    }
    return { ok: true };
  });
  if (hasil.ok) await fanOut(sesudah.notif);
  return hasil;
}

export function periksaCatatanHadir(input: { recordId: string; versi: number; olehUserId: string; sekarang?: Date }) {
  return putuskanCatatan({ ...input, hasil: "DIPERIKSA" });
}

export function kembalikanCatatanHadir(input: { recordId: string; versi: number; olehUserId: string; catatan: unknown; sekarang?: Date }) {
  return putuskanCatatan({ ...input, hasil: "DIKEMBALIKAN" });
}

/**
 * Pengingat P7e ("kantor diingatkan"): saat siklus dikunci atau bulan putus ditetapkan dengan baris
 * yang tertahan `CATATAN_HADIR_BELUM_DIMASUKKAN`, satu `SPG_ATTENDANCE_NEEDED` per SPG × bulan —
 * dicocokkan pada metadatanya di JS (penyaringan jalur JSON tidak andal). Ditulis di transaksi
 * pemanggil; pemanggil menyebarkannya sesudah komit.
 */
export async function ingatkanCatatanHadirPerlu(
  tx: Tx,
  input: { userId: string; storeId: string; bulan: string; hari: readonly string[] },
): Promise<AdminNotification | null> {
  const ada = await tx.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_CATATAN_HADIR.PERLU }, select: { metadata: true } });
  const sudah = ada.some((n) => {
    const m = n.metadata as { userId?: unknown; bulan?: unknown } | null;
    return m?.userId === input.userId && m?.bulan === input.bulan;
  });
  if (sudah) return null;
  const nama = await namaSpg(tx, input.userId);
  const label = salesMonthLabelId(input.bulan);
  return tx.adminNotification.create({
    data: {
      category: KATEGORI_NOTIF_CATATAN_HADIR.PERLU,
      title: capNotificationText(`Catatan check-in toko ${nama} ${label} belum dimasukkan`),
      message: capNotificationText(`Gaji pokok dan komisi ${label} menunggu sampai catatan check-in toko dimasukkan dan diperiksa.`),
      metadata: { userId: input.userId, storeId: input.storeId, bulan: input.bulan, hari: [...input.hari] },
    },
  });
}

export async function sebarPengingatCatatan(daftar: readonly (AdminNotification | null)[]): Promise<void> {
  for (const n of daftar) await fanOut(n);
}

