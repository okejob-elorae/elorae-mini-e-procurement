// Skrip konten dunia ISOLATED di www.tiktok.com, www.instagram.com, dan www.youtube.com
// (document_start; Instagram/YouTube sejak v0.11.0 — pengurainya lib/pengurai-instagram.js dan
// lib/pengurai-youtube.js, bentuk ekspornya sama dengan lib/pengurai.js).
// - menampung daftar video yang ditangkap halaman-utama.js (TikTok) / halaman-utama-instagram.js
//   (Instagram, pengguna yang sudah masuk) lewat postMessage, sumber divalidasi;
// - menjawab permintaan "bacaHalaman" dari service worker (putaran otomatis);
// - mode manual: panel kecil di kanan bawah halaman profil/video dengan tombol "Simpan ke Elorae",
//   TIDAK ditampilkan di tab latar yang dibuka putaran otomatis;
// - kiriman otomatis (v0.10.0): begitu panel selesai membaca profil (dengan daftar videonya) atau
//   video, pembacaan itu dikirim sendiri ke Elorae lewat service worker (POST /otomatis). Syarat
//   dan batas 6 jam per akun/video diputuskan lib/aturan.js; sakelarnya di popup.
// Skrip klasik: lib/pengurai.js dimuat dengan import() dinamis (terdaftar di
// web_accessible_resources khusus www.tiktok.com).
(() => {
  "use strict";
  if (window.top !== window) return;
  if (globalThis.__eloraeKreatifKonten) return;
  globalThis.__eloraeKreatifKonten = true;

  const PLATFORM = { "www.tiktok.com": "TIKTOK", "www.instagram.com": "INSTAGRAM", "www.youtube.com": "YOUTUBE" }[location.hostname];
  if (!PLATFORM) return;
  const LABEL_PLATFORM = { TIKTOK: "TikTok", INSTAGRAM: "Instagram", YOUTUBE: "YouTube" }[PLATFORM];
  // Pengurai per platform (bentuk ekspor sama). Ditulis lengkap supaya tes manifest melihat setiap berkas.
  const MUAT_PENGURAI = {
    TIKTOK: () => import(chrome.runtime.getURL("lib/pengurai.js")),
    INSTAGRAM: () => import(chrome.runtime.getURL("lib/pengurai-instagram.js")),
    YOUTUBE: () => import(chrome.runtime.getURL("lib/pengurai-youtube.js")),
  };

  // Sama dengan TAG di halaman-utama.js.
  const TAG = "elorae-kreatif:item-list:v1";
  // Sama dengan TAG di halaman-utama-instagram.js.
  const TAG_IG = "elorae-kreatif:ig-tangkap:v1";
  // Sama dengan ID_SKRIP_REHIDRASI di lib/pengurai.js (dibutuhkan sebelum modul selesai dimuat).
  const ID_REHIDRASI = "__UNIVERSAL_DATA_FOR_REHYDRATION__";
  const MAKS_TANGKAPAN = 30;

  /** Tangkapan daftar video/posting: badan mentah sampai pengurai siap, sesudahnya ringkasannya saja. */
  const tangkapan = [];
  let pengurai = null;
  const ringkasTangkapan = (m, url, body) => (PLATFORM === "INSTAGRAM" ? m.ringkasTangkapan(url, body) : m.ringkasItemList(url, body));
  const muatPengurai = MUAT_PENGURAI[PLATFORM]().then((m) => {
    pengurai = m;
    for (let i = 0; i < tangkapan.length; i++) {
      if (tangkapan[i].body) tangkapan[i] = ringkasTangkapan(m, tangkapan[i].url, tangkapan[i].body);
    }
    return m;
  });

  // ------------------------------------------------ data rehidrasi (disalin sedini mungkin)
  // Disimpan salinannya kalau-kalau TikTok membuang skrip itu dari DOM setelah hidrasi.
  let teksRehidrasi = null;
  function salinRehidrasi() {
    const el = document.getElementById(ID_REHIDRASI);
    if (el && el.textContent) teksRehidrasi = el.textContent;
  }
  if (PLATFORM !== "TIKTOK") {
    // Instagram/YouTube tidak memakai skrip rehidrasi TikTok.
  } else if (document.readyState === "loading") {
    const pengamat = new MutationObserver(salinRehidrasi);
    pengamat.observe(document, { childList: true, subtree: true });
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        salinRehidrasi();
        pengamat.disconnect();
      },
      { once: true },
    );
  } else {
    salinRehidrasi();
  }

  /** Dokumen yang dibaca pengurai: DOM hidup, dengan cadangan salinan data rehidrasi. */
  const dokumenBaca = {
    get body() {
      return document.body;
    },
    get location() {
      return document.location;
    },
    getElementById(id) {
      const el = document.getElementById(id);
      if (el) return el;
      return id === ID_REHIDRASI && teksRehidrasi ? { textContent: teksRehidrasi } : null;
    },
    querySelector(sel) {
      return document.querySelector(sel);
    },
    // Instagram: blob <script type="application/json">; YouTube: skrip ytInitialData/ytInitialPlayerResponse.
    querySelectorAll(sel) {
      return document.querySelectorAll(sel);
    },
    get documentElement() {
      return document.documentElement;
    },
    // Untuk diagnosa saat angka tidak terbaca (judul, panjang, kata penanda) — tidak dikirim utuh.
    get title() {
      return document.title;
    },
    get html() {
      return document.documentElement?.outerHTML ?? "";
    },
  };

  // ------------------------------------------------ tangkapan daftar video
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const d = ev.data;
    if (!d || typeof d !== "object" || typeof d.url !== "string") return;
    let body;
    if (PLATFORM === "TIKTOK" && d.sumber === TAG && d.jenis === "item_list" && d.body && typeof d.body === "object") body = d.body;
    else if (PLATFORM === "INSTAGRAM" && d.sumber === TAG_IG && d.jenis === "tangkapan" && typeof d.teks === "string") body = d.teks;
    else return;
    const butir = pengurai ? ringkasTangkapan(pengurai, d.url, body) : { url: d.url, body };
    const ada = tangkapan.findIndex((t) => t.url === d.url);
    if (ada >= 0) tangkapan.splice(ada, 1);
    tangkapan.push(butir);
    if (tangkapan.length > MAKS_TANGKAPAN) tangkapan.shift();
    jadwalkanPerbarui();
  });
  // Minta halaman-utama*.js mengirim ulang yang sudah ditangkap sebelum skrip ini siap.
  if (PLATFORM === "TIKTOK") window.postMessage({ sumber: TAG, jenis: "minta-ulang" }, location.origin);
  if (PLATFORM === "INSTAGRAM") window.postMessage({ sumber: TAG_IG, jenis: "minta-ulang" }, location.origin);

  async function baca() {
    const m = await muatPengurai;
    return m.bacaHalaman(dokumenBaca, { url: location.href, itemList: tangkapan });
  }

  // HTML segar halaman ini, bila data di halaman tidak ada: TikTok berpindah halaman tanpa memuat
  // ulang (panel), atau tab latar putaran otomatis termuat tanpa data (terlihat 2026-10-09). Satu
  // alamat diambil paling sering sekali per 2 menit; "Baca ulang" di panel memaksa ambil lagi.
  // Bila tetap gagal, `diagnosa` dari kedua bacaan ikut dilaporkan.
  const BATAS_ULANG_SEGAR_MS = 120_000;
  let segar = null;

  async function ambilHalamanSegar(url, paksa) {
    if (!paksa && segar?.url === url && Date.now() - segar.at < BATAS_ULANG_SEGAR_MS) return segar.html;
    try {
      const res = await fetch(url, { credentials: "include", cache: "no-store", headers: { accept: "text/html" } });
      const html = res.ok ? await res.text() : null;
      segar = { url, at: Date.now(), html };
      return html;
    } catch {
      segar = { url, at: Date.now(), html: null };
      return null;
    }
  }

  async function bacaLengkap(paksa = false) {
    const m = await muatPengurai;
    const opsi = { url: location.href, itemList: tangkapan };
    const h = m.bacaHalaman(dokumenBaca, opsi);
    if (!m.perluHalamanSegar(h)) return h;
    const html = await ambilHalamanSegar(location.href, paksa);
    if (!html) return { ...h, diagnosa: `halaman: ${h.diagnosa ?? h.alasan ?? "-"} | ambil ulang gagal` };
    const h2 = m.bacaHalaman(html, opsi);
    if (!m.perluHalamanSegar(h2)) return h2;
    return { ...h, diagnosa: `halaman: ${h.diagnosa ?? h.alasan ?? "-"} | ambil ulang: ${h2.diagnosa ?? h2.alasan ?? "-"}` };
  }

  // ------------------------------------------------ permintaan dari service worker
  chrome.runtime.onMessage.addListener((pesan, pengirim, balas) => {
    if (pengirim.id !== chrome.runtime.id) return false;
    // Cek cepat: tab TikTok yang dibuka orang mengambil halaman tugas dengan fetch (kuki tab ini sudah
    // lolos pemeriksaan keamanan TikTok) dan membacanya — tanpa membuka tab baru. Hanya alamat
    // tiktok.com yang sah untuk tugas yang diterima; hasilnya bentuk yang sama dengan bacaHalaman.
    // Instagram (v0.11.0): jalan yang sama dari tab instagram.com yang dibuka dan sudah dimasuki pemilik.
    if (pesan?.jenis === "ambilLewatTab" && typeof pesan.url === "string") {
      muatPengurai
        .then(async (m) => {
          const url = m.urlUntukTab(pesan.url);
          if (!url) return balas({ status: "GAGAL_MUAT", pesan: `Alamat ini tidak bisa dicek dari tab ${LABEL_PLATFORM}` });
          let res;
          try {
            res = await fetch(url, { credentials: "include", cache: "no-store", headers: { accept: "text/html" } });
          } catch (e) {
            return balas({ status: "GAGAL_MUAT", pesan: `Tab ${LABEL_PLATFORM} tidak bisa mengambil halaman: ` + String(e?.message ?? e) });
          }
          if (!res.ok && res.status !== 404) return balas({ status: "GAGAL_MUAT", pesan: `${LABEL_PLATFORM} menjawab HTTP ${res.status}` });
          const html = await res.text();
          const h = m.bacaHalaman(html, { url, itemList: [] });
          balas({ ...h, lewatTab: true });
        })
        .catch((e) => balas({ status: "TIDAK_TERBACA", pesan: "Pengurai gagal: " + String(e?.message ?? e) }));
      return true;
    }
    // Jalan pengganti: halaman video kena pemeriksaan keamanan → angka video diambil dari daftar
    // video profil kreatornya (tab yang sama sudah diarahkan ke profil oleh service worker).
    if (PLATFORM === "TIKTOK" && pesan?.jenis === "bacaKontenDariProfil" && typeof pesan.videoId === "string") {
      bacaLengkap()
        .then((h) => {
          if (h.status !== "OK" || h.data?.jenis !== "PROFIL") return balas({ ...h, data: undefined });
          const k = pengurai.kontenDariProfil(h.data, pesan.videoId);
          if (k) return balas({ status: "OK", data: k, lewatProfil: true });
          balas({
            status: "TIDAK_TERBACA",
            alasan: "VIDEO_TIDAK_DI_PROFIL",
            adaItemList: h.adaItemList,
            diagnosa: `profil terbaca (${h.data.posting.length} video), video ini tidak ada di daftar`,
          });
        })
        .catch((e) => balas({ status: "TIDAK_TERBACA", pesan: "Pengurai gagal: " + String(e?.message ?? e) }));
      return true;
    }
    if (pesan?.jenis !== "bacaHalaman") return false;
    // Putaran otomatis juga memakai cadangan HTML segar bila data halaman tidak ada.
    bacaLengkap()
      .then((h) => balas(h))
      .catch((e) => balas({ status: "TIDAK_TERBACA", pesan: "Pengurai gagal: " + String(e?.message ?? e) }));
    return true;
  });

  // ------------------------------------------------ panel manual
  // Hitungan panel (ER, grafik, format angka) — modul murni yang juga diuji node --test.
  let alat = null;
  const muatAlat = import(chrome.runtime.getURL("lib/panel.js")).then((m) => (alat = m));
  // Setelan tampilan (tema, warna, ukuran, posisi, periode, asumsi harga) — juga modul murni.
  let kal = null;
  const muatKalender = import(chrome.runtime.getURL("lib/kalender.js")).then((m) => (kal = m));
  let gaya = null;
  const muatGaya = import(chrome.runtime.getURL("lib/tampilan.js")).then((m) => (gaya = m));
  // Keputusan kiriman otomatis (bacaan lengkap? kunci 6 jam? teks kabar) — modul murni.
  let aturan = null;
  const muatAturan = import(chrome.runtime.getURL("lib/aturan.js")).then((m) => (aturan = m));
  const TEKS_STATUS = {
    CAPTCHA: `${LABEL_PLATFORM} meminta captcha atau pemeriksaan. Selesaikan dulu, lalu tekan Baca ulang.`,
    LOGIN:
      PLATFORM === "INSTAGRAM"
        ? "Instagram meminta masuk. Posting dan angkanya hanya terbaca bila Anda sudah masuk ke Instagram di Chrome ini."
        : `${LABEL_PLATFORM} meminta masuk (login).`,
    TIDAK_DITEMUKAN: "Akun atau video ini tidak ditemukan.",
    PRIVAT: "Akun atau video ini privat — angkanya tidak bisa dibaca.",
    TIDAK_TERBACA:
      PLATFORM === "INSTAGRAM"
        ? "Angka belum terbaca. Pastikan Anda sudah masuk ke Instagram, gulir sedikit, lalu tekan tombol putar di bawah."
        : "Angka belum terbaca. Tekan tombol putar di bawah; kalau masih gagal, muat ulang halaman (⌘R).",
  };
  const TEKS_SIMPAN = {
    // Elorae lama (sebelum KOL dibuat otomatis) masih bisa menjawab ini.
    TIDAK_ADA_DI_ELORAE: "Belum ada di Elorae. Tambahkan KOL atau kontennya di Elorae dulu.",
    TANPA_IZIN: "Orang yang menyambungkan ekstensi ini tidak punya izin mengelola Kreatif, jadi KOL baru tidak bisa dibuat. Sambungkan ulang dengan akun yang punya izin itu.",
    KOL_DIBLOKIR: "KOL ini diblokir di Elorae, jadi videonya tidak ditambahkan.",
    BELUM_TERSAMBUNG: "Ekstensi belum tersambung ke Elorae. Klik ikon ekstensi untuk menyambungkan.",
    TOKEN_TIDAK_SAH: "Sambungan ke Elorae sudah dicabut. Sambungkan ulang lewat ikon ekstensi.",
    JARINGAN: "Elorae tidak terjangkau. Pastikan Elorae menyala, lalu coba lagi.",
    TERLALU_SERING: "Terlalu sering menyimpan. Tunggu sebentar lalu coba lagi.",
    MUATAN_TIDAK_SAH: "Elorae menolak angka ini. Muat ulang halaman lalu coba lagi.",
  };

  let panel = null;
  let hasilTerakhir = null;
  let pesanSimpan = null;
  /** Kabar kiriman otomatis untuk halaman ini: `{ url, teks, jenis, tautan? }` atau null. */
  let kabarOtomatis = null;
  /** Kunci kiriman otomatis → waktu boleh bertanya lagi ke service worker (Infinity = selesai untuk halaman ini). */
  const tanyaOtomatisLagi = new Map();
  const sedangKirimOtomatis = new Set();
  const JEDA_TANYA_ULANG_MS = 60_000;
  let menyimpan = false;
  let urlTerakhir = location.href;
  let tundaPerbarui = null;

  function jadwalkanPerbarui() {
    if (!panel) return;
    clearTimeout(tundaPerbarui);
    tundaPerbarui = setTimeout(perbaruiPanel, 400);
  }

  function kirimKeLatar(pesan) {
    return new Promise((selesai) => {
      try {
        chrome.runtime.sendMessage(pesan, (jawaban) => {
          if (chrome.runtime.lastError) selesai(null);
          else selesai(jawaban ?? null);
        });
      } catch {
        selesai(null);
      }
    });
  }

  // Warna panel datang dari variabel CSS yang dipasang di pembungkus (`variabelCss` di
  // lib/tampilan.js: tema terang/gelap/otomatis + warna aksen pilihan). Nilai di `.wadah` di bawah
  // hanya cadangan sebelum setelan terbaca. Angka memakai ui-rounded (SF Pro Rounded di Mac).
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wadah {
      --ink: #0e0d13; --kartu: #18161f; --kartu-2: #221f2b; --garis: rgba(255, 255, 255, 0.09);
      --teks: #f5f3fb; --redup: #a19cb2; --aksen: #c9b8ff; --aksen-teks: #16121f;
      --naik: #7fe3b4; --turun: #ff98a6;
      --bayangan: 0 18px 48px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.25);
    }
    .kotak, .pil {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--teks); background: var(--ink); border: 1px solid var(--garis);
      box-shadow: var(--bayangan); -webkit-font-smoothing: antialiased;
    }
    .kiri.kotak, .kiri.pil { right: auto; left: 16px; }
    .bulat { font-family: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif; }
    .kotak { width: 316px; max-height: calc(100vh - 32px); overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain;
      border-radius: 24px; padding: 14px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; scrollbar-width: thin; }
    .kotak.masuk { animation: muncul 220ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both; }
    @keyframes muncul { from { opacity: 0; transform: translateY(10px) scale(0.98); } }

    .pil { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 14px 8px 10px;
      cursor: pointer; font-weight: 700; font-size: 13px; }
    .pil:hover { background: var(--kartu-2); }
    .pil .er { color: var(--teks); background: color-mix(in srgb, var(--aksen) 26%, transparent);
      border-radius: 999px; padding: 2px 8px; font-weight: 700; }

    .logo { width: 22px; height: 22px; border-radius: 7px; background: var(--aksen); color: var(--aksen-teks);
      display: grid; place-items: center; font-weight: 900; font-size: 13px; line-height: 1; flex: none; }
    .kepala { display: flex; align-items: center; gap: 8px; }
    .kepala .merek { font-weight: 800; letter-spacing: -0.01em; }
    .kepala .sub { color: var(--redup); }
    .kepala .isi-kanan { margin-left: auto; display: flex; gap: 2px; }

    .siapa { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .avatar { flex: none; width: 38px; height: 38px; border-radius: 50%; background: var(--kartu-2);
      border: 1.5px solid var(--aksen); display: grid; place-items: center; font-weight: 800; font-size: 16px; }
    .siapa .nama { font-weight: 800; font-size: 15px; letter-spacing: -0.01em; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; }
    .siapa .jenis { color: var(--redup); font-size: 12px; }

    .ubin { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .tile { background: var(--kartu); border: 1px solid var(--garis); border-radius: 16px; padding: 10px 12px; min-width: 0; }
    .tile .nilai { font-size: 28px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.05;
      font-variant-numeric: tabular-nums; white-space: nowrap; }
    .tile .label { color: var(--redup); font-size: 12px; margin-top: 3px; }
    .tile.aksen { background: var(--aksen); border-color: transparent; color: var(--aksen-teks); }
    .tile.aksen .label { color: color-mix(in srgb, var(--aksen-teks) 74%, transparent); }

    .statistik { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .statistik div { background: var(--kartu); border: 1px solid var(--garis); border-radius: 12px; padding: 7px 8px; min-width: 0; }
    .statistik b { display: block; font-size: 15px; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .statistik span { color: var(--redup); font-size: 11px; }

    .blok { background: var(--kartu); border: 1px solid var(--garis); border-radius: 16px; padding: 10px 12px; display: grid; gap: 8px; }
    .blok .judul-blok { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 700; }
    .blok .catatan { color: var(--redup); font-size: 11.5px; }

    .segmen { display: inline-flex; background: var(--kartu-2); border-radius: 999px; padding: 2px; }
    .segmen button { border-radius: 999px; padding: 3px 9px; font-size: 12px; font-weight: 700; color: var(--redup); background: transparent; }
    .segmen button[aria-pressed="true"] { background: var(--aksen); color: var(--aksen-teks); }

    .tabel { display: grid; grid-template-columns: 1fr auto auto; gap: 4px 10px; align-items: baseline; font-variant-numeric: tabular-nums; }
    .tabel .l { color: var(--redup); }
    .tabel .v { font-weight: 700; text-align: right; white-space: nowrap; }
    .tabel .p { text-align: right; font-size: 11.5px; font-weight: 700; white-space: nowrap; min-width: 58px; }
    .naik { color: var(--naik); }
    .turun { color: var(--turun); }
    .tetap { color: var(--redup); }

    .batang { display: flex; align-items: flex-end; gap: 4px; height: 46px; }
    .batang i { flex: 1; min-height: 3px; border-radius: 4px 4px 2px 2px; background: var(--aksen); transform-origin: bottom; }
    .batang i.muda { background: transparent; border: 1.5px dashed color-mix(in srgb, var(--aksen) 60%, transparent); }
    .masuk .batang i { animation: tumbuh 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    @keyframes tumbuh { from { transform: scaleY(0.05); } }
    .kaki { display: flex; justify-content: space-between; gap: 8px; color: var(--redup); font-size: 12px; }
    .kaki b { color: var(--teks); font-weight: 700; }

    .pemicu-rentang { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: var(--ink);
      border: 1px solid var(--garis); border-radius: 12px; padding: 8px 10px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .pemicu-rentang:hover, .pemicu-rentang[aria-expanded="true"] { border-color: var(--aksen); }
    .pemicu-rentang > span:first-of-type { flex: 1; min-width: 0; }
    .pemicu-rentang svg:first-child { color: var(--aksen); }
    .kal-jumlah-kecil { color: var(--redup); font-weight: 600; font-size: 11.5px; white-space: nowrap; }

    .kal-pop { position: fixed; z-index: 2147483647; display: flex; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px);
      overflow: auto; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--teks);
      background: var(--ink); border: 1px solid color-mix(in srgb, var(--aksen) 35%, var(--garis)); border-radius: 18px;
      box-shadow: var(--bayangan); -webkit-font-smoothing: antialiased; animation: muncul 180ms cubic-bezier(0.2, 0.9, 0.3, 1.1) both; }
    .kal-pop.sempit { flex-direction: column; }
    .ikon-bulat { flex: none; width: 20px; height: 20px; border-radius: 50%; background: var(--aksen); color: var(--aksen-teks);
      display: inline-grid; place-items: center; }
    .ikon-bulat svg { width: 12px; height: 12px; }
    .kal-cepat { flex: none; width: 228px; padding: 10px; display: flex; flex-direction: column; gap: 2px;
      background: color-mix(in srgb, var(--aksen) 9%, var(--kartu)); border-right: 1px solid color-mix(in srgb, var(--aksen) 22%, transparent); }
    .kal-cepat-judul { display: flex; align-items: center; gap: 8px; margin: 0; padding: 4px 8px 8px; font-weight: 700; font-size: 12px; }
    .kal-cepat button { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%;
      background: transparent; border-radius: 10px; padding: 7px 8px; text-align: left; }
    .kal-cepat button:hover { background: color-mix(in srgb, var(--aksen) 18%, transparent); }
    .kal-cepat button[aria-pressed="true"] { background: var(--aksen); color: var(--aksen-teks); font-weight: 700; }
    .kal-cepat-nama { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    .kal-cepat-tgl { color: var(--redup); font-size: 11.5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .kal-cepat button[aria-pressed="true"] .kal-cepat-tgl { color: color-mix(in srgb, var(--aksen-teks) 75%, transparent); }
    .kal-chip-baris { display: flex; gap: 6px; overflow-x: auto; padding: 10px 12px 0; scrollbar-width: none; width: 0; min-width: 100%; }
    .kal-chip { flex: none; border-radius: 999px; padding: 5px 10px; font-size: 12px; font-weight: 700;
      background: color-mix(in srgb, var(--aksen) 14%, transparent); border: 1px solid color-mix(in srgb, var(--aksen) 40%, transparent); }
    .kal-chip[aria-pressed="true"] { background: var(--aksen); color: var(--aksen-teks); border-color: var(--aksen); }
    .kal-utama { display: flex; flex-direction: column; min-width: 0; }
    /* width 0 + min-width 100%: ringkasan dan kaki mengikuti lebar kalender, tidak melebarkannya. */
    .kal-ringkas { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--garis); width: 0; min-width: 100%; }
    .kal-kotak { flex: 1; min-width: 0; border: 1px solid var(--garis); background: var(--kartu); border-radius: 10px; padding: 5px 10px; }
    .kal-kotak.aktif { border-color: var(--aksen); background: color-mix(in srgb, var(--aksen) 14%, transparent); }
    .kal-kotak small { display: block; font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--redup); }
    .kal-kotak b { display: block; font-size: 13.5px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kal-kotak.kosong b { color: var(--redup); font-weight: 500; }
    .kal-jumlah { flex: none; border-radius: 999px; padding: 2px 8px; font-size: 11.5px; font-weight: 800; background: var(--aksen);
      color: var(--aksen-teks); font-variant-numeric: tabular-nums; }
    .kal-panah { flex: none; color: var(--redup); display: inline-flex; }
    .kal-bulan-bulan { display: flex; justify-content: center; gap: 20px; padding: 10px 12px 6px; touch-action: none; user-select: none; }
    .kal-bulan { width: 252px; }
    .kal-kepala { display: grid; grid-template-columns: 30px 1fr 30px; align-items: center; margin-bottom: 4px; }
    .kal-nav { width: 30px; height: 30px; border-radius: 9px; background: transparent; display: grid; place-items: center; color: var(--teks); }
    .kal-nav:hover { background: var(--kartu-2); }
    .kal-label { justify-self: center; display: inline-flex; align-items: center; gap: 4px; background: transparent; border-radius: 9px;
      padding: 5px 8px; font-weight: 800; letter-spacing: -0.01em; }
    .kal-label:hover { background: var(--kartu-2); }
    .kal-label.statis { cursor: default; }
    .kal-label svg { width: 12px; height: 12px; color: var(--redup); }
    .kal-grid { display: grid; grid-template-columns: repeat(7, 36px); row-gap: 2px; }
    .kal-grid .hd { text-align: center; font-size: 11.5px; color: var(--redup); padding: 4px 0 6px; }
    .kal-grid .hd.min { color: var(--turun); }
    .kal-hari { height: 34px; background: transparent; border-radius: 10px; font-size: 13px; font-variant-numeric: tabular-nums; }
    .kal-hari.minggu { color: var(--turun); }
    .kal-hari.hariini { font-weight: 800; text-decoration: underline; text-underline-offset: 3px; }
    .kal-hari:hover:not(:disabled) { box-shadow: inset 0 0 0 1.5px var(--aksen); }
    .kal-hari.dalam { background: color-mix(in srgb, var(--aksen) 22%, transparent); border-radius: 0; }
    .kal-hari.awal, .kal-hari.akhir { background: var(--aksen); color: var(--aksen-teks); font-weight: 800; }
    .kal-hari.awal { border-radius: 10px 0 0 10px; }
    .kal-hari.akhir { border-radius: 0 10px 10px 0; }
    .kal-hari.awal.akhir { border-radius: 10px; }
    .kal-hari:disabled { opacity: 0.28; cursor: default; }
    .kal-grid-bulan { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding-top: 4px; }
    .kal-grid-bulan button { border-radius: 10px; padding: 12px 0; background: var(--kartu); font-weight: 700; }
    .kal-grid-bulan button:hover:not(:disabled) { background: color-mix(in srgb, var(--aksen) 18%, transparent); }
    .kal-grid-bulan button[aria-pressed="true"] { background: var(--aksen); color: var(--aksen-teks); }
    .kal-grid-bulan button:disabled { opacity: 0.3; cursor: default; }
    .kal-kaki { display: flex; align-items: center; gap: 8px; padding: 8px 12px 10px; border-top: 1px solid var(--garis); width: 0; min-width: 100%; }
    .kal-kaki p { flex: 1; min-width: 0; margin: 0; display: flex; align-items: flex-start; gap: 8px; color: var(--redup); font-size: 12px; }
    .kal-tombol { flex: none; border-radius: 999px; padding: 5px 11px; background: var(--kartu-2); font-weight: 700; font-size: 12px; }
    .kal-tombol:hover { background: color-mix(in srgb, var(--aksen) 18%, var(--kartu-2)); }
    .grafik-periode { width: 100%; height: 64px; display: block; }
    .grafik-periode .area-kini { fill: color-mix(in srgb, var(--aksen) 22%, transparent); stroke: none; }
    .grafik-periode .garis-kini { fill: none; stroke: var(--aksen); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .grafik-periode .garis-lalu { fill: none; stroke: var(--redup); stroke-width: 1.5; stroke-dasharray: 4 3; stroke-linejoin: round; }
    .legenda { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11.5px; align-items: center; }
    .legenda span { display: inline-flex; align-items: center; gap: 5px; }
    .legenda .redup { color: var(--redup); margin-left: auto; }
    .legenda i { display: inline-block; width: 14px; height: 0; border-top: 2px solid var(--aksen); }
    .legenda i.lalu { border-top: 2px dashed var(--redup); }
    button.tautan { justify-self: start; background: transparent; color: var(--aksen); font-weight: 700; font-size: 12px; padding: 0; text-decoration: underline; }
    .harga { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .isian { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
    .isian input { flex: 1 1 100%; min-width: 0; font: inherit; color: var(--teks); background: var(--ink);
      border: 1px solid var(--garis); border-radius: 10px; padding: 7px 10px; }
    .isian input:focus-visible { outline: 2px solid var(--aksen); outline-offset: 1px; }
    .lencana { border-radius: 999px; padding: 3px 9px; font-size: 12px; font-weight: 800; white-space: nowrap; }
    .lencana.MURAH, .lencana.WAJAR { background: color-mix(in srgb, var(--naik) 16%, transparent); color: var(--naik); }
    .lencana.MAHAL { background: color-mix(in srgb, var(--turun) 16%, transparent); color: var(--turun); }
    .lencana.netral { background: var(--kartu-2); color: var(--teks); white-space: normal; }
    .lencana { white-space: normal; }

    .atur { display: grid; gap: 8px; }
    .atur .baris-atur { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .atur .baris-atur > span { color: var(--redup); font-size: 12px; }
    .swatch-baris { display: flex; gap: 6px; align-items: center; }
    .swatch { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid transparent;
      box-shadow: inset 0 0 0 1px var(--garis); position: relative; overflow: hidden; }
    .swatch[aria-pressed="true"] { border-color: var(--teks); }
    .swatch input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; padding: 0; border: 0; }
    .chip-baris { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 5px 10px;
      background: var(--kartu-2); font-size: 12px; font-variant-numeric: tabular-nums; }
    .chip b { font-weight: 700; }
    .chip span { color: var(--redup); }
    svg { width: 14px; height: 14px; flex: none; stroke: currentColor; fill: none; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round; }

    .catatan { color: var(--redup); font-size: 12px; }
    .kabar-otomatis { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--redup); font-size: 12px; }
    .kabar-otomatis svg { width: 13px; height: 13px; color: var(--naik); }
    .kabar-otomatis span { min-width: 0; }
    .kabar-otomatis.sorot { color: var(--teks); font-weight: 700; }
    .kabar-otomatis.galat svg { color: var(--turun); }
    .kabar-otomatis a { margin-left: auto; color: var(--aksen); font-weight: 700; white-space: nowrap; text-decoration: underline; }
    .status { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; border-radius: 12px; padding: 8px 10px; }
    .status svg { margin-top: 1px; }
    .status.galat { background: color-mix(in srgb, var(--turun) 14%, transparent); color: var(--turun); }
    .status.baik { background: color-mix(in srgb, var(--naik) 14%, transparent); color: var(--naik); }

    .tombol { display: flex; gap: 8px; }
    button { font: inherit; color: inherit; cursor: pointer; border: none; }
    button:focus-visible { outline: 2px solid var(--aksen); outline-offset: 2px; }
    button.utama { flex: 1; border-radius: 999px; padding: 11px 14px; background: var(--aksen); color: var(--aksen-teks);
      font-weight: 800; font-size: 14px; letter-spacing: -0.01em; transition: transform 120ms ease, filter 120ms ease; }
    button.utama:hover:not(:disabled) { filter: brightness(1.06); }
    button.utama:active:not(:disabled) { transform: scale(0.97); }
    button.bundar { width: 42px; height: 42px; border-radius: 50%; background: var(--kartu-2); display: grid;
      place-items: center; flex: none; }
    button.bundar:hover { background: color-mix(in srgb, var(--teks) 10%, var(--kartu-2)); }
    button.bundar svg { width: 18px; height: 18px; }
    button.kecil { width: 28px; height: 28px; border-radius: 50%; background: transparent; display: grid; place-items: center; color: var(--redup); }
    button.kecil:hover { background: var(--kartu-2); color: var(--teks); }
    button:disabled { opacity: 0.45; cursor: default; }
    .berputar svg { animation: putar 0.8s linear infinite; }
    @keyframes putar { to { transform: rotate(360deg); } }

    @media (prefers-reduced-motion: reduce) {
      .kotak.masuk, .masuk .batang i, .berputar svg { animation: none; }
      button.utama { transition: none; }
    }
  `;

  // Ikon garis 24×24, dibangun dengan createElementNS (tanpa innerHTML: TikTok bisa memasang Trusted Types).
  const IKON = {
    like: ["M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"],
    komentar: ["M4.5 5.5h15v10.5H9l-4.5 3.5z"],
    share: ["M14 4.5l6 6-6 6", "M20 10.5H10a6 6 0 0 0-6 6v3"],
    save: ["M7 4h10v16.5l-5-3.8-5 3.8z"],
    video: ["M4 6.5h11v11H4z", "M15 10.5l5-3v9l-5-3"],
    ulang: ["M20 12a8 8 0 1 1-2.4-5.7", "M20 4.5V9h-4.5"],
    kecil: ["M6 12h12"],
    lebar: ["M4 9V4h5", "M20 15v5h-5", "M4 4l6 6", "M20 20l-6-6"],
    sempit: ["M9 4v5H4", "M15 20v-5h5", "M9 9L3 3", "M15 15l6 6"],
    centang: ["M5 12.5l4.5 4.5L19 7.5"],
    atur: ["M4 7h9", "M17 7h3", "M15 5v4", "M4 17h3", "M11 17h9", "M9 15v4"],
    awas: ["M12 8v5", "M12 16.5v.01", "M12 3.5l9.5 16.5h-19z"],
    kalender: ["M4.5 6h15v14h-15z", "M4.5 10h15", "M8.5 3.5v4", "M15.5 3.5v4", "M8 14h3", "M13 14h3", "M8 17h3"],
    kilat: ["M13 3L5 13.5h6L10 21l8-10.5h-6z"],
    tunjuk: ["M9 11V5.5a1.5 1.5 0 0 1 3 0V11", "M12 10.5a1.5 1.5 0 0 1 3 0v1", "M15 11a1.5 1.5 0 0 1 3 0v3.5a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L4.3 15a1.6 1.6 0 0 1 2.6-1.8L9 15.5"],
    kiri: ["M14.5 6l-6 6 6 6"],
    kanan: ["M9.5 6l6 6-6 6"],
    bawah: ["M6.5 9.5l5.5 5.5 5.5-5.5"],
    panah: ["M5 12h14", "M13 6l6 6-6 6"],
  };
  const NS = "http://www.w3.org/2000/svg";
  function ikon(nama) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    for (const d of IKON[nama]) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      s.append(p);
    }
    return s;
  }

  function el(tag, atribut = {}, ...anak) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(atribut)) {
      if (v === undefined || v === null) continue;
      if (k === "teks") e.textContent = v;
      else if (k === "kelas") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const a of anak) if (a) e.append(typeof a === "string" ? document.createTextNode(a) : a);
    return e;
  }

  // ------------------------------------------------ setelan tampilan & tema
  const mediaGelap = window.matchMedia("(prefers-color-scheme: dark)");

  /** Warna latar halaman TikTok (tema TikTok sendiri), dari elemen terluar yang berlatar. */
  function latarHalaman() {
    for (const e of [document.body, document.documentElement, document.getElementById("app")]) {
      if (!e) continue;
      const rgb = gaya.bacaRgb(getComputedStyle(e).backgroundColor);
      if (rgb) return rgb;
    }
    return null;
  }

  function terapkanTema() {
    const tema = gaya.temaEfektif(panel.tampilan.tema, latarHalaman(), mediaGelap.matches);
    for (const [k, v] of Object.entries(gaya.variabelCss(tema, panel.tampilan.aksen))) panel.wadah.style.setProperty(k, v);
  }

  async function bacaTampilan() {
    try {
      const r = await chrome.storage.local.get(gaya.KUNCI_TAMPILAN);
      return gaya.bersihkanTampilan(r?.[gaya.KUNCI_TAMPILAN]);
    } catch {
      return gaya.bersihkanTampilan(null);
    }
  }

  function ubahTampilan(sebagian) {
    panel.tampilan = gaya.bersihkanTampilan({ ...panel.tampilan, ...sebagian });
    chrome.storage.local.set({ [gaya.KUNCI_TAMPILAN]: panel.tampilan }).catch(() => {});
    gambar(pengurai?.jenisHalaman(location.href));
  }

  let tundaTema = null;
  function pantauTemaHalaman() {
    // Tema TikTok berganti → cukup pasang ulang variabel warna; isi panel (dan isian harga) tetap.
    const ulang = () => {
      clearTimeout(tundaTema);
      tundaTema = setTimeout(() => panel && gaya && terapkanTema(), 200);
    };
    mediaGelap.addEventListener("change", ulang);
    const pengamat = new MutationObserver(ulang);
    for (const e of [document.documentElement, document.body]) {
      if (e) pengamat.observe(e, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    }
    chrome.storage.onChanged.addListener((perubahan, area) => {
      if (area !== "local" || !(gaya.KUNCI_TAMPILAN in perubahan) || !panel) return;
      panel.tampilan = gaya.bersihkanTampilan(perubahan[gaya.KUNCI_TAMPILAN].newValue);
      if (panel.mengetik) panel.tertunda = true;
      else gambar(pengurai?.jenisHalaman(location.href));
    });
  }

  // ------------------------------------------------ siklus panel
  async function bangunPanel() {
    const tabOtomatis = await kirimKeLatar({ jenis: "apakahTabOtomatis" });
    if (tabOtomatis?.otomatis) return;
    await muatGaya;
    const [setelan, tampilan] = await Promise.all([kirimKeLatar({ jenis: "bacaPanel" }), bacaTampilan()]);
    const host = document.createElement("elorae-kreatif-panel");
    const akar = host.attachShadow({ mode: "closed" });
    akar.append(el("style", { teks: CSS }));
    const wadah = el("div", { kelas: "wadah" });
    akar.append(wadah);
    document.documentElement.append(host);
    panel = { host, akar, wadah, kecil: Boolean(setelan?.kecil), animasi: true, tampilan, mengetik: false, tertunda: false, patokan: null };
    panel.patokan = await kirimKeLatar({ jenis: "bacaPatokan" });
    pantauTemaHalaman();
    pantauSakelarKirim();
    await perbaruiPanel();
    setInterval(() => {
      if (location.href !== urlTerakhir) {
        urlTerakhir = location.href;
        pesanSimpan = null;
        kabarOtomatis = null;
        panel.animasi = true;
        perbaruiPanel();
      }
    }, 1000);
  }

  let membaca = false;
  async function perbaruiPanel(paksa = false) {
    if (!panel) return;
    const m = await muatPengurai.catch(() => null);
    await muatAlat.catch(() => null);
    await muatKalender.catch(() => null);
    const target = m ? m.jenisHalaman(location.href) : null;
    if (!target) {
      panel.host.style.display = "none";
      return;
    }
    panel.host.style.display = "";
    membaca = true;
    if (paksa) panel.patokan = await kirimKeLatar({ jenis: "bacaPatokan", paksa: true });
    try {
      hasilTerakhir = await bacaLengkap(paksa);
    } catch (e) {
      hasilTerakhir = { status: "TIDAK_TERBACA", pesan: String(e?.message ?? e) };
    }
    membaca = false;
    // Tidak ditunggu: menggambar panel tidak boleh menunggu Elorae.
    kirimOtomatisBilaPerlu(hasilTerakhir).catch(() => {});
    // Jangan gambar ulang di tengah orang mengetik harga — isiannya akan kehilangan fokus.
    if (panel.mengetik) {
      panel.tertunda = true;
      return;
    }
    gambar(target);
  }

  function setelKecil(kecil) {
    panel.kecil = kecil;
    panel.animasi = !kecil;
    kirimKeLatar({ jenis: "setelPanel", kecil });
    gambar(pengurai?.jenisHalaman(location.href));
  }

  // ------------------------------------------------ potongan isi
  const ubin = (nilai, label, judul, aksen = false) =>
    el("div", { kelas: aksen ? "tile aksen" : "tile", title: judul }, el("div", { kelas: "nilai bulat", teks: nilai }), el("div", { kelas: "label", teks: label }));

  const chip = (namaIkon, nilai, label, judul) =>
    el("span", { kelas: "chip", title: judul }, ikon(namaIkon), el("b", { teks: nilai }), el("span", { teks: label }));

  const tanggalPendek = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
  const tanggalTahun = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
  const tanggalPanjang = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
  const persen1 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

  function grafikViews(posting, ringkas) {
    const batang = alat.batangViews(posting, Date.now());
    if (!batang.length) return null;
    const baris = el("div", { kelas: "batang", "aria-hidden": "true" });
    batang.forEach((b, i) => {
      const t = el("i", {
        kelas: b.muda ? "muda" : "",
        title: `${alat.angkaLengkap(b.views)} views${b.muda ? " · belum 48 jam, belum ikut ER" : ""}`,
      });
      t.style.height = `${Math.max(6, Math.round(b.tinggi * 100))}%`;
      t.style.animationDelay = `${i * 25}ms`;
      baris.append(t);
    });
    const kiri =
      ringkas.avgViews != null
        ? el("span", {}, "Rata-rata ", el("b", { teks: alat.angkaPendek(ringkas.avgViews) }), " views")
        : el("span", { teks: `${batang.length} video terbaru` });
    return el(
      "div",
      { kelas: "blok", role: "img", "aria-label": `Views ${batang.length} video terbaru` },
      baris,
      el("div", { kelas: "kaki" }, kiri, el("span", { teks: "lama → baru" })),
    );
  }

  function statistikAkun(r) {
    const sel = (nilai, label, judul) => el("div", { title: judul }, el("b", { kelas: "bulat", teks: nilai }), el("span", { teks: label }));
    return el(
      "div",
      { kelas: "statistik" },
      sel(alat.angkaPendek(r.medianViews ?? undefined), "median views", "Nilai tengah views dari video yang dipakai ER — tidak terangkat oleh satu video viral."),
      sel(r.rasioViews == null ? "—" : `${persen1.format(r.rasioViews)}%`, "views/pengikut", "Rata-rata views dibagi jumlah pengikut: berapa persen pengikut yang benar-benar menonton."),
      sel(r.perMinggu == null ? "—" : persen1.format(r.perMinggu), "video/minggu", `Rata-rata unggahan per minggu dalam ${r.hariDasar || 28} hari terakhir.`),
    );
  }

  /** Lencana perubahan: ▲ naik / ▼ turun / = tetap; `poin` untuk ER (selisih poin persen). */
  function lencanaUbah(baru, lama, lengkap, poin = false) {
    if (!lengkap || baru == null || lama == null) return el("span", { kelas: "p tetap", teks: "—" });
    const d = poin ? Math.round((baru - lama) * 10) / 10 : alat.perubahanPersen(baru, lama);
    if (d == null) return el("span", { kelas: "p tetap", teks: lama === 0 && baru > 0 ? "baru" : "—" });
    if (d === 0) return el("span", { kelas: "p tetap", teks: "= 0" });
    const teks = `${d > 0 ? "▲" : "▼"} ${persen1.format(Math.abs(d))}${poin ? " poin" : "%"}`;
    return el("span", { kelas: `p ${d > 0 ? "naik" : "turun"}`, teks });
  }

  // ------------------------------------------------ memuat video lama (untuk periode pembanding)
  // TikTok baru memuat video lama saat daftar videonya digulir. Bila periode pembanding belum
  // tercakup, panel menggulir halaman sendiri — seperti orang menggulir — sampai video tertua yang
  // tertangkap melewati awal periode pembanding, seluruh video akun tertangkap, batas
  // MAKS_POSTING tercapai, atau tiga guliran berturut-turut tidak menambah video; lalu posisi
  // halaman dikembalikan. Sekali per alamat × periode; tombol "Coba muat lagi" mengulang.
  const tidurPanel = (ms) => new Promise((r) => setTimeout(r, ms));
  const muatLama = { aktif: false, dicoba: new Set() };

  async function gulirKeBawah() {
    // Naik sedikit lalu turun lagi: pemicu muat TikTok/Instagram (pengamat di ujung daftar) baru
    // bereaksi bila ujung daftar keluar lalu masuk layar lagi.
    window.scrollBy({ top: -600, behavior: "instant" });
    await tidurPanel(150);
    const item = PLATFORM === "TIKTOK" ? document.querySelectorAll('[data-e2e="user-post-item"]') : [];
    if (item.length) item[item.length - 1].scrollIntoView({ block: "end", behavior: "instant" });
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
  }

  async function muatVideoLama(kunciPeriode, batas) {
    const kunci = `${location.href}|${kunciPeriode}`;
    if (muatLama.aktif || muatLama.dicoba.has(kunci)) return;
    muatLama.aktif = true;
    muatLama.dicoba.add(kunci);
    if (panel.mengetik) panel.tertunda = true;
    else gambar(pengurai?.jenisHalaman(location.href));
    const awalX = window.scrollX;
    const awalY = window.scrollY;
    let sebelum = -1;
    let diam = 0;
    try {
      for (let i = 0; i < 40; i++) {
        const h = await baca();
        const posting = h.data?.posting ?? [];
        const biasa = posting.filter((p) => !p.disematkan);
        const tertua = biasa.length ? Math.min(...biasa.map((p) => p.dibuatPada)) : Infinity;
        const semua = Number.isFinite(h.data?.jumlahVideo) && posting.length >= h.data.jumlahVideo;
        if (tertua < batas || semua || posting.length >= pengurai.MAKS_POSTING) break;
        if (posting.length === sebelum) {
          if (++diam >= 3) break;
        } else diam = 0;
        sebelum = posting.length;
        await gulirKeBawah();
        await tidurPanel(1400);
      }
    } finally {
      window.scrollTo({ left: awalX, top: awalY, behavior: "instant" });
      muatLama.aktif = false;
    }
    await perbaruiPanel();
  }

  /** Grafik views per hari unggah: periode ini (garis + area warna aksen) vs periode lalu (garis putus). */
  function grafikPeriode(deret, adaLalu) {
    const L = 268;
    const T = 64;
    const n = deret.kini.length;
    const puncak = Math.max(1, ...deret.kini, ...(adaLalu ? deret.lalu : []));
    const x = (i) => (n === 1 ? L / 2 : (i / (n - 1)) * (L - 4) + 2);
    const y = (v) => T - 3 - (v / puncak) * (T - 8);
    const titik = (arr) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${L} ${T}`);
    svg.setAttribute("class", "grafik-periode");
    svg.setAttribute("aria-hidden", "true");
    const garis = (titikTeks, kelas) => {
      const p = document.createElementNS(NS, "polyline");
      p.setAttribute("points", titikTeks);
      p.setAttribute("class", kelas);
      return p;
    };
    const area = document.createElementNS(NS, "polygon");
    area.setAttribute("points", `${x(0).toFixed(1)},${T} ${titik(deret.kini)} ${x(n - 1).toFixed(1)},${T}`);
    area.setAttribute("class", "area-kini");
    svg.append(area);
    if (adaLalu) svg.append(garis(titik(deret.lalu), "garis-lalu"));
    svg.append(garis(titik(deret.kini), "garis-kini"));
    return svg;
  }

  const TEKS_GALAT_RENTANG = {
    TANGGAL_TIDAK_SAH: "Pilih tanggal dari dan sampai.",
    TERBALIK: "Tanggal 'dari' harus sebelum tanggal 'sampai'.",
    TERLALU_PANJANG: "Rentang paling panjang 366 hari.",
    BELUM_TERJADI: "Tanggal itu belum terjadi.",
  };

  // ------------------------------------------------ kalender rentang (meniru isian rentang Elorae)
  // Kalender bawaan Chrome tidak bisa diberi warna tema, jadi panel menggambar kalendernya sendiri:
  // pilihan cepat, Mulai → Selesai, dua bulan (atau satu bila ruang di samping panel sempit),
  // ketuk tanggal awal lalu tanggal akhir atau tekan dan tarik. Rentang yang selesai langsung dipakai.
  const MAKS_HARI_KALENDER = 366;

  function rentangSekarang() {
    if (panel.tampilan.rentang) return panel.tampilan.rentang;
    const hariIni = kal.hariIniWib(Date.now());
    return { dari: kal.geserHari(hariIni, -32), sampai: kal.geserHari(hariIni, -3) };
  }

  function bukaKalender() {
    const r = rentangSekarang();
    const b = kal.bacaTanggal(r.sampai) ?? kal.bacaTanggal(kal.hariIniWib(Date.now()));
    panel.kal = { buka: true, jangkar: "", ujung: "", kanan: { tahun: b.tahun, bulan: b.bulan }, pilihBulan: null, tekan: null, abaikanKlik: false };
    panel.mengetik = true; // pembaruan latar menunggu kalender ditutup
    gambar(pengurai?.jenisHalaman(location.href));
  }

  function tutupKalender() {
    if (!panel.kal?.buka) return;
    panel.kal = null;
    panel.mengetik = false;
    panel.tertunda = false;
    gambar(pengurai?.jenisHalaman(location.href));
  }

  function terapkanRentang(r) {
    panel.kal = null;
    panel.mengetik = false;
    panel.tertunda = false;
    ubahTampilan({ periode: "atur", rentang: r });
  }

  /** Bulan yang tampil: kanan = bulan rentang berakhir; dua bulan → bulan sebelumnya di kiri. */
  function bulanTampil(tata) {
    const k = panel.kal.kanan;
    return tata === "dua" ? [kal.geserBulan(k, -1), k] : [k];
  }

  function sorotan() {
    const k = panel.kal;
    if (k.jangkar) return kal.urutkanRentang(k.jangkar, k.ujung || k.jangkar);
    return rentangSekarang();
  }

  function ringkasanKalender() {
    const k = panel.kal;
    const memilih = Boolean(k.jangkar);
    const bergerak = memilih && k.ujung && k.ujung !== k.jangkar;
    const r = sorotan();
    const awal = memilih ? (bergerak ? r.dari : k.jangkar) : r.dari;
    const akhir = memilih ? (bergerak ? r.sampai : "") : r.sampai;
    const n = kal.jumlahHari(awal, akhir);
    const kotak = (label, nilai, aktif) =>
      el(
        "div",
        { kelas: `kal-kotak${aktif ? " aktif" : ""}${nilai ? "" : " kosong"}` },
        el("small", { teks: label }),
        el("b", { teks: nilai ? kal.labelTanggal(nilai) : "Belum dipilih" }),
      );
    return el(
      "div",
      { kelas: "kal-ringkas", "aria-hidden": "true" },
      kotak("Mulai", awal, !memilih),
      n > 0 ? el("span", { kelas: "kal-jumlah", teks: `${n} hari` }) : el("span", { kelas: "kal-panah" }, ikon("panah")),
      kotak("Selesai", akhir, memilih),
    );
  }

  function petunjukKalender() {
    const k = panel.kal;
    return k.jangkar
      ? `Sekarang pilih tanggal akhir — pilih ${kal.labelTanggal(k.jangkar)} lagi untuk satu hari saja.`
      : "Ketuk tanggal awal lalu tanggal akhir — atau tekan tanggal awal dan tarik sampai tanggal akhir.";
  }

  /** Perbarui sorotan tanpa membangun ulang kalender (dipakai saat kursor/jari bergerak). */
  function segarkanKalender(pop) {
    const r = sorotan();
    const k = panel.kal;
    const batas = hariMatiKalender();
    for (const t of pop.querySelectorAll("[data-tanggal]")) {
      const d = t.dataset.tanggal;
      t.disabled = d > batas.akhir || (batas.awal !== null && d < batas.awal);
      t.classList.toggle("dalam", d >= r.dari && d <= r.sampai);
      t.classList.toggle("awal", d === r.dari);
      t.classList.toggle("akhir", d === r.sampai);
      t.setAttribute("aria-pressed", String(d === r.dari || d === r.sampai));
    }
    pop.querySelector(".kal-ringkas")?.replaceWith(ringkasanKalender());
    const p = pop.querySelector(".kal-petunjuk-teks");
    if (p) p.textContent = petunjukKalender();
    const ulangi = pop.querySelector(".kal-ulangi");
    if (ulangi) ulangi.hidden = !k.jangkar;
  }

  /** Hari yang bisa dipilih: sampai hari ini; sesudah tanggal awal, rentang paling 366 hari. */
  function hariMatiKalender() {
    const hariIni = kal.hariIniWib(Date.now());
    const k = panel.kal;
    if (!k.jangkar) return { awal: null, akhir: hariIni };
    const maks = kal.geserHari(k.jangkar, MAKS_HARI_KALENDER - 1);
    return { awal: kal.geserHari(k.jangkar, -(MAKS_HARI_KALENDER - 1)), akhir: maks < hariIni ? maks : hariIni };
  }

  function satuBulan(b, tata, sisi) {
    const k = panel.kal;
    const hariIni = kal.hariIniWib(Date.now());
    const navKiri = sisi === "kiri" || tata !== "dua";
    const navKanan = sisi === "kanan" || tata !== "dua";
    const geser = (n) => {
      k.kanan = kal.geserBulan(k.kanan, n);
      k.pilihBulan = null;
      gambarKalender();
    };
    const kepala = el(
      "div",
      { kelas: "kal-kepala" },
      navKiri ? el("button", { type: "button", kelas: "kal-nav", "aria-label": "Bulan sebelumnya", onclick: () => geser(-1) }, ikon("kiri")) : el("span"),
      el(
        "button",
        {
          type: "button",
          kelas: "kal-label",
          "aria-label": `Pilih bulan (${kal.NAMA_BULAN[b.bulan - 1]} ${b.tahun})`,
          onclick: () => {
            k.pilihBulan = { sisi, tahun: b.tahun };
            gambarKalender();
          },
        },
        `${kal.NAMA_BULAN[b.bulan - 1]} ${b.tahun}`,
        ikon("bawah"),
      ),
      navKanan && `${b.tahun}-${String(b.bulan).padStart(2, "0")}` < hariIni.slice(0, 7)
        ? el("button", { type: "button", kelas: "kal-nav", "aria-label": "Bulan berikutnya", onclick: () => geser(1) }, ikon("kanan"))
        : el("span"),
    );
    const grid = el("div", { kelas: "kal-grid", role: "grid" });
    kal.HARI_PENDEK.forEach((h, i) => grid.append(el("span", { kelas: `hd${i === 6 ? " min" : ""}`, teks: h })));
    for (const minggu of kal.gridBulan(b.tahun, b.bulan)) {
      minggu.forEach((t, i) => {
        if (!t) return grid.append(el("span"));
        grid.append(
          el("button", {
            type: "button",
            kelas: `kal-hari${i === 6 ? " minggu" : ""}${t === hariIni ? " hariini" : ""}`,
            "data-tanggal": t,
            "aria-label": kal.labelTanggal(t),
            teks: String(Number(t.slice(8))),
          }),
        );
      });
    }
    return el("div", { kelas: "kal-bulan" }, kepala, grid);
  }

  function pilihBulanKalender(tata) {
    const k = panel.kal;
    const p = k.pilihBulan;
    const hariIni = kal.hariIniWib(Date.now());
    const tahunIni = Number(hariIni.slice(0, 4));
    const kepala = el(
      "div",
      { kelas: "kal-kepala" },
      el("button", { type: "button", kelas: "kal-nav", "aria-label": "Tahun sebelumnya", onclick: () => ((p.tahun -= 1), gambarKalender()) }, ikon("kiri")),
      el("span", { kelas: "kal-label statis", teks: String(p.tahun) }),
      p.tahun < tahunIni
        ? el("button", { type: "button", kelas: "kal-nav", "aria-label": "Tahun berikutnya", onclick: () => ((p.tahun += 1), gambarKalender()) }, ikon("kanan"))
        : el("span"),
    );
    const grid = el("div", { kelas: "kal-grid-bulan" });
    kal.BULAN_PENDEK.forEach((nama, i) => {
      const kode = `${p.tahun}-${String(i + 1).padStart(2, "0")}`;
      const [kiri, kanan] = bulanTampil(tata).length === 2 ? bulanTampil(tata) : [null, bulanTampil(tata)[0]];
      const tampil = p.sisi === "kiri" ? kiri : kanan;
      const b = el("button", {
        type: "button",
        teks: nama,
        "aria-pressed": String(tampil && tampil.tahun === p.tahun && tampil.bulan === i + 1),
        onclick: () => {
          const dipilih = { tahun: p.tahun, bulan: i + 1 };
          // Bulan kiri yang dipilih → bulan kanan tepat sesudahnya.
          k.kanan = p.sisi === "kiri" ? kal.geserBulan(dipilih, 1) : dipilih;
          k.pilihBulan = null;
          gambarKalender();
        },
      });
      b.disabled = kode > hariIni.slice(0, 7);
      grid.append(b);
    });
    return el("div", { kelas: "kal-bulan" }, kepala, grid);
  }

  function bangunKalender(tata) {
    const k = panel.kal;
    const r = rentangSekarang();
    const hariIni = kal.hariIniWib(Date.now());
    const cepat = kal.PILIHAN_CEPAT.map((p) => {
      const rr = kal.rentangCepat(p.kunci, hariIni);
      return { ...p, r: rr, aktif: Boolean(panel.tampilan.rentang) && rr.dari === r.dari && rr.sampai === r.sampai };
    });

    const bulan = el("div", { kelas: "kal-bulan-bulan" });
    if (k.pilihBulan) bulan.append(pilihBulanKalender(tata));
    else {
      const daftar = bulanTampil(tata);
      daftar.forEach((b, i) => bulan.append(satuBulan(b, tata, daftar.length === 2 ? (i === 0 ? "kiri" : "kanan") : "satu")));
    }

    // Klik / tarik di hari mana pun.
    const tanggalDi = (x, y) => {
      const t = panel.akar.elementFromPoint(x, y)?.closest?.("[data-tanggal]");
      return t && !t.disabled ? t.dataset.tanggal : "";
    };
    bulan.addEventListener("pointerdown", (ev) => {
      k.abaikanKlik = false;
      if (ev.button !== 0) return;
      const t = ev.target.closest?.("[data-tanggal]");
      if (!t || t.disabled) return;
      k.tekan = { jangkar: t.dataset.tanggal, terakhir: t.dataset.tanggal, pindah: false };
    });
    bulan.addEventListener("pointermove", (ev) => {
      const t = tanggalDi(ev.clientX, ev.clientY);
      const p = k.tekan;
      if (p) {
        if (!t || (!p.pindah && t === p.jangkar)) return;
        p.pindah = true;
        p.terakhir = t;
        k.jangkar = p.jangkar;
        k.ujung = t;
        segarkanKalender(pop);
        return;
      }
      if (k.jangkar && t && ev.pointerType === "mouse" && t !== k.ujung) {
        k.ujung = t;
        segarkanKalender(pop);
      }
    });
    const lepas = () => {
      const p = k.tekan;
      k.tekan = null;
      if (!p?.pindah) return;
      k.abaikanKlik = true; // klik yang menyusul tarikan bukan klik pertama rentang baru
      terapkanRentang(kal.urutkanRentang(p.jangkar, p.terakhir));
    };
    bulan.addEventListener("pointerup", lepas);
    bulan.addEventListener("pointercancel", () => (k.tekan = null));
    bulan.addEventListener("click", (ev) => {
      const t = ev.target.closest?.("[data-tanggal]");
      if (!t || t.disabled) return;
      if (k.abaikanKlik) {
        k.abaikanKlik = false;
        return;
      }
      if (!k.jangkar) {
        k.jangkar = t.dataset.tanggal;
        k.ujung = t.dataset.tanggal;
        segarkanKalender(pop);
        return;
      }
      terapkanRentang(kal.urutkanRentang(k.jangkar, t.dataset.tanggal));
    });

    const kaki = el(
      "div",
      { kelas: "kal-kaki" },
      el("p", { "aria-live": "polite" }, el("span", { kelas: "ikon-bulat" }, ikon("tunjuk")), el("span", { kelas: "kal-petunjuk-teks", teks: petunjukKalender() })),
      el("button", {
        type: "button",
        kelas: "kal-tombol kal-ulangi",
        teks: "Ulangi",
        onclick: () => {
          k.jangkar = "";
          k.ujung = "";
          segarkanKalender(pop);
        },
      }),
      el("button", { type: "button", kelas: "kal-tombol", teks: "Tutup", onclick: tutupKalender }),
    );

    const tombolCepat = (p, chip) =>
      el(
        "button",
        { type: "button", kelas: chip ? "kal-chip" : "", "aria-pressed": String(p.aktif), onclick: () => terapkanRentang(p.r) },
        chip ? p.label : el("span", { kelas: "kal-cepat-nama" }, p.aktif ? ikon("centang") : null, p.label),
        chip ? null : el("span", { kelas: "kal-cepat-tgl", teks: kal.labelRentang(p.r.dari, p.r.sampai, { tahun: false }) }),
      );

    const utama = el(
      "div",
      { kelas: "kal-utama" },
      tata === "sempit" ? el("div", { kelas: "kal-chip-baris", role: "group", "aria-label": "Pilihan cepat" }, ...cepat.map((p) => tombolCepat(p, true))) : null,
      ringkasanKalender(),
      bulan,
      kaki,
    );
    const pop = el(
      "div",
      { kelas: `kal-pop ${tata}`, role: "dialog", "aria-label": "Pilih rentang tanggal" },
      tata === "sempit"
        ? null
        : el(
            "div",
            { kelas: "kal-cepat", role: "group", "aria-label": "Pilihan cepat" },
            el("p", { kelas: "kal-cepat-judul" }, el("span", { kelas: "ikon-bulat" }, ikon("kilat")), "Pilihan cepat"),
            ...cepat.map((p) => tombolCepat(p, false)),
          ),
      utama,
    );
    for (const jenis of ["keydown", "keyup", "keypress"]) pop.addEventListener(jenis, (ev) => ev.stopPropagation());
    pop.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") tutupKalender();
    });
    segarkanKalender(pop);
    return pop;
  }

  /** Gambar (ulang) kalender di samping panel. Dipanggil di akhir gambar() dan saat ganti bulan. */
  function gambarKalender() {
    if (!panel.kal?.buka || !kal) return;
    const kotak = panel.wadah.querySelector(".kotak");
    const pemicu = panel.wadah.querySelector(".pemicu-rentang");
    if (!kotak || !pemicu) return;
    const rk = kotak.getBoundingClientRect();
    const kiri = panel.tampilan.posisi === "kiri";
    const ruang = (kiri ? innerWidth - rk.right : rk.left) - 24;
    const tata = kal.tataLetakKalender(ruang);
    const pop = bangunKalender(tata);
    const lama = panel.wadah.querySelector(".kal-pop");
    if (lama) lama.replaceWith(pop);
    else panel.wadah.append(pop);
    // Di samping panel; "sempit" menumpang di atas panel itu sendiri.
    if (tata === "sempit") {
      pop.style.left = `${rk.left}px`;
      pop.style.width = `${rk.width}px`;
    } else if (kiri) pop.style.left = `${rk.right + 12}px`;
    else pop.style.right = `${innerWidth - rk.left + 12}px`;
    const tinggi = pop.getBoundingClientRect().height;
    const atas = Math.max(12, Math.min(pemicu.getBoundingClientRect().top, innerHeight - 12 - tinggi));
    pop.style.top = `${atas}px`;
  }

  // Klik di luar kalender (di halaman, atau di bagian panel lain) menutupnya.
  document.addEventListener(
    "pointerdown",
    (ev) => {
      if (panel?.kal?.buka && !ev.composedPath().includes(panel.host)) tutupKalender();
    },
    true,
  );
  addEventListener("resize", () => {
    if (panel?.kal?.buka) gambarKalender();
  });

  function periodeProfil(data, adaItemList) {
    const atur = panel.tampilan.periode === "atur";
    const hari = atur ? null : panel.tampilan.periode;
    const rentang = rentangSekarang();
    const segmen = el("div", { kelas: "segmen", role: "group", "aria-label": "Periode" });
    for (const n of [7, 30, 90]) {
      segmen.append(el("button", { type: "button", "aria-pressed": String(n === hari), teks: `${n}H`, title: `${n} hari`, onclick: () => ubahTampilan({ periode: n }) }));
    }
    segmen.append(
      el("button", {
        type: "button",
        "aria-pressed": String(atur),
        teks: "Atur",
        title: "Pilih tanggal sendiri",
        onclick: () => {
          const pertama = !panel.tampilan.rentang;
          ubahTampilan({ periode: "atur", rentang });
          if (pertama) bukaKalender(); // belum pernah memilih tanggal → langsung tampilkan kalendernya
        },
      }),
    );
    const isi = [el("div", { kelas: "judul-blok" }, el("span", { teks: "Periode" }), segmen)];

    let j;
    if (atur) {
      const terbuka = Boolean(panel.kal?.buka);
      isi.push(
        el(
          "button",
          {
            type: "button",
            kelas: "pemicu-rentang",
            "aria-haspopup": "dialog",
            "aria-expanded": String(terbuka),
            onclick: () => (terbuka ? tutupKalender() : bukaKalender()),
          },
          ikon("kalender"),
          el("span", { teks: kal.labelRentang(rentang.dari, rentang.sampai) }),
          el("span", { kelas: "kal-jumlah-kecil", teks: `${kal.jumlahHari(rentang.dari, rentang.sampai)} hari` }),
          ikon("bawah"),
        ),
      );
      j = alat.jendelaRentang(rentang.dari, rentang.sampai, Date.now());
      if (j.galat) {
        isi.push(el("div", { kelas: "status galat", role: "status" }, ikon("awas"), el("span", { teks: TEKS_GALAT_RENTANG[j.galat] })));
        return el("div", { kelas: "blok" }, ...isi);
      }
    } else {
      j = alat.jendelaPeriode(hari, Date.now());
    }
    const panjangHari = Math.round((j.akhir - j.awal) / 86_400);
    const pembanding = alat.jendelaPembanding(j);
    const r = alat.ringkasJendela(data.posting, j, { jumlahVideo: data.jumlahVideo, sekarangMs: Date.now() });
    const fmt = atur ? tanggalTahun : tanggalPendek;
    const lengkap = r.lengkapLalu && r.lengkapKini;

    const tabel = el("div", { kelas: "tabel" });
    // Video periode ini belum termuat semua → angkanya sebagian; tampilkan "—", bukan angka yang salah.
    const baris = (label, kini, lama, format, poin = false, lengkapBaris = lengkap) =>
      tabel.append(
        el("span", { kelas: "l", teks: label }),
        el("span", { kelas: "v", teks: r.lengkapKini ? format(kini) : "—" }),
        lencanaUbah(kini, lama, lengkapBaris, poin),
      );
    const n = (x) => alat.angkaPendek(x ?? undefined);
    baris("Video diunggah", r.kini.video, r.lalu.video, n);
    baris("Total views", r.kini.views, r.lalu.views, n);
    baris("Rata-rata views", r.kini.rataViews, r.lalu.rataViews, n);
    // Median di samping rata-rata: satu video viral menarik total dan rata-rata, median tidak.
    baris("Median views", r.kini.medianViews, r.lalu.medianViews, n);
    baris("Like", r.kini.like, r.lalu.like, n);
    baris("Komentar", r.kini.komentar, r.lalu.komentar, n);
    baris("Share", r.kini.share, r.lalu.share, n);
    baris("Simpan", r.kini.save, r.lalu.save, n);
    baris("ER", r.kini.er, r.lalu.er, (x) => alat.teksPersen(x), true);

    if (r.lengkapKini) {
      isi.push(
        grafikPeriode(alat.deretJendela(data.posting, j), lengkap),
        el(
          "div",
          { kelas: "legenda" },
          el("span", {}, el("i", { kelas: "kini" }), "Periode ini"),
          lengkap ? el("span", {}, el("i", { kelas: "lalu" }), `${panjangHari} hari sebelumnya`) : null,
          el("span", { kelas: "redup", teks: "views per hari unggah" }),
        ),
      );
    }
    isi.push(tabel);
    const tgl = (detik) => fmt.format(detik * 1000);
    isi.push(
      el("div", {
        kelas: "catatan",
        teks:
          `Semua angka dari video yang diunggah ${tgl(j.awal)} – ${tgl(j.akhir - 1)}, dibanding video ${tgl(pembanding.awal)} – ${tgl(pembanding.akhir - 1)}.` +
          (r.mudaKini > 0
            ? ` ${r.mudaKini} video berumur < 48 jam — views-nya masih naik, jadi periode ini bisa tampak lebih rendah.`
            : "") +
          (atur ? "" : " Periode berakhir 48 jam lalu supaya video yang masih muda tidak membuatnya tampak turun."),
      }),
    );

    const batasMuat = pembanding.awal;
    if (!lengkap) {
      const kunciPeriode = atur ? `${rentang.dari}_${rentang.sampai}` : String(hari);
      const kunci = `${location.href}|${kunciPeriode}`;
      if (muatLama.aktif) {
        isi.push(el("div", { kelas: "status baik", role: "status" }, ikon("ulang"), el("span", { teks: `Memuat video lama untuk pembanding… (${data.posting.length} video terbaca)` })));
      } else if (adaItemList && pengurai.MAKS_POSTING > 0 && !muatLama.dicoba.has(kunci)) {
        // Jalan sesudah gambar selesai dan sesudah TikTok sempat menampilkan daftar videonya.
        setTimeout(() => muatVideoLama(kunciPeriode, batasMuat).catch(() => {}), 1500);
      } else {
        const batasPenuh = data.posting.length >= pengurai.MAKS_POSTING;
        isi.push(
          el("div", {
            kelas: "catatan",
            teks: batasPenuh
              ? `Pembanding ini butuh lebih dari ${pengurai.MAKS_POSTING} video untuk akun ini — pakai rentang yang lebih pendek atau lebih baru.`
              : `${PLATFORM === "INSTAGRAM" ? "Posting" : "Video"} lama belum termuat semua, jadi naik/turun belum bisa dihitung.`,
          }),
        );
        if (!batasPenuh) {
          isi.push(
            el("button", {
              type: "button",
              kelas: "tautan",
              teks: "Coba muat lagi",
              onclick: () => {
                muatLama.dicoba.delete(kunci);
                muatVideoLama(kunciPeriode, batasMuat).catch(() => {});
              },
            }),
          );
        }
      }
    }
    // Periode siap pakai berakhir 48 jam lalu: sebutkan video yang lebih baru yang tidak ikut.
    if (r.mudaDilewati && !atur) isi.push(el("div", { kelas: "catatan", teks: `${r.mudaDilewati} video < 48 jam belum dihitung (views-nya masih naik).` }));
    return el("div", { kelas: "blok" }, ...isi);
  }

  /** Harga yang diketik per akun selama halaman terbuka (tidak disimpan ke mana pun). */
  const hargaDiketik = new Map();

  const POSISI_HARGA = {
    DI_BAWAH: { kelas: "MURAH", teks: "di bawah yang biasa Elorae bayar" },
    DALAM: { kelas: "WAJAR", teks: "dalam rentang yang biasa Elorae bayar" },
    DI_ATAS: { kelas: "MAHAL", teks: "di atas yang biasa Elorae bayar" },
  };

  /**
   * Harga per video. Patokan HANYA dari kolaborasi berbayar Elorae (GET /patokan): kuartil bawah,
   * median, kuartil atas harga per 1.000 views yang pernah dibayar. Tanpa patokan yang cukup, panel
   * tidak menebak — hanya menghitung harga per 1.000 views dari harga yang diketik.
   */
  function hargaProfil(handle, r) {
    const pk = panel.patokan;
    const patokan = pk?.ok ? pk.patokan : null;
    const isi = [el("div", { kelas: "judul-blok" }, el("span", { teks: "Harga per video" }))];
    if (r.medianViews == null) {
      isi.push(el("div", { kelas: "catatan", teks: "Butuh paling sedikit 3 video berumur 48 jam untuk menghitung median views." }));
      return el("div", { kelas: "blok" }, ...isi);
    }
    const perkiraan = alat.perkiraanHarga(r.medianViews, patokan);
    if (perkiraan) {
      isi.push(
        el("div", { kelas: "harga bulat", teks: `${alat.rupiahPendek(perkiraan.bawah)} – ${alat.rupiahPendek(perkiraan.atas)}` }),
        el("div", {
          kelas: "catatan",
          teks:
            `Median ${alat.angkaPendek(r.medianViews)} views × ${alat.rupiahPendek(patokan.p25)}–${alat.rupiahPendek(patokan.p75)} per 1.000 views ` +
            `(tengah ${alat.rupiahPendek(patokan.median)}): separuh dari ${patokan.n} kolaborasi berbayar Elorae dibayar di rentang itu.`,
        }),
      );
    } else if (patokan) {
      isi.push(
        el("div", {
          kelas: "catatan",
          teks:
            `Belum ada patokan: Elorae baru punya ${patokan.n} kolaborasi berbayar yang sudah tayang dengan views berumur ≥ ${patokan.hariMinViews} hari ` +
            `(butuh ${patokan.minSampel}). Patokan muncul sendiri begitu datanya cukup.`,
        }),
      );
    } else {
      isi.push(
        el("div", {
          kelas: "catatan",
          teks:
            pk?.kode === "BELUM_TERSAMBUNG"
              ? "Sambungkan ekstensi ke Elorae untuk memakai patokan dari kolaborasi Anda."
              : "Patokan dari Elorae tidak terbaca. Tekan tombol putar untuk mencoba lagi.",
        }),
      );
    }
    const lencana = el("span", { kelas: "lencana", hidden: "" });
    const perbaruiLencana = (teks) => {
      const nilai = alat.nilaiHargaDiminta(alat.bacaRupiah(teks), r.medianViews, patokan);
      if (!nilai) {
        lencana.hidden = true;
        return;
      }
      const pos = nilai.posisi ? POSISI_HARGA[nilai.posisi] : null;
      lencana.hidden = false;
      lencana.className = `lencana ${pos ? pos.kelas : "netral"}`;
      lencana.textContent = `${alat.rupiahPendek(nilai.cpm)} per 1.000 views${pos ? ` · ${pos.teks}` : ""}`;
    };
    const masukan = el("input", {
      type: "text",
      inputmode: "decimal",
      placeholder: "Harga diminta, mis. 15jt",
      "aria-label": "Harga yang diminta KOL",
      value: hargaDiketik.get(handle) ?? "",
    });
    // Tombol keyboard TikTok (panah, spasi, L…) tidak boleh ikut bereaksi saat mengetik di sini.
    for (const jenis of ["keydown", "keyup", "keypress"]) masukan.addEventListener(jenis, (ev) => ev.stopPropagation());
    masukan.addEventListener("input", () => {
      hargaDiketik.set(handle, masukan.value);
      perbaruiLencana(masukan.value);
    });
    masukan.addEventListener("focus", () => {
      panel.mengetik = true;
    });
    masukan.addEventListener("blur", () => {
      panel.mengetik = false;
      if (!panel.tertunda) return;
      // Ditunda sedikit: blur terjadi saat tombol ditekan, dan menggambar ulang seketika akan
      // menghapus tombol yang sedang diklik (mis. 7H) sebelum kliknya sampai.
      setTimeout(() => {
        if (panel.mengetik || !panel.tertunda) return;
        panel.tertunda = false;
        gambar(pengurai?.jenisHalaman(location.href));
      }, 300);
    });
    perbaruiLencana(masukan.value);
    isi.push(el("div", { kelas: "isian" }, masukan, lencana));
    return el("div", { kelas: "blok" }, ...isi);
  }

  /** Pengaturan tampilan langsung di panel (tombol gerigi) — sama dengan bagian Tampilan di popup. */
  function blokAtur() {
    const t = panel.tampilan;
    const segmen = (kunci, pilihan) => {
      const g = el("div", { kelas: "segmen", role: "group" });
      for (const [nilai, label] of pilihan) {
        g.append(el("button", { type: "button", "aria-pressed": String(t[kunci] === nilai), teks: label, onclick: () => ubahTampilan({ [kunci]: nilai }) }));
      }
      return g;
    };
    const warna = el("div", { kelas: "swatch-baris", role: "group", "aria-label": "Warna" });
    for (const [kunci, { nama }] of Object.entries(gaya.AKSEN)) {
      const b = el("button", { type: "button", kelas: "swatch", title: nama, "aria-label": nama, "aria-pressed": String(t.aksen === kunci), onclick: () => ubahTampilan({ aksen: kunci }) });
      b.style.background = kunci === "mono" ? "linear-gradient(135deg, #f5f3fb 50%, #17151d 50%)" : gaya.warnaAksen(kunci, "gelap").aksen;
      warna.append(b);
    }
    const sendiri = !(t.aksen in gaya.AKSEN);
    const pilih = el("input", { type: "color", value: sendiri ? t.aksen : "#c9b8ff", "aria-label": "Pilih warna sendiri" });
    pilih.addEventListener("change", () => ubahTampilan({ aksen: pilih.value }));
    for (const jenis of ["keydown", "keyup", "keypress"]) pilih.addEventListener(jenis, (ev) => ev.stopPropagation());
    const lain = el("span", { kelas: "swatch", title: "Pilih warna sendiri", "aria-pressed": String(sendiri) }, pilih);
    lain.style.background = sendiri ? t.aksen : "conic-gradient(#ff8a73, #ffd75e, #7fe3b4, #7cb7ff, #c9b8ff, #ff8a73)";
    warna.append(lain);
    const baris = (label, isi) => el("div", { kelas: "baris-atur" }, el("span", { teks: label }), isi);
    return el(
      "div",
      { kelas: "blok atur" },
      el("div", { kelas: "judul-blok" }, el("span", { teks: "Tampilan" })),
      baris("Tema", segmen("tema", [["otomatis", "Otomatis"], ["terang", "Terang"], ["gelap", "Gelap"]])),
      baris("Warna", warna),
      baris("Ukuran", segmen("ukuran", [["lengkap", "Lengkap"], ["ringkas", "Ringkas"]])),
      baris("Posisi", segmen("posisi", [["kiri", "Kiri"], ["kanan", "Kanan"]])),
    );
  }

  function isiProfil(h, data, lengkap) {
    if (PLATFORM === "YOUTUBE") {
      // Halaman kanal hanya memuat angka ringkas ("46,5 jt subscriber"): pengikut perkiraan, tanpa ER.
      const awalan = data.pengikutPerkiraan ? "± " : "";
      return {
        bagian: [
          el(
            "div",
            { kelas: "ubin" },
            ubin(`${awalan}${alat.angkaPendek(data.pengikut)}`, "subscriber", `${awalan}${alat.angkaLengkap(data.pengikut)} subscriber${data.pengikutPerkiraan ? " (dibulatkan YouTube)" : ""}`),
            ubin("—", "ER kanal tidak dihitung", "YouTube hanya menampilkan angka kanal yang dibulatkan.", true),
          ),
          el("div", { kelas: "catatan", teks: "Buka videonya untuk angka per video (views persis, like, komentar). ER kanal YouTube tidak dihitung." }),
        ],
        er: null,
      };
    }
    const ig = PLATFORM === "INSTAGRAM";
    const r = alat.ringkasAkun(data.posting, data.pengikut, Date.now(), { jumlahVideo: data.jumlahVideo });
    const judulEr = ig
      ? "Rata-rata ER per posting ber-views atas ≤ 12 posting terbaru (bukan pin, berumur ≥ 48 jam): (like + komentar) ÷ views — share dan simpan tidak publik di Instagram, jadi ER ini lebih rendah dari ER TikTok."
      : "Rata-rata ER per video atas ≤ 12 video terbaru (bukan pin, berumur ≥ 48 jam): " +
        "(like + komentar + share + save) ÷ views. Rumusnya sama dengan yang disimpan Elorae.";
    const satuan = ig ? "posting" : "video";
    const bagian = [
      el(
        "div",
        { kelas: "ubin" },
        ubin(alat.angkaPendek(data.pengikut), "pengikut", `${alat.angkaLengkap(data.pengikut)} pengikut`),
        ubin(alat.teksPersen(r.er), r.er == null ? "ER belum terhitung" : `ER · ${r.postsCounted} ${satuan}`, judulEr, true),
      ),
    ];
    if (lengkap) {
      bagian.push(statistikAkun(r), periodeProfil(data, h.adaItemList));
      const grafik = grafikViews(data.posting, r);
      if (grafik) bagian.push(grafik);
      // Patokan harga Elorae dihitung dari kolaborasi TikTok saja.
      if (!ig) bagian.push(hargaProfil(data.uniqueId, r));
      const chipBaris = [];
      if (data.totalLike !== undefined) chipBaris.push(chip("like", alat.angkaPendek(data.totalLike), "like", `${alat.angkaLengkap(data.totalLike)} like`));
      if (data.jumlahVideo !== undefined) chipBaris.push(chip("video", alat.angkaPendek(data.jumlahVideo), satuan, `${alat.angkaLengkap(data.jumlahVideo)} ${satuan}`));
      if (chipBaris.length) bagian.push(el("div", { kelas: "chip-baris" }, ...chipBaris));
    }
    if (!h.adaItemList) {
      bagian.push(
        el("div", {
          kelas: "catatan",
          teks: ig
            ? "Posting belum tertangkap. Instagram hanya memuat posting untuk pengguna yang sudah masuk — masuk ke Instagram di Chrome ini, lalu gulir sedikit ke daftar posting agar ER dan periode terhitung."
            : "Daftar video belum tertangkap. Gulir sedikit ke daftar video atau muat ulang halaman agar ER dan periode terhitung.",
        }),
      );
    } else if (r.er == null) {
      bagian.push(el("div", { kelas: "catatan", teks: `ER butuh paling sedikit 3 ${ig ? "posting ber-views (reel)" : "video"} yang berumur 48 jam dan bukan pin.` }));
    }
    return { bagian, er: r.er };
  }

  function isiKonten(data, lengkap) {
    const er = alat.erPosting(data);
    // Instagram/YouTube tidak menampilkan semua angka: yang tidak terbaca tidak ditampilkan (bukan 0).
    const judulEr = PLATFORM === "TIKTOK" ? "(like + komentar + share + save) ÷ views" : "(like + komentar) ÷ views — share dan simpan tidak publik di platform ini";
    const bagian = [
      el(
        "div",
        { kelas: "ubin" },
        ubin(alat.angkaPendek(data.views), "views", data.views === undefined ? "Views tidak tampil untuk konten ini" : `${alat.angkaLengkap(data.views)} views`),
        ubin(alat.teksPersen(er), PLATFORM === "TIKTOK" ? "ER video ini" : "ER konten ini", judulEr, true),
      ),
    ];
    if (lengkap) {
      const chipBaris = [];
      if (data.like !== undefined) chipBaris.push(chip("like", alat.angkaPendek(data.like), "like", `${alat.angkaLengkap(data.like)} like`));
      if (data.komentar !== undefined) chipBaris.push(chip("komentar", alat.angkaPendek(data.komentar), "komentar", `${alat.angkaLengkap(data.komentar)} komentar`));
      if (data.share !== undefined) chipBaris.push(chip("share", alat.angkaPendek(data.share), "share", `${alat.angkaLengkap(data.share)} share`));
      if (data.save !== undefined) chipBaris.push(chip("save", alat.angkaPendek(data.save), "simpan", `${alat.angkaLengkap(data.save)} simpan`));
      if (chipBaris.length) bagian.push(el("div", { kelas: "chip-baris" }, ...chipBaris));
      if (Number.isFinite(data.dibuatPada) && data.dibuatPada > 0) {
        const umurHari = Math.max(0, (Date.now() - data.dibuatPada * 1000) / 86_400_000);
        const perHari = umurHari >= 1 && Number.isFinite(data.views) ? Math.round(data.views / umurHari) : null;
        bagian.push(
          el("div", {
            kelas: "catatan",
            teks:
              `Diunggah ${tanggalPanjang.format(data.dibuatPada * 1000)} · ${umurHari < 1 ? "kurang dari sehari" : `${Math.floor(umurHari)} hari`} lalu` +
              (perHari != null ? ` · ± ${alat.angkaPendek(perHari)} views/hari` : ""),
          }),
        );
      }
    }
    return { bagian, er };
  }

  /** "Profil TikTok", "Reel Instagram", "Posting Instagram", "Kanal YouTube", "Shorts YouTube", … */
  function labelJenis(target, data) {
    if (target.jenis === "PROFIL") return PLATFORM === "YOUTUBE" ? "Kanal YouTube" : `Profil ${LABEL_PLATFORM}`;
    const bentuk = data?.bentuk ?? target.bentuk;
    if (PLATFORM === "INSTAGRAM") return bentuk === "REEL" ? "Reel Instagram" : "Posting Instagram";
    if (PLATFORM === "YOUTUBE") return bentuk === "SHORTS" ? "Shorts YouTube" : "Video YouTube";
    return "Video TikTok";
  }

  function gambar(target) {
    if (!panel || !target || !alat || !gaya) return;
    terapkanTema();
    const w = panel.wadah;
    w.replaceChildren();
    const posisi = panel.tampilan.posisi === "kiri" ? " kiri" : "";
    const lengkap = panel.tampilan.ukuran === "lengkap";
    const h = hasilTerakhir ?? { status: "TIDAK_TERBACA" };
    const data = h.data;
    const ok = Boolean(data && h.status === "OK");
    const isi = ok ? (data.jenis === "PROFIL" ? isiProfil(h, data, lengkap) : isiKonten(data, lengkap)) : null;

    if (panel.kecil) {
      w.append(
        el(
          "button",
          { kelas: `pil${posisi}`, title: "Buka panel Elorae", "aria-label": "Buka panel Elorae", onclick: () => setelKecil(false) },
          el("span", { kelas: "logo bulat", teks: "e" }),
          "Elorae",
          isi?.er != null ? el("span", { kelas: "er bulat", teks: `ER ${alat.teksPersen(isi.er)}` }) : null,
        ),
      );
      return;
    }

    const kepala = el(
      "div",
      { kelas: "kepala" },
      el("span", { kelas: "logo bulat", teks: "e" }),
      el("span", { kelas: "merek bulat", teks: "Elorae" }),
      el("span", { kelas: "sub", teks: "pantau KOL" }),
      el(
        "span",
        { kelas: "isi-kanan" },
        el(
          "button",
          {
            kelas: "kecil",
            title: "Tema, warna, ukuran, posisi",
            "aria-label": "Atur tampilan panel",
            "aria-expanded": String(Boolean(panel.atur)),
            onclick: () => {
              panel.atur = !panel.atur;
              gambar(pengurai?.jenisHalaman(location.href));
            },
          },
          ikon("atur"),
        ),
        el(
          "button",
          {
            kelas: "kecil",
            title: lengkap ? "Tampilan ringkas" : "Tampilan lengkap",
            "aria-label": lengkap ? "Tampilan ringkas" : "Tampilan lengkap",
            onclick: () => ubahTampilan({ ukuran: lengkap ? "ringkas" : "lengkap" }),
          },
          ikon(lengkap ? "sempit" : "lebar"),
        ),
        el("button", { kelas: "kecil", title: "Kecilkan", "aria-label": "Kecilkan panel", onclick: () => setelKecil(true) }, ikon("kecil")),
      ),
    );
    const handle = data?.uniqueId ?? target.handle ?? "";
    const siapa = el(
      "div",
      { kelas: "siapa" },
      el("div", { kelas: "avatar bulat", teks: alat.inisial(handle) }),
      el("div", { style: "min-width:0" }, el("div", { kelas: "nama", teks: handle ? "@" + handle : LABEL_PLATFORM }), el("div", { kelas: "jenis", teks: labelJenis(target, data) })),
    );

    const kartu = el("div", { kelas: `kotak${posisi}${panel.animasi ? " masuk" : ""}`, role: "region", "aria-label": "Panel Elorae" }, kepala, panel.atur ? blokAtur() : null, siapa);
    panel.animasi = false;

    if (isi) {
      kartu.append(...isi.bagian);
    } else {
      let teks = TEKS_STATUS[h.status] ?? TEKS_STATUS.TIDAK_TERBACA;
      if (h.alasan === "DATA_TIDAK_COCOK") teks = "Halaman berganti tanpa dimuat ulang. Muat ulang (F5) agar angkanya terbaca.";
      else if (h.alasan === "ANGKA_TIDAK_TERBACA" && h.kurang?.length) teks = `Angka tidak terbaca: ${h.kurang.join(", ")}. Muat ulang halaman lalu coba lagi.`;
      kartu.append(el("div", { kelas: "status galat", role: "status" }, ikon("awas"), el("span", { teks })));
    }

    // Kabar kiriman otomatis — diam bila "Simpan ke Elorae" baru saja memberi pesannya sendiri.
    if (kabarOtomatis?.url === location.href && !pesanSimpan) {
      const k = kabarOtomatis;
      kartu.append(
        el(
          "div",
          { kelas: `kabar-otomatis ${k.jenis}`, role: "status" },
          ikon(k.jenis === "galat" ? "awas" : k.jenis === "sorot" ? "video" : "centang"),
          el("span", { teks: k.teks }),
          k.tautan ? el("a", { href: k.tautan, target: "_blank", rel: "noopener noreferrer", teks: "Buka" }) : null,
        ),
      );
    }

    if (pesanSimpan) {
      kartu.append(
        el("div", { kelas: `status ${pesanSimpan.baik ? "baik" : "galat"}`, role: "status" }, ikon(pesanSimpan.baik ? "centang" : "awas"), el("span", { teks: pesanSimpan.teks })),
      );
    }

    const tombolSimpan = el("button", { kelas: "utama bulat", teks: menyimpan ? "Menyimpan…" : "Simpan ke Elorae", onclick: simpan });
    if (!ok || menyimpan) tombolSimpan.disabled = true;
    const tombolBaca = el(
      "button",
      {
        kelas: membaca ? "bundar berputar" : "bundar",
        title: "Baca ulang angka di halaman ini",
        "aria-label": "Baca ulang",
        onclick: () => {
          pesanSimpan = null;
          membaca = true;
          gambar(pengurai?.jenisHalaman(location.href));
          perbaruiPanel(true);
        },
      },
      ikon("ulang"),
    );
    kartu.append(el("div", { kelas: "tombol" }, tombolSimpan, tombolBaca));
    w.append(kartu);
    if (panel.kal?.buka) {
      if (panel.tampilan.periode === "atur" && kal) gambarKalender();
      else panel.kal = null;
    }
  }

  async function simpan() {
    const h = hasilTerakhir;
    if (!h || h.status !== "OK" || menyimpan) return;
    menyimpan = true;
    pesanSimpan = null;
    gambar(pengurai?.jenisHalaman(location.href));
    const jawaban = await kirimKeLatar({ jenis: "simpanManual", url: location.href, data: h.data });
    menyimpan = false;
    if (jawaban?.ok) {
      const nama = jawaban.cocok?.nama ? jawaban.cocok.nama : "KOL ini";
      const d = jawaban.dibuat ?? {};
      const teks =
        d.kol && d.konten
          ? `KOL baru ${nama} dibuat di Elorae, videonya mulai dipantau, angkanya tersimpan.`
          : d.kol
            ? `KOL baru ${nama} dibuat di Elorae dan angkanya tersimpan.`
            : d.konten
              ? `Video ini ditambahkan ke ${nama} dan mulai dipantau; angkanya tersimpan.`
              : `Tersimpan untuk ${nama}.`;
      pesanSimpan = { baik: true, teks };
    } else {
      const kode = jawaban?.kode ?? "JARINGAN";
      pesanSimpan = { baik: false, teks: TEKS_SIMPAN[kode] ?? `Gagal menyimpan (${kode}).` };
    }
    gambar(pengurai?.jenisHalaman(location.href));
  }

  // ------------------------------------------------ kiriman otomatis (tanpa tombol)
  async function sakelarKirimNyala(at) {
    try {
      const r = await chrome.storage.local.get(at.KUNCI_SAKELAR_KIRIM_OTOMATIS);
      return at.sakelarKirimOtomatis(r?.[at.KUNCI_SAKELAR_KIRIM_OTOMATIS]);
    } catch {
      return false;
    }
  }

  /**
   * Bacaan lengkap → minta service worker mengirimnya (service worker memutuskan ulang semuanya:
   * sambungan, sakelar, tab otomatis, 6 jam per akun/video). Di sini hanya penyaring murah supaya
   * setiap bacaan ulang (gulir, tangkapan daftar video) tidak mengirim pesan berisi 200 posting.
   */
  async function kirimOtomatisBilaPerlu(h) {
    const at = await muatAturan.catch(() => null);
    if (!at || !panel) return;
    const url = location.href;
    if (!at.bacaanLengkap(h, url)) return;
    const kunci = at.kunciKirimOtomatis(h.data);
    if (!kunci || sedangKirimOtomatis.has(kunci) || (tanyaOtomatisLagi.get(kunci) ?? 0) > Date.now()) return;
    if (!(await sakelarKirimNyala(at))) return;
    sedangKirimOtomatis.add(kunci);
    let jawaban = null;
    try {
      jawaban = await kirimKeLatar({ jenis: "kirimOtomatis", url, data: h.data, adaItemList: h.adaItemList === true });
    } finally {
      sedangKirimOtomatis.delete(kunci);
    }
    tanyaOtomatisLagi.set(kunci, jawaban?.selesai ? Infinity : Date.now() + JEDA_TANYA_ULANG_MS);
    if (!panel || location.href !== url) return;
    const tampil = at.teksKabarOtomatis(jawaban?.kabar);
    if (!tampil) return;
    kabarOtomatis = { url, ...tampil, tautan: tampil.jenis === "sorot" ? (jawaban?.performaUrl ?? null) : null };
    if (panel.mengetik) panel.tertunda = true;
    else gambar(pengurai?.jenisHalaman(location.href));
  }

  /** Sakelar di popup dinyalakan lagi → halaman yang sedang terbuka langsung ikut dikirim. */
  function pantauSakelarKirim() {
    chrome.storage.onChanged.addListener((perubahan, area) => {
      if (area !== "local" || !aturan || !(aturan.KUNCI_SAKELAR_KIRIM_OTOMATIS in perubahan)) return;
      tanyaOtomatisLagi.clear();
      if (aturan.sakelarKirimOtomatis(perubahan[aturan.KUNCI_SAKELAR_KIRIM_OTOMATIS].newValue)) {
        kirimOtomatisBilaPerlu(hasilTerakhir).catch(() => {});
      }
    });
  }

  function mulaiPanel() {
    // Beri waktu TikTok menghidrasi halaman sebelum panel pertama dibaca.
    setTimeout(() => bangunPanel().catch(() => {}), 1500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mulaiPanel, { once: true });
  else mulaiPanel();
})();
