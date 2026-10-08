// Skrip konten dunia ISOLATED di www.tiktok.com (document_start).
// - menampung daftar video yang ditangkap halaman-utama.js (postMessage, sumber divalidasi);
// - menjawab permintaan "bacaHalaman" dari service worker (putaran otomatis);
// - mode manual: panel kecil di kanan bawah halaman profil/video dengan tombol "Simpan ke Elorae",
//   TIDAK ditampilkan di tab latar yang dibuka putaran otomatis.
// Skrip klasik: lib/pengurai.js dimuat dengan import() dinamis (terdaftar di
// web_accessible_resources khusus www.tiktok.com).
(() => {
  "use strict";
  if (window.top !== window) return;
  if (globalThis.__eloraeKreatifKonten) return;
  globalThis.__eloraeKreatifKonten = true;

  // Sama dengan TAG di halaman-utama.js.
  const TAG = "elorae-kreatif:item-list:v1";
  // Sama dengan ID_SKRIP_REHIDRASI di lib/pengurai.js (dibutuhkan sebelum modul selesai dimuat).
  const ID_REHIDRASI = "__UNIVERSAL_DATA_FOR_REHYDRATION__";
  const MAKS_TANGKAPAN = 30;

  /** Tangkapan daftar video: badan mentah sampai pengurai siap, sesudahnya ringkasannya saja. */
  const tangkapan = [];
  let pengurai = null;
  const muatPengurai = import(chrome.runtime.getURL("lib/pengurai.js")).then((m) => {
    pengurai = m;
    for (let i = 0; i < tangkapan.length; i++) {
      if (tangkapan[i].body) tangkapan[i] = m.ringkasItemList(tangkapan[i].url, tangkapan[i].body);
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
  if (document.readyState === "loading") {
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
  };

  // ------------------------------------------------ tangkapan daftar video
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const d = ev.data;
    if (!d || typeof d !== "object" || d.sumber !== TAG || d.jenis !== "item_list") return;
    if (typeof d.url !== "string" || !d.body || typeof d.body !== "object") return;
    const butir = pengurai ? pengurai.ringkasItemList(d.url, d.body) : { url: d.url, body: d.body };
    const ada = tangkapan.findIndex((t) => t.url === d.url);
    if (ada >= 0) tangkapan.splice(ada, 1);
    tangkapan.push(butir);
    if (tangkapan.length > MAKS_TANGKAPAN) tangkapan.shift();
    jadwalkanPerbarui();
  });
  // Minta halaman-utama.js mengirim ulang yang sudah ditangkap sebelum skrip ini siap.
  window.postMessage({ sumber: TAG, jenis: "minta-ulang" }, location.origin);

  async function baca() {
    const m = await muatPengurai;
    return m.bacaHalaman(dokumenBaca, { url: location.href, itemList: tangkapan });
  }

  // ------------------------------------------------ permintaan dari service worker
  chrome.runtime.onMessage.addListener((pesan, pengirim, balas) => {
    if (pengirim.id !== chrome.runtime.id || pesan?.jenis !== "bacaHalaman") return false;
    baca()
      .then((h) => balas(h))
      .catch((e) => balas({ status: "TIDAK_TERBACA", pesan: "Pengurai gagal: " + String(e?.message ?? e) }));
    return true;
  });

  // ------------------------------------------------ panel manual
  const angka = new Intl.NumberFormat("id-ID");
  const TEKS_STATUS = {
    CAPTCHA: "TikTok meminta captcha. Selesaikan dulu, lalu tekan Baca ulang.",
    LOGIN: "TikTok meminta masuk (login).",
    TIDAK_DITEMUKAN: "Akun atau video ini tidak ditemukan.",
    PRIVAT: "Akun atau video ini privat — angkanya tidak bisa dibaca.",
    TIDAK_TERBACA: "Angka belum terbaca. Muat ulang halaman (F5), lalu tekan Baca ulang.",
  };
  const TEKS_SIMPAN = {
    TIDAK_ADA_DI_ELORAE: "Belum ada di Elorae. Tambahkan KOL atau kontennya di Elorae dulu.",
    BELUM_TERSAMBUNG: "Ekstensi belum tersambung ke Elorae. Klik ikon ekstensi untuk menyambungkan.",
    TOKEN_TIDAK_SAH: "Sambungan ke Elorae sudah dicabut. Sambungkan ulang lewat ikon ekstensi.",
    JARINGAN: "Elorae tidak terjangkau. Pastikan Elorae menyala, lalu coba lagi.",
    TERLALU_SERING: "Terlalu sering menyimpan. Tunggu sebentar lalu coba lagi.",
    MUATAN_TIDAK_SAH: "Elorae menolak angka ini. Muat ulang halaman lalu coba lagi.",
  };

  let panel = null;
  let hasilTerakhir = null;
  let pesanSimpan = null;
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

  const CSS = `
    :host { all: initial; }
    .kotak, .pil {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #111827; background: #ffffff; border: 1px solid #e5e7eb;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18); box-sizing: border-box;
    }
    .kotak { width: 272px; border-radius: 12px; overflow: hidden; }
    .pil { border-radius: 999px; padding: 6px 12px; cursor: pointer; font-weight: 600; }
    .kepala { display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 8px 10px 8px 12px; border-bottom: 1px solid #e5e7eb; font-weight: 600; }
    .kepala small { font-weight: 400; color: #6b7280; }
    .isi { padding: 10px 12px; display: grid; gap: 8px; }
    .judul { font-weight: 600; overflow-wrap: anywhere; }
    dl { margin: 0; display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; }
    dt { color: #6b7280; }
    dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    .catatan { color: #6b7280; font-size: 12px; }
    .status { font-size: 12px; }
    .status.galat { color: #b91c1c; }
    .status.baik { color: #047857; }
    .tombol { display: flex; gap: 6px; }
    button { font: inherit; border-radius: 8px; border: 1px solid #d1d5db; background: #f9fafb;
      color: inherit; padding: 6px 10px; cursor: pointer; }
    button.utama { background: #111827; border-color: #111827; color: #ffffff; flex: 1; font-weight: 600; }
    button:disabled { opacity: 0.5; cursor: default; }
    button.ikon { border: none; background: transparent; padding: 2px 6px; font-size: 16px; line-height: 1; }
    @media (prefers-color-scheme: dark) {
      .kotak, .pil { color: #f3f4f6; background: #1f2937; border-color: #374151; }
      .kepala { border-color: #374151; }
      .kepala small, dt, .catatan { color: #9ca3af; }
      button { background: #111827; border-color: #4b5563; }
      button.utama { background: #f3f4f6; border-color: #f3f4f6; color: #111827; }
      .status.galat { color: #fca5a5; }
      .status.baik { color: #6ee7b7; }
    }
  `;

  function el(tag, atribut = {}, ...anak) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(atribut)) {
      if (k === "teks") e.textContent = v;
      else if (k === "kelas") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const a of anak) if (a) e.append(a);
    return e;
  }

  function baris(label, nilai) {
    return [el("dt", { teks: label }), el("dd", { teks: nilai === undefined ? "—" : angka.format(nilai) })];
  }

  async function bangunPanel() {
    const tabOtomatis = await kirimKeLatar({ jenis: "apakahTabOtomatis" });
    if (tabOtomatis?.otomatis) return;
    const setelan = await kirimKeLatar({ jenis: "bacaPanel" });
    const host = document.createElement("elorae-kreatif-panel");
    const akar = host.attachShadow({ mode: "closed" });
    akar.append(el("style", { teks: CSS }));
    const wadah = el("div");
    akar.append(wadah);
    document.documentElement.append(host);
    panel = { host, wadah, kecil: Boolean(setelan?.kecil) };
    await perbaruiPanel();
    setInterval(() => {
      if (location.href !== urlTerakhir) {
        urlTerakhir = location.href;
        pesanSimpan = null;
        perbaruiPanel();
      }
    }, 1000);
  }

  async function perbaruiPanel() {
    if (!panel) return;
    const m = await muatPengurai.catch(() => null);
    const target = m ? m.jenisHalaman(location.href) : null;
    if (!target) {
      panel.host.style.display = "none";
      return;
    }
    panel.host.style.display = "";
    try {
      hasilTerakhir = await baca();
    } catch (e) {
      hasilTerakhir = { status: "TIDAK_TERBACA", pesan: String(e?.message ?? e) };
    }
    gambar(target);
  }

  function setelKecil(kecil) {
    panel.kecil = kecil;
    kirimKeLatar({ jenis: "setelPanel", kecil });
    gambar(pengurai?.jenisHalaman(location.href));
  }

  function gambar(target) {
    if (!panel || !target) return;
    const w = panel.wadah;
    w.replaceChildren();
    if (panel.kecil) {
      w.append(el("button", { kelas: "pil", teks: "Elorae ▴", title: "Buka panel Elorae", onclick: () => setelKecil(false) }));
      return;
    }
    const h = hasilTerakhir ?? { status: "TIDAK_TERBACA" };
    const data = h.data;
    const kepala = el(
      "div",
      { kelas: "kepala" },
      el("span", {}, document.createTextNode("Elorae "), el("small", { teks: "· Pantau KOL" })),
      el("button", { kelas: "ikon", teks: "–", title: "Kecilkan", "aria-label": "Kecilkan panel", onclick: () => setelKecil(true) }),
    );
    const isi = el("div", { kelas: "isi" });
    const handle = data?.uniqueId ? "@" + data.uniqueId : "@" + target.handle;
    isi.append(el("div", { kelas: "judul", teks: target.jenis === "PROFIL" ? `Profil ${handle}` : `Video ${handle}` }));

    if (data && h.status === "OK") {
      const dl = el("dl");
      if (data.jenis === "PROFIL") {
        dl.append(...baris("Pengikut", data.pengikut), ...baris("Total like", data.totalLike), ...baris("Jumlah video", data.jumlahVideo));
        dl.append(...baris("Posting terbaca", data.posting.length));
        isi.append(dl);
        if (!h.adaItemList) {
          isi.append(
            el("div", {
              kelas: "catatan",
              teks: "Daftar video belum tertangkap. Gulir sedikit ke daftar video atau muat ulang halaman agar ER bisa dihitung.",
            }),
          );
        }
      } else {
        dl.append(
          ...baris("Views", data.views),
          ...baris("Like", data.like),
          ...baris("Komentar", data.komentar),
          ...baris("Share", data.share),
          ...baris("Save", data.save),
        );
        isi.append(dl);
      }
    } else {
      let teks = TEKS_STATUS[h.status] ?? TEKS_STATUS.TIDAK_TERBACA;
      if (h.alasan === "DATA_TIDAK_COCOK") teks = "Halaman berganti tanpa dimuat ulang. Muat ulang (F5) agar angkanya terbaca.";
      else if (h.alasan === "ANGKA_TIDAK_TERBACA" && h.kurang?.length) teks = `Angka tidak terbaca: ${h.kurang.join(", ")}. Muat ulang halaman lalu coba lagi.`;
      isi.append(el("div", { kelas: "status galat", teks }));
    }

    if (pesanSimpan) isi.append(el("div", { kelas: `status ${pesanSimpan.baik ? "baik" : "galat"}`, teks: pesanSimpan.teks }));

    const tombolSimpan = el("button", { kelas: "utama", teks: menyimpan ? "Menyimpan…" : "Simpan ke Elorae", onclick: simpan });
    if (h.status !== "OK" || menyimpan) tombolSimpan.disabled = true;
    const tombolBaca = el("button", { teks: "Baca ulang", title: "Baca angka di halaman ini lagi", onclick: () => { pesanSimpan = null; perbaruiPanel(); } });
    isi.append(el("div", { kelas: "tombol" }, tombolSimpan, tombolBaca));
    w.append(el("div", { kelas: "kotak", role: "region", "aria-label": "Panel Elorae" }, kepala, isi));
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
      pesanSimpan = { baik: true, teks: `Tersimpan untuk ${nama}.` };
    } else {
      const kode = jawaban?.kode ?? "JARINGAN";
      pesanSimpan = { baik: false, teks: TEKS_SIMPAN[kode] ?? `Gagal menyimpan (${kode}).` };
    }
    gambar(pengurai?.jenisHalaman(location.href));
  }

  function mulaiPanel() {
    // Beri waktu TikTok menghidrasi halaman sebelum panel pertama dibaca.
    setTimeout(() => bangunPanel().catch(() => {}), 1500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mulaiPanel, { once: true });
  else mulaiPanel();
})();
