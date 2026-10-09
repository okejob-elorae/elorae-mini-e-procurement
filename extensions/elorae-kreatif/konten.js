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
  // Hitungan panel (ER, grafik, format angka) — modul murni yang juga diuji node --test.
  let alat = null;
  const muatAlat = import(chrome.runtime.getURL("lib/panel.js")).then((m) => (alat = m));
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

  // Kartu gelap yang sengaja satu tema: ia melayang di atas TikTok terang maupun gelap, jadi
  // warnanya ditetapkan sendiri (bukan mengikuti prefers-color-scheme) dan dipisah dari halaman
  // oleh garis tipis + bayangan. Angka memakai ui-rounded (SF Pro Rounded di Mac), cadangan system-ui.
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .kotak, .pil {
      --ink: #0e0d13; --kartu: #18161f; --kartu-2: #221f2b; --garis: rgba(255, 255, 255, 0.09);
      --teks: #f5f3fb; --redup: #a19cb2; --aksen: #c9b8ff; --aksen-teks: #1a1426;
      --baik: #7fe3b4; --galat: #ff98a6;
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--teks); background: var(--ink); border: 1px solid var(--garis);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.25);
      -webkit-font-smoothing: antialiased;
    }
    .bulat { font-family: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif; }
    .kotak { width: 304px; border-radius: 24px; padding: 14px; display: grid; gap: 12px; }
    .kotak.masuk { animation: muncul 220ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both; }
    @keyframes muncul { from { opacity: 0; transform: translateY(10px) scale(0.98); } }

    .pil { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 14px 8px 10px;
      cursor: pointer; font-weight: 700; font-size: 13px; }
    .pil:hover { background: var(--kartu-2); }
    .pil .er { color: var(--aksen); font-weight: 700; }

    .logo { width: 22px; height: 22px; border-radius: 7px; background: var(--aksen); color: var(--aksen-teks);
      display: grid; place-items: center; font-weight: 900; font-size: 13px; line-height: 1; }
    .kepala { display: flex; align-items: center; gap: 8px; }
    .kepala .merek { font-weight: 800; letter-spacing: -0.01em; }
    .kepala .sub { color: var(--redup); }
    .kepala .isi-kanan { margin-left: auto; }

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
    .tile.aksen .label { color: rgba(26, 20, 38, 0.72); }

    .grafik { background: var(--kartu); border: 1px solid var(--garis); border-radius: 16px; padding: 10px 12px; display: grid; gap: 8px; }
    .batang { display: flex; align-items: flex-end; gap: 4px; height: 46px; }
    .batang i { flex: 1; min-height: 3px; border-radius: 4px 4px 2px 2px; background: var(--aksen);
      transform-origin: bottom; }
    .batang i.muda { background: transparent; border: 1.5px dashed rgba(201, 184, 255, 0.55); }
    .masuk .batang i { animation: tumbuh 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    @keyframes tumbuh { from { transform: scaleY(0.05); } }
    .grafik .kaki { display: flex; justify-content: space-between; gap: 8px; color: var(--redup); font-size: 12px; }
    .grafik .kaki b { color: var(--teks); font-weight: 700; }

    .chip-baris { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 5px 10px;
      background: var(--kartu-2); font-size: 12px; font-variant-numeric: tabular-nums; }
    .chip b { font-weight: 700; }
    .chip span { color: var(--redup); }
    svg { width: 14px; height: 14px; flex: none; stroke: currentColor; fill: none; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round; }

    .catatan { color: var(--redup); font-size: 12px; }
    .status { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; border-radius: 12px; padding: 8px 10px; }
    .status svg { margin-top: 1px; }
    .status.galat { background: rgba(255, 152, 166, 0.12); color: var(--galat); }
    .status.baik { background: rgba(127, 227, 180, 0.12); color: var(--baik); }

    .tombol { display: flex; gap: 8px; }
    button { font: inherit; color: inherit; cursor: pointer; border: none; }
    button:focus-visible { outline: 2px solid var(--aksen); outline-offset: 2px; }
    button.utama { flex: 1; border-radius: 999px; padding: 11px 14px; background: var(--aksen); color: var(--aksen-teks);
      font-weight: 800; font-size: 14px; letter-spacing: -0.01em; transition: transform 120ms ease, filter 120ms ease; }
    button.utama:hover:not(:disabled) { filter: brightness(1.06); }
    button.utama:active:not(:disabled) { transform: scale(0.97); }
    button.bundar { width: 42px; height: 42px; border-radius: 50%; background: var(--kartu-2); display: grid;
      place-items: center; flex: none; }
    button.bundar:hover { background: #2c2838; }
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
    pengikut: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21a8 8 0 0 1 16 0"],
    like: ["M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"],
    komentar: ["M4.5 5.5h15v10.5H9l-4.5 3.5z"],
    share: ["M14 4.5l6 6-6 6", "M20 10.5H10a6 6 0 0 0-6 6v3"],
    save: ["M7 4h10v16.5l-5-3.8-5 3.8z"],
    video: ["M4 6.5h11v11H4z", "M15 10.5l5-3v9l-5-3"],
    ulang: ["M20 12a8 8 0 1 1-2.4-5.7", "M20 4.5V9h-4.5"],
    kecil: ["M6 12h12"],
    centang: ["M5 12.5l4.5 4.5L19 7.5"],
    awas: ["M12 8v5", "M12 16.5v.01", "M12 3.5l9.5 16.5h-19z"],
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
      if (k === "teks") e.textContent = v;
      else if (k === "kelas") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const a of anak) if (a) e.append(typeof a === "string" ? document.createTextNode(a) : a);
    return e;
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
    panel = { host, wadah, kecil: Boolean(setelan?.kecil), animasi: true };
    await perbaruiPanel();
    setInterval(() => {
      if (location.href !== urlTerakhir) {
        urlTerakhir = location.href;
        pesanSimpan = null;
        panel.animasi = true;
        perbaruiPanel();
      }
    }, 1000);
  }

  let membaca = false;
  async function perbaruiPanel() {
    if (!panel) return;
    const m = await muatPengurai.catch(() => null);
    await muatAlat.catch(() => null);
    const target = m ? m.jenisHalaman(location.href) : null;
    if (!target) {
      panel.host.style.display = "none";
      return;
    }
    panel.host.style.display = "";
    membaca = true;
    try {
      hasilTerakhir = await baca();
    } catch (e) {
      hasilTerakhir = { status: "TIDAK_TERBACA", pesan: String(e?.message ?? e) };
    }
    membaca = false;
    gambar(target);
  }

  function setelKecil(kecil) {
    panel.kecil = kecil;
    panel.animasi = !kecil;
    kirimKeLatar({ jenis: "setelPanel", kecil });
    gambar(pengurai?.jenisHalaman(location.href));
  }

  const ubin = (nilai, label, judul, aksen = false) =>
    el("div", { kelas: aksen ? "tile aksen" : "tile", title: judul }, el("div", { kelas: "nilai bulat", teks: nilai }), el("div", { kelas: "label", teks: label }));

  const chip = (namaIkon, nilai, label, judul) =>
    el("span", { kelas: "chip", title: judul }, ikon(namaIkon), el("b", { teks: nilai }), el("span", { teks: label }));

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
    const kiri = ringkas.avgViews != null
      ? el("span", {}, "Rata-rata ", el("b", { teks: alat.angkaPendek(ringkas.avgViews) }), " views")
      : el("span", { teks: `${batang.length} video terbaru` });
    return el(
      "div",
      { kelas: "grafik", role: "img", "aria-label": `Views ${batang.length} video terbaru` },
      baris,
      el("div", { kelas: "kaki" }, kiri, el("span", { teks: "lama → baru" })),
    );
  }

  function isiProfil(h, data) {
    const ringkas = alat.hitungErAkun(data.posting, Date.now());
    const judulEr =
      "Rata-rata ER per video atas ≤ 12 video terbaru (bukan pin, berumur ≥ 48 jam): " +
      "(like + komentar + share + save) ÷ views. Rumusnya sama dengan yang disimpan Elorae.";
    const bagian = [
      el(
        "div",
        { kelas: "ubin" },
        ubin(alat.angkaPendek(data.pengikut), "pengikut", `${alat.angkaLengkap(data.pengikut)} pengikut`),
        ubin(alat.teksPersen(ringkas.er), ringkas.er == null ? "ER belum terhitung" : `ER · ${ringkas.postsCounted} video`, judulEr, true),
      ),
    ];
    const grafik = grafikViews(data.posting, ringkas);
    if (grafik) bagian.push(grafik);
    bagian.push(
      el(
        "div",
        { kelas: "chip-baris" },
        chip("like", alat.angkaPendek(data.totalLike), "like", `${alat.angkaLengkap(data.totalLike)} like`),
        chip("video", alat.angkaPendek(data.jumlahVideo), "video", `${alat.angkaLengkap(data.jumlahVideo)} video`),
      ),
    );
    if (!h.adaItemList) {
      bagian.push(el("div", { kelas: "catatan", teks: "Daftar video belum tertangkap. Gulir sedikit ke daftar video atau muat ulang halaman agar ER terhitung." }));
    } else if (ringkas.er == null) {
      bagian.push(el("div", { kelas: "catatan", teks: "ER butuh paling sedikit 3 video yang berumur 48 jam dan bukan pin." }));
    }
    return { bagian, er: ringkas.er };
  }

  function isiKonten(data) {
    const er = alat.erPosting(data);
    return {
      er,
      bagian: [
        el(
          "div",
          { kelas: "ubin" },
          ubin(alat.angkaPendek(data.views), "views", `${alat.angkaLengkap(data.views)} views`),
          ubin(alat.teksPersen(er), "ER video ini", "(like + komentar + share + save) ÷ views", true),
        ),
        el(
          "div",
          { kelas: "chip-baris" },
          chip("like", alat.angkaPendek(data.like), "like", `${alat.angkaLengkap(data.like)} like`),
          chip("komentar", alat.angkaPendek(data.komentar), "komentar", `${alat.angkaLengkap(data.komentar)} komentar`),
          chip("share", alat.angkaPendek(data.share), "share", `${alat.angkaLengkap(data.share)} share`),
          chip("save", alat.angkaPendek(data.save), "save", `${alat.angkaLengkap(data.save)} save`),
        ),
      ],
    };
  }

  function gambar(target) {
    if (!panel || !target || !alat) return;
    const w = panel.wadah;
    w.replaceChildren();
    const h = hasilTerakhir ?? { status: "TIDAK_TERBACA" };
    const data = h.data;
    const ok = Boolean(data && h.status === "OK");
    const isi = ok ? (data.jenis === "PROFIL" ? isiProfil(h, data) : isiKonten(data)) : null;

    if (panel.kecil) {
      w.append(
        el(
          "button",
          { kelas: "pil", title: "Buka panel Elorae", "aria-label": "Buka panel Elorae", onclick: () => setelKecil(false) },
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
      el("span", { kelas: "isi-kanan" }, el("button", { kelas: "kecil", title: "Kecilkan", "aria-label": "Kecilkan panel", onclick: () => setelKecil(true) }, ikon("kecil"))),
    );
    const handle = data?.uniqueId ?? target.handle;
    const siapa = el(
      "div",
      { kelas: "siapa" },
      el("div", { kelas: "avatar bulat", teks: alat.inisial(handle) }),
      el("div", { style: "min-width:0" }, el("div", { kelas: "nama", teks: "@" + handle }), el("div", { kelas: "jenis", teks: target.jenis === "PROFIL" ? "Profil TikTok" : "Video TikTok" })),
    );

    const kartu = el("div", { kelas: panel.animasi ? "kotak masuk" : "kotak", role: "region", "aria-label": "Panel Elorae" }, kepala, siapa);
    panel.animasi = false;

    if (isi) {
      kartu.append(...isi.bagian);
    } else {
      let teks = TEKS_STATUS[h.status] ?? TEKS_STATUS.TIDAK_TERBACA;
      if (h.alasan === "DATA_TIDAK_COCOK") teks = "Halaman berganti tanpa dimuat ulang. Muat ulang (F5) agar angkanya terbaca.";
      else if (h.alasan === "ANGKA_TIDAK_TERBACA" && h.kurang?.length) teks = `Angka tidak terbaca: ${h.kurang.join(", ")}. Muat ulang halaman lalu coba lagi.`;
      kartu.append(el("div", { kelas: "status galat", role: "status" }, ikon("awas"), el("span", { teks })));
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
          perbaruiPanel();
        },
      },
      ikon("ulang"),
    );
    kartu.append(el("div", { kelas: "tombol" }, tombolSimpan, tombolBaca));
    w.append(kartu);
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
