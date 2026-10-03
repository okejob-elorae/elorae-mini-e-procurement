import { prisma, Prisma } from "@elorae/db";
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import idMessages from "@/lib/i18n/messages/id.json";
import { runSerializable } from "@/lib/db/tx-retry";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import {
  cuplikan,
  keadaanPengumuman,
  peranDari,
  perluKabar,
  terlihatDiHp,
  UMUR_MAKS_KABAR_MS,
  validasiPengumuman,
  whereKeadaan,
  type GalatPengumuman,
  type IsianPengumuman,
} from "./aturan";
import { penerimaPengumuman } from "./queries";

/**
 * Penulis pengumuman: simpan (buat/ubah), arsipkan, pulihkan, hapus; dan dari
 * HP: tandai dibaca, konfirmasi "Saya mengerti". Plus penyapu jadwal yang
 * mengabarkan pengumuman terjadwal begitu waktunya tiba.
 *
 * Setiap keputusan kantor menulis `AuditLog` DI DALAM transaksinya, membawa
 * potret sebelum/sesudah — barisnya sendiri hanya menyimpan keadaan terakhir.
 *
 * "Sudah dikabarkan" dicatat sebagai baris `AuditLog` `ANNOUNCEMENT_SENT`
 * (dengan jumlah penerima), ditulis di transaksi yang sama dengan keputusan
 * yang membuat pengumuman tampil. Schema tidak punya kolom penanda, dan jejak
 * ini sekaligus menjawab "kapan dan ke berapa orang ini dikirim". Kabar
 * (`kabariPengguna`) dikirim SESUDAH transaksi, dan tidak pernah melempar.
 */

type Tx = Prisma.TransactionClient;

export const ENTITAS = "Announcement";
export const AKSI = {
  DIBUAT: "ANNOUNCEMENT_CREATED",
  DIUBAH: "ANNOUNCEMENT_UPDATED",
  DIARSIPKAN: "ANNOUNCEMENT_ARCHIVED",
  DIPULIHKAN: "ANNOUNCEMENT_RESTORED",
  DIHAPUS: "ANNOUNCEMENT_DELETED",
  DIKABARKAN: "ANNOUNCEMENT_SENT",
} as const;

type BarisPengumuman = {
  id: string;
  title: string;
  body: string;
  audience: string;
  requireAck: boolean;
  pinned: boolean;
  publishedAt: Date;
  expiresAt: Date | null;
  archivedAt: Date | null;
  createdById: string;
};

function potret(a: Omit<BarisPengumuman, "id" | "createdById">) {
  return {
    title: a.title,
    body: a.body,
    audience: a.audience,
    pinned: a.pinned,
    requireAck: a.requireAck,
    publishedAt: a.publishedAt.toISOString(),
    expiresAt: a.expiresAt?.toISOString() ?? null,
    archivedAt: a.archivedAt?.toISOString() ?? null,
  };
}

// ── Kabar ─────────────────────────────────────────────────────────────────

/** Bekal kabar yang dibawa keluar dari transaksi; dikirim sesudah komit. */
export type KirimPengumuman = { announcementId: string; title: string; body: string; requireAck: boolean; penerima: string[] };

/**
 * Tandai pengumuman "sudah dikabarkan" — DI DALAM transaksi pemanggil — bila
 * memang perlu (aktif dan belum pernah). Mengembalikan bekal kabarnya, atau
 * null. Penerima dihitung di sini supaya jumlah di jejak sama dengan yang dikirimi.
 */
async function tandaiDikabarkan(
  tx: Tx,
  a: BarisPengumuman,
  o: { userId: string; sekarang: Date; umurMaksMs?: number },
): Promise<KirimPengumuman | null> {
  const sudah = await tx.auditLog.findFirst({
    where: { entityType: ENTITAS, entityId: a.id, action: AKSI.DIKABARKAN },
    select: { id: true },
  });
  if (!perluKabar(a, o.sekarang, !!sudah, { umurMaksMs: o.umurMaksMs })) return null;
  const penerima = await penerimaPengumuman(a.audience, tx);
  await tx.auditLog.create({
    data: {
      userId: o.userId,
      action: AKSI.DIKABARKAN,
      entityType: ENTITAS,
      entityId: a.id,
      metadata: { penerima: penerima.length, audience: a.audience },
    },
  });
  return { announcementId: a.id, title: a.title, body: a.body, requireAck: a.requireAck, penerima: penerima.map((p) => p.id) };
}

const UKURAN_GELOMBANG = 10;

/**
 * Kirim kabar `PENGUMUMAN` ke setiap penerima. Teks dari berkas bahasa,
 * dipatok Indonesia (kabar disimpan sebagai satu teks). Tidak pernah melempar —
 * pengumumannya sudah tersimpan dan tampil di beranda/daftar HP apa pun yang
 * terjadi dengan push.
 */
export async function kabarkanPengumuman(k: KirimPengumuman): Promise<void> {
  try {
    const t = createTranslator({
      locale: "id",
      messages: idMessages as unknown as AbstractIntlMessages,
      namespace: "pwa.pengumuman",
    }) as unknown as (kunci: string, v?: Record<string, string | number>) => string;
    const judul = t("kabarJudul", { judul: cuplikan(k.title, 80) });
    const isi = k.requireAck ? t("kabarIsiKonfirmasi", { isi: cuplikan(k.body, 110) }) : cuplikan(k.body, 140);
    for (let i = 0; i < k.penerima.length; i += UKURAN_GELOMBANG) {
      await Promise.all(
        k.penerima.slice(i, i + UKURAN_GELOMBANG).map((userId) =>
          kabariPengguna(userId, { jenis: JENIS_KABAR.PENGUMUMAN, judul, isi, data: { announcementId: k.announcementId } }),
        ),
      );
    }
  } catch (err) {
    console.error("[kabar] pengumuman gagal", k.announcementId, err);
  }
}

// ── Simpan ────────────────────────────────────────────────────────────────

export type HasilSimpanPengumuman =
  | { ok: true; id: string; dikabarkan: number; konfirmasiDireset: number }
  | { ok: false; kode: "TIDAK_SAH"; galat: GalatPengumuman[] }
  | { ok: false; kode: "TIDAK_ADA" | "DIARSIPKAN" };

/**
 * Buat (tanpa `id`) atau ubah pengumuman.
 *
 * - Yang diarsipkan tidak bisa diubah — pulihkan dulu.
 * - Mengubah judul atau isi pengumuman yang wajib dikonfirmasi MENGHAPUS
 *   konfirmasi yang sudah ada (bacaannya tetap), kecuali `mintaKonfirmasiUlang`
 *   dimatikan: yang mereka konfirmasi adalah teks lama. Jumlahnya tercatat di jejak.
 * - Begitu pengumuman tampil (terbit sekarang, atau jadwal digeser ke sekarang)
 *   dan belum pernah dikabarkan, penerimanya dikabari sesudah transaksi.
 */
export async function simpanPengumuman(input: {
  id?: string;
  isian: IsianPengumuman & { mintaKonfirmasiUlang?: unknown };
  userId: string;
  sekarang?: Date;
}): Promise<HasilSimpanPengumuman> {
  const sekarang = input.sekarang ?? new Date();

  const hasil = await runSerializable(async (tx) => {
    let kirim: KirimPengumuman | null = null;
    const lama = input.id ? await tx.announcement.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !lama) return { hasil: { ok: false, kode: "TIDAK_ADA" } as const, kirim };
    if (lama?.archivedAt) return { hasil: { ok: false, kode: "DIARSIPKAN" } as const, kirim };

    const v = validasiPengumuman(input.isian, { sekarang, lama: lama ?? undefined });
    if (!v.ok) return { hasil: { ok: false, kode: "TIDAK_SAH", galat: v.galat } as const, kirim };
    const d = v.data;

    if (lama) {
      const isiBerubah = lama.title !== d.title || lama.body !== d.body;
      let konfirmasiDireset = 0;
      if (isiBerubah && lama.requireAck && d.requireAck && input.isian.mintaKonfirmasiUlang !== false) {
        const r = await tx.announcementRead.updateMany({
          where: { announcementId: lama.id, ackAt: { not: null } },
          data: { ackAt: null },
        });
        konfirmasiDireset = r.count;
      }
      const baru = await tx.announcement.update({
        where: { id: lama.id },
        data: {
          title: d.title,
          body: d.body,
          audience: d.audience,
          pinned: d.pinned,
          requireAck: d.requireAck,
          publishedAt: d.publishedAt,
          expiresAt: d.expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: AKSI.DIUBAH,
          entityType: ENTITAS,
          entityId: lama.id,
          changes: { before: potret(lama), after: potret(baru) },
          metadata: { isiBerubah, konfirmasiDireset },
        },
      });
      kirim = await tandaiDikabarkan(tx, baru, { userId: input.userId, sekarang });
      return { hasil: { ok: true, id: lama.id, konfirmasiDireset } as const, kirim };
    }

    const baru = await tx.announcement.create({
      data: {
        title: d.title,
        body: d.body,
        audience: d.audience,
        pinned: d.pinned,
        requireAck: d.requireAck,
        publishedAt: d.publishedAt,
        expiresAt: d.expiresAt,
        createdById: input.userId,
      },
    });
    await tx.auditLog.create({
      data: { userId: input.userId, action: AKSI.DIBUAT, entityType: ENTITAS, entityId: baru.id, changes: { after: potret(baru) } },
    });
    kirim = await tandaiDikabarkan(tx, baru, { userId: input.userId, sekarang });
    return { hasil: { ok: true, id: baru.id, konfirmasiDireset: 0 } as const, kirim };
  });

  if (!hasil.hasil.ok) return hasil.hasil;
  if (hasil.kirim) await kabarkanPengumuman(hasil.kirim);
  return { ...hasil.hasil, dikabarkan: hasil.kirim?.penerima.length ?? 0 };
}

// ── Arsip, pulihkan, hapus ────────────────────────────────────────────────

export type HasilArsip = { ok: true; sudah: boolean } | { ok: false; kode: "TIDAK_ADA" };

/** Arsipkan — hilang dari HP, tetap ada di kantor beserta laporan bacanya. Idempoten. */
export async function arsipkanPengumuman(input: { id: string; userId: string; sekarang?: Date }): Promise<HasilArsip> {
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx): Promise<HasilArsip> => {
    const lama = await tx.announcement.findUnique({ where: { id: input.id } });
    if (!lama) return { ok: false, kode: "TIDAK_ADA" };
    if (lama.archivedAt) return { ok: true, sudah: true };
    const r = await tx.announcement.updateMany({ where: { id: lama.id, archivedAt: null }, data: { archivedAt: sekarang } });
    if (r.count === 0) return { ok: true, sudah: true };
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: AKSI.DIARSIPKAN,
        entityType: ENTITAS,
        entityId: lama.id,
        changes: { before: { archivedAt: null }, after: { archivedAt: sekarang.toISOString() } },
      },
    });
    return { ok: true, sudah: false };
  });
}

/**
 * Kembalikan dari arsip. Kalau pengumumannya sekarang aktif dan belum pernah
 * dikabarkan (diarsipkan sebelum waktunya terbit), penerimanya dikabari.
 */
export async function pulihkanPengumuman(input: { id: string; userId: string; sekarang?: Date }): Promise<HasilArsip> {
  const sekarang = input.sekarang ?? new Date();
  const r = await runSerializable(async (tx) => {
    const lama = await tx.announcement.findUnique({ where: { id: input.id } });
    if (!lama) return { hasil: { ok: false, kode: "TIDAK_ADA" } as const, kirim: null };
    if (!lama.archivedAt) return { hasil: { ok: true, sudah: true } as const, kirim: null };
    const u = await tx.announcement.updateMany({ where: { id: lama.id, archivedAt: { not: null } }, data: { archivedAt: null } });
    if (u.count === 0) return { hasil: { ok: true, sudah: true } as const, kirim: null };
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: AKSI.DIPULIHKAN,
        entityType: ENTITAS,
        entityId: lama.id,
        changes: { before: { archivedAt: lama.archivedAt.toISOString() }, after: { archivedAt: null } },
      },
    });
    const kirim = await tandaiDikabarkan(tx, { ...lama, archivedAt: null }, { userId: input.userId, sekarang });
    return { hasil: { ok: true, sudah: false } as const, kirim };
  });
  if (r.kirim) await kabarkanPengumuman(r.kirim);
  return r.hasil;
}

export type HasilHapus = { ok: true } | { ok: false; kode: "TIDAK_ADA" | "SUDAH_DIBACA" };

/**
 * Hapus — HANYA selama belum ada yang membaca (salah ketik, salah sasaran).
 * Begitu seseorang membacanya, pengumuman itu bagian dari catatan: arsipkan.
 */
export async function hapusPengumuman(input: { id: string; userId: string }): Promise<HasilHapus> {
  return runSerializable(async (tx): Promise<HasilHapus> => {
    const lama = await tx.announcement.findUnique({ where: { id: input.id } });
    if (!lama) return { ok: false, kode: "TIDAK_ADA" };
    const dibaca = await tx.announcementRead.count({ where: { announcementId: lama.id } });
    if (dibaca > 0) return { ok: false, kode: "SUDAH_DIBACA" };
    await tx.announcement.delete({ where: { id: lama.id } });
    await tx.auditLog.create({
      data: { userId: input.userId, action: AKSI.DIHAPUS, entityType: ENTITAS, entityId: lama.id, changes: { before: potret(lama) } },
    });
    return { ok: true };
  });
}

// ── HP: dibaca & konfirmasi ───────────────────────────────────────────────

async function terlihatOleh(id: string, userId: string, sekarang: Date) {
  const [a, tokoTetap] = await Promise.all([prisma.announcement.findUnique({ where: { id } }), ambilTokoTetap(userId)]);
  if (!a || !terlihatDiHp(a, peranDari(tokoTetap), sekarang)) return null;
  return a;
}

function bentrokUnik(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export type HasilDibaca = { ok: true; baru: boolean; kabarDitandai: number } | { ok: false; kode: "TIDAK_ADA" };

/**
 * Membuka pengumuman di HP = membacanya. Idempoten: bacaan kedua tidak menggeser
 * `readAt`. Kabar `PENGUMUMAN` untuk pengumuman ini ikut ditandai dibaca, supaya
 * lencana lonceng tidak menunggu sesuatu yang sudah dibuka dari beranda.
 */
export async function tandaiPengumumanDibaca(input: { id: string; userId: string; sekarang?: Date }): Promise<HasilDibaca> {
  const sekarang = input.sekarang ?? new Date();
  const a = await terlihatOleh(input.id, input.userId, sekarang);
  if (!a) return { ok: false, kode: "TIDAK_ADA" };
  let baru = false;
  const ada = await prisma.announcementRead.findUnique({
    where: { announcementId_userId: { announcementId: a.id, userId: input.userId } },
    select: { id: true },
  });
  if (!ada) {
    try {
      await prisma.announcementRead.create({ data: { announcementId: a.id, userId: input.userId, readAt: sekarang } });
      baru = true;
    } catch (e) {
      // Dua ketukan bersamaan: yang kalah cukup tahu sudah terbaca.
      if (!bentrokUnik(e)) throw e;
    }
  }
  return { ok: true, baru, kabarDitandai: await tandaiKabarDibaca(a.id, input.userId, sekarang) };
}

/**
 * Kabar `PENGUMUMAN` milik orang ini yang menunjuk pengumuman ini → dibaca.
 * Dicocokkan di JS: penyaringan jalur JSON tidak andal di semua adaptor.
 * Pelengkap — gagal tidak membatalkan bacaannya.
 */
async function tandaiKabarDibaca(announcementId: string, userId: string, sekarang: Date): Promise<number> {
  try {
    const rows = await prisma.notificationQueue.findMany({
      where: { userId, type: JENIS_KABAR.PENGUMUMAN, readAt: null },
      select: { id: true, data: true },
      take: 200,
    });
    const ids = rows
      .filter((r) => r.data !== null && typeof r.data === "object" && (r.data as Record<string, unknown>).announcementId === announcementId)
      .map((r) => r.id);
    if (ids.length === 0) return 0;
    const u = await prisma.notificationQueue.updateMany({ where: { id: { in: ids }, readAt: null }, data: { readAt: sekarang } });
    return u.count;
  } catch (err) {
    console.error("[pengumuman] tandai kabar dibaca gagal", announcementId, err);
    return 0;
  }
}

export type HasilKonfirmasi = { ok: true; baru: boolean } | { ok: false; kode: "TIDAK_ADA" | "TIDAK_PERLU" };

/**
 * "Saya mengerti". Idempoten: konfirmasi kedua tidak menggeser `ackAt`.
 * Sekaligus menandai dibaca bila belum.
 */
export async function konfirmasiPengumuman(input: { id: string; userId: string; sekarang?: Date }): Promise<HasilKonfirmasi> {
  const sekarang = input.sekarang ?? new Date();
  const a = await terlihatOleh(input.id, input.userId, sekarang);
  if (!a) return { ok: false, kode: "TIDAK_ADA" };
  if (!a.requireAck) return { ok: false, kode: "TIDAK_PERLU" };
  const kunci = { announcementId_userId: { announcementId: a.id, userId: input.userId } };
  const ada = await prisma.announcementRead.findUnique({ where: kunci, select: { ackAt: true } });
  if (!ada) {
    try {
      await prisma.announcementRead.create({ data: { announcementId: a.id, userId: input.userId, readAt: sekarang, ackAt: sekarang } });
      await tandaiKabarDibaca(a.id, input.userId, sekarang);
      return { ok: true, baru: true };
    } catch (e) {
      if (!bentrokUnik(e)) throw e;
    }
  } else if (ada.ackAt) {
    return { ok: true, baru: false };
  }
  const u = await prisma.announcementRead.updateMany({
    where: { announcementId: a.id, userId: input.userId, ackAt: null },
    data: { ackAt: sekarang },
  });
  return { ok: true, baru: u.count > 0 };
}

// ── Penyapu jadwal ────────────────────────────────────────────────────────

/**
 * Kabarkan pengumuman terjadwal yang waktunya sudah tiba. Untuk cron (mis. tiap
 * 5 menit): pengumuman yang terbit "sekarang" sudah dikabarkan saat disimpan,
 * yang dijadwalkan baru berbunyi lewat sini. Idempoten lewat jejak
 * `ANNOUNCEMENT_SENT`; yang terbit lebih dari 3 hari lalu dilewati
 * (`UMUR_MAKS_KABAR_MS`) supaya pemasangan cron tidak membangunkan pengumuman lama.
 *
 * `ids` membatasi sapuan — WAJIB dipakai tes (basis data bersama).
 */
export async function kirimPengumumanTerjadwal(
  sekarang = new Date(),
  opsi: { ids?: string[] } = {},
): Promise<{ pengumuman: number; orang: number }> {
  const calon = await prisma.announcement.findMany({
    where: {
      ...whereKeadaan("AKTIF", sekarang),
      publishedAt: { lte: sekarang, gte: new Date(sekarang.getTime() - UMUR_MAKS_KABAR_MS) },
      ...(opsi.ids ? { id: { in: opsi.ids } } : {}),
    },
    orderBy: { publishedAt: "asc" },
    take: 50,
  });
  let pengumuman = 0;
  let orang = 0;
  for (const c of calon) {
    if (keadaanPengumuman(c, sekarang) !== "AKTIF") continue;
    const kirim = await runSerializable(async (tx) => {
      const a = await tx.announcement.findUnique({ where: { id: c.id } });
      if (!a) return null;
      return tandaiDikabarkan(tx, a, { userId: a.createdById, sekarang, umurMaksMs: UMUR_MAKS_KABAR_MS });
    });
    if (!kirim) continue;
    pengumuman += 1;
    orang += kirim.penerima.length;
    await kabarkanPengumuman(kirim);
  }
  return { pengumuman, orang };
}
