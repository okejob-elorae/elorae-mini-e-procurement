// Pengurai halaman Instagram — modul MURNI (tanpa chrome.*, tanpa jaringan, waktu dari pemanggil).
// Dipakai konten.js di www.instagram.com, service worker, dan tes `node --test`.
//
// Yang DIUKUR (2026-10-10, tanpa masuk): halaman profil memuat puluhan
// <script type="application/json">; salah satunya memuat objek pengguna profil dengan
// "follower_count", "following_count", "id", "username". `GET /api/v1/users/web_profile_info/`
// menjawab 401 `require_login` tanpa masuk. Jadi POSTING dan angkanya hanya ada untuk pengguna
// yang SUDAH MASUK, dimuat halaman itu sendiri (respons GraphQL / api/v1) — ditangkap pasif oleh
// halaman-utama-instagram.js. Bentuk data pengguna yang sudah masuk BELUM diukur: semua JSON
// dibaca dengan berjalan menelusuri objek, mengenali bentuknya dari nama kolom, bukan dari jalurnya.
//
// Aturan tetap: angka yang tidak terbaca TIDAK PERNAH menjadi 0 — kolomnya dibiarkan tidak ada.
// Share dan simpan tidak publik di Instagram dan tidak pernah dikirim.

import { MAKS_PANJANG_LABEL, MAKS_SEBUTAN, MAKS_TAGAR, MAKS_TEKS, potongTeks } from "./pengurai.js";

export const PLATFORM = "INSTAGRAM";
export const MAKS_POSTING = 200;
/** Sama dengan POLA di halaman-utama-instagram.js (skrip dunia MAIN tidak bisa mengimpor modul). */
export const POLA_URL_TANGKAPAN = ["/graphql/query", "/api/graphql", "/graphql/", "/api/v1/"];

/** Ruas pertama alamat yang BUKAN nama akun. */
const BUKAN_AKUN = new Set([
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
  "",
]);
const POLA_AKUN = /^[A-Za-z0-9._]{1,30}$/;
const POLA_KODE = /^[A-Za-z0-9_-]{5,40}$/;

/**
 * SATU-SATUNYA daftar tanda halaman Instagram. Teks dicari di teks yang tampil (bukan di dalam
 * <script>), tanpa memandang huruf besar/kecil. BELUM diukur di halaman sungguhan.
 */
export const POLA_HALAMAN = {
  CAPTCHA: { jalur: ["/challenge"], teks: ["Help us confirm it's you", "Bantu kami memastikan bahwa ini adalah Anda", "Confirm it's you"] },
  LOGIN: { jalur: ["/accounts/login"], teks: [] },
  TIDAK_DITEMUKAN: {
    teks: [
      "Sorry, this page isn't available",
      "Maaf, halaman ini tidak tersedia",
      "The link you followed may be broken",
      "Tautan yang Anda ikuti mungkin rusak",
    ],
  },
  PRIVAT: { teks: ["This account is private", "Akun ini bersifat pribadi", "Akun ini privat"] },
};

// ---------------------------------------------------------------- angka & teks

/** Bulat ≥ 0 yang aman dari angka atau teks digit; selain itu `undefined` (BUKAN 0). */
export function angkaBulat(nilai) {
  if (typeof nilai === "number") return Number.isSafeInteger(nilai) && nilai >= 0 ? nilai : undefined;
  if (typeof nilai === "string" && /^\d+$/.test(nilai.trim())) {
    const n = Number(nilai.trim());
    return Number.isSafeInteger(n) ? n : undefined;
  }
  return undefined;
}

function pertama(...calon) {
  for (const c of calon) {
    const n = angkaBulat(c);
    if (n !== undefined) return n;
  }
  return undefined;
}

const objek = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const teksSah = (v) => typeof v === "string" && v.trim() !== "";

/** Nama akun Instagram rapi (huruf kecil, tanpa "@"); dari URL profil juga. "" bila bukan nama akun. */
export function normalAkun(masukan) {
  if (typeof masukan !== "string") return "";
  let t = masukan.trim();
  const dariUrl = /instagram\.com\/([^/?#\s]+)/i.exec(t);
  if (dariUrl) t = dariUrl[1];
  t = t.replace(/^@+/, "").trim();
  if (!POLA_AKUN.test(t) || BUKAN_AKUN.has(t.toLowerCase())) return "";
  return t.toLowerCase();
}

function urlDari(url) {
  try {
    const u = new URL(url);
    return /(^|\.)instagram\.com$/i.test(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

/**
 * `{ jenis: "PROFIL", handle }` | `{ jenis: "KONTEN", videoId: <shortcode>, bentuk: "REEL"|"POST",
 * handle: <akun|null> }` | null. Shortcode tidak diubah hurufnya.
 */
export function jenisHalaman(url) {
  const u = urlDari(url);
  if (!u) return null;
  const ruas = u.pathname.split("/").filter(Boolean);
  if (ruas.length >= 2) {
    const [a, b, c] = ruas;
    if (/^(p|reel|reels|tv)$/i.test(a) && POLA_KODE.test(b)) {
      return { jenis: "KONTEN", videoId: b, bentuk: /^reels?$/i.test(a) ? "REEL" : "POST", handle: null };
    }
    if (c && /^(p|reel|reels|tv)$/i.test(b) && POLA_KODE.test(c) && normalAkun(a)) {
      return { jenis: "KONTEN", videoId: c, bentuk: /^reels?$/i.test(b) ? "REEL" : "POST", handle: normalAkun(a) };
    }
  }
  // Profil: /<akun>/ dan tab-tabnya (/<akun>/reels/, /<akun>/tagged/).
  if (ruas.length >= 1 && ruas.length <= 2 && normalAkun(ruas[0]) && (ruas.length === 1 || /^(reels|tagged|saved|igtv|guides)$/i.test(ruas[1]))) {
    return { jenis: "PROFIL", handle: normalAkun(ruas[0]) };
  }
  return null;
}

/** Alamat yang aman diambil dari tab instagram.com: profil atau posting, https://www.instagram.com, tanpa query. */
export function urlUntukTab(url) {
  const t = jenisHalaman(typeof url === "string" ? url.trim() : "");
  if (!t) return null;
  if (t.jenis === "PROFIL") return `https://www.instagram.com/${t.handle}/`;
  return `https://www.instagram.com/${t.bentuk === "REEL" ? "reel" : "p"}/${t.videoId}/`;
}

export function apakahUrlTangkapan(url) {
  return typeof url === "string" && POLA_URL_TANGKAPAN.some((p) => url.includes(p));
}

// ---------------------------------------------------------------- membaca JSON

const MAKS_SIMPUL = 400_000;
const MAKS_KEDALAMAN = 60;

/** Telusuri semua objek di `akar` (sampai batas simpul/kedalaman), panggil `kunjungi(obj)`. */
function telusuri(akar, kunjungi) {
  let simpul = 0;
  const tumpuk = [[akar, 0]];
  while (tumpuk.length && simpul < MAKS_SIMPUL) {
    const [x, d] = tumpuk.pop();
    simpul++;
    if (Array.isArray(x)) {
      if (d < MAKS_KEDALAMAN) for (let i = x.length - 1; i >= 0; i--) if (x[i] && typeof x[i] === "object") tumpuk.push([x[i], d + 1]);
      continue;
    }
    if (!objek(x)) continue;
    kunjungi(x);
    if (d < MAKS_KEDALAMAN) for (const v of Object.values(x)) if (v && typeof v === "object") tumpuk.push([v, d + 1]);
  }
}

/** Objek pengguna (profil): punya `username` dan jumlah pengikut. */
export function pengikutDari(u) {
  if (!objek(u) || !teksSah(u.username)) return undefined;
  return pertama(u.follower_count, u.edge_followed_by?.count, u.followers_count);
}

function idPengguna(u) {
  const id = u?.pk ?? u?.id ?? u?.pk_id;
  return typeof id === "string" && /^\d{1,30}$/.test(id) ? id : typeof id === "number" && Number.isSafeInteger(id) ? String(id) : null;
}

function kodeMedia(m) {
  const k = m?.code ?? m?.shortcode;
  return typeof k === "string" && POLA_KODE.test(k) ? k : null;
}

/** Objek media: punya shortcode, waktu unggah, dan paling sedikit like/komentar. */
function apakahMedia(m) {
  if (!objek(m) || !kodeMedia(m)) return false;
  if (pertama(m.taken_at, m.taken_at_timestamp) === undefined) return false;
  return (
    "like_count" in m ||
    "comment_count" in m ||
    objek(m.edge_liked_by) ||
    objek(m.edge_media_preview_like) ||
    objek(m.edge_media_to_comment) ||
    objek(m.edge_media_preview_comment)
  );
}

function penulisMedia(m) {
  for (const u of [m.user, m.owner]) {
    if (objek(u) && teksSah(u.username)) return normalAkun(u.username) || null;
  }
  return null;
}

function idPenulisMedia(m) {
  for (const u of [m.user, m.owner]) {
    const id = objek(u) ? idPengguna(u) : null;
    if (id) return id;
  }
  return null;
}

function tambahUnik(daftar, nilai, maks) {
  if (nilai && nilai.length <= MAKS_PANJANG_LABEL && daftar.length < maks && !daftar.includes(nilai)) daftar.push(nilai);
}

const POLA_SEBUT = /(^|[^A-Za-z0-9_.@])@([A-Za-z0-9._]{1,30})(?![A-Za-z0-9_])/g;
const POLA_TAGAR = /#([\p{L}\p{N}_]{1,100})/gu;

function teksCaption(m) {
  if (objek(m.caption) && typeof m.caption.text === "string") return m.caption.text;
  if (typeof m.caption === "string") return m.caption;
  const e = m.edge_media_to_caption?.edges?.[0]?.node?.text;
  return typeof e === "string" ? e : null;
}

/** Akun yang ditandai: tag di foto/video, kolaborator, sponsor (kemitraan berbayar), dan @ di caption. */
function sebutanMedia(m, teks) {
  let ada = false;
  const hasil = [];
  const dari = (x) => tambahUnik(hasil, normalAkun(typeof x === "string" ? x : ""), MAKS_SEBUTAN);
  const tagFoto = (mm) => {
    if (Array.isArray(mm?.usertags?.in)) {
      ada = true;
      for (const t of mm.usertags.in) dari(t?.user?.username);
    }
    if (Array.isArray(mm?.edge_media_to_tagged_user?.edges)) {
      ada = true;
      for (const e of mm.edge_media_to_tagged_user.edges) dari(e?.node?.user?.username);
    }
  };
  tagFoto(m);
  for (const anak of Array.isArray(m.carousel_media) ? m.carousel_media : []) tagFoto(anak);
  if (Array.isArray(m.coauthor_producers)) {
    ada = true;
    for (const c of m.coauthor_producers) dari(c?.username);
  }
  if (Array.isArray(m.sponsor_tags)) {
    ada = true;
    for (const s of m.sponsor_tags) dari(s?.sponsor?.username ?? s?.username);
  }
  if (typeof teks === "string") {
    ada = true;
    for (const x of teks.matchAll(POLA_SEBUT)) dari(x[2].replace(/\.+$/, ""));
  }
  return ada ? hasil : undefined;
}

/**
 * Satu objek media → posting (bentuk kontrak Elorae, platform INSTAGRAM), atau null bila bukan media
 * yang lengkap. Angka yang disembunyikan pemilik (`like_and_view_counts_disabled`) tidak dikirim.
 */
export function postingDariMedia(m) {
  if (!apakahMedia(m)) return null;
  const tersembunyi = m.like_and_view_counts_disabled === true;
  const p = {
    id: kodeMedia(m),
    dibuatPada: pertama(m.taken_at, m.taken_at_timestamp),
    disematkan:
      (Array.isArray(m.timeline_pinned_user_ids) && m.timeline_pinned_user_ids.length > 0) ||
      m.is_pinned === true ||
      (Array.isArray(m.pinned_for_users) && m.pinned_for_users.length > 0),
  };
  if (!(p.dibuatPada > 0)) return null;
  const views = tersembunyi ? undefined : pertama(m.play_count, m.ig_play_count, m.view_count, m.video_view_count, m.video_play_count);
  const like = tersembunyi ? undefined : pertama(m.like_count, m.edge_liked_by?.count, m.edge_media_preview_like?.count);
  const komentar = pertama(m.comment_count, m.edge_media_to_comment?.count, m.edge_media_preview_comment?.count, m.edge_media_to_parent_comment?.count);
  if (views !== undefined) p.views = views;
  if (like !== undefined) p.like = like;
  if (komentar !== undefined) p.komentar = komentar;
  p.bentuk = m.product_type === "clips" || m.__typename === "XDTClipsMedia" ? "REEL" : "POST";
  const teks = teksCaption(m);
  if (typeof teks === "string" && teks.trim()) p.teks = potongTeks(teks.trim(), MAKS_TEKS);
  const sebutan = sebutanMedia(m, teks);
  if (sebutan) p.sebutan = sebutan;
  if (typeof teks === "string") {
    const tagar = [];
    for (const x of teks.matchAll(POLA_TAGAR)) tambahUnik(tagar, x[1].toLowerCase(), MAKS_TAGAR);
    p.tagar = tagar;
  }
  if (m.is_paid_partnership === true || (Array.isArray(m.sponsor_tags) && m.sponsor_tags.length > 0)) p.iklan = true;
  const penulis = penulisMedia(m);
  if (penulis) p.penulis = penulis;
  return p;
}

/**
 * Ringkasan satu badan JSON (tangkapan jaringan atau satu blob halaman): pengguna yang dikenali dan
 * media beserta penulisnya — supaya badan mentah (bisa ratusan KB) tidak perlu disimpan.
 */
export function ringkasJson(json) {
  const pengguna = new Map();
  const media = new Map();
  telusuri(json, (o) => {
    const pengikut = pengikutDari(o);
    if (pengikut !== undefined) {
      const akun = normalAkun(o.username);
      if (akun) {
        const lama = pengguna.get(akun) ?? {};
        pengguna.set(akun, {
          username: akun,
          pengikut,
          id: idPengguna(o) ?? lama.id ?? null,
          jumlahPosting: pertama(o.media_count, o.edge_owner_to_timeline_media?.count) ?? lama.jumlahPosting,
          privat: o.is_private === true || lama.privat === true,
        });
      }
    }
    if (apakahMedia(o)) {
      const p = postingDariMedia(o);
      if (p && !media.has(p.id)) media.set(p.id, { penulis: p.penulis ?? null, idPenulis: idPenulisMedia(o), posting: p });
    }
  });
  return { pengguna: [...pengguna.values()], media: [...media.values()] };
}

/** Teks respons Instagram → JSON: awalan `for (;;);` dibuang; beberapa objek per baris digabung jadi daftar. */
export function parseTeksJson(teks) {
  if (typeof teks !== "string") return null;
  const t = teks.replace(/^\s*for\s*\(\s*;\s*;\s*\)\s*;/, "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    const hasil = [];
    for (const baris of t.split(/\r?\n/)) {
      const b = baris.trim();
      if (!b) continue;
      try {
        hasil.push(JSON.parse(b));
      } catch {
        // baris yang bukan JSON dilewati
      }
    }
    return hasil.length ? hasil : null;
  }
}

/** Tangkapan jaringan `{ url, body }` (badan objek atau teks) → `{ url, pengguna, media }`. */
export function ringkasTangkapan(url, body) {
  const json = typeof body === "string" ? parseTeksJson(body) : body;
  return { url, ...(json ? ringkasJson(json) : { pengguna: [], media: [] }) };
}

/** Isi semua <script type="application/json"> dari dokumen atau teks HTML. */
export function blobJson(masukan) {
  const hasil = [];
  if (typeof masukan === "string") {
    for (const m of masukan.matchAll(/<script\b[^>]*type\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) hasil.push(m[1]);
    return hasil;
  }
  try {
    for (const el of masukan?.querySelectorAll?.('script[type="application/json"]') ?? []) {
      if (typeof el.textContent === "string") hasil.push(el.textContent);
    }
  } catch {
    // dokumen tanpa querySelectorAll
  }
  return hasil;
}

/** Ringkasan semua blob JSON halaman (yang rusak dilewati). */
export function ringkasHalaman(masukan) {
  const pengguna = [];
  const media = [];
  for (const teks of blobJson(masukan)) {
    if (!/follower_count|edge_followed_by|taken_at/.test(teks)) continue;
    let json;
    try {
      json = JSON.parse(teks);
    } catch {
      continue;
    }
    const r = ringkasJson(json);
    pengguna.push(...r.pengguna);
    media.push(...r.media);
  }
  return { pengguna, media };
}

// ---------------------------------------------------------------- keadaan halaman

const ENTITAS = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function teksTampil(masukan) {
  if (typeof masukan === "string") {
    return masukan
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&([a-z]+);/gi, (asli, nama) => ENTITAS[nama.toLowerCase()] ?? asli);
  }
  const b = masukan?.body;
  return typeof b?.innerText === "string" ? b.innerText : (b?.textContent ?? "");
}

const rapikan = (t) =>
  String(t ?? "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();

function jalurDari(masukan, opsi) {
  for (const u of [opsi?.url, masukan?.location?.href]) {
    if (typeof u !== "string") continue;
    try {
      return new URL(u).pathname;
    } catch {
      // lanjut
    }
  }
  return "";
}

function adaPola(teks, jalur, pola) {
  if ((pola.jalur ?? []).some((j) => jalur === j || jalur.startsWith(j + "/"))) return true;
  return (pola.teks ?? []).some((t) => teks.includes(rapikan(t)));
}

function adaFormMasuk(masukan) {
  if (typeof masukan === "string") return /<input\b[^>]*name=["']username["']/i.test(masukan) && /<input\b[^>]*name=["']password["']/i.test(masukan);
  try {
    return Boolean(masukan?.querySelector?.('input[name="username"]') && masukan?.querySelector?.('input[name="password"]'));
  } catch {
    return false;
  }
}

function htmlDari(masukan) {
  if (typeof masukan === "string") return masukan;
  try {
    return typeof masukan?.html === "string" ? masukan.html : "";
  } catch {
    return "";
  }
}

/**
 * Ringkasan singkat isi halaman saat angkanya tidak terbaca — dikirim bersama laporan masalah supaya
 * penyebabnya terlihat di Elorae. Tanpa angka dan tanpa isi halaman.
 */
export function diagnosaHalaman(masukan, ringkas) {
  const blob = blobJson(masukan);
  const html = htmlDari(masukan);
  const judul = (typeof masukan === "string" ? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(masukan)?.[1] : masukan?.title) ?? "";
  const ciri = [`blob json: ${blob.length}`];
  if (ringkas) ciri.push(`pengguna: ${ringkas.pengguna.length}`, `media: ${ringkas.media.length}`);
  if (judul) ciri.push(`judul: ${String(judul).trim().slice(0, 60)}`);
  if (html) {
    ciri.push(`html: ${html.length} b`);
    const tanda = ["xdt_api__v1__media__shortcode__web_info", "follower_count", "taken_at", "require_login", "checkpoint", "login"].filter((t) => html.includes(t));
    if (tanda.length) ciri.push(`tanda: ${tanda.join(",")}`);
  }
  return ciri.join("; ").slice(0, 400);
}

const WAJIB = { PROFIL: ["uniqueId", "pengikut"], KONTEN: ["videoId", "uniqueId"] };

/** Kolom wajib yang tidak ada. Konten: paling sedikit satu dari views/like/komentar ("angka"). */
export function kurangWajib(hasil) {
  const wajib = WAJIB[hasil?.jenis];
  if (!wajib) return ["jenis"];
  const kurang = wajib.filter((k) => hasil[k] === undefined);
  if (hasil.jenis === "PROFIL" && !Array.isArray(hasil.posting)) kurang.push("posting");
  if (hasil.jenis === "KONTEN" && hasil.views === undefined && hasil.like === undefined && hasil.komentar === undefined) kurang.push("angka");
  return kurang;
}

/** Data yang terbaca memang milik halaman pada `target` (dari jenisHalaman)? */
export function cocokDenganUrl(hasil, target) {
  if (!hasil || !target || hasil.jenis !== target.jenis) return false;
  if (target.jenis === "KONTEN") return hasil.videoId === target.videoId && (!target.handle || normalAkun(hasil.uniqueId) === target.handle);
  return normalAkun(hasil.uniqueId) === target.handle;
}

function gabungRingkas(...daftar) {
  const pengguna = new Map();
  const media = new Map();
  for (const r of daftar) {
    for (const u of r?.pengguna ?? []) {
      const lama = pengguna.get(u.username);
      pengguna.set(u.username, lama ? { ...lama, ...u, id: u.id ?? lama.id, jumlahPosting: u.jumlahPosting ?? lama.jumlahPosting } : u);
    }
    for (const m of r?.media ?? []) if (m?.posting && !media.has(m.posting.id)) media.set(m.posting.id, m);
  }
  return { pengguna: [...pengguna.values()], media: [...media.values()] };
}

/**
 * Baca satu halaman Instagram menjadi hasil siap kirim (bentuk sama dengan pengurai TikTok).
 * `opsi.url` = alamat halaman; `opsi.itemList` = tangkapan jaringan (`ringkasTangkapan`, atau
 * `{ url, body }` mentah). Hasil: `{ status: "OK", data, adaItemList }` | `{ status: "TIDAK_TERBACA",
 * alasan?, kurang?, diagnosa, tanpaSkrip }` | `{ status }` untuk CAPTCHA/LOGIN/PRIVAT/TIDAK_DITEMUKAN.
 * `adaItemList` = ada posting akun itu yang tertangkap dari jaringan.
 */
export function bacaHalaman(masukan, opsi = {}) {
  const target = typeof opsi.url === "string" ? jenisHalaman(opsi.url) : null;
  const dariHalaman = ringkasHalaman(masukan);
  const tangkapan = (opsi.itemList ?? []).map((t) => (Array.isArray(t?.media) ? t : ringkasTangkapan(t?.url, t?.body)));
  const r = gabungRingkas(dariHalaman, ...tangkapan);
  const teks = rapikan(teksTampil(masukan));
  const jalur = jalurDari(masukan, opsi);
  const tidakTerbaca = (lain = {}) => ({ status: "TIDAK_TERBACA", diagnosa: diagnosaHalaman(masukan, r), tanpaSkrip: blobJson(masukan).length === 0, ...lain });

  if (adaPola(teks, jalur, POLA_HALAMAN.CAPTCHA)) return { status: "CAPTCHA" };
  if (adaPola(teks, jalur, POLA_HALAMAN.LOGIN)) return { status: "LOGIN" };

  const jenis = target?.jenis ?? (r.media.length === 1 && !r.pengguna.length ? "KONTEN" : "PROFIL");
  if (jenis === "PROFIL") {
    const handle = target?.handle ?? r.pengguna[0]?.username;
    const u = r.pengguna.find((x) => x.username === handle);
    if (!u) {
      if (adaPola(teks, jalur, POLA_HALAMAN.TIDAK_DITEMUKAN)) return { status: "TIDAK_DITEMUKAN" };
      if (adaPola(teks, jalur, POLA_HALAMAN.PRIVAT)) return { status: "PRIVAT" };
      if (adaFormMasuk(masukan) && !blobJson(masukan).some((b) => /follower_count|edge_followed_by/.test(b))) return { status: "LOGIN" };
      return tidakTerbaca();
    }
    const milik = r.media.filter((m) => m.penulis === u.username || (!m.penulis && u.id && m.idPenulis === u.id));
    const posting = milik
      .map((m) => ({ ...m.posting, penulis: u.username }))
      .sort((a, b) => b.dibuatPada - a.dibuatPada)
      .slice(0, MAKS_POSTING);
    const data = { platform: PLATFORM, jenis: "PROFIL", uniqueId: u.username, pengikut: u.pengikut, posting };
    if (u.id) data.idPlatform = u.id;
    if (u.jumlahPosting !== undefined) data.jumlahVideo = u.jumlahPosting;
    // Akun privat yang tidak diikuti: pengikutnya terbaca, posting tidak — tetap sah dikirim.
    return { status: "OK", data, adaItemList: posting.length > 0 };
  }

  const kode = target?.videoId ?? r.media[0]?.posting.id;
  const m = r.media.find((x) => x.posting.id === kode);
  if (!m) {
    if (adaPola(teks, jalur, POLA_HALAMAN.TIDAK_DITEMUKAN)) return { status: "TIDAK_DITEMUKAN" };
    if (adaPola(teks, jalur, POLA_HALAMAN.PRIVAT)) return { status: "PRIVAT" };
    if (adaFormMasuk(masukan)) return { status: "LOGIN" };
    return tidakTerbaca();
  }
  const { penulis, ...p } = m.posting;
  const data = { platform: PLATFORM, jenis: "KONTEN", videoId: p.id, uniqueId: penulis ?? target?.handle ?? undefined };
  for (const k of ["views", "like", "komentar", "dibuatPada", "bentuk", "teks", "sebutan", "tagar", "iklan"]) if (p[k] !== undefined) data[k] = p[k];
  if (penulis) data.penulis = penulis;
  if (data.uniqueId === undefined) delete data.uniqueId;
  const kurang = kurangWajib(data);
  if (kurang.length) return tidakTerbaca({ alasan: "ANGKA_TIDAK_TERBACA", kurang, data });
  if (target && !cocokDenganUrl(data, target)) return tidakTerbaca({ alasan: "DATA_TIDAK_COCOK", data });
  return { status: "OK", data, adaItemList: true };
}

/**
 * Perlu mengambil HTML halaman yang segar? Ya bila data halaman tidak ada atau milik halaman lain
 * (Instagram berpindah halaman tanpa memuat ulang). Captcha/login/privat/angka kurang: tidak.
 */
export function perluHalamanSegar(hasil) {
  return hasil?.status === "TIDAK_TERBACA" && (hasil.alasan === undefined || hasil.alasan === "DATA_TIDAK_COCOK");
}
