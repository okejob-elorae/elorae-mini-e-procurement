/**
 * Riwayat kerja sama KOL dengan brand (D1) dan deteksi "video menandai
 * Elorae" (D2) — bagian MURNI, aman untuk komponen klien (tanpa Prisma).
 * Rancangan: docs/superpowers/specs/2026-10-10-kol-manager-lengkap-design.md.
 *
 * Satu baris `KolBrandCollab` = satu posting KOL × satu brand yang DITANDAI di
 * posting itu. Sumber brand yang ditandai = handle di data TikTok
 * (`textExtra[].userUniqueId` dengan `type === 0`, dikirim ekstensi sebagai
 * `sebutan`) — diukur langsung 2026-10-10: caption hanya menulis nama tampilan
 * ("@Eloraé"), handle aslinya (`elorae.official`) hanya ada di data itu. Pola
 * `@handle` di caption hanya cadangan untuk muatan yang TIDAK mengirim
 * `sebutan` sama sekali (ekstensi lama); daftar kosong berarti "tidak ada
 * yang ditandai", bukan "tebak dari caption".
 *
 * Akun KOL itu sendiri tidak pernah dihitung sebagai brand.
 *
 * Pengaturan di `SystemSetting["kreatif.brand"]` (Kreatif → Pengaturan);
 * baris kosong atau rusak jatuh ke bawaan di kode. Pembaca/penulis servernya
 * di `brand-pengaturan.ts`, penulis barisnya di `brand-writer.ts`.
 */

import { MAKS_INT, normalHandle } from "./pantau-muatan";

export const JENIS_BRAND = ["BERBAYAR", "KOLABORASI", "TAG"] as const;
export type JenisBrand = (typeof JENIS_BRAND)[number];

/** Penanda iklan — dicocokkan utuh dengan tagar atau kata di caption. */
export const PENANDA_BERBAYAR = [
  "ad",
  "ads",
  "iklan",
  "sponsored",
  "sponsor",
  "endorse",
  "endorsement",
  "paidpartnership",
  "paidpromotion",
  "kerjasamaberbayar",
  "kemitraanberbayar",
] as const;

/** Penanda kolaborasi (barter, hadiah, kemitraan tanpa bayar). */
export const PENANDA_KOLABORASI = ["collab", "collaboration", "kolaborasi", "kolab", "gifted", "prpackage", "partner"] as const;

/**
 * Penanda yang di caption biasa ditulis sebagai beberapa kata ("Paid
 * partnership", "kerja sama berbayar", "PR package"): dicocokkan juga pada
 * caption yang spasinya dibuang.
 */
const PENANDA_GABUNGAN: ReadonlySet<string> = new Set(["paidpartnership", "paidpromotion", "kerjasamaberbayar", "kemitraanberbayar", "prpackage"]);

export const MAKS_CAPTION_BRAND = 500;
export const MAKS_HANDLE_BRAND = 100;
export const MAKS_NAMA_BRAND = 100;

/** Angka video yang SUDAH dipantau ikut dicatat dari pembacaan profil hanya bila angka terakhirnya lebih tua dari ini. */
export const JEDA_ANGKA_DARI_PROFIL_JAM = 12;

export const SUMBER_BRAND = ["EKSTENSI", "MANUAL"] as const;
export type SumberBrand = (typeof SUMBER_BRAND)[number];

/** `metadata.sumber` penulis konten/kolaborasi/KOL yang dibuat karena video menandai Elorae (D2). */
export const SUMBER_DETEKSI_TAG = "DETEKSI_TAG";

const POLA_HANDLE_BRAND = /^[a-z0-9._-]{1,100}$/;
const POLA_TAGAR = /^[\p{L}\p{N}_]{1,100}$/u;
const POLA_SEBUT = /(^|[^\p{L}\p{N}_.@])@([a-z0-9_.]{2,30})(?![\p{L}\p{N}_])/giu;
const POLA_TAGAR_TEKS = /#([\p{L}\p{N}_]{1,100})/gu;

/** Handle brand rapi (tanpa "@", huruf kecil; URL profil TikTok juga dibaca), atau "" bila bentuknya pasti bukan handle. */
export function normalBrand(h: unknown): string {
  if (typeof h !== "string" || h.length > 300) return "";
  const n = normalHandle(h);
  return POLA_HANDLE_BRAND.test(n) ? n : "";
}

/** Tagar rapi (tanpa "#", huruf kecil), atau "". */
export function normalTagar(t: unknown): string {
  if (typeof t !== "string") return "";
  const n = t.trim().replace(/^#+/, "").toLowerCase();
  return POLA_TAGAR.test(n) ? n : "";
}

const unik = (xs: readonly string[]) => [...new Set(xs.filter(Boolean))];

/** Cadangan: handle `@...` di caption. Nama tampilan beraksen ("@Eloraé") dan alamat surel tidak ditebak. */
export function handleDariTeks(teks: string | null | undefined): string[] {
  const hasil: string[] = [];
  for (const m of (teks ?? "").matchAll(POLA_SEBUT)) {
    const h = normalBrand(m[2].replace(/\.+$/, ""));
    if (h) hasil.push(h);
  }
  return unik(hasil);
}

/** Bagian posting yang dibaca aturan brand (bentuk sama untuk posting profil dan hasil konten). */
export type PostingBrand = {
  id: string;
  /** Detik unix. */
  dibuatPada?: number;
  views?: number;
  teks?: string;
  sebutan?: string[];
  tagar?: string[];
  iklan?: boolean;
  penulis?: string;
};

type BagianTeks = Pick<PostingBrand, "teks" | "sebutan" | "tagar" | "iklan">;

/** Brand yang ditandai sebuah posting, tanpa akun KOL itu sendiri. */
export function brandDariPosting(p: Pick<PostingBrand, "teks" | "sebutan">, handleSendiri: readonly string[]): string[] {
  const sendiri = new Set(handleSendiri.map((h) => normalHandle(h)).filter(Boolean));
  const mentah = p.sebutan !== undefined ? p.sebutan.map(normalBrand) : handleDariTeks(p.teks);
  return unik(mentah).filter((h) => !sendiri.has(h));
}

/** Tagar posting: dari daftar `tagar`, atau dari caption bila daftarnya tidak dikirim. */
export function tagarPosting(p: Pick<PostingBrand, "teks" | "tagar">): string[] {
  if (p.tagar !== undefined) return unik(p.tagar.map(normalTagar));
  return unik([...(p.teks ?? "").matchAll(POLA_TAGAR_TEKS)].map((m) => normalTagar(m[1])));
}

function adaPenanda(penanda: readonly string[], kata: ReadonlySet<string>, padat: string): boolean {
  return penanda.some((x) => kata.has(x) || (PENANDA_GABUNGAN.has(x) && padat.includes(x)));
}

/**
 * Jenis kerja sama sebuah posting: BERBAYAR (iklan TikTok, atau penanda iklan
 * di tagar/caption), KOLABORASI (penanda kolaborasi), selain itu TAG.
 * Penanda dicocokkan UTUH — tagar "adidas" bukan "ad".
 */
export function jenisBrand(p: BagianTeks): JenisBrand {
  if (p.iklan === true) return "BERBAYAR";
  const teks = (p.teks ?? "").toLowerCase();
  const kata = new Set<string>([...tagarPosting(p), ...(teks.match(/[\p{L}\p{N}_]+/gu) ?? [])]);
  const padat = teks.replace(/[^\p{L}\p{N}]+/gu, "");
  if (adaPenanda(PENANDA_BERBAYAR, kata, padat)) return "BERBAYAR";
  if (adaPenanda(PENANDA_KOLABORASI, kata, padat)) return "KOLABORASI";
  return "TAG";
}

/** Posting milik pemilik profil: penulisnya tidak disebut, atau sama dengan handle profil. */
export function postingMilik(p: Pick<PostingBrand, "penulis">, handle: string): boolean {
  return p.penulis === undefined || normalHandle(p.penulis) === normalHandle(handle);
}

/**
 * Posting menandai Elorae: menyebut salah satu `akunElorae`, ATAU memakai salah
 * satu `tagarElorae`. Video milik akun Elorae sendiri tidak pernah dihitung.
 */
export function menandaiElorae(p: BagianTeks, pengaturan: PengaturanBrand, handleSendiri: readonly string[]): boolean {
  const sendiri = handleSendiri.map((h) => normalHandle(h));
  const akun = new Set(pengaturan.akunElorae);
  if (sendiri.some((h) => akun.has(h))) return false;
  if (brandDariPosting(p, handleSendiri).some((h) => akun.has(h))) return true;
  const tagar = new Set(pengaturan.tagarElorae);
  return tagarPosting(p).some((t) => tagar.has(t));
}

/**
 * Jenis orang untuk video yang masuk Performa karena menandai Elorae (D2): Afiliasi bila SEMUA
 * kolaborasi berjalan KOL itu berjenis KOMISI (dan ada paling sedikit satu), selain itu KOL —
 * "Tempel link" lalu mencari/membuat kolaborasi yang cocok dengan jenis itu.
 */
export function jenisUntukDeteksi(jenisBerjalan: readonly string[]): "AFILIASI" | "KOL" {
  return jenisBerjalan.length > 0 && jenisBerjalan.every((j) => j === "KOMISI") ? "AFILIASI" : "KOL";
}

export function kunciBrand(platform: string, postId: string, brand: string): string {
  return `${platform}:${postId}:${normalHandle(brand)}`;
}

export function kunciBrandManual(id: string): string {
  return `MANUAL:${id}`;
}

/** Link posting TikTok dari handle pemilik dan id-nya. */
export function urlPostingTiktok(handle: string, id: string): string {
  return `https://www.tiktok.com/@${normalHandle(handle)}/video/${id}`;
}

export type BarisBrandBaru = {
  kunci: string;
  brandHandle: string;
  jenis: JenisBrand;
  postId: string;
  postUrl: string;
  postedAt: Date | null;
  caption: string | null;
  views: number | null;
};

/** Baris riwayat brand untuk satu posting — satu per brand yang ditandai. */
export function barisBrandPosting(
  p: PostingBrand,
  o: { platform: "TIKTOK"; handle: string; handleSendiri: readonly string[] },
): BarisBrandBaru[] {
  const brand = brandDariPosting(p, o.handleSendiri);
  if (!brand.length) return [];
  const jenis = jenisBrand(p);
  const caption = p.teks?.trim() ? p.teks.trim().slice(0, MAKS_CAPTION_BRAND) : null;
  return brand.map((b) => ({
    kunci: kunciBrand(o.platform, p.id, b),
    brandHandle: b,
    jenis,
    postId: p.id,
    postUrl: urlPostingTiktok(o.handle, p.id),
    postedAt: typeof p.dibuatPada === "number" ? new Date(p.dibuatPada * 1000) : null,
    caption,
    views: typeof p.views === "number" ? Math.min(Math.max(0, Math.trunc(p.views)), MAKS_INT) : null,
  }));
}

/* ─────────────────────────── Pengaturan ─────────────────────────── */

export const KUNCI_BRAND = "kreatif.brand";

export type KompetitorBrand = { handle: string; nama: string };

export type PengaturanBrand = {
  /** Akun Elorae sendiri — posting yang menandainya masuk Performa video (D2) dan diberi lencana "Elorae". */
  akunElorae: string[];
  /** Tagar milik Elorae — posting yang memakainya juga dianggap menandai Elorae. */
  tagarElorae: string[];
  /** Brand yang diberi lencana "Kompetitor". */
  kompetitor: KompetitorBrand[];
  /** Mati = video yang menandai Elorae tidak dibuat otomatis (riwayat brand tetap dicatat). */
  otomatisKePerforma: boolean;
};

export const BRAND_BAWAAN: PengaturanBrand = {
  akunElorae: ["elorae.official"],
  tagarElorae: [],
  kompetitor: [],
  otomatisKePerforma: true,
};

export const BATAS_BRAND = { akunElorae: 20, tagarElorae: 30, kompetitor: 300 } as const;

function keObjek(nilai: unknown): Record<string, unknown> | null {
  let o = nilai;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      return null;
    }
  }
  return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
}

/** Daftar rapi untuk pembaca toleran: isian yang cacat dibuang, sisanya dipakai. Bukan daftar → null (pakai bawaan). */
function daftarRapi(x: unknown, rapikan: (v: unknown) => string, maks: number): string[] | null {
  if (!Array.isArray(x)) return null;
  return unik(x.map(rapikan)).slice(0, maks);
}

function kompetitorRapi(x: unknown): KompetitorBrand[] | null {
  if (!Array.isArray(x)) return null;
  const hasil: KompetitorBrand[] = [];
  const sudah = new Set<string>();
  for (const k of x) {
    if (!k || typeof k !== "object") continue;
    const handle = normalBrand((k as Record<string, unknown>).handle);
    if (!handle || sudah.has(handle)) continue;
    const nama = (k as Record<string, unknown>).nama;
    sudah.add(handle);
    hasil.push({ handle, nama: typeof nama === "string" ? nama.trim().slice(0, MAKS_NAMA_BRAND) : "" });
  }
  return hasil.slice(0, BATAS_BRAND.kompetitor);
}

/** Pembaca toleran: isian yang sah dipakai, kolom yang cacat jatuh ke bawaannya. */
export function bacaBrand(nilai: unknown): PengaturanBrand {
  const o = keObjek(nilai);
  const hasil: PengaturanBrand = { ...BRAND_BAWAAN, akunElorae: [...BRAND_BAWAAN.akunElorae], tagarElorae: [], kompetitor: [] };
  if (!o) return hasil;
  const akun = daftarRapi(o.akunElorae, normalBrand, BATAS_BRAND.akunElorae);
  if (akun) hasil.akunElorae = akun;
  const tagar = daftarRapi(o.tagarElorae, normalTagar, BATAS_BRAND.tagarElorae);
  if (tagar) hasil.tagarElorae = tagar;
  const komp = kompetitorRapi(o.kompetitor);
  if (komp) hasil.kompetitor = komp.filter((k) => !hasil.akunElorae.includes(k.handle));
  if (typeof o.otomatisKePerforma === "boolean") hasil.otomatisKePerforma = o.otomatisKePerforma;
  return hasil;
}

export type KodeTolakBrand = "TIDAK_VALID" | "HANDLE_TIDAK_SAH" | "TAGAR_TIDAK_SAH" | "TERLALU_BANYAK" | "BENTROK";
export type HasilValidasiBrand =
  | { ok: true; pengaturan: PengaturanBrand }
  | { ok: false; kode: KodeTolakBrand; bagian?: "akunElorae" | "tagarElorae" | "kompetitor"; nilai?: string };

/** Validasi untuk penyimpanan: isian cacat DITOLAK (tidak diganti bawaan diam-diam). */
export function validasiBrand(input: unknown): HasilValidasiBrand {
  const o = keObjek(input);
  if (!o || typeof input === "string") return { ok: false, kode: "TIDAK_VALID" };
  if (!Array.isArray(o.akunElorae) || !Array.isArray(o.tagarElorae) || !Array.isArray(o.kompetitor) || typeof o.otomatisKePerforma !== "boolean") {
    return { ok: false, kode: "TIDAK_VALID" };
  }

  const akun: string[] = [];
  for (const x of o.akunElorae) {
    const h = normalBrand(x);
    if (!h) return { ok: false, kode: "HANDLE_TIDAK_SAH", bagian: "akunElorae", nilai: String(x).slice(0, 100) };
    if (!akun.includes(h)) akun.push(h);
  }
  if (akun.length > BATAS_BRAND.akunElorae) return { ok: false, kode: "TERLALU_BANYAK", bagian: "akunElorae" };

  const tagar: string[] = [];
  for (const x of o.tagarElorae) {
    const t = normalTagar(x);
    if (!t) return { ok: false, kode: "TAGAR_TIDAK_SAH", bagian: "tagarElorae", nilai: String(x).slice(0, 100) };
    if (!tagar.includes(t)) tagar.push(t);
  }
  if (tagar.length > BATAS_BRAND.tagarElorae) return { ok: false, kode: "TERLALU_BANYAK", bagian: "tagarElorae" };

  const kompetitor: KompetitorBrand[] = [];
  for (const x of o.kompetitor) {
    const k = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
    if (!k || (k.nama !== undefined && k.nama !== null && typeof k.nama !== "string")) return { ok: false, kode: "TIDAK_VALID", bagian: "kompetitor" };
    const handle = normalBrand(k.handle);
    if (!handle) return { ok: false, kode: "HANDLE_TIDAK_SAH", bagian: "kompetitor", nilai: String(k.handle ?? "").slice(0, 100) };
    if (akun.includes(handle)) return { ok: false, kode: "BENTROK", bagian: "kompetitor", nilai: handle };
    if (kompetitor.some((y) => y.handle === handle)) continue;
    kompetitor.push({ handle, nama: typeof k.nama === "string" ? k.nama.trim().slice(0, MAKS_NAMA_BRAND) : "" });
  }
  if (kompetitor.length > BATAS_BRAND.kompetitor) return { ok: false, kode: "TERLALU_BANYAK", bagian: "kompetitor" };

  return { ok: true, pengaturan: { akunElorae: akun, tagarElorae: tagar, kompetitor, otomatisKePerforma: o.otomatisKePerforma } };
}

export type LabelBrand = "ELORAE" | "KOMPETITOR";

/** Lencana sebuah brand: Elorae lebih dulu, lalu kompetitor. */
export function labelBrand(handle: string, p: Pick<PengaturanBrand, "akunElorae" | "kompetitor">): LabelBrand | null {
  const h = normalHandle(handle);
  if (p.akunElorae.includes(h)) return "ELORAE";
  if (p.kompetitor.some((k) => k.handle === h)) return "KOMPETITOR";
  return null;
}
