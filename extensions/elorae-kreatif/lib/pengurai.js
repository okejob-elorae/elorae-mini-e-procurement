// Pengurai halaman TikTok — modul MURNI: tidak memanggil chrome.*, tidak menyentuh jaringan,
// tidak membaca jam sendiri (waktu selalu dari pemanggil). Dipakai skrip halaman (lewat
// import() dinamis), service worker, dan tes `node --test`.
//
// Aturan tetap: angka yang tidak terbaca TIDAK PERNAH menjadi 0. Kolomnya dibiarkan tidak
// ada; `kurangWajib` menyebut kolom wajib yang hilang dan pemanggil melapor TIDAK_TERBACA.

export const ID_SKRIP_REHIDRASI = "__UNIVERSAL_DATA_FOR_REHYDRATION__";
export const KUNCI_PROFIL = "webapp.user-detail";
export const KUNCI_KONTEN = "webapp.video-detail";
/** Sama dengan POLA di halaman-utama.js (skrip dunia MAIN tidak bisa mengimpor modul ini). */
export const POLA_URL_ITEM_LIST = "/api/post/item_list/";
/** Batas posting yang dikirim per profil (server hanya memakai ≤ 12 terakhir yang sah). */
export const MAKS_POSTING = 200;

/**
 * SATU-SATUNYA daftar tanda halaman. Perbarui di sini saja bila TikTok mengubah halamannya.
 * - `selektor`: hanya bentuk `#id`, `.kelas`, atau `[atribut="nilai"]` (tes menjaga bentuknya),
 *   karena untuk masukan teks HTML selektor dicocokkan dengan pola sederhana.
 * - `teks`: dicari di teks yang tampil (bukan di dalam <script>/<style>), tanpa memandang
 *   huruf besar/kecil; tanda kutip lengkung disamakan dengan kutip lurus.
 * - `kodeStatus`: `statusCode` di data rehidrasi. PERLU DICEK di mesin pemilik — nilai ini
 *   dikumpulkan dari catatan publik, bukan dari dokumentasi resmi TikTok.
 */
export const POLA_HALAMAN = {
  CAPTCHA: {
    selektor: [
      "#captcha-verify-container",
      "#captcha-verify-container-main-page",
      "#captcha_container",
      "#tiktok-verify-ele",
      ".captcha-verify-container",
      ".captcha_verify_container",
      ".secsdk-captcha-drag-icon",
    ],
    teks: [
      "Verify to continue",
      "Drag the slider to fit the puzzle",
      "Select 2 objects that are the same shape",
      "Verifikasi untuk melanjutkan",
      "Seret penggeser agar sesuai dengan puzzle",
      "Geser untuk menyelesaikan puzzle",
    ],
  },
  LOGIN: {
    selektor: ['[data-e2e="login-modal"]', "#login-modal", "#loginContainer"],
    teks: ["Log in to TikTok", "Masuk ke TikTok"],
    jalur: ["/login"],
  },
  TIDAK_DITEMUKAN: {
    teks: [
      "Couldn't find this account",
      "Akun ini tidak ditemukan",
      "Tidak dapat menemukan akun ini",
      "Video currently unavailable",
      "This video is unavailable",
      "Video saat ini tidak tersedia",
      "Video ini tidak tersedia",
    ],
    kodeStatus: [10202, 10221, 10204],
  },
  PRIVAT: {
    teks: [
      "This account is private",
      "Akun ini bersifat pribadi",
      "Akun ini privat",
      "This video is private",
      "Video ini privat",
    ],
  },
};

// ---------------------------------------------------------------- angka

/** Bulat ≥ 0 yang aman dari angka atau teks digit; selain itu `undefined` (BUKAN 0). */
export function angkaBulat(nilai) {
  if (typeof nilai === "number") {
    return Number.isSafeInteger(nilai) && nilai >= 0 ? nilai : undefined;
  }
  if (typeof nilai === "string") {
    const t = nilai.trim();
    if (!/^\d+$/.test(t)) return undefined;
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  return undefined;
}

function nolBelakang(n) {
  if (n === 0) return 0;
  let jumlah = 0;
  while (n % 10 === 0) {
    n /= 10;
    jumlah++;
  }
  return jumlah;
}

/**
 * Pilih satu angka dari beberapa calon (urutan = prioritas bila seri; `statsV2` didahulukan).
 * Bila calon berbeda, menang yang angka pentingnya paling banyak (nol di belakang paling
 * sedikit — 1.234.567 mengalahkan 1.200.000), dan 0 kalah dari angka lain (0 adalah nilai
 * "tidak tahu" yang lazim). Tak satu pun terbaca → `undefined`.
 */
export function pilihAngka(...calon) {
  const sah = calon.map(angkaBulat).filter((v) => v !== undefined);
  if (sah.length === 0) return undefined;
  let terbaik = sah[0];
  for (const v of sah.slice(1)) {
    if (v === terbaik) continue;
    if (terbaik === 0) {
      terbaik = v;
      continue;
    }
    if (v !== 0 && nolBelakang(v) < nolBelakang(terbaik)) terbaik = v;
  }
  return terbaik;
}

function teksSah(v) {
  return typeof v === "string" && v.trim() !== "";
}

/** ID TikTok selalu teks digit (melebihi batas bilangan aman JS); angka JSON sudah rusak. */
function idSah(v) {
  return typeof v === "string" && /^\d{1,30}$/.test(v);
}

function pasang(obj, kunci, nilai) {
  if (nilai !== undefined) obj[kunci] = nilai;
}

// ---------------------------------------------------------------- alamat & handle

/** Handle TikTok untuk dibandingkan: tanpa "@", tanpa spasi, huruf kecil. Bisa dari link. */
export function normalHandle(masukan) {
  if (typeof masukan !== "string") return "";
  let t = masukan.trim();
  const dariLink = /tiktok\.com\/@([^/?#\s]+)/i.exec(t);
  if (dariLink) t = dariLink[1];
  try {
    t = decodeURIComponent(t);
  } catch {
    // biarkan apa adanya
  }
  t = t.replace(/^@+/, "").trim().toLowerCase();
  if (/[\s/?#]/.test(t)) return "";
  return t;
}

/** `{jenis:"PROFIL", handle}` | `{jenis:"KONTEN", handle, videoId}` | null. */
export function jenisHalaman(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)tiktok\.com$/i.test(u.hostname)) return null;
  const m = /^\/@([^/]+)\/?(?:(?:video|photo)\/(\d+)\/?)?$/i.exec(u.pathname);
  if (!m) return null;
  const handle = normalHandle("@" + m[1]);
  if (!handle) return null;
  return m[2] ? { jenis: "KONTEN", handle, videoId: m[2] } : { jenis: "PROFIL", handle };
}

/**
 * Alamat tugas dari Elorae → URL https yang aman dibuka di tab, atau null. Elorae mengirim link
 * konten apa adanya (bisa tanpa "www", tanpa skema, atau tautan pendek vt.tiktok.com); TikTok
 * sendiri yang mengalihkannya ke www.tiktok.com. Hanya tiktok.com dan subdomainnya.
 */
export function urlTugasSah(url) {
  if (typeof url !== "string") return null;
  const t = url.trim();
  if (!t) return null;
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  if (host !== "tiktok.com" && !host.endsWith(".tiktok.com")) return null;
  u.protocol = "https:";
  return u.href;
}

export function apakahUrlItemList(url) {
  return typeof url === "string" && url.includes(POLA_URL_ITEM_LIST);
}

function secUidDariUrl(url) {
  try {
    return new URL(url, "https://www.tiktok.com/").searchParams.get("secUid") || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- membaca halaman

function apakahDokumen(masukan) {
  return masukan !== null && typeof masukan === "object";
}

/** Isi <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"> dari dokumen atau teks HTML. */
export function ambilTeksRehidrasi(masukan) {
  if (typeof masukan === "string") {
    const m = new RegExp(
      `<script\\b[^>]*\\bid\\s*=\\s*["']${ID_SKRIP_REHIDRASI}["'][^>]*>([\\s\\S]*?)<\\/script>`,
      "i",
    ).exec(masukan);
    return m ? m[1] : null;
  }
  if (!apakahDokumen(masukan)) return null;
  let el = null;
  try {
    el = masukan.getElementById?.(ID_SKRIP_REHIDRASI) ?? masukan.querySelector?.("#" + ID_SKRIP_REHIDRASI) ?? null;
  } catch {
    el = null;
  }
  return typeof el?.textContent === "string" ? el.textContent : null;
}

/** Objek `__DEFAULT_SCOPE__` atau null bila tidak ada/rusak. */
export function bacaLingkup(masukan) {
  const teks = ambilTeksRehidrasi(masukan);
  if (!teks) return null;
  try {
    const data = JSON.parse(teks);
    const lingkup = data?.__DEFAULT_SCOPE__;
    return lingkup && typeof lingkup === "object" ? lingkup : null;
  } catch {
    return null;
  }
}

const ENTITAS = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function teksDariHtml(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (asli, nama) => ENTITAS[nama.toLowerCase()] ?? asli);
}

function rapikanTeks(t) {
  return String(t ?? "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function esc(t) {
  return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cocokSelektorHtml(html, sel) {
  let m;
  if ((m = /^#([\w-]+)$/.exec(sel))) {
    return new RegExp(`\\bid\\s*=\\s*["']${esc(m[1])}["']`, "i").test(html);
  }
  if ((m = /^\.([\w-]+)$/.exec(sel))) {
    return new RegExp(`\\bclass\\s*=\\s*["'](?:[^"']*\\s)?${esc(m[1])}(?:\\s[^"']*)?["']`, "i").test(html);
  }
  if ((m = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel))) {
    return new RegExp(`\\b${esc(m[1])}\\s*=\\s*["']${esc(m[2])}["']`, "i").test(html);
  }
  return false;
}

/** Teks tampil + pencocok selektor + jalur URL, sama bentuknya untuk dokumen dan teks HTML. */
function bacaSinyal(masukan, opsi) {
  let jalur = "";
  const url = opsi?.url;
  if (typeof url === "string") {
    try {
      jalur = new URL(url).pathname;
    } catch {
      jalur = "";
    }
  }
  if (typeof masukan === "string") {
    const tanpaSkrip = masukan.replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ");
    return {
      teks: rapikanTeks(teksDariHtml(masukan)),
      cocok: (sel) => cocokSelektorHtml(tanpaSkrip, sel),
      jalur,
    };
  }
  if (!apakahDokumen(masukan)) return { teks: "", cocok: () => false, jalur };
  const badan = masukan.body;
  const teks = typeof badan?.innerText === "string" ? badan.innerText : (badan?.textContent ?? "");
  if (!jalur && typeof masukan.location?.pathname === "string") jalur = masukan.location.pathname;
  return {
    teks: rapikanTeks(teks),
    cocok: (sel) => {
      try {
        const el = masukan.querySelector?.(sel);
        // Wadah yang disembunyikan (display:none) tidak dihitung: TikTok bisa saja menyiapkan
        // wadah captcha kosong di DOM tanpa menampilkannya.
        return Boolean(el) && (typeof el.getClientRects !== "function" || el.getClientRects().length > 0);
      } catch {
        return false;
      }
    },
    jalur,
  };
}

function adaPola(sinyal, pola) {
  if ((pola.selektor ?? []).some((sel) => sinyal.cocok(sel))) return true;
  if ((pola.teks ?? []).some((t) => sinyal.teks.includes(rapikanTeks(t)))) return true;
  if ((pola.jalur ?? []).some((j) => sinyal.jalur === j || sinyal.jalur.startsWith(j + "/"))) return true;
  return false;
}

function kodeTidakDitemukan(kode) {
  return POLA_HALAMAN.TIDAK_DITEMUKAN.kodeStatus.includes(Number(kode));
}

/** Penilaian dari data rehidrasi saja: "OK" | "PRIVAT" | "TIDAK_DITEMUKAN" | null. */
function nilaiData(lingkup) {
  if (!lingkup) return null;
  const profil = lingkup[KUNCI_PROFIL];
  if (profil && typeof profil === "object") {
    const user = profil.userInfo?.user;
    if (user?.privateAccount === true) return "PRIVAT";
    if (kodeTidakDitemukan(profil.statusCode)) return "TIDAK_DITEMUKAN";
    if (teksSah(user?.uniqueId) && (profil.statusCode ?? 0) === 0) return "OK";
  }
  const konten = lingkup[KUNCI_KONTEN];
  if (konten && typeof konten === "object") {
    const item = konten.itemInfo?.itemStruct;
    if (item?.privateItem === true) return "PRIVAT";
    if (kodeTidakDitemukan(konten.statusCode)) return "TIDAK_DITEMUKAN";
    if (idSah(item?.id) && (konten.statusCode ?? 0) === 0) return "OK";
  }
  return null;
}

/**
 * Keadaan halaman TikTok: "CAPTCHA" | "LOGIN" | "TIDAK_DITEMUKAN" | "PRIVAT" | "OK" | "TIDAK_TERBACA".
 * `masukan` = dokumen (punya querySelector/getElementById/body.innerText) atau teks HTML.
 * `opsi.url` (opsional) dipakai untuk mengenali jalur /login.
 * Urutan: captcha selalu menang; data yang terbaca menang atas tembok login (TikTok sering
 * menampilkan ajakan masuk di atas halaman yang datanya tetap ada).
 */
export function deteksiHalaman(masukan, opsi = {}) {
  const sinyal = bacaSinyal(masukan, opsi);
  if (adaPola(sinyal, POLA_HALAMAN.CAPTCHA)) return "CAPTCHA";
  const dariData = nilaiData(bacaLingkup(masukan));
  if (dariData) return dariData;
  if (adaPola(sinyal, POLA_HALAMAN.PRIVAT)) return "PRIVAT";
  if (adaPola(sinyal, POLA_HALAMAN.TIDAK_DITEMUKAN)) return "TIDAK_DITEMUKAN";
  if (adaPola(sinyal, POLA_HALAMAN.LOGIN)) return "LOGIN";
  return "TIDAK_TERBACA";
}

// ---------------------------------------------------------------- HasilProfil / HasilKonten

/** Satu butir video (item_list atau itemList halaman) → posting, atau null bila ada yang tak terbaca. */
export function postingDariItem(item) {
  if (!item || typeof item !== "object" || !idSah(item.id)) return null;
  const s = item.stats ?? {};
  const v2 = item.statsV2 ?? {};
  const dibuatPada = angkaBulat(item.createTime);
  const posting = {
    id: item.id,
    dibuatPada,
    disematkan: item.isPinned === true,
    views: pilihAngka(v2.playCount, s.playCount),
    like: pilihAngka(v2.diggCount, s.diggCount),
    komentar: pilihAngka(v2.commentCount, s.commentCount),
    share: pilihAngka(v2.shareCount, s.shareCount),
    save: pilihAngka(v2.collectCount, s.collectCount),
  };
  if (!dibuatPada) return null;
  for (const k of ["views", "like", "komentar", "share", "save"]) {
    if (posting[k] === undefined) return null;
  }
  return posting;
}

/** Gabungkan daftar posting: id ganda diambil yang pertama; urut terbaru dulu; dibatasi MAKS_POSTING. */
export function gabungPosting(...daftar) {
  const terlihat = new Map();
  for (const satu of daftar) {
    for (const x of satu ?? []) {
      if (x && !terlihat.has(x.id)) terlihat.set(x.id, x);
    }
  }
  return [...terlihat.values()].sort((a, b) => b.dibuatPada - a.dibuatPada).slice(0, MAKS_POSTING);
}

function penulisItem(item) {
  const a = item?.author;
  if (typeof a === "string") return a;
  return typeof a?.uniqueId === "string" ? a.uniqueId : null;
}

/** Badan respons /api/post/item_list/ → posting yang terbaca penuh saja. */
export function uraiItemList(body) {
  const daftar = Array.isArray(body?.itemList) ? body.itemList : [];
  return gabungPosting(daftar.map(postingDariItem).filter(Boolean));
}

/**
 * Ringkas satu tangkapan item_list agar badan mentahnya (bisa ratusan KB) tidak perlu disimpan:
 * `{ url, secUid, butir: [{ penulis, posting }] }`.
 */
export function ringkasItemList(url, body) {
  const daftar = Array.isArray(body?.itemList) ? body.itemList : [];
  const butir = [];
  for (const item of daftar) {
    const posting = postingDariItem(item);
    if (posting) butir.push({ penulis: penulisItem(item), posting });
  }
  return { url, secUid: secUidDariUrl(url), butir };
}

export function uraiProfil(lingkup) {
  const bagian = lingkup?.[KUNCI_PROFIL] ?? {};
  const info = bagian.userInfo ?? {};
  const user = info.user ?? {};
  const s = info.stats ?? {};
  const v2 = info.statsV2 ?? {};
  const hasil = { jenis: "PROFIL" };
  if (teksSah(user.uniqueId)) hasil.uniqueId = user.uniqueId;
  if (teksSah(user.secUid)) hasil.secUid = user.secUid;
  pasang(hasil, "pengikut", pilihAngka(v2.followerCount, s.followerCount));
  pasang(hasil, "totalLike", pilihAngka(v2.heartCount, s.heartCount) ?? pilihAngka(v2.heart, s.heart));
  pasang(hasil, "jumlahVideo", pilihAngka(v2.videoCount, s.videoCount));
  const tertanam = [info.itemList, bagian.itemList].find(Array.isArray) ?? [];
  hasil.posting = gabungPosting(tertanam.map(postingDariItem).filter(Boolean));
  return hasil;
}

export function uraiKonten(lingkup) {
  const item = lingkup?.[KUNCI_KONTEN]?.itemInfo?.itemStruct ?? {};
  const s = item.stats ?? {};
  const v2 = item.statsV2 ?? {};
  const hasil = { jenis: "KONTEN" };
  if (idSah(item.id)) hasil.videoId = item.id;
  const penulis = penulisItem(item);
  if (teksSah(penulis)) hasil.uniqueId = penulis;
  pasang(hasil, "views", pilihAngka(v2.playCount, s.playCount));
  pasang(hasil, "like", pilihAngka(v2.diggCount, s.diggCount));
  pasang(hasil, "komentar", pilihAngka(v2.commentCount, s.commentCount));
  pasang(hasil, "share", pilihAngka(v2.shareCount, s.shareCount));
  pasang(hasil, "save", pilihAngka(v2.collectCount, s.collectCount));
  const dibuatPada = angkaBulat(item.createTime);
  if (dibuatPada) hasil.dibuatPada = dibuatPada;
  return hasil;
}

const WAJIB = {
  PROFIL: ["uniqueId", "pengikut"],
  KONTEN: ["videoId", "uniqueId", "views", "like", "komentar", "share", "save"],
};

/** Nama kolom wajib yang tidak ada (urutan tetap). */
export function kurangWajib(hasil) {
  const wajib = WAJIB[hasil?.jenis];
  if (!wajib) return ["jenis"];
  const kurang = wajib.filter((k) => hasil[k] === undefined);
  if (hasil.jenis === "PROFIL" && !Array.isArray(hasil.posting)) kurang.push("posting");
  return kurang;
}

/** Data yang terbaca memang milik halaman pada `target` (dari jenisHalaman)? */
export function cocokDenganUrl(hasil, target) {
  if (!hasil || !target || hasil.jenis !== target.jenis) return false;
  if (target.jenis === "KONTEN") return hasil.videoId === target.videoId;
  return normalHandle(hasil.uniqueId) === target.handle;
}

function postingDariTangkapan(tangkapan, profil) {
  const hasil = [];
  let ada = false;
  for (const t of tangkapan ?? []) {
    if (!t || !apakahUrlItemList(t.url)) continue;
    const r = Array.isArray(t.butir) ? t : ringkasItemList(t.url, t.body);
    let butir;
    if (r.secUid && profil.secUid) {
      if (r.secUid !== profil.secUid) continue;
      butir = r.butir;
    } else {
      const handle = normalHandle(profil.uniqueId);
      butir = r.butir.filter((b) => !b.penulis || normalHandle(b.penulis) === handle);
      if (r.butir.length > 0 && butir.length === 0) continue;
    }
    ada = true;
    hasil.push(butir.map((b) => b.posting));
  }
  return { ada, posting: gabungPosting(...hasil) };
}

/**
 * Baca satu halaman menjadi hasil siap kirim.
 * `opsi.url` = alamat halaman saat ini (untuk menolak data lama setelah navigasi tanpa muat
 * ulang), `opsi.itemList` = tangkapan `{ url, body }` atau ringkasannya (`ringkasItemList`).
 * Hasil: `{ status: "OK", data, adaItemList }` | `{ status: "TIDAK_TERBACA", alasan, kurang?, data? }`
 * | `{ status }` untuk CAPTCHA/LOGIN/PRIVAT/TIDAK_DITEMUKAN. `data` hanya boleh dikirim bila OK.
 */
export function bacaHalaman(masukan, opsi = {}) {
  const status = deteksiHalaman(masukan, opsi);
  if (status === "TIDAK_TERBACA") return { status, diagnosa: diagnosaHalaman(masukan) };
  if (status !== "OK") return { status };
  const lingkup = bacaLingkup(masukan);
  const target = typeof opsi.url === "string" ? jenisHalaman(opsi.url) : null;
  const jenis = target?.jenis ?? (lingkup?.[KUNCI_KONTEN] ? "KONTEN" : "PROFIL");
  const kunci = jenis === "PROFIL" ? KUNCI_PROFIL : KUNCI_KONTEN;
  if (!lingkup?.[kunci]) return { status: "TIDAK_TERBACA", alasan: "DATA_TIDAK_COCOK" };

  const data = jenis === "PROFIL" ? uraiProfil(lingkup) : uraiKonten(lingkup);
  let adaItemList = false;
  if (jenis === "PROFIL") {
    const dariTangkapan = postingDariTangkapan(opsi.itemList, data);
    adaItemList = dariTangkapan.ada;
    data.posting = gabungPosting(dariTangkapan.posting, data.posting);
  }
  const kurang = kurangWajib(data);
  if (kurang.length > 0) return { status: "TIDAK_TERBACA", alasan: "ANGKA_TIDAK_TERBACA", kurang, data };
  if (target && !cocokDenganUrl(data, target)) return { status: "TIDAK_TERBACA", alasan: "DATA_TIDAK_COCOK", data };
  return { status: "OK", data, adaItemList };
}

/**
 * Ringkasan singkat isi halaman saat angkanya tidak terbaca — dikirim bersama laporan masalah
 * supaya penyebabnya terlihat di Elorae (Kreatif → Pemantauan). Tidak memuat angka atau teks halaman:
 * hanya ada/tidaknya skrip data, kunci bagian datanya, dan kode status TikTok.
 */
export function diagnosaHalaman(masukan) {
  const teks = ambilTeksRehidrasi(masukan);
  if (!teks) return "skrip data tidak ada";
  const lingkup = bacaLingkup(masukan);
  if (!lingkup) return "skrip data tidak terbaca";
  const bagian = [`kunci: ${Object.keys(lingkup).slice(0, 12).join(",") || "-"}`];
  for (const k of [KUNCI_PROFIL, KUNCI_KONTEN]) {
    const b = lingkup[k];
    if (b && typeof b === "object") {
      const item = b.itemInfo?.itemStruct;
      bagian.push(`${k}: statusCode=${b.statusCode ?? "-"}${k === KUNCI_KONTEN ? ` item=${item ? "ada" : "tidak"}` : ` user=${b.userInfo?.user ? "ada" : "tidak"}`}`);
    }
  }
  return bagian.join("; ").slice(0, 400);
}

/**
 * Perlu mengambil HTML halaman yang segar? Ya bila data halaman tidak ada atau milik halaman lain —
 * terjadi saat TikTok berpindah halaman tanpa memuat ulang (klik dari beranda ke profil): skrip
 * rehidrasi masih milik halaman pertama. Captcha/login/privat/tidak ditemukan/angka kurang: tidak.
 */
export function perluHalamanSegar(hasil) {
  return hasil?.status === "TIDAK_TERBACA" && (hasil.alasan === undefined || hasil.alasan === "DATA_TIDAK_COCOK");
}

// ---------------------------------------------------------------- waktu

/** Bulat acak dalam [min, max] (inklusif). `rand` mengembalikan [0, 1); dijepit bila tidak. */
export function jedaAcak(min, max, rand = Math.random) {
  let a = Number(min);
  let b = Number(max);
  if (!Number.isFinite(a)) a = 0;
  if (!Number.isFinite(b)) b = a;
  if (a > b) [a, b] = [b, a];
  a = Math.ceil(a);
  b = Math.floor(b);
  if (b <= a) return a;
  let r = Number(rand());
  if (!Number.isFinite(r) || r < 0) r = 0;
  if (r >= 1) r = 0.999999999;
  return a + Math.floor(r * (b - a + 1));
}

const WIB_MENIT = 7 * 60;

function menitDariJam(jam) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(typeof jam === "string" ? jam.trim() : "");
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (mm > 59 || h > 24 || (h === 24 && mm > 0)) return null;
  return h * 60 + mm;
}

/** Menit sejak tengah malam WIB (UTC+7, tanpa musim panas). */
export function menitWib(waktu) {
  const ms = waktu instanceof Date ? waktu.getTime() : Number(waktu);
  if (!Number.isFinite(ms)) return null;
  const menit = Math.floor(ms / 60000) + WIB_MENIT;
  return ((menit % 1440) + 1440) % 1440;
}

/** Apakah `sekarang` (Date atau ms) di dalam jam kerja WIB [mulai, selesai). Ragu → false. */
export function dalamJamKerja(sekarang, mulai, selesai) {
  const m = menitDariJam(mulai);
  const s = menitDariJam(selesai);
  const t = menitWib(sekarang);
  if (m === null || s === null || t === null || m === s) return false;
  return m < s ? t >= m && t < s : t >= m || t < s;
}
