/**
 * Muatan API ekstensi pantau KOL — pembaca dan pencocok murni (aman untuk
 * klien, tanpa Prisma).
 *
 * Semua yang datang dari ekstensi adalah masukan dari luar: angka harus
 * bilangan bulat aman ≥ 0, teks dibatasi panjangnya, bentuk lain DITOLAK utuh
 * (`MUATAN_TIDAK_SAH`) — tidak pernah dibulatkan atau diisi nol diam-diam
 * (keputusan P7: angka yang tidak terbaca bukan 0).
 *
 * Angka di atas batas kolom `Int` (video viral > 2,1 miliar views) DITERIMA:
 * menolak seluruh profil karena satu video terlalu laku membuang data yang
 * sah. Yang disimpan ke kolom `Int` dipangkas di penyimpan (`pangkasInt`).
 */

import { KODE_MASALAH, type KodeMasalah } from "./pantau-aturan";

/** Batas kolom `Int` (INTEGER Postgres / INT MariaDB). */
export const MAKS_INT = 2_147_483_647;
/** Posting per hasil profil — `/api/post/item_list/` memberi puluhan; lebih dari ini pasti salah. */
export const MAKS_POSTING = 200;
export const MAKS_PESAN = 1000;

export type PostingProfil = {
  id: string;
  /** Detik unix. */
  dibuatPada: number;
  disematkan: boolean;
  views: number;
  like: number;
  komentar: number;
  share: number;
  save: number;
};

export type HasilProfil = {
  jenis: "PROFIL";
  uniqueId: string;
  secUid?: string;
  pengikut: number;
  totalLike?: number;
  jumlahVideo?: number;
  posting: PostingProfil[];
};

export type HasilKonten = {
  jenis: "KONTEN";
  videoId: string;
  uniqueId: string;
  views: number;
  like: number;
  komentar: number;
  share: number;
  save: number;
  dibuatPada?: number;
};

export type HasilPantau = HasilProfil | HasilKonten;

export type MasalahPantau = { kode: KodeMasalah; tugasId: string | null; pesan: string | null };

type Gagal = { ok: false; kode: "MUATAN_TIDAK_SAH" };
const GAGAL: Gagal = { ok: false, kode: "MUATAN_TIDAK_SAH" };

const objek = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x);
/** Bilangan bulat aman ≥ 0 (angka, detik unix). */
const bulat = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const detik = bulat;

/** Pangkas ke batas kolom `Int` sebelum disimpan. */
export function pangkasInt(n: number): number {
  return Math.min(Math.max(0, Math.trunc(n)), MAKS_INT);
}
const teks = (x: unknown, maks: number): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= maks;
const POLA_ID = /^[0-9A-Za-z_-]{1,64}$/;

function bacaPosting(x: unknown): PostingProfil | null {
  if (!objek(x)) return null;
  if (typeof x.id !== "string" || !POLA_ID.test(x.id)) return null;
  if (!detik(x.dibuatPada) || typeof x.disematkan !== "boolean") return null;
  for (const k of ["views", "like", "komentar", "share", "save"] as const) if (!bulat(x[k])) return null;
  return {
    id: x.id,
    dibuatPada: x.dibuatPada,
    disematkan: x.disematkan,
    views: x.views as number,
    like: x.like as number,
    komentar: x.komentar as number,
    share: x.share as number,
    save: x.save as number,
  };
}

export function bacaHasil(data: unknown): { ok: true; hasil: HasilPantau } | Gagal {
  if (!objek(data)) return GAGAL;
  if (!teks(data.uniqueId, 100)) return GAGAL;
  const uniqueId = (data.uniqueId as string).trim();

  if (data.jenis === "PROFIL") {
    if (!bulat(data.pengikut)) return GAGAL;
    if (data.secUid !== undefined && data.secUid !== null && !teks(data.secUid, 300)) return GAGAL;
    if (data.totalLike !== undefined && data.totalLike !== null && !detik(data.totalLike)) return GAGAL;
    if (data.jumlahVideo !== undefined && data.jumlahVideo !== null && !bulat(data.jumlahVideo)) return GAGAL;
    if (!Array.isArray(data.posting) || data.posting.length > MAKS_POSTING) return GAGAL;
    const posting: PostingProfil[] = [];
    for (const p of data.posting) {
      const b = bacaPosting(p);
      if (!b) return GAGAL;
      posting.push(b);
    }
    const hasil: HasilProfil = { jenis: "PROFIL", uniqueId, pengikut: data.pengikut, posting };
    if (typeof data.secUid === "string") hasil.secUid = data.secUid;
    if (typeof data.totalLike === "number") hasil.totalLike = data.totalLike;
    if (typeof data.jumlahVideo === "number") hasil.jumlahVideo = data.jumlahVideo;
    return { ok: true, hasil };
  }

  if (data.jenis === "KONTEN") {
    if (typeof data.videoId !== "string" || !POLA_ID.test(data.videoId)) return GAGAL;
    for (const k of ["views", "like", "komentar", "share", "save"] as const) if (!bulat(data[k])) return GAGAL;
    if (data.dibuatPada !== undefined && data.dibuatPada !== null && !detik(data.dibuatPada)) return GAGAL;
    const hasil: HasilKonten = {
      jenis: "KONTEN",
      videoId: data.videoId,
      uniqueId,
      views: data.views as number,
      like: data.like as number,
      komentar: data.komentar as number,
      share: data.share as number,
      save: data.save as number,
    };
    if (typeof data.dibuatPada === "number") hasil.dibuatPada = data.dibuatPada;
    return { ok: true, hasil };
  }
  return GAGAL;
}

export function bacaMasalah(data: unknown): { ok: true; masalah: MasalahPantau } | Gagal {
  if (!objek(data)) return GAGAL;
  if (typeof data.kode !== "string" || !(KODE_MASALAH as readonly string[]).includes(data.kode)) return GAGAL;
  let tugasId: string | null = null;
  if (data.tugasId !== undefined && data.tugasId !== null) {
    if (typeof data.tugasId !== "string" || !POLA_ID.test(data.tugasId)) return GAGAL;
    tugasId = data.tugasId;
  }
  let pesan: string | null = null;
  if (data.pesan !== undefined && data.pesan !== null) {
    if (typeof data.pesan !== "string") return GAGAL;
    pesan = data.pesan.trim().slice(0, MAKS_PESAN) || null;
  }
  return { ok: true, masalah: { kode: data.kode as KodeMasalah, tugasId, pesan } };
}

// ── Handle dan link TikTok ────────────────────────────────────────────────

/** Handle rapi: tanpa "@", spasi, dan huruf besar. Menerima URL profil juga. */
export function normalHandle(h: string | null | undefined): string {
  const t = (h ?? "").trim();
  const dariUrl = /tiktok\.com\/@([^/?#\s]+)/i.exec(t);
  const inti = dariUrl ? dariUrl[1] : t;
  return inti.replace(/^@+/, "").trim().toLowerCase();
}

/** `uniqueId` dari TikTok cocok dengan salah satu handle akun di Elorae. */
export function handleCocok(uniqueId: string, handles: readonly (string | null | undefined)[]): boolean {
  const u = normalHandle(uniqueId);
  if (!u) return false;
  return handles.some((h) => normalHandle(h) === u);
}

/** Id video/foto dari link TikTok panjang; link pendek (vt.tiktok.com) → null. */
export function videoIdDariLink(link: string | null | undefined): string | null {
  const m = /tiktok\.com\/@[^/?#\s]+\/(?:video|photo)\/(\d+)/i.exec(link ?? "");
  return m ? m[1] : null;
}

/** Handle pemilik dari link TikTok panjang. */
export function handleDariLink(link: string | null | undefined): string | null {
  const m = /tiktok\.com\/@([^/?#\s]+)/i.exec(link ?? "");
  return m ? normalHandle(m[1]) : null;
}

/** Link mengarah ke tiktok.com atau subdomainnya (www., vt., m.). */
export function linkTiktok(link: string | null | undefined): boolean {
  const t = (link ?? "").trim();
  if (!t) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    const host = u.hostname.toLowerCase();
    return host === "tiktok.com" || host.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

/**
 * Link konten dalam bentuk baku `https://www.tiktok.com/@<handle>/<video|photo>/<id>`
 * (tanpa parameter pelacak) bila bisa diturunkan; link pendek dibiarkan apa
 * adanya (ekstensi mengikuti pengalihannya).
 */
export function urlKontenKanonik(link: string): string {
  const t = link.trim();
  const m = /tiktok\.com\/@([^/?#\s]+)\/(video|photo)\/(\d+)/i.exec(t);
  return m ? `https://www.tiktok.com/@${normalHandle(m[1])}/${m[2].toLowerCase()}/${m[3]}` : t;
}

/** URL profil TikTok dari handle. */
export function urlProfilTiktok(handle: string): string {
  return `https://www.tiktok.com/@${normalHandle(handle)}`;
}
