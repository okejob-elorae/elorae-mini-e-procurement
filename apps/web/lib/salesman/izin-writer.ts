import { Prisma, type AdminNotification } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { bentrokKunciKiriman } from "@/lib/receivables/idempoten";
import { bacaPengaturanAbsensi, KUNCI_PENGATURAN_ABSENSI } from "./absensi";
import { hariTidakKerjaSatu } from "./izin-queries";
import {
  ENTITAS_IZIN,
  JEJAK_IZIN,
  jejakPindahIzin,
  KATEGORI_NOTIF_IZIN,
  labelRentangIzin,
  NAMA_JENIS_IZIN,
  periksaAjuanIzin,
  periksaPindahIzin,
  STATUS_IZIN_HIDUP,
  tahunRentang,
  tanggalSah,
  terpakaiCuti,
  hitungHariKerja,
  type JenisIzin,
  type KodeTolakIzin,
  type KodeTolakPindahIzin,
  type PelakuIzin,
  type StatusIzin,
  type TolakKuota,
} from "./izin";

/**
 * Penulis izin/sakit/cuti.
 *
 * Mengajukan (HP), menarik ajuan sendiri yang masih menunggu (HP), dan keputusan
 * kantor: setujui, tolak, atau membatalkan izin yang sudah disetujui. Setiap
 * perubahan status menulis `AuditLog` DI DALAM transaksinya — baris izin hanya
 * menyimpan keputusan terakhir, jejaknya menyimpan semuanya.
 *
 * Semuanya `runSerializable`: dua ajuan bertumpuk yang dikirim bersamaan, atau
 * dua penyetuju yang menekan bersamaan, tidak bisa sama-sama lolos. Perubahan
 * status juga bandingkan-lalu-tukar (`updateMany … where status`), jadi tetap
 * benar seandainya isolasinya diturunkan.
 *
 * Catatan kantor dan kabar dikirim SESUDAH transaksi dan tidak pernah
 * membatalkannya.
 */

const KUNCI_MAKS = 100;

type Klien = Prisma.TransactionClient;

async function kuotaCuti(tx: Klien): Promise<number> {
  const row = await tx.systemSetting.findUnique({ where: { key: KUNCI_PENGATURAN_ABSENSI }, select: { value: true } });
  return bacaPengaturanAbsensi(row?.value).kuotaCutiTahunan;
}

/** Ajuan hidup lain milik orang ini yang menyentuh tahun-tahun rentang — cukup untuk bentrok DAN kuota. */
async function ajuanLain(tx: Klien, userId: string, mulai: string, selesai: string, kecuali?: string) {
  const tahun = tahunRentang(mulai, selesai);
  return tx.leaveRequest.findMany({
    where: {
      userId,
      status: { in: [...STATUS_IZIN_HIDUP] },
      startDay: { lte: `${tahun[tahun.length - 1]}-12-31` },
      endDay: { gte: `${tahun[0]}-01-01` },
      ...(kecuali ? { id: { not: kecuali } } : {}),
    },
    select: { type: true, startDay: true, endDay: true, status: true },
  });
}

// ─── Mengajukan ──────────────────────────────────────────────────────────────

export type HasilAjukanIzin =
  | { ok: true; id: string; ulang: boolean }
  | { ok: false; kode: KodeTolakIzin | "KUNCI_WAJIB" | "KUNCI_DIPAKAI" }
  | TolakKuota;

/**
 * Kunci kiriman diperiksa PALING DULU: kiriman ulang dari ajuan yang sudah
 * tersimpan (jaringan putus sesudah tersimpan, dua ketukan Kirim) mengembalikan
 * ajuan yang ada — tidak dinilai ulang, karena "sudah lewat 7 hari" atau
 * "bentrok dengan dirinya sendiri" akan menolak ajuan yang sebenarnya tercatat.
 */
export async function ajukanIzin(input: {
  userId: string;
  jenis: unknown;
  mulai: unknown;
  selesai: unknown;
  alasan: unknown;
  fotoUrl?: unknown;
  idempotencyKey: unknown;
  sekarang?: Date;
}): Promise<HasilAjukanIzin> {
  const kunci = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!kunci || kunci.length > KUNCI_MAKS) return { ok: false, kode: "KUNCI_WAJIB" };
  const hariIni = kunciHariWib(input.sekarang ?? new Date());

  // Diisi di dalam transaksi; percobaan ulang menyetelnya ulang supaya baris
  // dari percobaan yang dibatalkan tidak pernah ikut dikirim.
  let notifikasi: AdminNotification | null = null;
  const simpan = () =>
    runSerializable(async (tx): Promise<HasilAjukanIzin> => {
      notifikasi = null;
      const ada = await tx.leaveRequest.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, userId: true } });
      if (ada) return ada.userId === input.userId ? { ok: true, id: ada.id, ulang: true } : { ok: false, kode: "KUNCI_DIPAKAI" };

      const lain =
        tanggalSah(input.mulai) && tanggalSah(input.selesai) && input.mulai <= input.selesai
          ? await ajuanLain(tx, input.userId, input.mulai, input.selesai)
          : [];
      // Hari kerja PEMOHON: SPG menjaga counter akhir pekan, jadi Minggu bisa jadi hari kerjanya.
      const [kuotaCutiTahunan, hariTidakKerja] = await Promise.all([kuotaCuti(tx), hariTidakKerjaSatu(input.userId, tx)]);
      const cek = periksaAjuanIzin(
        { jenis: input.jenis, mulai: input.mulai, selesai: input.selesai, alasan: input.alasan, fotoUrl: input.fotoUrl ?? null },
        { hariIni, lain, kuotaCutiTahunan, hariTidakKerja },
      );
      if (!cek.ok) return cek;
      const v = cek.nilai;

      const pemohon = await tx.user.findUnique({ where: { id: input.userId }, select: { name: true, email: true } });
      const baris = await tx.leaveRequest.create({
        data: {
          userId: input.userId,
          type: v.jenis,
          startDay: v.mulai,
          endDay: v.selesai,
          reason: v.alasan,
          photoUrl: v.fotoUrl,
          idempotencyKey: kunci,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: JEJAK_IZIN.DIAJUKAN,
          entityType: ENTITAS_IZIN,
          entityId: baris.id,
          changes: { after: { status: "DIAJUKAN", jenis: v.jenis, mulai: v.mulai, selesai: v.selesai, hariKerja: v.hariKerja } },
        },
      });
      // Penyetuju diberi tahu, di transaksi yang sama: tercatat bersama ajuannya atau tidak sama sekali.
      const nama = pemohon?.name ?? pemohon?.email ?? "Salesman";
      notifikasi = await tx.adminNotification.create({
        data: {
          category: KATEGORI_NOTIF_IZIN,
          severity: "INFO",
          title: `${NAMA_JENIS_IZIN[v.jenis]} diajukan · ${nama}`,
          message:
            `${NAMA_JENIS_IZIN[v.jenis]} ${labelRentangIzin(v.mulai, v.selesai)} (${v.hariKerja} hari kerja) menunggu persetujuan.` +
            (v.fotoDisarankan ? " Tanpa surat dokter." : ""),
          metadata: { leaveRequestId: baris.id },
        },
      });
      return { ok: true, id: baris.id, ulang: false };
    });

  let hasil: HasilAjukanIzin;
  try {
    hasil = await simpan();
  } catch (err) {
    // Kiriman kembarnya menang lebih dulu; percobaan ini menemukan ajuannya.
    if (!bentrokKunciKiriman(err)) throw err;
    hasil = await simpan();
  }
  const terkirim: AdminNotification | null = notifikasi;
  if (hasil.ok && !hasil.ulang && terkirim) void fanOutAdminNotification(terkirim);
  return hasil;
}

// ─── Mengubah status ─────────────────────────────────────────────────────────

export type KodeTolakKeputusanIzin = "TIDAK_DITEMUKAN" | "MILIK_SENDIRI" | "SUDAH_DIPUTUSKAN" | KodeTolakPindahIzin;

export type HasilKeputusanIzin = { ok: true } | { ok: false; kode: KodeTolakKeputusanIzin } | TolakKuota;

type Pindah = {
  leaveRequestId: string;
  olehUserId: string;
  ke: Exclude<StatusIzin, "DIAJUKAN">;
  pelaku: PelakuIzin;
  /** Status yang dibutuhkan tindakan ini — layar menawarkannya hanya dari status itu. */
  dari: StatusIzin;
  catatan: unknown;
};

type DataKabar = { userId: string; type: string; startDay: string; endDay: string; catatan: string | null };

async function pindahkan(p: Pindah): Promise<{ hasil: HasilKeputusanIzin; kabar: DataKabar | null }> {
  let kabar: DataKabar | null = null;
  const hasil = await runSerializable(async (tx): Promise<HasilKeputusanIzin> => {
    kabar = null;
    const r = await tx.leaveRequest.findUnique({
      where: { id: p.leaveRequestId },
      select: { id: true, userId: true, type: true, startDay: true, endDay: true, status: true, reviewNote: true },
    });
    if (!r) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (p.pelaku === "PEMOHON") {
      // Ajuan orang lain tidak "ada" bagi pemohon — tidak dibocorkan bahwa id-nya sah.
      if (r.userId !== p.olehUserId) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    } else if (r.userId === p.olehUserId) {
      // Tidak ada yang memutuskan izinnya sendiri.
      return { ok: false, kode: "MILIK_SENDIRI" };
    }

    if (r.status !== p.dari) {
      // Bergeser sejak layarnya dibuka (diputuskan orang lain, ditarik pemohon):
      // katakan itu. Status yang memang tidak pernah bisa ke sana tetap tidak sah.
      const sudahLewat = p.dari === "DIAJUKAN" || r.status === "DIBATALKAN";
      return { ok: false, kode: sudahLewat ? "SUDAH_DIPUTUSKAN" : "TRANSISI_TIDAK_SAH" };
    }
    const cek = periksaPindahIzin(r.status, p.ke, p.pelaku, p.catatan);
    if (!cek.ok) return cek;

    // Menyetujui cuti: kuota diperiksa ulang terhadap yang SUDAH disetujui —
    // kuotanya bisa diturunkan sejak ajuan ini masuk.
    if (p.ke === "DISETUJUI" && r.type === "CUTI") {
      const [kuota, libur] = await Promise.all([kuotaCuti(tx), hariTidakKerjaSatu(r.userId, tx)]);
      const disetujui = (await ajuanLain(tx, r.userId, r.startDay, r.endDay, r.id)).filter((a) => a.status === "DISETUJUI");
      for (const tahun of tahunRentang(r.startDay, r.endDay)) {
        const terpakai = terpakaiCuti(disetujui, tahun, libur);
        if (terpakai + hitungHariKerja(r.startDay, r.endDay, tahun, libur) > kuota) {
          return { ok: false, kode: "KUOTA_CUTI_HABIS", tahun, sisa: Math.max(0, kuota - terpakai) };
        }
      }
    }

    const kantor = p.pelaku === "KANTOR";
    // Pemohon yang menarik ajuannya tidak menulis "catatan kantor"; alasannya
    // (kalau ada) hidup di jejak.
    const data = kantor
      ? { status: p.ke, reviewedById: p.olehUserId, reviewedAt: new Date(), reviewNote: cek.catatan }
      : { status: p.ke };
    const u = await tx.leaveRequest.updateMany({ where: { id: r.id, status: r.status }, data });
    if (u.count !== 1) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };

    await tx.auditLog.create({
      data: {
        userId: p.olehUserId,
        action: jejakPindahIzin(p.ke, p.pelaku),
        entityType: ENTITAS_IZIN,
        entityId: r.id,
        changes: {
          before: { status: r.status, reviewNote: r.reviewNote },
          after: { status: p.ke, reviewNote: kantor ? cek.catatan : r.reviewNote },
        },
        reason: cek.catatan,
        metadata: { jenis: r.type, mulai: r.startDay, selesai: r.endDay, pemohonId: r.userId },
      },
    });
    if (kantor) kabar = { userId: r.userId, type: r.type, startDay: r.startDay, endDay: r.endDay, catatan: cek.catatan };
    return { ok: true };
  });
  return { hasil, kabar };
}

/** Teks kabar ke pemohon — disimpan sekali, jadi bahasa Indonesia di server. */
function susunKabar(ke: Exclude<StatusIzin, "DIAJUKAN">, d: DataKabar, id: string): Kabar {
  const nama = NAMA_JENIS_IZIN[d.type as JenisIzin] ?? d.type;
  const rentang = labelRentangIzin(d.startDay, d.endDay);
  const data = { leaveRequestId: id };
  if (ke === "DISETUJUI") {
    return {
      jenis: JENIS_KABAR.IZIN_DISETUJUI,
      judul: `${nama} disetujui`,
      isi: `${nama} ${rentang} disetujui.${d.catatan ? ` Catatan: ${d.catatan}` : ""}`,
      data,
    };
  }
  if (ke === "DITOLAK") {
    return {
      jenis: JENIS_KABAR.IZIN_DITOLAK,
      judul: `Pengajuan ${nama.toLowerCase()} ditolak`,
      isi: `${nama} ${rentang} ditolak: ${d.catatan ?? ""}`.trim(),
      data,
    };
  }
  // Izin yang sudah disetujui dicabut kantor: ia harus masuk kerja di hari itu.
  return {
    jenis: JENIS_KABAR.IZIN_DIBATALKAN,
    judul: `${nama} dibatalkan kantor`,
    isi: `${nama} ${rentang} yang sudah disetujui dibatalkan: ${d.catatan ?? ""}`.trim(),
    data,
  };
}

async function putuskan(p: Pindah): Promise<HasilKeputusanIzin> {
  const { hasil, kabar } = await pindahkan(p);
  const d: DataKabar | null = kabar;
  if (hasil.ok && d) await kabariPengguna(d.userId, susunKabar(p.ke, d, p.leaveRequestId));
  return hasil;
}

/** Pemohon menarik ajuannya yang belum diputuskan. Alasan opsional. */
export function tarikIzin(input: { leaveRequestId: string; userId: string; alasan?: unknown }): Promise<HasilKeputusanIzin> {
  return putuskan({
    leaveRequestId: input.leaveRequestId,
    olehUserId: input.userId,
    ke: "DIBATALKAN",
    pelaku: "PEMOHON",
    dari: "DIAJUKAN",
    catatan: input.alasan,
  });
}

export function setujuiIzin(input: { leaveRequestId: string; olehUserId: string; catatan?: unknown }): Promise<HasilKeputusanIzin> {
  return putuskan({ ...input, ke: "DISETUJUI", pelaku: "KANTOR", dari: "DIAJUKAN", catatan: input.catatan });
}

/** Tolak — catatan wajib: yang ditolak harus tahu sebabnya. */
export function tolakIzin(input: { leaveRequestId: string; olehUserId: string; catatan: unknown }): Promise<HasilKeputusanIzin> {
  return putuskan({ ...input, ke: "DITOLAK", pelaku: "KANTOR", dari: "DIAJUKAN" });
}

/** Kantor mencabut izin yang SUDAH disetujui (mis. ternyata ia masuk). Catatan wajib. */
export function batalkanIzin(input: { leaveRequestId: string; olehUserId: string; catatan: unknown }): Promise<HasilKeputusanIzin> {
  return putuskan({ ...input, ke: "DIBATALKAN", pelaku: "KANTOR", dari: "DISETUJUI" });
}
