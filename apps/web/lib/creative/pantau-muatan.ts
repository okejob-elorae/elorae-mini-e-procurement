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

/**
 * Platform yang dibaca ekstensi (2026-10-10, D9 rancangan KOL Manager lengkap). Muatan tanpa
 * `platform` = TIKTOK, supaya ekstensi lama tetap diterima. Threads dan Facebook TIDAK didukung.
 */
export const PLATFORM_PANTAU = ["TIKTOK", "INSTAGRAM", "YOUTUBE"] as const;
export type PlatformPantau = (typeof PLATFORM_PANTAU)[number];

/**
 * Bentuk konten di platformnya: menentukan link baku dan `ContentFormat` konten yang dibuat.
 * TikTok VIDEO (POST = posting foto); Instagram REEL / POST; YouTube VIDEO / SHORTS.
 */
export const BENTUK_KONTEN = ["VIDEO", "REEL", "POST", "SHORTS"] as const;
export type BentukKonten = (typeof BENTUK_KONTEN)[number];

const BENTUK_PER_PLATFORM: Record<PlatformPantau, readonly BentukKonten[]> = {
  TIKTOK: ["VIDEO", "POST"],
  INSTAGRAM: ["REEL", "POST"],
  YOUTUBE: ["VIDEO", "SHORTS"],
};

/** Bentuk bawaan bila ekstensi tidak menyebutnya. */
export const BENTUK_BAWAAN: Record<PlatformPantau, BentukKonten> = { TIKTOK: "VIDEO", INSTAGRAM: "POST", YOUTUBE: "VIDEO" };

/** `ContentFormat` konten yang dibuat dari bentuk itu (IG reel → REELS, IG posting → FEED, YouTube → VIDEO). */
export function formatDariBentuk(platform: PlatformPantau, bentuk: BentukKonten | undefined): "VIDEO" | "REELS" | "FEED" {
  if (platform === "INSTAGRAM") return bentuk === "REEL" ? "REELS" : "FEED";
  return "VIDEO";
}

export const LABEL_PLATFORM_PANTAU: Record<PlatformPantau, string> = { TIKTOK: "TikTok", INSTAGRAM: "Instagram", YOUTUBE: "YouTube" };

const NAMA_ANGKA = { views: "views", like: "like", komentar: "komentar", share: "share", save: "simpan" } as const;

/**
 * Catatan untuk baris angka konten yang sebagian angkanya tidak terbaca (Instagram: share dan simpan
 * tidak publik; like bisa disembunyikan). Kolom angka di basis data tidak boleh kosong, jadi yang
 * tidak terbaca tersimpan 0 — catatan ini yang menyebutnya. `null` bila kelimanya terbaca.
 */
export function catatanAngkaTakTerbaca(platform: PlatformPantau, a: AngkaPantau): string | null {
  const kurang = (Object.keys(NAMA_ANGKA) as (keyof typeof NAMA_ANGKA)[]).filter((k) => a[k] === undefined).map((k) => NAMA_ANGKA[k]);
  return kurang.length ? `Tidak terbaca dari ${LABEL_PLATFORM_PANTAU[platform]}: ${kurang.join(", ")} (tersimpan 0).` : null;
}

/** Platform sebuah hasil; tidak disebut = TikTok. */
export function platformHasil(h: { platform?: PlatformPantau | null }): PlatformPantau {
  return h.platform ?? "TIKTOK";
}

/** Batas kolom `Int` (INTEGER Postgres / INT MariaDB). */
export const MAKS_INT = 2_147_483_647;
/** Posting per hasil profil — `/api/post/item_list/` memberi puluhan; lebih dari ini pasti salah. */
export const MAKS_POSTING = 200;
export const MAKS_PESAN = 1000;
/** Caption yang dikirim ekstensi — dipotong, tidak ditolak. */
export const MAKS_TEKS_POSTING = 500;
/** Handle yang ditandai per posting (`textExtra[].userUniqueId`, type 0). */
export const MAKS_SEBUTAN = 30;
/** Tagar per posting. */
export const MAKS_TAGAR = 50;
/** Panjang satu handle/tagar; yang lebih panjang pasti bukan handle/tagar dan dibuang. */
export const MAKS_ISIAN_DAFTAR = 100;

/**
 * Kolom brand (2026-10-10, D1/D2 rancangan KOL Manager lengkap) — SEMUANYA
 * opsional: ekstensi lama yang tidak mengirimnya tetap diterima. Yang dikirim
 * dengan tipe salah menolak seluruh muatan.
 */
export type TambahanBrand = {
  /** Caption, dipotong `MAKS_TEKS_POSTING` tanda. */
  teks?: string;
  /** Handle yang ditandai, huruf kecil tanpa "@". */
  sebutan?: string[];
  /** Tagar, huruf kecil tanpa "#". */
  tagar?: string[];
  /** `item.isAd === true`. */
  iklan?: boolean;
  /** Handle pembuat posting, huruf kecil tanpa "@". */
  penulis?: string;
};

/**
 * Angka satu posting/konten. TikTok mengirim kelimanya (WAJIB, sejak awal). Instagram dan YouTube
 * tidak menampilkan semuanya (share dan simpan tidak publik; like bisa disembunyikan; posting foto
 * tanpa views): yang tidak terbaca TIDAK dikirim — tidak pernah dikirim sebagai 0.
 */
export type AngkaPantau = { views?: number; like?: number; komentar?: number; share?: number; save?: number };

export type PostingProfil = TambahanBrand &
  AngkaPantau & {
    /** Id video TikTok / shortcode Instagram / id video YouTube. */
    id: string;
    /** Detik unix. */
    dibuatPada: number;
    disematkan: boolean;
    bentuk?: BentukKonten;
  };

export type HasilProfil = {
  jenis: "PROFIL";
  /** Tidak ada = TIKTOK (`platformHasil`). */
  platform?: PlatformPantau;
  uniqueId: string;
  secUid?: string;
  /** Id akun di platformnya (Instagram `id`, YouTube channel id) — TikTok memakai `secUid`. */
  idPlatform?: string;
  pengikut: number;
  /** Jumlah pengikut dari teks ringkas ("46,5 jt subscriber" di YouTube), bukan angka persis. */
  pengikutPerkiraan?: true;
  totalLike?: number;
  jumlahVideo?: number;
  posting: PostingProfil[];
};

export type HasilKonten = TambahanBrand &
  AngkaPantau & {
    jenis: "KONTEN";
    /** Tidak ada = TIKTOK (`platformHasil`). */
    platform?: PlatformPantau;
    /** Id video TikTok / shortcode Instagram / id video YouTube. */
    videoId: string;
    uniqueId: string;
    dibuatPada?: number;
    bentuk?: BentukKonten;
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
/** Shortcode Instagram (huruf besar/kecil BERBEDA) dan id video YouTube (11 tanda). */
const POLA_KODE_INSTAGRAM = /^[A-Za-z0-9_-]{5,40}$/;
const POLA_ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;

/** Id konten sah untuk platformnya. TikTok memakai pola lama yang longgar (kompatibel dengan ekstensi lama). */
export function idKontenSah(platform: PlatformPantau, id: unknown): id is string {
  if (typeof id !== "string") return false;
  if (platform === "INSTAGRAM") return POLA_KODE_INSTAGRAM.test(id);
  if (platform === "YOUTUBE") return POLA_ID_YOUTUBE.test(id);
  return POLA_ID.test(id);
}

const ada = (v: unknown) => v !== undefined && v !== null;

/** Daftar teks rapi: bukan daftar / berisi bukan-teks → null (tolak); isian kosong atau terlalu panjang dibuang; dipotong ke `maks`. */
function daftarTeks(x: unknown, rapikan: (t: string) => string, maks: number): string[] | null {
  if (!Array.isArray(x)) return null;
  const hasil: string[] = [];
  for (const v of x) {
    if (typeof v !== "string") return null;
    const r = rapikan(v);
    if (r && r.length <= MAKS_ISIAN_DAFTAR && !hasil.includes(r)) hasil.push(r);
  }
  return hasil.slice(0, maks);
}

const rapiTagar = (t: string) => t.trim().replace(/^#+/, "").trim().toLowerCase();

/** Kolom brand opsional dari satu posting/hasil konten; `null` = tipenya salah (tolak muatan). */
function bacaTambahan(x: Record<string, unknown>): TambahanBrand | null {
  const hasil: TambahanBrand = {};
  if (ada(x.teks)) {
    if (typeof x.teks !== "string") return null;
    const t = x.teks.trim().slice(0, MAKS_TEKS_POSTING);
    if (t) hasil.teks = t;
  }
  if (ada(x.sebutan)) {
    const d = daftarTeks(x.sebutan, (t) => normalHandle(t), MAKS_SEBUTAN);
    if (!d) return null;
    hasil.sebutan = d;
  }
  if (ada(x.tagar)) {
    const d = daftarTeks(x.tagar, rapiTagar, MAKS_TAGAR);
    if (!d) return null;
    hasil.tagar = d;
  }
  if (ada(x.iklan)) {
    if (typeof x.iklan !== "boolean") return null;
    hasil.iklan = x.iklan;
  }
  if (ada(x.penulis)) {
    if (typeof x.penulis !== "string" || x.penulis.length > MAKS_ISIAN_DAFTAR) return null;
    const p = normalHandle(x.penulis);
    if (p) hasil.penulis = p;
  }
  return hasil;
}

const KOLOM_ANGKA = ["views", "like", "komentar", "share", "save"] as const;

/**
 * Angka sebuah posting/konten. TikTok: kelimanya WAJIB. Instagram/YouTube: masing-masing boleh
 * tidak ada, tetapi yang ada harus bilangan bulat aman ≥ 0. `null` = tolak muatan.
 */
function bacaAngka(x: Record<string, unknown>, platform: PlatformPantau): AngkaPantau | null {
  const hasil: AngkaPantau = {};
  for (const k of KOLOM_ANGKA) {
    const v = x[k];
    if (platform !== "TIKTOK" && (v === undefined || v === null)) continue;
    if (!bulat(v)) return null;
    hasil[k] = v;
  }
  return hasil;
}

/** Bentuk konten yang sah untuk platformnya; tidak ada = `undefined`; salah = `null` (tolak). */
function bacaBentuk(x: unknown, platform: PlatformPantau): BentukKonten | undefined | null {
  if (x === undefined || x === null) return undefined;
  return typeof x === "string" && (BENTUK_PER_PLATFORM[platform] as readonly string[]).includes(x) ? (x as BentukKonten) : null;
}

function bacaPosting(x: unknown, platform: PlatformPantau): PostingProfil | null {
  if (!objek(x)) return null;
  if (!idKontenSah(platform, x.id)) return null;
  if (!detik(x.dibuatPada) || typeof x.disematkan !== "boolean") return null;
  const angka = bacaAngka(x, platform);
  if (!angka) return null;
  const bentuk = bacaBentuk(x.bentuk, platform);
  if (bentuk === null) return null;
  const tambahan = bacaTambahan(x);
  if (!tambahan) return null;
  return {
    ...tambahan,
    id: x.id as string,
    dibuatPada: x.dibuatPada,
    disematkan: x.disematkan,
    ...angka,
    ...(bentuk ? { bentuk } : {}),
  };
}

export function bacaHasil(data: unknown): { ok: true; hasil: HasilPantau } | Gagal {
  if (!objek(data)) return GAGAL;
  if (!teks(data.uniqueId, 100)) return GAGAL;
  const uniqueId = (data.uniqueId as string).trim();
  const platform = data.platform === undefined || data.platform === null ? "TIKTOK" : data.platform;
  if (typeof platform !== "string" || !(PLATFORM_PANTAU as readonly string[]).includes(platform)) return GAGAL;
  const pf = platform as PlatformPantau;
  // TikTok tidak menulis `platform` ke hasil: bentuk muatan dan hasil lama tidak berubah.
  const tandaPlatform = pf === "TIKTOK" ? {} : { platform: pf };

  if (data.jenis === "PROFIL") {
    if (!bulat(data.pengikut)) return GAGAL;
    if (data.secUid !== undefined && data.secUid !== null && !teks(data.secUid, 300)) return GAGAL;
    if (data.idPlatform !== undefined && data.idPlatform !== null && !teks(data.idPlatform, 300)) return GAGAL;
    if (data.pengikutPerkiraan !== undefined && data.pengikutPerkiraan !== null && typeof data.pengikutPerkiraan !== "boolean") return GAGAL;
    if (data.totalLike !== undefined && data.totalLike !== null && !detik(data.totalLike)) return GAGAL;
    if (data.jumlahVideo !== undefined && data.jumlahVideo !== null && !bulat(data.jumlahVideo)) return GAGAL;
    if (!Array.isArray(data.posting) || data.posting.length > MAKS_POSTING) return GAGAL;
    const posting: PostingProfil[] = [];
    for (const p of data.posting) {
      const b = bacaPosting(p, pf);
      if (!b) return GAGAL;
      posting.push(b);
    }
    const hasil: HasilProfil = { jenis: "PROFIL", ...tandaPlatform, uniqueId, pengikut: data.pengikut, posting };
    if (typeof data.secUid === "string") hasil.secUid = data.secUid;
    if (typeof data.idPlatform === "string") hasil.idPlatform = data.idPlatform.trim();
    if (data.pengikutPerkiraan === true) hasil.pengikutPerkiraan = true;
    if (typeof data.totalLike === "number") hasil.totalLike = data.totalLike;
    if (typeof data.jumlahVideo === "number") hasil.jumlahVideo = data.jumlahVideo;
    return { ok: true, hasil };
  }

  if (data.jenis === "KONTEN") {
    if (!idKontenSah(pf, data.videoId)) return GAGAL;
    const angka = bacaAngka(data, pf);
    if (!angka) return GAGAL;
    // YouTube selalu menampilkan views persis; Instagram paling sedikit satu dari views/like/komentar.
    if (pf === "YOUTUBE" && angka.views === undefined) return GAGAL;
    if (pf === "INSTAGRAM" && angka.views === undefined && angka.like === undefined && angka.komentar === undefined) return GAGAL;
    if (data.dibuatPada !== undefined && data.dibuatPada !== null && !detik(data.dibuatPada)) return GAGAL;
    const bentuk = bacaBentuk(data.bentuk, pf);
    if (bentuk === null) return GAGAL;
    const tambahan = bacaTambahan(data);
    if (!tambahan) return GAGAL;
    const hasil: HasilKonten = {
      ...tambahan,
      jenis: "KONTEN",
      ...tandaPlatform,
      videoId: data.videoId as string,
      uniqueId,
      ...angka,
      ...(bentuk ? { bentuk } : {}),
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

// ── Handle dan link (TikTok, Instagram, YouTube) ───────────────────────────

/** Ruas pertama alamat Instagram yang BUKAN nama akun. */
const JALUR_INSTAGRAM_BUKAN_AKUN = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "direct",
  "about",
  "legal",
  "developer",
  "web",
  "challenge",
  "emails",
  "privacy",
  "session",
  "api",
  "graphql",
]);

/** Nama akun Instagram: huruf, angka, titik, garis bawah (≤ 30). */
const POLA_AKUN_INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/;

/** Handle rapi: tanpa "@", spasi, dan huruf besar. Menerima URL profil TikTok, Instagram, dan YouTube juga. */
export function normalHandle(h: string | null | undefined): string {
  const t = (h ?? "").trim();
  const dariUrl = /tiktok\.com\/@([^/?#\s]+)/i.exec(t) ?? /youtube\.com\/@([^/?#\s]+)/i.exec(t);
  let inti = dariUrl ? dariUrl[1] : t;
  if (!dariUrl) {
    const ig = /instagram\.com\/([^/?#\s]+)/i.exec(t);
    if (ig && POLA_AKUN_INSTAGRAM.test(ig[1]) && !JALUR_INSTAGRAM_BUKAN_AKUN.has(ig[1].toLowerCase())) inti = ig[1];
  }
  return inti.replace(/^@+/, "").trim().toLowerCase();
}

/** `uniqueId` dari TikTok cocok dengan salah satu handle akun di Elorae. */
export function handleCocok(uniqueId: string, handles: readonly (string | null | undefined)[]): boolean {
  const u = normalHandle(uniqueId);
  if (!u) return false;
  return handles.some((h) => normalHandle(h) === u);
}

/** Konten yang ditunjuk sebuah link: platform, id, bentuk, dan handle pemiliknya bila link memuatnya. */
export type IdKonten = { platform: PlatformPantau; id: string; bentuk: BentukKonten; handle: string | null };

function urlDari(link: string | null | undefined): URL | null {
  const t = (link ?? "").trim();
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

const hostDi = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Platform yang dipantau dari host sebuah link, atau `null`. */
export function platformLinkPantau(link: string | null | undefined): PlatformPantau | null {
  const u = urlDari(link);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (hostDi(host, "tiktok.com")) return "TIKTOK";
  if (hostDi(host, "instagram.com") || hostDi(host, "instagr.am")) return "INSTAGRAM";
  if (hostDi(host, "youtube.com") || host === "youtu.be") return "YOUTUBE";
  return null;
}

/** Link mengarah ke TikTok, Instagram, atau YouTube (situs yang dibaca ekstensi). */
export function linkPantau(link: string | null | undefined): boolean {
  return platformLinkPantau(link) !== null;
}

/**
 * Platform + id konten dari link panjang: TikTok `@<handle>/video|photo/<id>`; Instagram
 * `[/<akun>]/p|reel|reels|tv/<shortcode>`; YouTube `watch?v=`, `/shorts/`, `/live/`, `/embed/`,
 * `youtu.be/<id>`. Link pendek TikTok dan halaman lain → null. Shortcode Instagram dan id YouTube
 * dibiarkan apa adanya (huruf besar/kecil berbeda artinya).
 */
export function idKontenDariLink(link: string | null | undefined): IdKonten | null {
  const platform = platformLinkPantau(link);
  if (!platform) return null;
  const u = urlDari(link)!;
  if (platform === "TIKTOK") {
    const m = /^\/@([^/?#\s]+)\/(video|photo)\/(\d+)\/?$/i.exec(u.pathname);
    return m ? { platform, id: m[3], bentuk: m[2].toLowerCase() === "photo" ? "POST" : "VIDEO", handle: normalHandle(m[1]) || null } : null;
  }
  if (platform === "INSTAGRAM") {
    const m = /^\/(?:([^/]+)\/)?(p|reel|reels|tv)\/([^/]+)\/?$/i.exec(u.pathname);
    if (!m || !POLA_KODE_INSTAGRAM.test(m[3])) return null;
    const akun = m[1] && POLA_AKUN_INSTAGRAM.test(m[1]) && !JALUR_INSTAGRAM_BUKAN_AKUN.has(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
    if (m[1] && !akun) return null;
    const jenis = m[2].toLowerCase();
    return { platform, id: m[3], bentuk: jenis === "reel" || jenis === "reels" ? "REEL" : "POST", handle: akun };
  }
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  let bentuk: BentukKonten = "VIDEO";
  if (host === "youtu.be") id = /^\/([^/]+)\/?$/.exec(u.pathname)?.[1] ?? null;
  else if (/^\/watch\/?$/i.test(u.pathname)) id = u.searchParams.get("v");
  else {
    const m = /^\/(shorts|live|embed)\/([^/]+)\/?$/i.exec(u.pathname);
    if (m) {
      id = m[2];
      if (m[1].toLowerCase() === "shorts") bentuk = "SHORTS";
    }
  }
  return id && POLA_ID_YOUTUBE.test(id) ? { platform, id, bentuk, handle: null } : null;
}

/**
 * Id konten dari link bila link itu milik `platform`. TikTok memakai pembaca lama
 * (`videoIdDariLink`, lebih longgar) supaya link yang sudah tersimpan tetap dikenali sama persis.
 */
export function kontenIdDariLink(link: string | null | undefined, platform: PlatformPantau): string | null {
  if (platform === "TIKTOK") return videoIdDariLink(link);
  const r = idKontenDariLink(link);
  return r && r.platform === platform ? r.id : null;
}

/** Id video/foto dari link TikTok panjang; link pendek (vt.tiktok.com) → null. */
export function videoIdDariLink(link: string | null | undefined): string | null {
  const m = /tiktok\.com\/@[^/?#\s]+\/(?:video|photo)\/(\d+)/i.exec(link ?? "");
  return m ? m[1] : null;
}

/** Handle pemilik dari link TikTok panjang, link Instagram yang memuat nama akun, atau link YouTube `/@handle`. */
export function handleDariLink(link: string | null | undefined): string | null {
  const m = /tiktok\.com\/@([^/?#\s]+)/i.exec(link ?? "") ?? /youtube\.com\/@([^/?#\s]+)/i.exec(link ?? "");
  if (m) return normalHandle(m[1]);
  const ig = idKontenDariLink(link);
  return ig?.platform === "INSTAGRAM" ? ig.handle : null;
}

/** Link mengarah ke tiktok.com atau subdomainnya (www., vt., m.). */
export function linkTiktok(link: string | null | undefined): boolean {
  return platformLinkPantau(link) === "TIKTOK";
}

/** Link baku sebuah konten dari platform + id (+ handle untuk TikTok, + bentuk). */
export function urlKontenPlatform(platform: PlatformPantau, id: string, o: { handle?: string | null; bentuk?: BentukKonten } = {}): string {
  if (platform === "INSTAGRAM") return o.bentuk === "REEL" ? `https://www.instagram.com/reel/${id}/` : `https://www.instagram.com/p/${id}/`;
  if (platform === "YOUTUBE") return o.bentuk === "SHORTS" ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
  return `https://www.tiktok.com/@${normalHandle(o.handle)}/${o.bentuk === "POST" ? "photo" : "video"}/${id}`;
}

/**
 * Link konten dalam bentuk baku (tanpa parameter pelacak) bila bisa diturunkan:
 * `https://www.tiktok.com/@<handle>/<video|photo>/<id>`, `https://www.instagram.com/reel|p/<kode>/`,
 * `https://www.youtube.com/watch?v=<id>` atau `/shorts/<id>`. Link pendek dibiarkan apa adanya
 * (ekstensi mengikuti pengalihannya).
 */
export function urlKontenKanonik(link: string): string {
  const t = link.trim();
  const m = /tiktok\.com\/@([^/?#\s]+)\/(video|photo)\/(\d+)/i.exec(t);
  if (m) return `https://www.tiktok.com/@${normalHandle(m[1])}/${m[2].toLowerCase()}/${m[3]}`;
  const r = idKontenDariLink(t);
  return r && r.platform !== "TIKTOK" ? urlKontenPlatform(r.platform, r.id, { bentuk: r.bentuk }) : t;
}

/** URL profil dari handle per platform. */
export function urlProfilPantau(platform: PlatformPantau, handle: string): string {
  const h = normalHandle(handle);
  if (platform === "INSTAGRAM") return `https://www.instagram.com/${h}/`;
  if (platform === "YOUTUBE") return `https://www.youtube.com/@${h}`;
  return `https://www.tiktok.com/@${h}`;
}

/** URL profil TikTok dari handle. */
export function urlProfilTiktok(handle: string): string {
  return urlProfilPantau("TIKTOK", handle);
}
