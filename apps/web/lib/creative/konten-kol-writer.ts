import type { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { sinkronJurnalKolAman } from "./jurnal-kol";
import { terapkanMajuOtomatis } from "./maju-otomatis";
import {
  FORMAT_BAWAAN,
  formatSah,
  periksaIsianAngka,
  platformSah,
  sahLink,
  tebakPlatformFormat,
  type FormatKonten,
  type PlatformKol,
} from "./konten-kol";
import type { Tahap } from "./tahap";

/*
 * Penulis konten KOL (2026-10-07): konten, draf, persetujuan, revisi, dan
 * angka konten.
 *
 * - Setiap penulis menulis faktanya lalu memanggil `terapkanMajuOtomatis`
 *   dengan `tx` yang sama: link draf → DRAF, draf disetujui → DRAF_DISETUJUI,
 *   link konten → TAYANG, angka pada hari ≥ tayang + 7 → ANGKA_MASUK.
 *   Perpindahannya dikembalikan (`maju`) supaya layar bisa menyebutnya di toast.
 * - Kolom yang TIDAK dikirim (`undefined`) tidak disentuh; `null` yang dikirim
 *   dengan sengaja mengosongkan.
 * - Angka konten TIDAK PERNAH ditimpa: setiap pengisian adalah baris
 *   `KolContentMetric` baru.
 * - Jejaknya ditulis pada KOLABORASI (`entityType "KolBrief"`, `entityId` =
 *   id kolaborasi, `metadata.kontenId`), supaya linimasa kolaborasi
 *   menampilkannya tanpa tahu tabel konten.
 */

type Klien = Prisma.TransactionClient;

export type KodeGagalKontenKol =
  | "TIDAK_DITEMUKAN"
  | "KOLABORASI_TIDAK_DITEMUKAN"
  | "LINK_TIDAK_SAH"
  | "PLATFORM_TIDAK_SAH"
  | "FORMAT_TIDAK_SAH"
  | "TANGGAL_TIDAK_SAH"
  | "TANPA_DRAF"
  | "SUDAH_TAYANG"
  | "BELUM_TAYANG"
  | "CATATAN_WAJIB"
  | "CATATAN_TERLALU_PANJANG"
  | "ANGKA_TIDAK_SAH"
  | "ANGKA_KOSONG";

export type MajuTahap = { dari: Tahap; ke: Tahap } | null;

export type HasilKontenKol =
  | { ok: true; id: string; maju: MajuTahap; sudah?: boolean }
  | { ok: false; kode: KodeGagalKontenKol };

const gagal = (kode: KodeGagalKontenKol) => ({ ok: false as const, kode });

const MAKS_CATATAN = 2000;
const MAKS_KODE_IKLAN = 191;

const tanggalSah = (d: Date | null | undefined) => d === undefined || d === null || (d instanceof Date && !Number.isNaN(d.getTime()));

/** "kirim link" dari teks: undefined tetap undefined, kosong → null, sisanya disahkan. */
function linkMasuk(v: string | null | undefined): { nilai: string | null | undefined } | "LINK_TIDAK_SAH" {
  if (v === undefined) return { nilai: undefined };
  if (v === null || !v.trim()) return { nilai: null };
  const sah = sahLink(v);
  return sah ? { nilai: sah } : "LINK_TIDAK_SAH";
}

async function kolaborasiDanTebakan(tx: Klien, kolaborasiId: string) {
  return tx.kolBrief.findUnique({
    where: { id: kolaborasiId },
    select: {
      id: true,
      docNo: true,
      kol: { select: { name: true, accounts: { select: { platform: true }, orderBy: { followers: "desc" } } } },
      deliverables: { select: { platform: true, format: true } },
    },
  });
}

/* ──────────────────────────── Konten ──────────────────────────── */

export type IsiKontenKol = {
  /** Kosong = konten baru. */
  id?: string | null;
  kolaborasiId: string;
  platform?: PlatformKol;
  format?: FormatKonten;
  link?: string | null;
  liveAt?: Date | null;
  plannedAt?: Date | null;
  draftLink?: string | null;
  adCode?: string | null;
  adCodeUntil?: Date | null;
  olehUserId: string;
};

/**
 * Buat atau ubah satu konten. Konten baru tanpa platform/format ditebak dari
 * link, deliverable, lalu akun KOL (`tebakPlatformFormat`).
 *
 * Link tayang yang baru diisi tanpa tanggal tayang mencatat tanggal tayang =
 * sekarang (yang menempel link biasanya baru melihat kontennya naik). Link
 * draf yang berubah adalah draf baru: statusnya MENUNGGU dan persetujuan
 * lamanya dilepas.
 */
export async function simpanKontenKol(input: IsiKontenKol): Promise<HasilKontenKol> {
  if (input.platform !== undefined && !platformSah(input.platform)) return gagal("PLATFORM_TIDAK_SAH");
  if (input.format !== undefined && !formatSah(input.format)) return gagal("FORMAT_TIDAK_SAH");
  if (![input.liveAt, input.plannedAt, input.adCodeUntil].every(tanggalSah)) return gagal("TANGGAL_TIDAK_SAH");
  const link = linkMasuk(input.link);
  if (link === "LINK_TIDAK_SAH") return gagal("LINK_TIDAK_SAH");
  const draf = linkMasuk(input.draftLink);
  if (draf === "LINK_TIDAK_SAH") return gagal("LINK_TIDAK_SAH");
  const adCode = input.adCode === undefined ? undefined : input.adCode?.trim().slice(0, MAKS_KODE_IKLAN) || null;

  const hasil = await runSerializable(async (tx) => {
    const sekarang = new Date();
    const kolab = await kolaborasiDanTebakan(tx, input.kolaborasiId);
    if (!kolab) return gagal("KOLABORASI_TIDAK_DITEMUKAN");

    if (input.id) {
      const lama = await tx.kolContent.findFirst({
        where: { id: input.id, collabId: kolab.id },
        select: {
          id: true,
          platform: true,
          format: true,
          link: true,
          liveAt: true,
          plannedAt: true,
          draftLink: true,
          draftStatus: true,
          adCode: true,
          adCodeUntil: true,
        },
      });
      if (!lama) return gagal("TIDAK_DITEMUKAN");

      const data: Prisma.KolContentUncheckedUpdateInput = {};
      const sebelum: Record<string, unknown> = {};
      const sesudah: Record<string, unknown> = {};
      const ubah = (kolom: keyof typeof lama, nilai: unknown) => {
        const a = lama[kolom];
        const sama = a instanceof Date && nilai instanceof Date ? a.getTime() === nilai.getTime() : a === nilai;
        if (sama) return;
        (data as Record<string, unknown>)[kolom] = nilai;
        sebelum[kolom] = a instanceof Date ? a.toISOString() : a;
        sesudah[kolom] = nilai instanceof Date ? nilai.toISOString() : nilai;
      };
      if (input.platform !== undefined) ubah("platform", input.platform);
      if (input.format !== undefined) ubah("format", input.format);
      if (link.nilai !== undefined) ubah("link", link.nilai);
      if (input.liveAt !== undefined) ubah("liveAt", input.liveAt);
      else if (link.nilai && !lama.link && !lama.liveAt) ubah("liveAt", sekarang);
      if (input.plannedAt !== undefined) ubah("plannedAt", input.plannedAt);
      if (adCode !== undefined) ubah("adCode", adCode);
      if (input.adCodeUntil !== undefined) ubah("adCodeUntil", input.adCodeUntil);
      if (draf.nilai !== undefined && draf.nilai !== lama.draftLink) {
        ubah("draftLink", draf.nilai);
        ubah("draftStatus", draf.nilai ? "MENUNGGU" : null);
        data.draftAt = draf.nilai ? sekarang : null;
        data.approvedById = null;
        data.approvedAt = null;
      }

      if (Object.keys(data).length === 0) return { ok: true as const, id: lama.id, maju: null, sudah: true };
      await tx.kolContent.update({ where: { id: lama.id }, data });
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.KONTEN_KOL_DIUBAH,
        entityType: "KolBrief",
        entityId: kolab.id,
        changes: { before: sebelum, after: sesudah },
        metadata: { kontenId: lama.id, docNo: kolab.docNo, kol: kolab.kol.name },
      });
      const maju = await terapkanMajuOtomatis(tx, {
        kolaborasiId: kolab.id,
        olehUserId: input.olehUserId,
        sebab: link.nilai ? "link konten" : draf.nilai ? "link draf" : "konten diubah",
      });
      return { ok: true as const, id: lama.id, maju };
    }

    const tebak = tebakPlatformFormat({
      link: link.nilai ?? draf.nilai ?? null,
      deliverables: kolab.deliverables,
      akun: kolab.kol.accounts,
    });
    const platform = input.platform ?? tebak.platform;
    const formatDeliverable = kolab.deliverables.find((d) => d.platform === platform && formatSah(d.format))?.format;
    const format: FormatKonten = input.format ?? (formatSah(formatDeliverable) ? formatDeliverable : FORMAT_BAWAAN[platform]);
    const dibuat = await tx.kolContent.create({
      data: {
        collabId: kolab.id,
        platform,
        format,
        link: link.nilai ?? null,
        liveAt: input.liveAt ?? (link.nilai ? sekarang : null),
        plannedAt: input.plannedAt ?? null,
        draftLink: draf.nilai ?? null,
        draftStatus: draf.nilai ? "MENUNGGU" : null,
        draftAt: draf.nilai ? sekarang : null,
        adCode: adCode ?? null,
        adCodeUntil: input.adCodeUntil ?? null,
        createdById: input.olehUserId,
      },
      select: { id: true, liveAt: true },
    });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONTEN_KOL_DICATAT,
      entityType: "KolBrief",
      entityId: kolab.id,
      changes: {
        after: { platform, format, link: link.nilai ?? null, liveAt: dibuat.liveAt?.toISOString() ?? null, draftLink: draf.nilai ?? null },
      },
      metadata: { kontenId: dibuat.id, docNo: kolab.docNo, kol: kolab.kol.name },
    });
    const maju = await terapkanMajuOtomatis(tx, {
      kolaborasiId: kolab.id,
      olehUserId: input.olehUserId,
      sebab: link.nilai ? "link konten" : draf.nilai ? "link draf" : "konten dicatat",
    });
    return { ok: true as const, id: dibuat.id, maju };
  });
  // Sesudah commit: link tayang bisa membuat fee kolaborasi diakui — selaraskan jurnalnya (best-effort).
  if (hasil.ok) await sinkronJurnalKolAman([input.kolaborasiId], input.olehUserId);
  return hasil;
}

/* ──────────────────────────── Draf ──────────────────────────── */

/**
 * Catat draf masuk: link draf → status MENUNGGU, waktu draf = sekarang,
 * persetujuan lama dilepas. Tanpa `kontenId` dibuat konten baru (platform
 * ditebak). Konten yang sudah tayang tidak menerima draf.
 */
export async function kirimDraf(input: {
  kontenId?: string | null;
  kolaborasiId: string;
  draftLink: string;
  platform?: PlatformKol;
  format?: FormatKonten;
  plannedAt?: Date | null;
  olehUserId: string;
}): Promise<HasilKontenKol> {
  const link = sahLink(input.draftLink);
  if (!link) return gagal("LINK_TIDAK_SAH");
  if (!input.kontenId) {
    return simpanKontenKol({
      kolaborasiId: input.kolaborasiId,
      platform: input.platform,
      format: input.format,
      plannedAt: input.plannedAt,
      draftLink: link,
      olehUserId: input.olehUserId,
    });
  }
  return runSerializable(async (tx) => {
    const lama = await tx.kolContent.findFirst({
      where: { id: input.kontenId!, collabId: input.kolaborasiId },
      select: {
        id: true,
        link: true,
        draftLink: true,
        draftStatus: true,
        collab: { select: { id: true, docNo: true, kol: { select: { name: true } } } },
      },
    });
    if (!lama) return gagal("TIDAK_DITEMUKAN");
    if (lama.link?.trim()) return gagal("SUDAH_TAYANG");
    const sekarang = new Date();
    await tx.kolContent.update({
      where: { id: lama.id },
      data: {
        draftLink: link,
        draftStatus: "MENUNGGU",
        draftAt: sekarang,
        approvedById: null,
        approvedAt: null,
        ...(input.plannedAt !== undefined ? { plannedAt: input.plannedAt } : {}),
      },
    });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONTEN_KOL_DIUBAH,
      entityType: "KolBrief",
      entityId: lama.collab.id,
      changes: {
        before: { draftLink: lama.draftLink, draftStatus: lama.draftStatus },
        after: { draftLink: link, draftStatus: "MENUNGGU" },
      },
      metadata: { kontenId: lama.id, docNo: lama.collab.docNo, kol: lama.collab.kol.name, draf: "MASUK" },
    });
    const maju = await terapkanMajuOtomatis(tx, { kolaborasiId: lama.collab.id, olehUserId: input.olehUserId, sebab: "link draf" });
    return { ok: true as const, id: lama.id, maju };
  });
}

/** Setujui draf. Draf yang sudah disetujui dijawab `ok` tanpa menulis apa pun. */
export async function setujuiDraf(input: { kontenId: string; olehUserId: string }): Promise<HasilKontenKol> {
  return runSerializable(async (tx) => {
    const lama = await tx.kolContent.findUnique({
      where: { id: input.kontenId },
      select: { id: true, draftLink: true, draftStatus: true, collab: { select: { id: true, docNo: true, kol: { select: { name: true } } } } },
    });
    if (!lama) return gagal("TIDAK_DITEMUKAN");
    if (!lama.draftLink?.trim()) return gagal("TANPA_DRAF");
    if (lama.draftStatus === "DISETUJUI") return { ok: true as const, id: lama.id, maju: null, sudah: true };
    await tx.kolContent.update({
      where: { id: lama.id },
      data: { draftStatus: "DISETUJUI", approvedById: input.olehUserId, approvedAt: new Date() },
    });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.DRAF_DISETUJUI,
      entityType: "KolBrief",
      entityId: lama.collab.id,
      changes: { before: { draftStatus: lama.draftStatus }, after: { draftStatus: "DISETUJUI" } },
      metadata: { kontenId: lama.id, docNo: lama.collab.docNo, kol: lama.collab.kol.name, draftLink: lama.draftLink },
    });
    const maju = await terapkanMajuOtomatis(tx, { kolaborasiId: lama.collab.id, olehUserId: input.olehUserId, sebab: "draf disetujui" });
    return { ok: true as const, id: lama.id, maju };
  });
}

/**
 * Minta revisi draf. Catatan WAJIB — "revisi" tanpa isi tidak bisa dikerjakan
 * KOL-nya. Catatannya disimpan di draf, sebagai catatan kolaborasi
 * ("Minta revisi draf: …"), dan sebagai alasan di jejak; kontak terakhir
 * kolaborasi ikut diperbarui (meminta revisi = menghubungi KOL).
 */
export async function mintaRevisi(input: { kontenId: string; catatan: string; olehUserId: string }): Promise<HasilKontenKol> {
  const catatan = (input.catatan ?? "").trim();
  if (!catatan) return gagal("CATATAN_WAJIB");
  if (catatan.length > MAKS_CATATAN) return gagal("CATATAN_TERLALU_PANJANG");
  return runSerializable(async (tx) => {
    const lama = await tx.kolContent.findUnique({
      where: { id: input.kontenId },
      select: {
        id: true,
        link: true,
        draftLink: true,
        draftStatus: true,
        collab: { select: { id: true, docNo: true, kolId: true, kol: { select: { name: true } } } },
      },
    });
    if (!lama) return gagal("TIDAK_DITEMUKAN");
    if (!lama.draftLink?.trim()) return gagal("TANPA_DRAF");
    if (lama.link?.trim()) return gagal("SUDAH_TAYANG");
    const sekarang = new Date();
    await tx.kolContent.update({
      where: { id: lama.id },
      data: { draftStatus: "REVISI", draftNote: catatan, approvedById: null, approvedAt: null },
    });
    await tx.kolNote.create({
      data: { collabId: lama.collab.id, body: `Minta revisi draf: ${catatan}`, createdById: input.olehUserId },
    });
    await tx.kolBrief.update({ where: { id: lama.collab.id }, data: { lastContactAt: sekarang } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.DRAF_REVISI,
      entityType: "KolBrief",
      entityId: lama.collab.id,
      changes: { before: { draftStatus: lama.draftStatus }, after: { draftStatus: "REVISI" } },
      metadata: { kontenId: lama.id, docNo: lama.collab.docNo, kol: lama.collab.kol.name, draftLink: lama.draftLink },
      reason: catatan,
    });
    return { ok: true as const, id: lama.id, maju: null };
  });
}

/* ──────────────────────────── Angka ──────────────────────────── */

export type IsiAngkaKonten = {
  kontenId: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  recordedAt?: Date | null;
  source?: string | null;
  note?: string | null;
  /** Perangkat pantau yang membaca angkanya (ekstensi); kosong untuk isian tangan. */
  perangkatId?: string | null;
  olehUserId: string;
};

/**
 * Catat angka konten — SELALU baris baru. Hanya untuk konten yang sudah
 * tayang; tanggal catat tidak boleh sebelum hari tayang (WIB) dan tidak boleh
 * di masa depan. Angka nol semua ditolak: baris kosong menghapus pengingat
 * H+N padahal belum ada angka.
 */
export async function catatAngka(input: IsiAngkaKonten): Promise<HasilKontenKol> {
  return runSerializable((tx) => catatAngkaDiTx(tx, input));
}

/**
 * Isi `catatAngka` di dalam transaksi PEMANGGIL — dipakai penerima hasil
 * ekstensi pantau (`pantau-writer.ts`), yang menandai tugasnya selesai di
 * transaksi yang sama. Satu penulis angka konten, bukan dua.
 */
export async function catatAngkaDiTx(tx: Klien, input: IsiAngkaKonten): Promise<HasilKontenKol> {
  const angka = {
    views: input.views ?? 0,
    likes: input.likes ?? 0,
    comments: input.comments ?? 0,
    shares: input.shares ?? 0,
    saves: input.saves ?? 0,
  };
  const salah = periksaIsianAngka(angka);
  if (salah) return gagal(salah);
  if (!tanggalSah(input.recordedAt)) return gagal("TANGGAL_TIDAK_SAH");
  const note = input.note?.trim() || null;
  if (note && note.length > MAKS_CATATAN) return gagal("CATATAN_TERLALU_PANJANG");
  const source = input.source?.trim().slice(0, 191) || null;
  const perangkatId = input.perangkatId?.trim() || null;

  const sekarang = new Date();
  const lama = await tx.kolContent.findUnique({
    where: { id: input.kontenId },
    select: { id: true, link: true, liveAt: true, collab: { select: { id: true, docNo: true, kol: { select: { name: true } } } } },
  });
  if (!lama) return gagal("TIDAK_DITEMUKAN");
  if (!lama.link?.trim()) return gagal("BELUM_TAYANG");
  const waktu = input.recordedAt ?? sekarang;
  // Lima menit kelonggaran untuk jam peramban yang sedikit maju.
  if (waktu.getTime() > sekarang.getTime() + 5 * 60_000) return gagal("TANGGAL_TIDAK_SAH");
  if (lama.liveAt && formatDateOnlyJakarta(waktu) < formatDateOnlyJakarta(lama.liveAt)) return gagal("TANGGAL_TIDAK_SAH");

  const baris = await tx.kolContentMetric.create({
    data: { contentId: lama.id, recordedAt: waktu, ...angka, source, note, perangkatId, createdById: input.olehUserId },
    select: { id: true },
  });
  await catatJejak(tx, {
    userId: input.olehUserId,
    action: JEJAK.ANGKA_KONTEN_DICATAT,
    entityType: "KolBrief",
    entityId: lama.collab.id,
    changes: { after: { ...angka, recordedAt: waktu.toISOString() } },
    metadata: { kontenId: lama.id, angkaId: baris.id, docNo: lama.collab.docNo, kol: lama.collab.kol.name, source, ...(perangkatId ? { perangkatId } : {}) },
  });
  const maju = await terapkanMajuOtomatis(tx, { kolaborasiId: lama.collab.id, olehUserId: input.olehUserId, sebab: "angka konten" });
  return { ok: true as const, id: lama.id, maju };
}
