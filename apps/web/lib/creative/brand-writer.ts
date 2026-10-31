import { randomUUID } from "node:crypto";
import type { Prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import {
  barisBrandPosting,
  JEDA_ANGKA_DARI_PROFIL_JAM,
  JENIS_BRAND,
  jenisUntukDeteksi,
  kunciBrand,
  kunciBrandManual,
  MAKS_NAMA_BRAND,
  menandaiElorae,
  normalBrand,
  postingMilik,
  SUMBER_DETEKSI_TAG,
  type JenisBrand,
  type PengaturanBrand,
  type PostingBrand,
} from "./brand-collab";
import { catatAngkaDiTx } from "./konten-kol-writer";
import { platformDariLink, sahLink } from "./konten-kol";
import {
  catatanAngkaTakTerbaca,
  formatDariBentuk,
  handleCocok,
  handleDariLink,
  idKontenDariLink,
  kontenIdDariLink,
  normalHandle,
  pangkasInt,
  urlKontenKanonik,
  urlKontenPlatform,
  type AngkaPantau,
  type PlatformPantau,
} from "./pantau-muatan";
import { TAHAP_BERJALAN } from "./tahap";
import { akunPlatform, tempelSatuDiTx } from "./tempel-link-writer";

/*
 * Penulis riwayat brand KOL (D1) dan "video menandai Elorae masuk Performa
 * video" (D2) — KHUSUS SERVER (klien hanya `import type`). Aturan murninya di
 * `brand-collab.ts`. Rancangan:
 * docs/superpowers/specs/2026-10-10-kol-manager-lengkap-design.md.
 *
 * Semua penulis pembacaan berjalan di transaksi PEMANGGIL (`simpanHasil`,
 * `simpanManual`, `simpanOtomatis` di `pantau-writer.ts`, semuanya
 * `runSerializable`): dua pembacaan serentak untuk video yang sama tidak bisa
 * sama-sama membuatnya — `tempelSatuDiTx` memeriksa "sudah ada" di transaksi
 * yang sama, dan transaksi serializable yang kalah diulang lalu menemukannya.
 *
 * Baris riwayat brand dari ekstensi TIDAK menulis jejak `AuditLog` (seperti
 * angka pengikut yang mengikuti pemantauan); isian dan hapus manual dari
 * profil KOL menulis jejaknya di transaksi yang sama.
 *
 * Instagram dan YouTube (2026-10-10, D9): setiap penulis menerima `platform`
 * (tidak ada = TIKTOK) — akun, konten, kunci riwayat brand, dan link baku
 * mengikuti platform itu. Angka yang tidak terbaca (Instagram: share/simpan)
 * tersimpan 0 dengan catatan yang menyebutnya (`catatanAngkaTakTerbaca`).
 */

type Klien = Prisma.TransactionClient;

const JAM_MS = 3_600_000;

/** Ringkasan yang dikumpulkan selama satu pembacaan (bisa melewati beberapa akun). */
export type RingkasanPembacaan = {
  /** Video yang baru masuk Performa video karena menandai Elorae. */
  videoMasuk: number;
  /** Baris riwayat brand yang dibuat atau berubah. */
  brand: number;
  /** Baris angka konten yang dicatat dari pembacaan ini. */
  angka: number;
  /** Kolaborasi yang dibuat/disentuh — jurnalnya diselaraskan SESUDAH commit. */
  kolaborasiDisentuh: Set<string>;
};

export function ringkasanBaru(): RingkasanPembacaan {
  return { videoMasuk: 0, brand: 0, angka: 0, kolaborasiDisentuh: new Set() };
}

/** Kosongkan ringkasan di awal setiap percobaan transaksi (percobaan ulang serializable mulai bersih). */
export function kosongkanRingkasan(r: RingkasanPembacaan): void {
  r.videoMasuk = 0;
  r.brand = 0;
  r.angka = 0;
  r.kolaborasiDisentuh.clear();
}

export type KonteksPembacaan = {
  perangkat: { id: string; dibuatOlehId: string };
  sekarang: Date;
  pengaturan: PengaturanBrand;
  /** `creative:manage` pemasang perangkat — dibaca dari basis data, sekali per pembacaan. */
  bolehBuat: () => Promise<boolean>;
  ringkasan: RingkasanPembacaan;
};

/** Angka sebuah posting/hasil konten, bentuk muatan ekstensi (Instagram/YouTube: sebagian boleh tidak ada). */
export type AngkaPosting = AngkaPantau;

/* ─────────────────────────── D1: riwayat brand ─────────────────────────── */

/**
 * Catat brand yang ditandai setiap posting MILIK pemilik akun (penulis kosong atau sama dengan
 * handle akun). Baris baru dibuat (`skipDuplicates`: dua pembacaan serentak tidak saling
 * menggagalkan); baris lama diperbarui hanya bila jenis, views, atau caption-nya berubah.
 * Akun-akun KOL itu sendiri tidak pernah dicatat sebagai brand. Mengembalikan jumlah baris yang
 * dibuat atau berubah.
 */
export async function catatBrandDariPembacaanDiTx(
  tx: Klien,
  input: {
    kolId: string;
    accountId: string | null;
    /** Tidak ada = TIKTOK. */
    platform?: PlatformPantau;
    handle: string;
    posting: readonly PostingBrand[];
    createdById?: string | null;
  },
): Promise<number> {
  const handle = normalHandle(input.handle);
  if (!handle) return 0;
  const platform = input.platform ?? "TIKTOK";
  const milik = input.posting.filter((p) => postingMilik(p, handle));
  let baris = milik.flatMap((p) => barisBrandPosting(p, { platform, handle, handleSendiri: [handle] }));
  if (!baris.length) return 0;

  // Akun lain milik KOL yang sama juga bukan brand (KOL yang menandai akun keduanya sendiri).
  const akunKol = await tx.kolAccount.findMany({ where: { kolId: input.kolId }, select: { handle: true } });
  const sendiri = new Set(akunKol.map((a) => normalHandle(a.handle)));
  baris = baris.filter((b) => !sendiri.has(b.brandHandle));
  if (!baris.length) return 0;

  const lama = await tx.kolBrandCollab.findMany({
    where: { kunci: { in: baris.map((b) => b.kunci) } },
    select: { id: true, kunci: true, jenis: true, views: true, caption: true },
  });
  const perKunci = new Map(lama.map((r) => [r.kunci, r]));

  const baru = baris.filter((b) => !perKunci.has(b.kunci));
  let berubah = 0;
  if (baru.length) {
    const r = await tx.kolBrandCollab.createMany({
      data: baru.map((b) => ({
        kunci: b.kunci,
        kolId: input.kolId,
        accountId: input.accountId,
        platform,
        brandHandle: b.brandHandle,
        jenis: b.jenis,
        postId: b.postId,
        postUrl: b.postUrl,
        postedAt: b.postedAt,
        caption: b.caption,
        views: b.views,
        sumber: "EKSTENSI",
        createdById: input.createdById ?? null,
      })),
      skipDuplicates: true,
    });
    berubah += r.count;
  }
  for (const b of baris) {
    const r = perKunci.get(b.kunci);
    if (!r) continue;
    const data: Prisma.KolBrandCollabUpdateInput = {};
    if (r.jenis !== b.jenis) data.jenis = b.jenis;
    // Angka/caption yang tidak terbaca kali ini tidak menghapus yang lama.
    if (b.views !== null && r.views !== b.views) data.views = b.views;
    if (b.caption !== null && r.caption !== b.caption) data.caption = b.caption;
    if (!Object.keys(data).length) continue;
    await tx.kolBrandCollab.update({ where: { id: r.id }, data });
    berubah += 1;
  }
  return berubah;
}

/* ─────────────────────────── D2: masuk Performa ─────────────────────────── */

/** Nasib satu posting dalam D2 — dipakai `/otomatis` untuk menjawab satu video. */
export type NasibPosting =
  /** Sudah dipantau; angkanya dicatat. */
  | "ANGKA"
  /** Sudah dipantau; angka terakhir belum lewat 12 jam. */
  | "JEDA"
  /** Sudah dipantau tetapi akun pembacanya bukan pemilik video itu. */
  | "AKUN_BERBEDA"
  /** Sudah dipantau tetapi angkanya ditolak penulis angka (tanggal tayang, dsb.). */
  | "ANGKA_DITOLAK"
  /** Baru masuk Performa video (dibuat + angkanya dicatat). */
  | "MASUK"
  /** Menandai Elorae, tetapi pembuatan otomatis dimatikan di Pengaturan. */
  | "MATI"
  /** Menandai Elorae, tetapi pemasang perangkat tidak punya `creative:manage`. */
  | "TANPA_IZIN"
  /** Menandai Elorae, tetapi KOL-nya diblokir. */
  | "DIBLOKIR"
  /** Belum dipantau dan tidak menandai Elorae. */
  | "ABAI";

type KontenAda = { id: string; link: string | null; kolHandles: string[] };

/** Konten yang sudah dipantau per id konten (link memuat id-nya) di satu platform. */
async function kontenPerVideo(tx: Klien, platform: PlatformPantau, ids: readonly string[]): Promise<Map<string, KontenAda>> {
  const hasil = new Map<string, KontenAda>();
  if (!ids.length) return hasil;
  const baris = await tx.kolContent.findMany({
    where: { OR: ids.map((id) => ({ link: cariTeks(id) })) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, link: true, collab: { select: { kol: { select: { accounts: { where: { platform }, select: { handle: true } } } } } } },
  });
  const dicari = new Set(ids);
  for (const k of baris) {
    // `relationMode = "prisma"`: konten bisa sesaat menunjuk kolaborasi/KOL yang sudah terhapus.
    if (k.collab?.kol == null) continue;
    // Shortcode/id peka huruf besar-kecil: dicocokkan persis di sini (`cariTeks` tidak, di MariaDB).
    const v = kontenIdDariLink(k.link, platform);
    if (!v || !dicari.has(v) || hasil.has(v)) continue;
    hasil.set(v, { id: k.id, link: k.link, kolHandles: k.collab.kol.accounts.map((a) => a.handle) });
  }
  return hasil;
}

/** Waktu angka terakhir per konten. */
async function angkaTerakhir(tx: Klien, kontenIds: readonly string[]): Promise<Map<string, Date>> {
  if (!kontenIds.length) return new Map();
  const r = await tx.kolContentMetric.groupBy({ by: ["contentId"], where: { contentId: { in: [...kontenIds] } }, _max: { recordedAt: true } });
  return new Map(r.flatMap((x) => (x._max.recordedAt ? [[x.contentId, x._max.recordedAt] as const] : [])));
}

/** Angka yang tidak terbaca tidak dikirim ekstensi; kolomnya wajib terisi, jadi 0 + catatan. */
const angkaKolom = (n: number | undefined) => (n === undefined ? undefined : pangkasInt(n));

export async function catatAngkaPantauDiTx(
  tx: Klien,
  isi: { kontenId: string; platform: PlatformPantau; angka: AngkaPosting; sekarang: Date; perangkat: { id: string; dibuatOlehId: string } },
) {
  return catatAngkaDiTx(tx, {
    kontenId: isi.kontenId,
    views: angkaKolom(isi.angka.views),
    likes: angkaKolom(isi.angka.like),
    comments: angkaKolom(isi.angka.komentar),
    shares: angkaKolom(isi.angka.share),
    saves: angkaKolom(isi.angka.save),
    recordedAt: isi.sekarang,
    source: "ekstensi",
    note: catatanAngkaTakTerbaca(isi.platform, isi.angka),
    perangkatId: isi.perangkat.id,
    olehUserId: isi.perangkat.dibuatOlehId,
  });
}

async function catatAngka(tx: Klien, platform: PlatformPantau, kontenId: string, a: AngkaPosting, k: KonteksPembacaan) {
  const r = await catatAngkaPantauDiTx(tx, { kontenId, platform, angka: a, sekarang: k.sekarang, perangkat: k.perangkat });
  if (r.ok) k.ringkasan.angka += 1;
  return r.ok;
}

/**
 * D2 untuk posting-posting satu pembacaan (profil, atau satu video) milik `handle`:
 *
 *   - video yang SUDAH dipantau → angkanya dicatat dari pembacaan ini bila angka terakhirnya lebih
 *     tua dari `JEDA_ANGKA_DARI_PROFIL_JAM` (membuka profil berkali-kali tidak menumpuk baris);
 *   - video yang BELUM dipantau dan menandai Elorae → dibuat lewat `tempelSatuDiTx` (sumber
 *     `DETEKSI_TAG`, tanpa tugas segera) lalu angkanya dicatat dari pembacaan yang SAMA, jadi video
 *     itu masuk Performa sudah membawa views/like/komentar/share/save. Butuh `otomatisKePerforma`
 *     dan `creative:manage` pemasang perangkat.
 *
 * Akun Elorae sendiri dilewati seluruhnya. Mengembalikan nasib per id posting.
 */
export async function masukkanKePerformaDiTx(
  tx: Klien,
  input: { platform?: PlatformPantau; handle: string; posting: readonly (PostingBrand & AngkaPosting)[] },
  k: KonteksPembacaan,
): Promise<Map<string, NasibPosting>> {
  const nasib = new Map<string, NasibPosting>();
  const platform = input.platform ?? "TIKTOK";
  const handle = normalHandle(input.handle);
  if (!handle || k.pengaturan.akunElorae.includes(handle)) return nasib;
  const sudah = new Set<string>();
  const milik = input.posting.filter((p) => postingMilik(p, handle) && !sudah.has(p.id) && Boolean(sudah.add(p.id)));
  if (!milik.length) return nasib;

  const ada = await kontenPerVideo(tx, platform, milik.map((p) => p.id));
  const terakhir = await angkaTerakhir(tx, [...ada.values()].map((x) => x.id));
  let jenis: "AFILIASI" | "KOL" | null = null;

  for (const p of milik) {
    const konten = ada.get(p.id);
    if (konten) {
      const boleh = [...konten.kolHandles, handleDariLink(konten.link) ?? ""].filter((h) => normalHandle(h));
      if (boleh.length && !handleCocok(handle, boleh)) {
        nasib.set(p.id, "AKUN_BERBEDA");
        continue;
      }
      const t = terakhir.get(konten.id);
      if (t && k.sekarang.getTime() - t.getTime() < JEDA_ANGKA_DARI_PROFIL_JAM * JAM_MS) {
        nasib.set(p.id, "JEDA");
        continue;
      }
      nasib.set(p.id, (await catatAngka(tx, platform, konten.id, p, k)) ? "ANGKA" : "ANGKA_DITOLAK");
      continue;
    }

    if (!menandaiElorae(p, k.pengaturan, [handle])) {
      nasib.set(p.id, "ABAI");
      continue;
    }
    if (!k.pengaturan.otomatisKePerforma) {
      nasib.set(p.id, "MATI");
      continue;
    }
    if (!(await k.bolehBuat())) {
      nasib.set(p.id, "TANPA_IZIN");
      continue;
    }

    if (jenis === null) {
      const akun = await akunPlatform(tx, platform, handle);
      const berjalan = akun.length
        ? await tx.kolBrief.findMany({ where: { kolId: akun[0].kol.id, tahap: { in: [...TAHAP_BERJALAN] } }, select: { jenis: true } })
        : [];
      jenis = jenisUntukDeteksi(berjalan.map((b) => b.jenis));
    }
    // Tanggal tayang = waktu unggah dari data TikTok; jam yang aneh tidak boleh membuatnya di masa depan.
    const unggah = typeof p.dibuatPada === "number" ? new Date(p.dibuatPada * 1000) : k.sekarang;
    const r = await tempelSatuDiTx(tx, {
      baris: `deteksi:${p.id}`,
      videoId: p.id,
      handle,
      url: urlKontenKanonik(urlKontenPlatform(platform, p.id, { handle, bentuk: p.bentuk })),
      platform,
      format: formatDariBentuk(platform, p.bentuk),
      liveAt: unggah.getTime() > k.sekarang.getTime() ? k.sekarang : unggah,
      jenis,
      olehUserId: k.perangkat.dibuatOlehId,
      sekarang: k.sekarang,
      sumber: SUMBER_DETEKSI_TAG,
      tanpaTugasSegera: true,
    });
    if (r.status === "GAGAL") {
      nasib.set(p.id, "DIBLOKIR"); // satu-satunya GAGAL dari tempelSatuDiTx
      continue;
    }
    if (r.status === "DITAMBAHKAN") {
      k.ringkasan.videoMasuk += 1;
      k.ringkasan.kolaborasiDisentuh.add(r.kolaborasiId);
    }
    await catatAngka(tx, platform, r.kontenId, p, k);
    nasib.set(p.id, r.status === "DITAMBAHKAN" ? "MASUK" : "ANGKA");
  }
  return nasib;
}

/* ─────────────────────────── Manual (profil KOL) ─────────────────────────── */

export type KodeTolakBrandManual = "KOL_TIDAK_ADA" | "HANDLE_TIDAK_SAH" | "JENIS_TIDAK_SAH" | "LINK_TIDAK_SAH" | "TANGGAL_TIDAK_SAH" | "SUDAH_ADA";
export type HasilBrandManual = { ok: true; id: string } | { ok: false; kode: KodeTolakBrandManual };

/**
 * Tambah satu baris riwayat brand dari profil KOL (`creative:manage` diperiksa aksinya). Isian:
 * handle brand (wajib), nama (opsional), jenis, link posting dan tanggalnya (opsional). Link video
 * TikTok memberi kunci yang SAMA dengan pembacaan ekstensi (`TIKTOK:<id>:<brand>`), jadi pembacaan
 * berikutnya memperbarui baris ini, bukan membuat kembarannya; tanpa link kuncinya `MANUAL:<id>`.
 */
export async function tambahBrandManual(input: {
  kolId: string;
  brandHandle: string;
  brandName?: string | null;
  jenis: string;
  postUrl?: string | null;
  postedAt?: Date | null;
  olehUserId: string;
}): Promise<HasilBrandManual> {
  const brand = normalBrand(input.brandHandle);
  if (!brand) return { ok: false, kode: "HANDLE_TIDAK_SAH" };
  if (!(JENIS_BRAND as readonly string[]).includes(input.jenis)) return { ok: false, kode: "JENIS_TIDAK_SAH" };
  const jenis = input.jenis as JenisBrand;
  const nama = input.brandName?.trim().slice(0, MAKS_NAMA_BRAND) || null;
  let postUrl: string | null = null;
  if (input.postUrl?.trim()) {
    postUrl = sahLink(input.postUrl);
    if (!postUrl) return { ok: false, kode: "LINK_TIDAK_SAH" };
  }
  if (input.postedAt !== undefined && input.postedAt !== null && Number.isNaN(input.postedAt.getTime())) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  // Link posting TikTok/Instagram/YouTube memberi kunci yang sama dengan pembacaan ekstensi.
  const posting = postUrl ? idKontenDariLink(postUrl) : null;
  const postId = posting?.id ?? null;

  return runSerializable(async (tx): Promise<HasilBrandManual> => {
    const kol = await tx.kol.findUnique({ where: { id: input.kolId }, select: { id: true, accounts: { select: { platform: true, handle: true } } } });
    if (!kol) return { ok: false, kode: "KOL_TIDAK_ADA" };
    if (kol.accounts.some((a) => normalHandle(a.handle) === brand)) return { ok: false, kode: "HANDLE_TIDAK_SAH" };
    const platform = platformDariLink(postUrl) ?? (kol.accounts[0]?.platform as Prisma.KolBrandCollabCreateInput["platform"] | undefined) ?? "LAINNYA";
    const kunci = posting ? kunciBrand(posting.platform, posting.id, brand) : kunciBrandManual(randomUUID());
    if (postId && (await tx.kolBrandCollab.findUnique({ where: { kunci }, select: { id: true } }))) return { ok: false, kode: "SUDAH_ADA" };
    const b = await tx.kolBrandCollab.create({
      data: {
        kunci,
        kolId: kol.id,
        platform,
        brandHandle: brand,
        brandName: nama,
        jenis,
        postId,
        postUrl: postUrl && postId ? urlKontenKanonik(postUrl) : postUrl,
        postedAt: input.postedAt ?? null,
        sumber: "MANUAL",
        createdById: input.olehUserId,
      },
      select: { id: true },
    });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.BRAND_KOL_DITAMBAH,
      entityType: "Kol",
      entityId: kol.id,
      changes: { after: { brandHandle: brand, brandName: nama, jenis, postUrl, postedAt: input.postedAt?.toISOString() ?? null } },
      metadata: { brandId: b.id, kunci },
    });
    return { ok: true, id: b.id };
  });
}

/**
 * Hapus satu baris riwayat brand dari profil KOL. Baris dari ekstensi akan ditulis lagi oleh
 * pembacaan berikutnya selama postingnya masih menandai brand itu — dikatakan di Bantuan.
 */
export async function hapusBrandKol(input: { id: string; kolId: string; olehUserId: string }): Promise<{ ok: true } | { ok: false; kode: "TIDAK_DITEMUKAN" }> {
  return runSerializable(async (tx) => {
    const b = await tx.kolBrandCollab.findFirst({
      where: { id: input.id, kolId: input.kolId },
      select: { id: true, kunci: true, brandHandle: true, brandName: true, jenis: true, postUrl: true, postedAt: true, sumber: true, views: true },
    });
    if (!b) return { ok: false, kode: "TIDAK_DITEMUKAN" } as const;
    await tx.kolBrandCollab.delete({ where: { id: b.id } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.BRAND_KOL_DIHAPUS,
      entityType: "Kol",
      entityId: input.kolId,
      changes: {
        before: { brandHandle: b.brandHandle, brandName: b.brandName, jenis: b.jenis, postUrl: b.postUrl, postedAt: b.postedAt?.toISOString() ?? null, views: b.views },
      },
      metadata: { brandId: b.id, kunci: b.kunci, sumber: b.sumber },
    });
    return { ok: true } as const;
  });
}
