// Pengurai halaman YouTube — modul MURNI (tanpa chrome.*, tanpa jaringan, waktu dari pemanggil).
// Dipakai konten.js di www.youtube.com, service worker (cek otomatis mengambil HTML halaman video
// langsung, tanpa masuk), dan tes `node --test`.
//
// Yang DIUKUR (2026-10-10):
//   - halaman kanal (`/@handle/videos`): `ytInitialData` — teks pengikut ringkas di header
//     ("46,5 jt subscriber"; bahasa Inggris "46.5M subscribers"),
//     `metadata.channelMetadataRenderer.externalId` (id kanal) dan `.vanityChannelUrl`
//     ("http://www.youtube.com/@YouTube"). Video di kanal hanya punya views ringkas — TIDAK dipakai.
//   - halaman video (`/watch?v=ID`, `/shorts/ID`): `ytInitialPlayerResponse.videoDetails`
//     (`viewCount` persis sebagai teks, `videoId`, `author`, `channelId`, `shortDescription` yang memuat
//     @handle kanal yang disebut), `microformat.playerMicroformatRenderer.publishDate` (ISO) dan
//     `.ownerProfileUrl`; like dari teks aksesibilitas tombol like ("suka video ini bersama 753 orang
//     lainnya" / "like this video along with 753 other people"); jumlah komentar di
//     `contextualInfo.runs[0].text` ("173"); promosi berbayar = `paidContentOverlay` di player response.
// Semua dibaca defensif: yang tidak ada dilewati (tidak pernah menjadi 0).

export const PLATFORM = "YOUTUBE";
export const MAKS_POSTING = 0;
const MAKS_TEKS = 500;
const MAKS_SEBUTAN = 30;
const MAKS_TAGAR = 50;
const MAKS_LABEL = 100;
const POLA_ID = /^[A-Za-z0-9_-]{11}$/;

/** SATU-SATUNYA daftar tanda halaman YouTube. BELUM diukur selain yang disebut di atas. */
export const POLA_HALAMAN = {
  CAPTCHA: { teks: ["Our systems have detected unusual traffic", "Sistem kami telah mendeteksi traffic yang tidak biasa"], jalur: ["/sorry"] },
  PERSETUJUAN: { teks: ["Before you continue to YouTube", "Sebelum Anda melanjutkan ke YouTube"] },
};

// ---------------------------------------------------------------- alamat

function urlDari(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be" ? u : null;
  } catch {
    return null;
  }
}

/** Handle kanal rapi (tanpa "@", huruf kecil), dari teks atau URL `/@handle`. "" bila tidak ada. */
export function normalHandle(masukan) {
  if (typeof masukan !== "string") return "";
  let t = masukan.trim();
  const dariUrl = /\/@([^/?#"'\s]+)/.exec(t);
  if (dariUrl) t = dariUrl[1];
  try {
    t = decodeURIComponent(t);
  } catch {
    // biarkan
  }
  t = t.replace(/^@+/, "").trim().toLowerCase();
  return t && t.length <= MAKS_LABEL && !/[\s/?#]/.test(t) ? t : "";
}

/**
 * `{ jenis: "KONTEN", videoId, bentuk: "VIDEO"|"SHORTS", handle: null }` |
 * `{ jenis: "PROFIL", handle, channelId }` (salah satunya boleh null) | null.
 */
export function jenisHalaman(url) {
  const u = urlDari(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (host === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    return id && POLA_ID.test(id) ? { jenis: "KONTEN", videoId: id, bentuk: "VIDEO", handle: null } : null;
  }
  const ruas = u.pathname.split("/").filter(Boolean);
  if (ruas[0] === "watch") {
    const id = u.searchParams.get("v");
    return id && POLA_ID.test(id) ? { jenis: "KONTEN", videoId: id, bentuk: "VIDEO", handle: null } : null;
  }
  if (/^(shorts|live)$/i.test(ruas[0] ?? "") && POLA_ID.test(ruas[1] ?? "")) {
    return { jenis: "KONTEN", videoId: ruas[1], bentuk: ruas[0].toLowerCase() === "shorts" ? "SHORTS" : "VIDEO", handle: null };
  }
  if (ruas[0]?.startsWith("@")) {
    const handle = normalHandle(ruas[0]);
    return handle ? { jenis: "PROFIL", handle, channelId: null } : null;
  }
  if (ruas[0] === "channel" && /^UC[A-Za-z0-9_-]{10,40}$/.test(ruas[1] ?? "")) return { jenis: "PROFIL", handle: null, channelId: ruas[1] };
  return null;
}

/** Alamat baku untuk diambil (cek otomatis): halaman video `watch?v=` atau `/shorts/`. */
export function urlUntukTab(url) {
  const t = jenisHalaman(typeof url === "string" ? url.trim() : "");
  if (t?.jenis !== "KONTEN") return null;
  return t.bentuk === "SHORTS" ? `https://www.youtube.com/shorts/${t.videoId}` : `https://www.youtube.com/watch?v=${t.videoId}`;
}

// ---------------------------------------------------------------- angka

/** Angka persis dari teks bertanda pemisah ribuan ("1.234", "1,234", "753"); bukan angka persis → undefined. */
export function angkaPersis(teks) {
  if (typeof teks === "number") return Number.isSafeInteger(teks) && teks >= 0 ? teks : undefined;
  if (typeof teks !== "string") return undefined;
  const t = teks.replace(/[\s\u00a0\u202f]/g, "");
  if (!/^\d{1,3}(?:[.,]\d{3})*$|^\d+$/.test(t)) return undefined;
  const n = Number(t.replace(/[.,]/g, ""));
  return Number.isSafeInteger(n) ? n : undefined;
}

const SATUAN = {
  rb: 1e3,
  ribu: 1e3,
  jt: 1e6,
  juta: 1e6,
  miliar: 1e9,
  m: null, // id: miliar, en: million
  k: 1e3,
  b: 1e9,
  mln: 1e6,
};

/**
 * Angka ringkas YouTube → `{ angka, perkiraan }` atau null. Indonesia: "46,5 jt", "1,2 rb", "3 rb",
 * "1,5 M" (miliar); Inggris: "12K", "1.2M", "1.5B". Tanpa satuan = angka persis ("987", "1.234").
 * `opsi.bahasa` ("id"/"en") memutuskan arti "M" dan pemisah desimal; tanpa itu ditebak dari teksnya.
 */
export function angkaRingkas(teks, opsi = {}) {
  if (typeof teks !== "string") return null;
  const m = /^\s*(\d+(?:[.,]\d+)*)\s*(rb|ribu|jt|juta|miliar|mln|m|k|b)?\b/i.exec(teks.replace(/[\u00a0\u202f]/g, " "));
  if (!m) return null;
  if (!m[2]) {
    const n = angkaPersis(m[1]);
    return n === undefined ? null : { angka: n, perkiraan: false };
  }
  const satuan = m[2].toLowerCase();
  let bahasa = opsi.bahasa === "id" || opsi.bahasa === "en" ? opsi.bahasa : null;
  if (!bahasa) {
    if (["rb", "ribu", "jt", "juta", "miliar"].includes(satuan)) bahasa = "id";
    else if (["k", "b", "mln"].includes(satuan)) bahasa = "en";
    else bahasa = /,\d/.test(m[1]) || /\bsubscriber\b(?!s)/i.test(teks) ? "id" : "en";
  }
  const desimal = bahasa === "id" ? "," : ".";
  const ribuan = bahasa === "id" ? "." : ",";
  const angka = Number(m[1].split(ribuan).join("").replace(desimal, "."));
  const kali = satuan === "m" ? (bahasa === "id" ? 1e9 : 1e6) : SATUAN[satuan];
  if (!Number.isFinite(angka) || !kali) return null;
  const n = Math.round(angka * kali);
  return Number.isSafeInteger(n) ? { angka: n, perkiraan: true } : null;
}

// ---------------------------------------------------------------- membaca objek JS di halaman

/** Ambil objek JSON `{...}` yang dimulai di `mulai` (penghitung kurung yang paham teks berkutip). */
function objekSeimbang(teks, mulai) {
  let d = 0;
  let dalamTeks = false;
  let lepas = false;
  for (let i = mulai; i < teks.length; i++) {
    const c = teks[i];
    if (dalamTeks) {
      if (lepas) lepas = false;
      else if (c === "\\") lepas = true;
      else if (c === '"') dalamTeks = false;
      continue;
    }
    if (c === '"') dalamTeks = true;
    else if (c === "{") d++;
    else if (c === "}" && --d === 0) return teks.slice(mulai, i + 1);
  }
  return null;
}

/** `nama = {...}` (atau `"nama": {...}`) di teks skrip → objek, atau null. */
export function ambilObjekJs(teks, nama) {
  if (typeof teks !== "string") return null;
  const pola = new RegExp(`(?:var\\s+|window\\[["']|["'])?${nama}["']?\\]?\\s*[=:]\\s*\\{`, "g");
  for (const m of teks.matchAll(pola)) {
    const isi = objekSeimbang(teks, m.index + m[0].length - 1);
    if (!isi) continue;
    try {
      return JSON.parse(isi);
    } catch {
      // coba kemunculan berikutnya
    }
  }
  return null;
}

/** Teks semua <script> (dokumen) atau HTML apa adanya. */
function teksSkrip(masukan) {
  if (typeof masukan === "string") return masukan;
  try {
    return [...(masukan?.querySelectorAll?.("script") ?? [])].map((s) => s.textContent ?? "").join("\n");
  } catch {
    return "";
  }
}

/** `{ initial, player }` — ytInitialData dan ytInitialPlayerResponse halaman, masing-masing null bila tidak ada. */
export function bacaData(masukan) {
  const t = teksSkrip(masukan);
  return { initial: ambilObjekJs(t, "ytInitialData"), player: ambilObjekJs(t, "ytInitialPlayerResponse") };
}

const objek = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

/** Telusuri nilai teks di `akar`; berhenti saat `cocok` mengembalikan selain undefined. */
function cariTeks(akar, cocok, batas = 300_000) {
  const tumpuk = [akar];
  let n = 0;
  while (tumpuk.length && n++ < batas) {
    const x = tumpuk.pop();
    if (typeof x === "string") {
      const r = cocok(x);
      if (r !== undefined) return r;
    } else if (Array.isArray(x)) for (let i = x.length - 1; i >= 0; i--) tumpuk.push(x[i]);
    else if (objek(x)) for (const v of Object.values(x).reverse()) tumpuk.push(v);
  }
  return undefined;
}

/** Telusuri objek di `akar`; berhenti saat `cocok(obj)` mengembalikan selain undefined. */
function cariObjek(akar, cocok, batas = 300_000) {
  const tumpuk = [akar];
  let n = 0;
  while (tumpuk.length && n++ < batas) {
    const x = tumpuk.pop();
    if (Array.isArray(x)) for (let i = x.length - 1; i >= 0; i--) tumpuk.push(x[i]);
    else if (objek(x)) {
      const r = cocok(x);
      if (r !== undefined) return r;
      for (const v of Object.values(x).reverse()) tumpuk.push(v);
    }
  }
  return undefined;
}

const POLA_PENGIKUT = /^\s*\d[\d.,\s\u00a0]*\s*(?:rb|ribu|jt|juta|miliar|mln|m|k|b)?\s*(?:subscriber|subscribers|pelanggan)\b/i;

/** Pengikut kanal dari teks header (`{ angka, perkiraan }`), atau null. */
export function pengikutKanal(initial, opsi = {}) {
  const ambil = (t) => (POLA_PENGIKUT.test(t) ? (angkaRingkas(t, opsi) ?? undefined) : undefined);
  return (initial?.header ? cariTeks(initial.header, ambil) : undefined) ?? cariTeks(initial, ambil) ?? null;
}

const POLA_LIKE = [/suka video ini bersama ([\d.,\s\u00a0]+) orang lainnya/i, /like this video along with ([\d.,\s\u00a0]+) other (?:people|person)/i];

/** Like dari teks aksesibilitas tombol like (terukur), cadangan `likeCountIfIndifferentNumber`. */
export function likeVideo(initial) {
  const dariTeks = cariTeks(initial, (t) => {
    for (const p of POLA_LIKE) {
      const m = p.exec(t);
      if (m) return angkaPersis(m[1].trim());
    }
    return undefined;
  });
  if (dariTeks !== undefined) return dariTeks;
  return cariObjek(initial, (o) => (typeof o.likeCountIfIndifferentNumber === "string" ? angkaPersis(o.likeCountIfIndifferentNumber) : undefined));
}

/** Jumlah komentar dari `contextualInfo.runs[0].text` (terukur "173"); teks ringkas ("1,2 rb") tidak dipakai. */
export function komentarVideo(initial) {
  return cariObjek(initial, (o) => {
    const t = o.contextualInfo?.runs?.[0]?.text ?? o.contextualInfo?.simpleText;
    return typeof t === "string" ? angkaPersis(t) : undefined;
  });
}

function tambahUnik(daftar, nilai, maks) {
  if (nilai && nilai.length <= MAKS_LABEL && daftar.length < maks && !daftar.includes(nilai)) daftar.push(nilai);
}

/** Handle kanal yang disebut di deskripsi (@handle) — bukan alamat surel. */
export function sebutanDeskripsi(teks, pemilik) {
  const hasil = [];
  for (const m of String(teks ?? "").matchAll(/(^|[^A-Za-z0-9_.@-])@([A-Za-z0-9._-]{3,30})(?![A-Za-z0-9_])/g)) {
    const h = m[2].replace(/[.-]+$/, "").toLowerCase();
    if (h !== pemilik) tambahUnik(hasil, h, MAKS_SEBUTAN);
  }
  return hasil;
}

export function tagarDeskripsi(teks) {
  const hasil = [];
  for (const m of String(teks ?? "").matchAll(/#([\p{L}\p{N}_]{1,100})/gu)) tambahUnik(hasil, m[1].toLowerCase(), MAKS_TAGAR);
  return hasil;
}

function potong(t, maks) {
  if (t.length <= maks) return t;
  const k = t.charCodeAt(maks - 1);
  return t.slice(0, k >= 0xd800 && k <= 0xdbff ? maks - 1 : maks);
}

// ---------------------------------------------------------------- hasil

export function uraiProfil(initial, opsi = {}) {
  const meta = initial?.metadata?.channelMetadataRenderer ?? {};
  const hasil = { platform: PLATFORM, jenis: "PROFIL" };
  const handle = normalHandle(typeof meta.vanityChannelUrl === "string" ? meta.vanityChannelUrl : "") || normalHandle(meta.ownerUrls?.find?.((u) => /\/@/.test(u)) ?? "");
  if (handle) hasil.uniqueId = handle;
  if (typeof meta.externalId === "string" && /^UC[A-Za-z0-9_-]{10,40}$/.test(meta.externalId)) hasil.idPlatform = meta.externalId;
  const p = pengikutKanal(initial, opsi);
  if (p) {
    hasil.pengikut = p.angka;
    if (p.perkiraan) hasil.pengikutPerkiraan = true;
  }
  // Video di halaman kanal hanya membawa views ringkas: tidak dikirim (angka per video dibaca dari halamannya).
  hasil.posting = [];
  return hasil;
}

export function uraiKonten(player, initial) {
  const d = player?.videoDetails ?? {};
  const mf = player?.microformat?.playerMicroformatRenderer ?? {};
  const hasil = { platform: PLATFORM, jenis: "KONTEN" };
  if (typeof d.videoId === "string" && POLA_ID.test(d.videoId)) hasil.videoId = d.videoId;
  const pemilik = normalHandle(typeof mf.ownerProfileUrl === "string" ? mf.ownerProfileUrl : "");
  if (pemilik) {
    hasil.uniqueId = pemilik;
    hasil.penulis = pemilik;
  }
  const views = angkaPersis(d.viewCount);
  if (views !== undefined) hasil.views = views;
  const like = likeVideo(initial);
  if (like !== undefined) hasil.like = like;
  const komentar = komentarVideo(initial);
  if (komentar !== undefined) hasil.komentar = komentar;
  const terbit = typeof mf.publishDate === "string" ? Date.parse(mf.publishDate) : NaN;
  if (Number.isFinite(terbit) && terbit > 0) hasil.dibuatPada = Math.floor(terbit / 1000);
  const deskripsi = typeof d.shortDescription === "string" ? d.shortDescription : null;
  if (deskripsi !== null) {
    if (deskripsi.trim()) hasil.teks = potong(deskripsi.trim(), MAKS_TEKS);
    hasil.sebutan = sebutanDeskripsi(deskripsi, pemilik);
    hasil.tagar = tagarDeskripsi(deskripsi);
  }
  if (player?.paidContentOverlay) hasil.iklan = true;
  return hasil;
}

const WAJIB = { PROFIL: ["uniqueId", "pengikut"], KONTEN: ["videoId", "uniqueId", "views"] };

export function kurangWajib(hasil) {
  const wajib = WAJIB[hasil?.jenis];
  if (!wajib) return ["jenis"];
  const kurang = wajib.filter((k) => hasil[k] === undefined);
  if (hasil.jenis === "PROFIL" && !Array.isArray(hasil.posting)) kurang.push("posting");
  return kurang;
}

export function cocokDenganUrl(hasil, target) {
  if (!hasil || !target || hasil.jenis !== target.jenis) return false;
  if (target.jenis === "KONTEN") return hasil.videoId === target.videoId;
  if (target.handle) return hasil.uniqueId === target.handle;
  return Boolean(target.channelId) && hasil.idPlatform === target.channelId;
}

const rapikan = (t) =>
  String(t ?? "")
    .replace(/\s+/g, " ")
    .toLowerCase();

function teksTampil(masukan) {
  if (typeof masukan === "string") return masukan.replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ").replace(/<[^>]+>/g, " ");
  const b = masukan?.body;
  return typeof b?.innerText === "string" ? b.innerText : (b?.textContent ?? "");
}

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

function bahasaDari(masukan, opsi) {
  if (opsi.bahasa) return opsi.bahasa;
  const lang = typeof masukan === "string" ? /<html\b[^>]*\blang=["']([a-z]{2})/i.exec(masukan)?.[1] : masukan?.documentElement?.lang;
  const b = String(lang ?? "").slice(0, 2).toLowerCase();
  return b === "id" || b === "en" ? b : undefined;
}

/** Ringkasan isi halaman saat angkanya tidak terbaca (tanpa angka, tanpa isi halaman). */
export function diagnosaHalaman(masukan, data) {
  const html = typeof masukan === "string" ? masukan : "";
  const ciri = [`ytInitialData: ${data.initial ? "ada" : "tidak"}`, `ytInitialPlayerResponse: ${data.player ? "ada" : "tidak"}`];
  const status = data.player?.playabilityStatus?.status;
  if (status) ciri.push(`playability: ${String(status).slice(0, 30)}`);
  const judul = typeof masukan === "string" ? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(masukan)?.[1] : masukan?.title;
  if (judul) ciri.push(`judul: ${String(judul).trim().slice(0, 60)}`);
  if (html) ciri.push(`html: ${html.length} b`);
  return ciri.join("; ").slice(0, 400);
}

/**
 * Baca satu halaman YouTube menjadi hasil siap kirim (bentuk sama dengan pengurai TikTok).
 * `opsi.url` = alamat halaman; `opsi.bahasa` = "id"/"en" (arti "M" pada angka ringkas).
 */
export function bacaHalaman(masukan, opsi = {}) {
  const target = typeof opsi.url === "string" ? jenisHalaman(opsi.url) : null;
  const data = bacaData(masukan);
  const teks = rapikan(teksTampil(masukan));
  const jalur = jalurDari(masukan, opsi);
  const tidakTerbaca = (lain = {}) => ({ status: "TIDAK_TERBACA", diagnosa: diagnosaHalaman(masukan, data), tanpaSkrip: !data.initial && !data.player, ...lain });

  if (POLA_HALAMAN.CAPTCHA.jalur.some((j) => jalur.startsWith(j)) || POLA_HALAMAN.CAPTCHA.teks.some((t) => teks.includes(rapikan(t)))) return { status: "CAPTCHA" };
  if (!data.initial && !data.player && POLA_HALAMAN.PERSETUJUAN.teks.some((t) => teks.includes(rapikan(t)))) {
    return tidakTerbaca({ diagnosa: "halaman persetujuan kuki YouTube" });
  }

  const jenis = target?.jenis ?? (data.player?.videoDetails ? "KONTEN" : "PROFIL");
  if (jenis === "KONTEN") {
    const ps = data.player?.playabilityStatus?.status;
    if (ps === "ERROR") return { status: "TIDAK_DITEMUKAN" };
    if (ps === "LOGIN_REQUIRED" && !data.player?.videoDetails?.viewCount) return { status: "PRIVAT" };
    if (!data.player) return tidakTerbaca();
    const hasil = uraiKonten(data.player, data.initial);
    if (!hasil.bentuk && target?.bentuk === "SHORTS") hasil.bentuk = "SHORTS";
    const kurang = kurangWajib(hasil);
    if (target && hasil.videoId && hasil.videoId !== target.videoId) return tidakTerbaca({ alasan: "DATA_TIDAK_COCOK", data: hasil });
    if (kurang.length) return tidakTerbaca({ alasan: "ANGKA_TIDAK_TERBACA", kurang, data: hasil });
    return { status: "OK", data: hasil, adaItemList: true };
  }

  if (!data.initial) return tidakTerbaca();
  const hasil = uraiProfil(data.initial, { bahasa: bahasaDari(masukan, opsi) });
  const kurang = kurangWajib(hasil);
  if (target && hasil.uniqueId && !cocokDenganUrl(hasil, target)) return tidakTerbaca({ alasan: "DATA_TIDAK_COCOK", data: hasil });
  if (kurang.length) return tidakTerbaca({ alasan: "ANGKA_TIDAK_TERBACA", kurang, data: hasil });
  return { status: "OK", data: hasil, adaItemList: true };
}

/** Perlu mengambil HTML halaman yang segar? (YouTube berpindah halaman tanpa memuat ulang.) */
export function perluHalamanSegar(hasil) {
  return hasil?.status === "TIDAK_TERBACA" && (hasil.alasan === undefined || hasil.alasan === "DATA_TIDAK_COCOK");
}
