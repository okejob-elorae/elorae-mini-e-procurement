import { prisma, Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { cariTeks } from "@/lib/db/cari-teks";
import { formatDateOnlyJakarta, parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { geserHari, hariIniWib } from "@/lib/tanggal-isian";
import { catatAngkaDiTx, type KodeGagalKontenKol } from "./konten-kol-writer";
import { susunAntreanPantau, BATAS_TELAT_KONTEN_HARI, TITIK_KONTEN, kunciKonten, kunciProfil } from "./pantau-antrean";
import {
  dalamJamKerja,
  ENTITAS_PERANGKAT,
  JEDA_MANUAL_SAMPAI,
  JEJAK_PANTAU,
  KODE_BERLAKU_MENIT,
  KODE_JEDA,
  KODE_STATUS_AKUN,
  KODE_ULANG,
  LEASE_MENIT,
  MAKS_PERCOBAAN,
  NAMA_PERANGKAT_MAKS,
  normalKodeSambung,
  type AlasanJeda,
  type AlasanTanpaTugas,
  type JejakPantau,
  type JenisLogPantau,
  type PengaturanPantau,
} from "./pantau-aturan";
import { hitungErAkun } from "./pantau-er";
import {
  handleCocok,
  handleDariLink,
  normalHandle,
  pangkasInt,
  videoIdDariLink,
  type HasilKonten,
  type HasilPantau,
  type HasilProfil,
  type MasalahPantau,
} from "./pantau-muatan";
import { bacaPengaturanPantau } from "./pantau-pengaturan";
import { buatKode, buatToken, hashRahasia } from "./pantau-token";
import { TAHAP_BERJALAN } from "./tahap";

/*
 * Penulis pantau KOL — KHUSUS SERVER (klien hanya `import type`).
 *
 * Dua pintu masuk:
 *   - layar Elorae (buat kode sambung, jeda, lanjutkan, cabut, susun antrean):
 *     setiap tindakan menulis `AuditLog` (nama di `JEJAK_PANTAU`) DI DALAM
 *     transaksinya;
 *   - API ekstensi (sambung, pinjam tugas, hasil, masalah, manual): ditulis ke
 *     `KolLogPantau`, atas nama perangkatnya. Tulisan yang memerlukan pengguna
 *     (angka konten, maju tahap) memakai orang yang menyambungkan perangkatnya
 *     (`dibuatOlehId`), dengan `perangkatId` di metadata.
 *
 * Peminjaman tugas (`pinjamTugas`) berjalan di `runSerializable`: Prisma
 * `updateMany` BUKAN compare-and-swap (lihat CLAUDE.md) — di luar transaksi
 * serializable, dua perangkat bisa sama-sama "berhasil" meminjam tugas yang
 * sama. Dibuktikan oleh tes balapan di `pantau-writer.test.ts`.
 *
 * `sekarang` dan `pengaturan` bisa diberikan pemanggil: tes memakai tahun
 * 2000–2004 dan pengaturannya sendiri, tanpa menyentuh baris pengaturan
 * sungguhan atau kuota hari ini.
 */

type Klien = Prisma.TransactionClient;

export type PerangkatSah = {
  id: string;
  nama: string;
  dibuatOlehId: string;
  dijedaSampai: Date | null;
  alasanJeda: string | null;
  dicabutAt: Date | null;
  terakhirLaporAt: Date | null;
};

const PILIH_PERANGKAT = {
  id: true,
  nama: true,
  dibuatOlehId: true,
  dijedaSampai: true,
  alasanJeda: true,
  dicabutAt: true,
  terakhirLaporAt: true,
} satisfies Prisma.KolPerangkatSelect;

/** Kode yang dihitung sebagai kegagalan perangkat untuk aturan "gagal beruntun". */
const KODE_GAGAL_PERANGKAT: ReadonlySet<string> = new Set([
  "GAGAL_MUAT",
  "TIDAK_TERBACA",
  "AKUN_BERBEDA",
  "KONTEN_BERBEDA",
  "ANGKA_KOSONG",
  "MUATAN_TIDAK_SAH",
  "JENIS_BERBEDA",
]);
/** Kode hasil yang diantrekan lagi bila percobaan masih tersisa. */
const KODE_HASIL_ULANG: ReadonlySet<string> = new Set([...KODE_ULANG, "ANGKA_KOSONG", "MUATAN_TIDAK_SAH"]);

/**
 * Satu percobaan dihitung SEKALI per pinjaman: hanya laporan untuk tugas yang
 * sedang DIPINJAM pelapornya yang menambah percobaan. Begitu dihitung, tugasnya
 * lepas dari perangkat itu (ANTRE lagi atau GAGAL), jadi laporan susulan untuk
 * pinjaman yang sama — mis. ekstensi mengirim `/masalah TIDAK_TERBACA` sesudah
 * `/hasil` ditolak — tidak menghitungnya dua kali. Laporan dari perangkat yang
 * pinjamannya sudah lewat (tugasnya ANTRE lagi atau dipinjam perangkat lain)
 * juga tidak dihitung.
 */
const dipinjamOleh = (t: { status: string; perangkatId: string | null }, perangkatId: string) =>
  t.status === "DIPINJAM" && t.perangkatId === perangkatId;

const menit = (n: number) => n * 60_000;
const terbuka = (d: Date | null, sekarang: Date) => d !== null && d.getTime() > sekarang.getTime();

async function tulisLog(
  tx: Klien,
  isi: { perangkatId: string | null; tugasId?: string | null; jenis: JenisLogPantau; kode?: string | null; pesan?: string | null; waktu: Date },
) {
  await tx.kolLogPantau.create({
    data: {
      perangkatId: isi.perangkatId,
      tugasId: isi.tugasId ?? null,
      jenis: isi.jenis,
      kode: isi.kode ?? null,
      pesan: isi.pesan?.slice(0, 1000) ?? null,
      createdAt: isi.waktu,
    },
  });
}

async function jejak(
  tx: Klien,
  isi: { userId: string; action: JejakPantau; entityId: string; changes?: { before?: unknown; after?: unknown }; metadata?: Record<string, unknown>; reason?: string | null },
) {
  await tx.auditLog.create({
    data: {
      userId: isi.userId,
      action: isi.action,
      entityType: ENTITAS_PERANGKAT,
      entityId: isi.entityId,
      changes: (isi.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: (isi.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: isi.reason?.trim() || null,
    },
  });
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/* ═══════════════════════════ Layar Elorae ═══════════════════════════ */

export type HasilBuatKode =
  | { ok: true; perangkatId: string; nama: string; kode: string; berlakuSampai: Date }
  | { ok: false; kode: "NAMA_WAJIB" | "NAMA_TERLALU_PANJANG" | "PERANGKAT_TIDAK_ADA" | "SUDAH_DICABUT" };

/**
 * Buat kode sambung (8 tanda, 15 menit, sekali pakai). Tanpa `perangkatId`
 * dibuat perangkat baru bernama `nama`; dengan `perangkatId` perangkat lama
 * diberi kode baru (sambung ulang — token lamanya berhenti berlaku begitu kode
 * ini dipakai). Kode mentahnya hanya dikembalikan di sini, sekali.
 */
export async function buatKodeSambung(input: {
  nama?: string | null;
  perangkatId?: string | null;
  olehUserId: string;
  sekarang?: Date;
}): Promise<HasilBuatKode> {
  const sekarang = input.sekarang ?? new Date();
  const berlakuSampai = new Date(sekarang.getTime() + menit(KODE_BERLAKU_MENIT));
  const nama = (input.nama ?? "").trim();
  if (!input.perangkatId) {
    if (!nama) return { ok: false, kode: "NAMA_WAJIB" };
    if (nama.length > NAMA_PERANGKAT_MAKS) return { ok: false, kode: "NAMA_TERLALU_PANJANG" };
  }

  // Tabrakan hash kode hampir mustahil (31⁸), tapi kolomnya unik: coba ulang dengan kode lain.
  for (let coba = 0; ; coba++) {
    const { kode, kodeHash } = buatKode();
    try {
      return await runSerializable(async (tx): Promise<HasilBuatKode> => {
        if (input.perangkatId) {
          const p = await tx.kolPerangkat.findUnique({ where: { id: input.perangkatId }, select: { id: true, nama: true, dicabutAt: true } });
          if (!p) return { ok: false, kode: "PERANGKAT_TIDAK_ADA" };
          if (p.dicabutAt) return { ok: false, kode: "SUDAH_DICABUT" };
          await tx.kolPerangkat.update({ where: { id: p.id }, data: { kodeHash, kodeBerlakuSampai: berlakuSampai } });
          await jejak(tx, {
            userId: input.olehUserId,
            action: JEJAK_PANTAU.KODE_DIBUAT,
            entityId: p.id,
            metadata: { nama: p.nama, berlakuSampai: berlakuSampai.toISOString(), sambungUlang: true },
          });
          return { ok: true, perangkatId: p.id, nama: p.nama, kode, berlakuSampai };
        }
        const p = await tx.kolPerangkat.create({
          data: { nama, dibuatOlehId: input.olehUserId, kodeHash, kodeBerlakuSampai: berlakuSampai, createdAt: sekarang },
          select: { id: true },
        });
        await jejak(tx, {
          userId: input.olehUserId,
          action: JEJAK_PANTAU.KODE_DIBUAT,
          entityId: p.id,
          changes: { after: { nama } },
          metadata: { nama, berlakuSampai: berlakuSampai.toISOString() },
        });
        return { ok: true, perangkatId: p.id, nama, kode, berlakuSampai };
      });
    } catch (e) {
      if (coba < 2 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
}

export type HasilUbahPerangkat = { ok: true } | { ok: false; kode: "PERANGKAT_TIDAK_ADA" | "SUDAH_DICABUT" };

/** Jeda dari Elorae = sampai dilanjutkan (`JEDA_MANUAL_SAMPAI`). Perangkat yang sedang dijeda otomatis diubah jadi jeda manual. */
export async function jedaPerangkat(input: { perangkatId: string; olehUserId: string; sekarang?: Date }): Promise<HasilUbahPerangkat> {
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx) => {
    const p = await tx.kolPerangkat.findUnique({ where: { id: input.perangkatId }, select: PILIH_PERANGKAT });
    if (!p) return { ok: false, kode: "PERANGKAT_TIDAK_ADA" } as const;
    if (p.dicabutAt) return { ok: false, kode: "SUDAH_DICABUT" } as const;
    if (p.alasanJeda === "MANUAL" && terbuka(p.dijedaSampai, sekarang)) return { ok: true } as const;
    await tx.kolPerangkat.update({ where: { id: p.id }, data: { dijedaSampai: JEDA_MANUAL_SAMPAI, alasanJeda: "MANUAL" } });
    await tulisLog(tx, { perangkatId: p.id, jenis: "JEDA", kode: "MANUAL", waktu: sekarang });
    await jejak(tx, {
      userId: input.olehUserId,
      action: JEJAK_PANTAU.DIJEDA,
      entityId: p.id,
      changes: { before: { dijedaSampai: iso(p.dijedaSampai), alasanJeda: p.alasanJeda }, after: { alasanJeda: "MANUAL" } },
      metadata: { nama: p.nama },
    });
    // Tugas yang sedang dipinjamnya kembali ke antrean untuk perangkat lain.
    await tx.kolTugasPantau.updateMany({
      where: { perangkatId: p.id, status: "DIPINJAM" },
      data: { status: "ANTRE", perangkatId: null, pinjamSampai: null },
    });
    return { ok: true } as const;
  });
}

export async function lanjutkanPerangkat(input: { perangkatId: string; olehUserId: string; sekarang?: Date }): Promise<HasilUbahPerangkat> {
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx) => {
    const p = await tx.kolPerangkat.findUnique({ where: { id: input.perangkatId }, select: PILIH_PERANGKAT });
    if (!p) return { ok: false, kode: "PERANGKAT_TIDAK_ADA" } as const;
    if (p.dicabutAt) return { ok: false, kode: "SUDAH_DICABUT" } as const;
    if (!p.dijedaSampai && !p.alasanJeda) return { ok: true } as const;
    await tx.kolPerangkat.update({ where: { id: p.id }, data: { dijedaSampai: null, alasanJeda: null } });
    await tulisLog(tx, { perangkatId: p.id, jenis: "LANJUT", kode: "MANUAL", waktu: sekarang });
    await jejak(tx, {
      userId: input.olehUserId,
      action: JEJAK_PANTAU.DILANJUTKAN,
      entityId: p.id,
      changes: { before: { dijedaSampai: iso(p.dijedaSampai), alasanJeda: p.alasanJeda }, after: { dijedaSampai: null, alasanJeda: null } },
      metadata: { nama: p.nama },
    });
    return { ok: true } as const;
  });
}

/** Cabut: token dan kode dibuang, tugas yang dipinjam kembali ke antrean. Tidak bisa dibatalkan — sambungkan perangkat baru. */
export async function cabutPerangkat(input: { perangkatId: string; olehUserId: string; sekarang?: Date }): Promise<HasilUbahPerangkat> {
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx) => {
    const p = await tx.kolPerangkat.findUnique({ where: { id: input.perangkatId }, select: PILIH_PERANGKAT });
    if (!p) return { ok: false, kode: "PERANGKAT_TIDAK_ADA" } as const;
    if (p.dicabutAt) return { ok: true } as const;
    await tx.kolPerangkat.update({
      where: { id: p.id },
      data: { dicabutAt: sekarang, tokenHash: null, kodeHash: null, kodeBerlakuSampai: null, dijedaSampai: null, alasanJeda: null },
    });
    await tx.kolTugasPantau.updateMany({
      where: { perangkatId: p.id, status: "DIPINJAM" },
      data: { status: "ANTRE", perangkatId: null, pinjamSampai: null },
    });
    await jejak(tx, { userId: input.olehUserId, action: JEJAK_PANTAU.DICABUT, entityId: p.id, metadata: { nama: p.nama } });
    return { ok: true } as const;
  });
}

/* ═══════════════════════════ Antrean ═══════════════════════════ */

export type CakupanAntrean = { kontenIds?: readonly string[]; akunIds?: readonly string[] };

const POTONG = 500;
function potong<T>(xs: readonly T[], n = POTONG): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < xs.length; i += n) hasil.push(xs.slice(i, i + n));
  return hasil;
}

/**
 * Susun antrean hari ini (cron 06.00 WIB dan tombol "Susun antrean sekarang").
 * Aturannya murni di `susunAntreanPantau`; di sini hanya membaca bahannya dan
 * menulis hasilnya. Aman dijalankan berkali-kali: kunci tugas unik
 * (`skipDuplicates`). Titik konten lama yang belum dikerjakan → DILEWATI.
 * `cakupan` membatasi bacaan ke id tertentu (tes berbagi basis data).
 */
export async function susunAntrean(
  input: { sekarang?: Date; pengaturan?: PengaturanPantau; olehUserId?: string | null; cakupan?: CakupanAntrean } = {},
): Promise<{ dibuat: number; dilewati: number }> {
  const sekarang = input.sekarang ?? new Date();
  const hariIni = hariIniWib(sekarang);
  const pengaturan = input.pengaturan ?? (await bacaPengaturanPantau());
  const tertua = parseDateOnly(geserHari(hariIni, -(Math.max(...TITIK_KONTEN) + BATAS_TELAT_KONTEN_HARI + 1)))!;

  const [kontenMentah, akunMentah] = await Promise.all([
    prisma.kolContent.findMany({
      where: {
        link: cariTeks("tiktok.com"),
        liveAt: { gte: tertua, lte: sekarang },
        ...(input.cakupan?.kontenIds ? { id: { in: [...input.cakupan.kontenIds] } } : {}),
      },
      select: { id: true, link: true, liveAt: true, collab: { select: { kol: { select: { blockedAt: true } } } } },
    }),
    prisma.kolAccount.findMany({
      where: { platform: "TIKTOK", ...(input.cakupan?.akunIds ? { id: { in: [...input.cakupan.akunIds] } } : {}) },
      select: {
        id: true,
        handle: true,
        lastCheckedAt: true,
        kol: { select: { blockedAt: true, briefs: { where: { tahap: { in: [...TAHAP_BERJALAN] } }, select: { id: true }, take: 1 } } },
      },
    }),
  ]);

  // `relationMode = "prisma"`: konten/akun bisa sesaat menunjuk kolaborasi/KOL yang sudah terhapus — dilewati.
  const konten = kontenMentah
    .filter((k) => k.collab?.kol != null)
    .map((k) => ({ id: k.id, link: k.link, liveAtHari: k.liveAt ? formatDateOnlyJakarta(k.liveAt) : null, kolDiblokir: k.collab.kol.blockedAt !== null }));
  const akun = akunMentah
    .filter((a) => a.kol != null)
    .map((a) => ({
      id: a.id,
      handle: a.handle,
      kolDiblokir: a.kol.blockedAt !== null,
      aktif: a.kol.briefs.length > 0,
      terakhirDicekHari: a.lastCheckedAt ? formatDateOnlyJakarta(a.lastCheckedAt) : null,
    }));

  const calonKunci = [
    ...konten.flatMap((k) => TITIK_KONTEN.map((n) => kunciKonten(k.id, n))),
    ...akun.map((a) => kunciProfil(a.id, hariIni)),
  ];
  const kunciAda = new Set<string>();
  for (const bagian of potong(calonKunci)) {
    const ada = await prisma.kolTugasPantau.findMany({ where: { kunci: { in: bagian } }, select: { kunci: true } });
    for (const r of ada) kunciAda.add(r.kunci);
  }
  const akunTerbuka = new Set<string>();
  for (const bagian of potong(akun.map((a) => a.id))) {
    const ada = await prisma.kolTugasPantau.findMany({
      where: { jenis: "PROFIL", status: { in: ["ANTRE", "DIPINJAM"] }, accountId: { in: bagian } },
      select: { accountId: true },
    });
    for (const r of ada) if (r.accountId) akunTerbuka.add(r.accountId);
  }

  const { baru, lewati } = susunAntreanPantau({ hariIni, konten, akun, kunciAda, akunTerbuka, pengaturan });

  let dibuat = 0;
  for (const bagian of potong(baru)) {
    const r = await prisma.kolTugasPantau.createMany({
      data: bagian.map((t) => ({
        kunci: t.kunci,
        jenis: t.jenis,
        platform: t.platform,
        accountId: t.accountId,
        contentId: t.contentId,
        url: t.url,
        titikH: t.titikH,
        prioritas: t.prioritas,
        jatuhAt: parseDateOnly(t.jatuhHari)!,
        createdAt: sekarang,
      })),
      skipDuplicates: true,
    });
    dibuat += r.count;
  }
  let dilewati = 0;
  for (const bagian of potong(lewati)) {
    const r = await prisma.kolTugasPantau.updateMany({
      where: { kunci: { in: bagian }, status: "ANTRE" },
      data: { status: "DILEWATI", selesaiAt: sekarang, galatTerakhir: "TITIK_BARU" },
    });
    dilewati += r.count;
  }

  if (input.olehUserId) {
    await prisma.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_PANTAU.ANTREAN_DISUSUN,
        entityType: "KolTugasPantau",
        entityId: hariIni,
        metadata: { dibuat, dilewati },
      },
    });
  }
  return { dibuat, dilewati };
}

/* ═══════════════════════════ API ekstensi ═══════════════════════════ */

export type HasilSambung =
  | { ok: true; token: string; perangkat: { id: string; nama: string } }
  | { ok: false; kode: "KODE_TIDAK_SAH" | "KODE_KEDALUWARSA" };

/**
 * Tukar kode sambung dengan token. Sekali pakai: kode dikosongkan dalam
 * transaksi yang sama dengan token disimpan (compare-and-swap di dalam
 * `runSerializable`), jadi dua ekstensi yang mengetik kode yang sama tidak
 * bisa sama-sama mendapat token.
 */
export async function sambungPerangkat(input: { kode: unknown; versi: unknown; sekarang?: Date }): Promise<HasilSambung> {
  const kode = normalKodeSambung(input.kode);
  if (!kode) return { ok: false, kode: "KODE_TIDAK_SAH" };
  const versi = typeof input.versi === "string" && input.versi.trim() ? input.versi.trim().slice(0, 40) : null;
  const sekarang = input.sekarang ?? new Date();
  const kodeHash = hashRahasia(kode);
  const { token, tokenHash } = buatToken();
  return runSerializable(async (tx): Promise<HasilSambung> => {
    const p = await tx.kolPerangkat.findUnique({ where: { kodeHash }, select: { id: true, nama: true, dicabutAt: true, kodeBerlakuSampai: true } });
    if (!p || p.dicabutAt) return { ok: false, kode: "KODE_TIDAK_SAH" };
    if (!p.kodeBerlakuSampai || p.kodeBerlakuSampai.getTime() < sekarang.getTime()) return { ok: false, kode: "KODE_KEDALUWARSA" };
    const r = await tx.kolPerangkat.updateMany({
      where: { id: p.id, kodeHash, dicabutAt: null },
      data: { kodeHash: null, kodeBerlakuSampai: null, tokenHash, tersambungAt: sekarang, terakhirLaporAt: sekarang, versiEkstensi: versi },
    });
    if (r.count !== 1) return { ok: false, kode: "KODE_TIDAK_SAH" };
    await tulisLog(tx, { perangkatId: p.id, jenis: "SAMBUNG", pesan: versi ? `versi ${versi}` : null, waktu: sekarang });
    return { ok: true, token, perangkat: { id: p.id, nama: p.nama } };
  });
}

/** Selang paling pendek antara dua tulisan `terakhirLaporAt` — status ditanya setiap menit. */
const SELANG_LAPOR_MS = 60_000;

/**
 * Perangkat pemilik token, atau `null` (token tidak dikenal / dicabut → 401).
 * Sekaligus: jeda otomatis yang sudah lewat dilepas (log LANJUT), dan
 * `terakhirLaporAt` diperbarui paling sering sekali per menit.
 */
export async function perangkatDariToken(token: string, sekarang: Date = new Date()): Promise<PerangkatSah | null> {
  const p = await prisma.kolPerangkat.findUnique({ where: { tokenHash: hashRahasia(token) }, select: PILIH_PERANGKAT });
  if (!p || p.dicabutAt) return null;
  if (p.dijedaSampai && p.dijedaSampai.getTime() <= sekarang.getTime()) {
    await runSerializable(async (tx) => {
      const r = await tx.kolPerangkat.updateMany({
        where: { id: p.id, dijedaSampai: { lte: sekarang } },
        data: { dijedaSampai: null, alasanJeda: null },
      });
      if (r.count === 1) await tulisLog(tx, { perangkatId: p.id, jenis: "LANJUT", kode: "OTOMATIS", pesan: p.alasanJeda, waktu: sekarang });
    });
    p.dijedaSampai = null;
    p.alasanJeda = null;
  }
  if (!p.terakhirLaporAt || sekarang.getTime() - p.terakhirLaporAt.getTime() >= SELANG_LAPOR_MS) {
    await prisma.kolPerangkat.update({ where: { id: p.id }, data: { terakhirLaporAt: sekarang } });
    p.terakhirLaporAt = sekarang;
  }
  return p;
}

export type HitunganHariIni = { selesai: number; gagal: number; dipinjam: number; kuota: number; sisa: number };

/**
 * Kuota hari ini (WIB), semua perangkat bersama: satu pengecekan = satu tugas
 * yang selesai, gagal, atau sedang dipinjam. Hasil manual (`/manual`, tanpa
 * tugas) tidak memakan kuota.
 */
export async function hitungHariIni(client: Klien | typeof prisma, sekarang: Date, kuota: number): Promise<HitunganHariIni> {
  const hari = hariIniWib(sekarang);
  const rentang = { gte: parseDateOnly(hari)!, lte: parseDateOnlyEnd(hari)! };
  const [selesai, gagal, dipinjam] = await Promise.all([
    client.kolLogPantau.count({ where: { jenis: "HASIL", tugasId: { not: null }, createdAt: rentang } }),
    client.kolLogPantau.count({ where: { jenis: "MASALAH", tugasId: { not: null }, createdAt: rentang } }),
    // Lease yang sah berakhir paling lambat `LEASE_MENIT` dari sekarang; batas atas ini juga
    // menjaga hitungan tes (tahun 2000–2004) dari pinjaman sungguhan yang berakhir hari ini.
    client.kolTugasPantau.count({ where: { status: "DIPINJAM", pinjamSampai: { gte: sekarang, lte: new Date(sekarang.getTime() + menit(LEASE_MENIT)) } } }),
  ]);
  return { selesai, gagal, dipinjam, kuota, sisa: Math.max(0, kuota - selesai - gagal - dipinjam) };
}

export type StatusEkstensi = {
  ok: true;
  perangkat: { id: string; nama: string };
  aktif: boolean;
  dijedaSampai: string | null;
  alasanJeda: string | null;
  pengaturan: Pick<
    PengaturanPantau,
    | "jamMulai"
    | "jamSelesai"
    | "jedaMinDetik"
    | "jedaMaksDetik"
    | "istirahatSetiapMenit"
    | "istirahatMinMenit"
    | "istirahatMaksMenit"
    | "jedaOtomatisMenit"
  >;
  hariIni: { selesai: number; gagal: number; kuota: number; sisa: number };
};

export async function statusPerangkat(
  p: PerangkatSah,
  o: { sekarang?: Date; pengaturan?: PengaturanPantau } = {},
): Promise<StatusEkstensi> {
  const sekarang = o.sekarang ?? new Date();
  const pg = o.pengaturan ?? (await bacaPengaturanPantau());
  const h = await hitungHariIni(prisma, sekarang, pg.kuotaHarian);
  const dijeda = terbuka(p.dijedaSampai, sekarang);
  return {
    ok: true,
    perangkat: { id: p.id, nama: p.nama },
    aktif: pg.aktif && !dijeda,
    dijedaSampai: dijeda ? iso(p.dijedaSampai) : null,
    alasanJeda: dijeda ? p.alasanJeda : null,
    pengaturan: {
      jamMulai: pg.jamMulai,
      jamSelesai: pg.jamSelesai,
      jedaMinDetik: pg.jedaMinDetik,
      jedaMaksDetik: pg.jedaMaksDetik,
      istirahatSetiapMenit: pg.istirahatSetiapMenit,
      istirahatMinMenit: pg.istirahatMinMenit,
      istirahatMaksMenit: pg.istirahatMaksMenit,
      jedaOtomatisMenit: pg.jedaOtomatisMenit,
    },
    hariIni: { selesai: h.selesai, gagal: h.gagal, kuota: h.kuota, sisa: h.sisa },
  };
}

export type TugasEkstensi = { id: string; jenis: "PROFIL" | "KONTEN"; platform: "TIKTOK"; url: string; handle?: string };
export type HasilPinjam = { tugas: TugasEkstensi | null; alasan?: AlasanTanpaTugas };

const PILIH_TUGAS = {
  id: true,
  jenis: true,
  url: true,
  account: { select: { handle: true } },
  content: { select: { link: true, collab: { select: { kol: { select: { accounts: { where: { platform: "TIKTOK" as const }, select: { handle: true } } } } } } } },
} satisfies Prisma.KolTugasPantauSelect;

function keTugasEkstensi(t: Prisma.KolTugasPantauGetPayload<{ select: typeof PILIH_TUGAS }>): TugasEkstensi {
  const handle =
    t.jenis === "PROFIL"
      ? normalHandle(t.account?.handle)
      : (handleDariLink(t.content?.link ?? t.url) ?? normalHandle(t.content?.collab?.kol?.accounts[0]?.handle));
  return { id: t.id, jenis: t.jenis === "KONTEN" ? "KONTEN" : "PROFIL", platform: "TIKTOK", url: t.url, ...(handle ? { handle } : {}) };
}

/**
 * Pinjamkan satu tugas ke perangkat (lease `LEASE_MENIT`). Urutan alasan
 * tanpa tugas: NONAKTIF → DIJEDA → DI_LUAR_JAM → KUOTA_HABIS → ANTREAN_KOSONG.
 * Tugas DIPINJAM yang lease-nya lewat kembali ANTRE lebih dulu; perangkat
 * yang masih memegang tugas yang sah mendapat tugas itu lagi (lease
 * diperpanjang), bukan tugas kedua. Prioritas tertinggi, jatuh tempo paling
 * awal dulu.
 */
export async function pinjamTugas(input: {
  perangkatId: string;
  sekarang?: Date;
  pengaturan?: PengaturanPantau;
  cakupan?: { tugasIds?: readonly string[] };
}): Promise<HasilPinjam> {
  const sekarang = input.sekarang ?? new Date();
  const pg = input.pengaturan ?? (await bacaPengaturanPantau());
  const lingkup: Prisma.KolTugasPantauWhereInput = input.cakupan?.tugasIds ? { id: { in: [...input.cakupan.tugasIds] } } : {};
  const sampai = new Date(sekarang.getTime() + menit(LEASE_MENIT));

  return runSerializable(async (tx): Promise<HasilPinjam> => {
    const p = await tx.kolPerangkat.findUnique({ where: { id: input.perangkatId }, select: { dicabutAt: true, dijedaSampai: true } });
    if (!p || p.dicabutAt) return { tugas: null, alasan: "NONAKTIF" };
    if (!pg.aktif) return { tugas: null, alasan: "NONAKTIF" };
    if (terbuka(p.dijedaSampai, sekarang)) return { tugas: null, alasan: "DIJEDA" };
    if (!dalamJamKerja(sekarang, pg)) return { tugas: null, alasan: "DI_LUAR_JAM" };

    await tx.kolTugasPantau.updateMany({
      where: { ...lingkup, status: "DIPINJAM", pinjamSampai: { lt: sekarang } },
      data: { status: "ANTRE", perangkatId: null, pinjamSampai: null },
    });

    const dipegang = await tx.kolTugasPantau.findFirst({
      where: { ...lingkup, status: "DIPINJAM", perangkatId: input.perangkatId, pinjamSampai: { gte: sekarang } },
      orderBy: [{ pinjamSampai: "asc" }, { id: "asc" }],
      select: PILIH_TUGAS,
    });
    if (dipegang) {
      await tx.kolTugasPantau.update({ where: { id: dipegang.id }, data: { pinjamSampai: sampai } });
      return { tugas: keTugasEkstensi(dipegang) };
    }

    const h = await hitungHariIni(tx, sekarang, pg.kuotaHarian);
    if (h.sisa <= 0) return { tugas: null, alasan: "KUOTA_HABIS" };

    const calon = await tx.kolTugasPantau.findFirst({
      where: { ...lingkup, status: "ANTRE", jatuhAt: { lte: sekarang } },
      orderBy: [{ prioritas: "desc" }, { jatuhAt: "asc" }, { id: "asc" }],
      select: PILIH_TUGAS,
    });
    if (!calon) return { tugas: null, alasan: "ANTREAN_KOSONG" };
    const r = await tx.kolTugasPantau.updateMany({
      where: { id: calon.id, status: "ANTRE" },
      data: { status: "DIPINJAM", perangkatId: input.perangkatId, pinjamSampai: sampai },
    });
    if (r.count !== 1) return { tugas: null, alasan: "ANTREAN_KOSONG" };
    return { tugas: keTugasEkstensi(calon) };
  });
}

/* ─────────────────────────── Hasil ─────────────────────────── */

/** Penolakan dari penulis angka konten (`catatAngkaDiTx`) yang bisa sampai ke ekstensi. */
type KodeTolakAngka = Extract<KodeGagalKontenKol, "TIDAK_DITEMUKAN" | "BELUM_TAYANG" | "ANGKA_TIDAK_SAH" | "ANGKA_KOSONG" | "TANGGAL_TIDAK_SAH">;

export type KodeTolakHasil =
  | "TUGAS_TIDAK_ADA"
  | "TUGAS_TIDAK_AKTIF"
  | "JENIS_BERBEDA"
  | "AKUN_BERBEDA"
  | "KONTEN_BERBEDA"
  | "MUATAN_TIDAK_SAH"
  | KodeTolakAngka;

export type HasilSimpan = { ok: true; ulang?: true } | { ok: false; kode: KodeTolakHasil };

/** Simpan hasil profil ke akun: catatan pengikut baru (selalu baris baru) + angka akun terbaru. */
async function simpanProfilDiTx(tx: Klien, akunId: string, data: HasilProfil, perangkatId: string, sekarang: Date) {
  const er = hitungErAkun(data.posting, sekarang);
  await tx.kolFollowerSnapshot.create({
    data: {
      accountId: akunId,
      followers: pangkasInt(data.pengikut),
      recordedAt: sekarang,
      source: "ekstensi",
      er: er.er === null ? null : new Prisma.Decimal(er.er),
      avgViews: er.avgViews,
      postsCounted: er.postsCounted,
      perangkatId,
    },
  });
  await tx.kolAccount.update({
    where: { id: akunId },
    data: {
      followers: pangkasInt(data.pengikut),
      // ER yang tidak bisa dihitung (< 3 posting sah) tidak menghapus ER terakhir yang terukur; `erUpdatedAt` menyebut kapan.
      ...(er.er !== null ? { er: new Prisma.Decimal(er.er), avgViews: er.avgViews, erUpdatedAt: sekarang } : {}),
      ...(data.secUid ? { platformUserId: data.secUid.slice(0, 191) } : {}),
      lastCheckedAt: sekarang,
      checkStatus: "OK",
    },
  });
}

async function simpanKontenDiTx(tx: Klien, kontenId: string, data: HasilKonten, p: Pick<PerangkatSah, "id" | "dibuatOlehId">, sekarang: Date) {
  // Kolom angka konten adalah Int: video di atas 2,1 miliar views disimpan terpangkas, tidak ditolak.
  return catatAngkaDiTx(tx, {
    kontenId,
    views: pangkasInt(data.views),
    likes: pangkasInt(data.like),
    comments: pangkasInt(data.komentar),
    shares: pangkasInt(data.share),
    saves: pangkasInt(data.save),
    recordedAt: sekarang,
    source: "ekstensi",
    perangkatId: p.id,
    olehUserId: p.dibuatOlehId,
  });
}

/** Handle yang boleh untuk sebuah konten: akun TikTok KOL-nya + handle di link-nya sendiri. */
function handleKonten(link: string | null, akun: readonly { handle: string }[]): string[] {
  return [...akun.map((a) => a.handle), handleDariLink(link) ?? ""].filter((h) => normalHandle(h));
}

/**
 * Gagalkan tugas karena hasilnya ditolak (akun/konten berbeda, angka kosong),
 * catat masalahnya, dan terapkan aturan gagal beruntun. Ditulis di transaksi
 * pemanggil dan DIKEMBALIKAN (bukan dilempar) supaya ikut tersimpan.
 */
async function tolakHasil(
  tx: Klien,
  tugas: { id: string; percobaan: number; status: string; perangkatId: string | null },
  kode: KodeTolakHasil,
  p: PerangkatSah,
  pg: PengaturanPantau,
  sekarang: Date,
): Promise<{ ok: false; kode: KodeTolakHasil }> {
  if (!dipinjamOleh(tugas, p.id)) return { ok: false, kode };
  const percobaan = tugas.percobaan + 1;
  const ulang = KODE_HASIL_ULANG.has(kode) && percobaan < MAKS_PERCOBAAN;
  await tx.kolTugasPantau.update({
    where: { id: tugas.id },
    data: ulang
      ? { status: "ANTRE", percobaan, perangkatId: null, pinjamSampai: null, galatTerakhir: kode }
      : { status: "GAGAL", percobaan, perangkatId: p.id, pinjamSampai: null, galatTerakhir: kode, selesaiAt: sekarang },
  });
  await tulisLog(tx, { perangkatId: p.id, tugasId: tugas.id, jenis: "MASALAH", kode, waktu: sekarang });
  await periksaGagalBeruntun(tx, p, pg, sekarang);
  return { ok: false, kode };
}

/**
 * Jeda perangkat bila `maksGagalBeruntun` laporan terakhirnya semuanya
 * kegagalan perangkat. LANJUT memutus deretnya — perangkat yang baru
 * dilanjutkan tidak langsung dijeda lagi oleh kegagalan lamanya.
 */
async function periksaGagalBeruntun(tx: Klien, p: PerangkatSah, pg: PengaturanPantau, sekarang: Date) {
  const akhir = await tx.kolLogPantau.findMany({
    where: { perangkatId: p.id, jenis: { in: ["HASIL", "MASALAH", "LANJUT"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pg.maksGagalBeruntun,
    select: { jenis: true, kode: true },
  });
  if (akhir.length < pg.maksGagalBeruntun) return;
  if (!akhir.every((l) => l.jenis === "MASALAH" && l.kode !== null && KODE_GAGAL_PERANGKAT.has(l.kode))) return;
  await jedaOtomatis(tx, p, "GAGAL_BERUNTUN", pg, sekarang);
}

async function jedaOtomatis(tx: Klien, p: PerangkatSah, alasan: Exclude<AlasanJeda, "MANUAL">, pg: PengaturanPantau, sekarang: Date) {
  const sampai = new Date(sekarang.getTime() + menit(pg.jedaOtomatisMenit));
  // Jeda manual tidak dipendekkan oleh jeda otomatis.
  const kini = await tx.kolPerangkat.findUnique({ where: { id: p.id }, select: { dijedaSampai: true, alasanJeda: true } });
  if (kini?.alasanJeda === "MANUAL" && terbuka(kini.dijedaSampai, sekarang)) return kini.dijedaSampai;
  await tx.kolPerangkat.update({ where: { id: p.id }, data: { dijedaSampai: sampai, alasanJeda: alasan } });
  await tx.kolTugasPantau.updateMany({
    where: { perangkatId: p.id, status: "DIPINJAM" },
    data: { status: "ANTRE", perangkatId: null, pinjamSampai: null },
  });
  await tulisLog(tx, { perangkatId: p.id, jenis: "JEDA", kode: alasan, pesan: `sampai ${sampai.toISOString()}`, waktu: sekarang });
  return sampai;
}

/**
 * Terima hasil satu tugas. Idempoten: hasil kedua untuk tugas SELESAI →
 * `{ ok: true, ulang: true }` tanpa baris baru. Tugas yang ANTRE (lease-nya
 * lewat) atau DIPINJAM perangkat lain tetap diterima — angkanya sah, dan
 * tugasnya selesai sekali saja.
 */
export async function simpanHasil(input: {
  perangkat: PerangkatSah;
  tugasId: string;
  data: HasilPantau;
  sekarang?: Date;
  pengaturan?: PengaturanPantau;
}): Promise<HasilSimpan> {
  const sekarang = input.sekarang ?? new Date();
  const pg = input.pengaturan ?? (await bacaPengaturanPantau());
  const p = input.perangkat;
  return runSerializable(async (tx): Promise<HasilSimpan> => {
    const t = await tx.kolTugasPantau.findUnique({
      where: { id: input.tugasId },
      select: {
        id: true,
        jenis: true,
        status: true,
        percobaan: true,
        perangkatId: true,
        accountId: true,
        contentId: true,
        account: { select: { id: true, handle: true } },
        content: { select: { id: true, link: true, collab: { select: { kol: { select: { accounts: { where: { platform: "TIKTOK" }, select: { handle: true } } } } } } } },
      },
    });
    if (!t) return { ok: false, kode: "TUGAS_TIDAK_ADA" };
    if (t.status === "SELESAI") return { ok: true, ulang: true };
    if (t.status !== "ANTRE" && t.status !== "DIPINJAM") return { ok: false, kode: "TUGAS_TIDAK_AKTIF" };
    if (input.data.jenis !== t.jenis) return tolakHasil(tx, t, "JENIS_BERBEDA", p, pg, sekarang);

    if (input.data.jenis === "PROFIL") {
      if (!t.account) return { ok: false, kode: "TUGAS_TIDAK_ADA" };
      if (!handleCocok(input.data.uniqueId, [t.account.handle])) return tolakHasil(tx, t, "AKUN_BERBEDA", p, pg, sekarang);
      await simpanProfilDiTx(tx, t.account.id, input.data, p.id, sekarang);
    } else {
      if (!t.content) return { ok: false, kode: "TUGAS_TIDAK_ADA" };
      const boleh = handleKonten(t.content.link, t.content.collab?.kol?.accounts ?? []);
      if (boleh.length && !handleCocok(input.data.uniqueId, boleh)) return tolakHasil(tx, t, "AKUN_BERBEDA", p, pg, sekarang);
      const vid = videoIdDariLink(t.content.link);
      if (vid && vid !== input.data.videoId) return tolakHasil(tx, t, "KONTEN_BERBEDA", p, pg, sekarang);
      const r = await simpanKontenDiTx(tx, t.content.id, input.data, p, sekarang);
      if (!r.ok) return tolakHasil(tx, t, r.kode as KodeTolakHasil, p, pg, sekarang);
    }

    await tx.kolTugasPantau.update({
      where: { id: t.id },
      data: { status: "SELESAI", selesaiAt: sekarang, perangkatId: p.id, pinjamSampai: null, galatTerakhir: null },
    });
    await tulisLog(tx, { perangkatId: p.id, tugasId: t.id, jenis: "HASIL", kode: t.jenis, waktu: sekarang });
    return { ok: true };
  });
}

/* ─────────────────────────── Masalah ─────────────────────────── */

/**
 * Laporan masalah dari ekstensi.
 *   - GAGAL_MUAT / TIDAK_TERBACA: percobaan + 1; ANTRE lagi selama < 3, lalu GAGAL.
 *   - TIDAK_DITEMUKAN / PRIVAT: GAGAL; tugas profil menandai `KolAccount.checkStatus`
 *     dan `lastCheckedAt` (akunnya sudah dicek — tidak dicek ulang setiap hari).
 *   - CAPTCHA / LOGIN: masalah PERANGKAT, bukan tugas — tugasnya kembali ANTRE
 *     tanpa menambah percobaan, perangkat dijeda `jedaOtomatisMenit`.
 */
export async function laporMasalah(input: {
  perangkat: PerangkatSah;
  masalah: MasalahPantau;
  sekarang?: Date;
  pengaturan?: PengaturanPantau;
}): Promise<{ ok: true; dijedaSampai: string | null }> {
  const sekarang = input.sekarang ?? new Date();
  const pg = input.pengaturan ?? (await bacaPengaturanPantau());
  const p = input.perangkat;
  const { kode } = input.masalah;
  return runSerializable(async (tx) => {
    let tugasId: string | null = null;
    if (input.masalah.tugasId) {
      const t = await tx.kolTugasPantau.findUnique({
        where: { id: input.masalah.tugasId },
        select: { id: true, status: true, percobaan: true, perangkatId: true, accountId: true, jenis: true },
      });
      if (t && dipinjamOleh(t, p.id)) {
        tugasId = t.id;
        if (KODE_JEDA.has(kode)) {
          await tx.kolTugasPantau.update({ where: { id: t.id }, data: { status: "ANTRE", perangkatId: null, pinjamSampai: null, galatTerakhir: kode } });
        } else {
          const percobaan = t.percobaan + 1;
          const ulang = KODE_ULANG.has(kode) && percobaan < MAKS_PERCOBAAN;
          await tx.kolTugasPantau.update({
            where: { id: t.id },
            data: ulang
              ? { status: "ANTRE", percobaan, perangkatId: null, pinjamSampai: null, galatTerakhir: kode }
              : { status: "GAGAL", percobaan, perangkatId: p.id, pinjamSampai: null, galatTerakhir: kode, selesaiAt: sekarang },
          });
          if (t.jenis === "PROFIL" && t.accountId) {
            if (KODE_STATUS_AKUN.has(kode)) {
              await tx.kolAccount.update({ where: { id: t.accountId }, data: { checkStatus: kode, lastCheckedAt: sekarang } });
            } else if (kode === "TIDAK_TERBACA") {
              await tx.kolAccount.update({ where: { id: t.accountId }, data: { checkStatus: "TIDAK_TERBACA" } });
            }
          }
        }
      }
    }
    // Laporan susulan untuk tugas yang sudah dihitung (bukan pinjaman pelapor lagi) tidak dicatat
    // sebagai masalah kedua — kuota dan deret gagal beruntun menghitung baris MASALAH. Masalah
    // perangkat (captcha/login) dan laporan tanpa tugas tetap dicatat.
    const susulan = input.masalah.tugasId !== null && tugasId === null;
    if (!susulan || KODE_JEDA.has(kode)) {
      await tulisLog(tx, { perangkatId: p.id, tugasId, jenis: "MASALAH", kode, pesan: input.masalah.pesan, waktu: sekarang });
    }

    let dijedaSampai: Date | null = null;
    if (KODE_JEDA.has(kode)) dijedaSampai = (await jedaOtomatis(tx, p, kode as "CAPTCHA" | "LOGIN", pg, sekarang)) ?? null;
    else if (KODE_GAGAL_PERANGKAT.has(kode) && !susulan) await periksaGagalBeruntun(tx, p, pg, sekarang);
    if (!dijedaSampai) {
      const kini = await tx.kolPerangkat.findUnique({ where: { id: p.id }, select: { dijedaSampai: true } });
      dijedaSampai = terbuka(kini?.dijedaSampai ?? null, sekarang) ? kini!.dijedaSampai : null;
    }
    return { ok: true as const, dijedaSampai: iso(dijedaSampai) };
  });
}

/**
 * `/hasil` yang muatannya tidak sah (`MUATAN_TIDAK_SAH`) tetap satu percobaan
 * gagal untuk tugasnya — tanpa ini, bentuk halaman TikTok yang berubah membuat
 * tugas berputar selamanya lewat lease yang lewat. Dihitung sekali per
 * pinjaman (lihat `dipinjamOleh`); tugas yang tidak dikenal atau tidak sedang
 * dipinjam pelapornya tidak disentuh.
 */
export async function tolakMuatan(input: {
  perangkat: PerangkatSah;
  tugasId: string;
  sekarang?: Date;
  pengaturan?: PengaturanPantau;
}): Promise<{ ok: false; kode: "MUATAN_TIDAK_SAH" }> {
  const sekarang = input.sekarang ?? new Date();
  const pg = input.pengaturan ?? (await bacaPengaturanPantau());
  await runSerializable(async (tx) => {
    const t = await tx.kolTugasPantau.findUnique({
      where: { id: input.tugasId },
      select: { id: true, status: true, percobaan: true, perangkatId: true },
    });
    if (t) await tolakHasil(tx, t, "MUATAN_TIDAK_SAH", input.perangkat, pg, sekarang);
  });
  return { ok: false, kode: "MUATAN_TIDAK_SAH" };
}

/**
 * "Putuskan" dari popup ekstensi: perangkat mencabut tokennya sendiri. Sama
 * dengan Cabut di Elorae (tugas pinjamannya kembali ke antrean), tetapi
 * tercatat di log pantau (`SAMBUNG`/`PUTUS`) — tidak ada pengguna Elorae yang
 * melakukannya, jadi tidak ada baris `AuditLog`.
 */
export async function putuskanSendiri(input: { perangkat: PerangkatSah; sekarang?: Date }): Promise<{ ok: true }> {
  const sekarang = input.sekarang ?? new Date();
  const p = input.perangkat;
  await runSerializable(async (tx) => {
    const r = await tx.kolPerangkat.updateMany({
      where: { id: p.id, dicabutAt: null },
      data: { dicabutAt: sekarang, tokenHash: null, kodeHash: null, kodeBerlakuSampai: null, dijedaSampai: null, alasanJeda: null },
    });
    if (r.count !== 1) return;
    await tx.kolTugasPantau.updateMany({
      where: { perangkatId: p.id, status: "DIPINJAM" },
      data: { status: "ANTRE", perangkatId: null, pinjamSampai: null },
    });
    await tulisLog(tx, { perangkatId: p.id, jenis: "SAMBUNG", kode: "PUTUS", pesan: "diputuskan dari ekstensi", waktu: sekarang });
  });
  return { ok: true };
}

/* ─────────────────────────── Manual ─────────────────────────── */

export type HasilManual =
  | { ok: true; cocok: { kolId: string; nama: string } }
  | { ok: false; kode: "TIDAK_ADA_DI_ELORAE" | "AKUN_BERBEDA" | KodeTolakAngka };

/**
 * "Simpan ke Elorae" dari panel di halaman TikTok — tanpa tugas, tidak
 * memakan kuota. Profil dicocokkan lewat handle akun TikTok (abai huruf besar
 * dan "@"); konten lewat link yang memuat id videonya. Satu akun TikTok yang
 * tercatat di beberapa KOL diperbarui semuanya; yang disebut adalah yang
 * pertama.
 */
export async function simpanManual(input: { perangkat: PerangkatSah; url: string; data: HasilPantau; sekarang?: Date }): Promise<HasilManual> {
  const sekarang = input.sekarang ?? new Date();
  const p = input.perangkat;
  const d = input.data;
  return runSerializable(async (tx): Promise<HasilManual> => {
    if (d.jenis === "PROFIL") {
      const u = normalHandle(d.uniqueId);
      const calon = await tx.kolAccount.findMany({
        where: { platform: "TIKTOK", handle: cariTeks(u) },
        orderBy: [{ id: "asc" }],
        select: { id: true, handle: true, kol: { select: { id: true, name: true } } },
        take: 50,
      });
      const cocok = calon.filter((a) => a.kol != null && handleCocok(u, [a.handle]));
      if (!cocok.length) return { ok: false, kode: "TIDAK_ADA_DI_ELORAE" };
      for (const a of cocok) await simpanProfilDiTx(tx, a.id, d, p.id, sekarang);
      await tulisLog(tx, { perangkatId: p.id, jenis: "HASIL", kode: "MANUAL_PROFIL", pesan: input.url.slice(0, 500), waktu: sekarang });
      return { ok: true, cocok: { kolId: cocok[0].kol.id, nama: cocok[0].kol.name } };
    }

    const konten = await tx.kolContent.findMany({
      where: { link: cariTeks(d.videoId) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        link: true,
        collab: { select: { kol: { select: { id: true, name: true, accounts: { where: { platform: "TIKTOK" }, select: { handle: true } } } } } },
      },
      take: 20,
    });
    const k = konten.find((x) => x.collab?.kol != null && videoIdDariLink(x.link) === d.videoId);
    if (!k) return { ok: false, kode: "TIDAK_ADA_DI_ELORAE" };
    const boleh = handleKonten(k.link, k.collab.kol.accounts);
    if (boleh.length && !handleCocok(d.uniqueId, boleh)) return { ok: false, kode: "AKUN_BERBEDA" };
    const r = await simpanKontenDiTx(tx, k.id, d, p, sekarang);
    if (!r.ok) return { ok: false, kode: r.kode as KodeTolakAngka };
    await tulisLog(tx, { perangkatId: p.id, jenis: "HASIL", kode: "MANUAL_KONTEN", pesan: input.url.slice(0, 500), waktu: sekarang });
    return { ok: true, cocok: { kolId: k.collab.kol.id, nama: k.collab.kol.name } };
  });
}
