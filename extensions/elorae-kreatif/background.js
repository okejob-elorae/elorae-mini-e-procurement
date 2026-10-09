// Service worker Elorae Kreatif (modul ES).
// - Sambung ke Elorae (kode → token), simpan { eloraeUrl, token, perangkat } di storage.local.
// - Putaran otomatis lewat chrome.alarms: minta tugas → buka tab latar → baca angka lewat
//   konten.js → kirim hasil/masalah → tutup tab → jeda acak / istirahat.
// - Perantara mode manual (panel "Simpan ke Elorae") dan popup.
// Semua keputusan ada di lib/aturan.js (dites); berkas ini hanya menjalankannya.
// Token TIDAK PERNAH ditulis ke log.

import { urlTugasSah } from "./lib/pengurai.js";
import {
  bersihkanPengaturan,
  jadwalSetelahAlasan,
  jadwalSetelahTugas,
  kodeMasalah,
  kunciMasihAktif,
  perbaruiJedaLokal,
  putuskanLangkah,
  putuskanTunggu,
  setelahTugas,
  teksKeadaan,
} from "./lib/aturan.js";

const ASAL_ELORAE = ["http://localhost:3000", "https://elorae.cloud"];
const JALUR_API = "/api/kreatif/ekstensi";
const ALARM_DETAK = "pantau-detak";
const ALARM_BERIKUT = "pantau-berikut";
const BATAS_PANGGIL_MS = 20_000;
const BATAS_MUAT_MS = 45_000;
const BATAS_MASIH_MEMUAT_MS = 20_000;
const UMUR_ANTREAN_MS = 30 * 60_000;
const MAKS_ANTREAN = 50;
const ASAL_TIKTOK = "https://www.tiktok.com/";

const lokal = chrome.storage.local;
const sesi = chrome.storage.session;
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const versi = () => chrome.runtime.getManifest().version;

// ============================================================ pemasangan

chrome.runtime.onInstalled.addListener(() => pastikanAlarm());
chrome.runtime.onStartup.addListener(async () => {
  // Peramban baru menyala: kunci dari sesi lalu pasti basi.
  await lokal.remove("kunci");
  pastikanAlarm();
});
pastikanAlarm();

async function pastikanAlarm() {
  try {
    const ada = await chrome.alarms.get(ALARM_DETAK);
    if (!ada) await chrome.alarms.create(ALARM_DETAK, { periodInMinutes: 1 });
  } catch (e) {
    console.warn("[Elorae] alarm gagal dipasang:", pesanGalat(e));
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_DETAK || alarm.name === ALARM_BERIKUT) detak();
});

function jadwalkanAlarmBerikut(saat) {
  if (!Number.isFinite(saat)) return;
  // Chrome membulatkan alarm ke ≥ 30 detik; detak per menit tetap menjadi jaring pengaman.
  chrome.alarms.create(ALARM_BERIKUT, { when: Math.max(saat, Date.now() + 30_000) }).catch(() => {});
}

// ============================================================ penyimpanan kecil

const baca = (...kunci) => lokal.get(kunci);
const tulis = (obj) => lokal.set(obj);

async function catatGalat(pesan) {
  await tulis({ galatTerakhir: { pesan: String(pesan).slice(0, 300), at: Date.now() } });
}

function pesanGalat(e) {
  return String(e?.message ?? e ?? "galat tidak dikenal");
}

// ============================================================ memanggil Elorae

/**
 * Panggil API ekstensi. Tidak pernah melempar. Hasil:
 * `{ json, status }` bila Elorae menjawab JSON (termasuk penolakan 4xx `{ ok:false, kode }`);
 * `{ gagal: "JARINGAN" | "TERLALU_SERING" | "HTTP" | "TOKEN_TIDAK_SAH", status? }`.
 * JARINGAN mencakup 5xx (Elorae menjawab GAGAL untuk galat tak terduga) — dicoba lagi nanti.
 * 401 dengan token → token dibuang (perangkat dicabut di Elorae).
 */
async function panggil(eloraeUrl, jalur, { metode = "POST", body, token } = {}) {
  const pengendali = new AbortController();
  const batas = setTimeout(() => pengendali.abort(), BATAS_PANGGIL_MS);
  try {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(eloraeUrl + JALUR_API + jalur, {
      method: metode,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
      signal: pengendali.signal,
    });
    if (res.status === 401 && token) {
      await tandaiTerputus("TOKEN_TIDAK_SAH");
      return { gagal: "TOKEN_TIDAK_SAH", status: 401 };
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (res.status === 429) return { gagal: "TERLALU_SERING", status: 429 };
    if (json && typeof json === "object" && res.status < 500) return { json, status: res.status };
    return { gagal: res.status >= 500 ? "JARINGAN" : "HTTP", status: res.status };
  } catch (e) {
    return { gagal: "JARINGAN", pesan: pesanGalat(e) };
  } finally {
    clearTimeout(batas);
  }
}

/**
 * Patokan harga per 1.000 views dari kolaborasi berbayar Elorae (GET /patokan), disimpan 30 menit
 * di storage.session. Hanya angka ringkasan; tanpa sambungan → BELUM_TERSAMBUNG.
 */
const SIMPAN_PATOKAN_MS = 30 * 60_000;
async function bacaPatokan(paksa) {
  const { patokanCache } = await sesi.get("patokanCache");
  if (!paksa && patokanCache && Date.now() - patokanCache.at < SIMPAN_PATOKAN_MS) return { ok: true, patokan: patokanCache.patokan };
  const r = await panggilDenganToken("/patokan", { metode: "GET" });
  if (r.gagal) return { ok: false, kode: r.gagal };
  if (!r.json?.ok || !r.json.patokan) return { ok: false, kode: "HTTP" };
  await sesi.set({ patokanCache: { at: Date.now(), patokan: r.json.patokan } });
  return { ok: true, patokan: r.json.patokan };
}

async function koneksiAktif() {
  const { koneksi } = await baca("koneksi");
  return koneksi?.token && koneksi?.eloraeUrl ? koneksi : null;
}

async function panggilDenganToken(jalur, opsi = {}) {
  const koneksi = await koneksiAktif();
  if (!koneksi) return { gagal: "BELUM_TERSAMBUNG" };
  return panggil(koneksi.eloraeUrl, jalur, { ...opsi, token: koneksi.token });
}

async function tandaiTerputus(alasan) {
  const { koneksi } = await baca("koneksi");
  await tulis({
    koneksi: koneksi ? { eloraeUrl: koneksi.eloraeUrl } : null,
    terputus: { alasan, at: Date.now() },
    kunci: null,
    jedaLokal: null,
  });
  await perbaruiLencana();
}

function normalAsal(alamat) {
  try {
    const asal = new URL(String(alamat ?? "").trim()).origin;
    return ASAL_ELORAE.includes(asal) ? asal : null;
  } catch {
    return null;
  }
}

// ============================================================ antrean kirim (hasil/masalah yang tertunda)

/** Kirim; bila Elorae tak terjangkau, simpan ke antrean untuk dicoba lagi tiap detak. */
async function kirimAtauAntre(jalur, body) {
  const r = await panggilDenganToken(jalur, { body });
  if (r.gagal === "JARINGAN" || r.gagal === "TERLALU_SERING") {
    const { antreanKirim = [] } = await baca("antreanKirim");
    antreanKirim.push({ jalur, body, dibuatAt: Date.now() });
    await tulis({ antreanKirim: antreanKirim.slice(-MAKS_ANTREAN) });
    return { terkirim: false, antre: true };
  }
  if (r.gagal) return { terkirim: false, antre: false, gagal: r.gagal, status: r.status };
  return { terkirim: true, json: r.json };
}

async function kirimAntrean() {
  const { antreanKirim = [] } = await baca("antreanKirim");
  if (antreanKirim.length === 0) return;
  const sisa = [];
  let berhenti = false;
  for (const butir of antreanKirim) {
    if (berhenti || Date.now() - butir.dibuatAt > UMUR_ANTREAN_MS) {
      if (berhenti) sisa.push(butir);
      continue;
    }
    const r = await panggilDenganToken(butir.jalur, { body: butir.body });
    if (r.gagal === "JARINGAN" || r.gagal === "TERLALU_SERING") {
      berhenti = true;
      sisa.push(butir);
      continue;
    }
    if (r.gagal === "TOKEN_TIDAK_SAH" || r.gagal === "BELUM_TERSAMBUNG") return tulis({ antreanKirim: [] });
    if (r.json?.ok === false) await catatGalat(`Elorae menolak laporan tertunda: ${r.json.kode ?? "?"}`);
    if (r.json && butir.jalur === "/masalah" && ["CAPTCHA", "LOGIN"].includes(butir.body?.kode)) {
      const { jedaLokal } = await baca("jedaLokal");
      if (jedaLokal?.tungguServer) await tulis({ jedaLokal: { ...jedaLokal, laporTerkirim: true } });
    }
  }
  await tulis({ antreanKirim: sisa });
}

// ============================================================ status

async function ambilStatus() {
  const r = await panggilDenganToken("/status", { metode: "GET" });
  if (r.json?.ok === true) {
    await tulis({ statusServer: { data: r.json, at: Date.now() } });
    return r.json;
  }
  if (r.json?.ok === false) await catatGalat(`Elorae menolak permintaan status: ${r.json.kode ?? "?"}`);
  return null;
}

// ============================================================ tab otomatis

async function daftarTabOtomatis() {
  const { tabOtomatis = [] } = await sesi.get("tabOtomatis");
  return tabOtomatis;
}

async function catatTabOtomatis(tabId) {
  const daftar = await daftarTabOtomatis();
  await sesi.set({ tabOtomatis: [...daftar.filter((id) => id !== tabId), tabId] });
}

async function tutupTabOtomatis(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // sudah tertutup
  }
  const daftar = await daftarTabOtomatis();
  await sesi.set({ tabOtomatis: daftar.filter((id) => id !== tabId) });
}

async function tutupSemuaTabOtomatis() {
  for (const id of await daftarTabOtomatis()) await tutupTabOtomatis(id);
}

/**
 * Tab latar baru (active:false) di jendela terakhir yang difokuskan. Dibuka kosong dulu lalu
 * diarahkan, supaya tab sudah tercatat sebagai tab otomatis sebelum konten.js bertanya.
 */
async function bukaTabLatar(url) {
  let jendela = null;
  try {
    jendela = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  } catch {
    jendela = null;
  }
  let tab;
  if (jendela?.id !== undefined && jendela?.id !== null) {
    tab = await chrome.tabs.create({ windowId: jendela.id, url: "about:blank", active: false });
  } else {
    const baru = await chrome.windows.create({ url: "about:blank", focused: false, state: "minimized" });
    tab = baru.tabs[0];
  }
  await catatTabOtomatis(tab.id);
  try {
    await chrome.tabs.update(tab.id, { muted: true });
  } catch {
    // tidak penting
  }
  await chrome.tabs.update(tab.id, { url });
  return tab.id;
}

async function tungguMuat(tabId) {
  const mulai = Date.now();
  await tidur(800);
  while (Date.now() - mulai < BATAS_MUAT_MS) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return { ok: false, pesan: "Tab tertutup sebelum halaman selesai dimuat" };
    }
    const url = tab.url || "";
    if (tab.status === "complete") {
      if (url.startsWith(ASAL_TIKTOK)) return { ok: true, url };
      // Tautan pendek (vt.tiktok.com) bisa singgah dulu sebelum dialihkan ke www — tunggu terus.
      if (url && !url.startsWith("about:") && !urlTugasSah(url)) {
        return { ok: false, pesan: "Halaman dialihkan ke luar tiktok.com" };
      }
    } else if (url.startsWith(ASAL_TIKTOK) && Date.now() - mulai >= BATAS_MASIH_MEMUAT_MS) {
      // Sebagian halaman tidak pernah "complete" (permintaan yang terus terbuka); datanya
      // biasanya sudah ada — biarkan konten.js yang menilai.
      return { ok: true, url };
    }
    await tidur(1000);
  }
  return { ok: false, pesan: `Halaman TikTok tidak selesai dimuat dalam ${BATAS_MUAT_MS / 1000} detik` };
}

/** Tanya konten.js berulang (tiap detik) sampai putuskanTunggu berkata KIRIM. */
async function mintaHasil(tabId, tugas) {
  const mulai = Date.now();
  let terakhir = null;
  let sudahSuntik = false;
  for (;;) {
    const sejakMs = Date.now() - mulai;
    try {
      const jawaban = await chrome.tabs.sendMessage(tabId, { jenis: "bacaHalaman" }, { frameId: 0 });
      if (jawaban && typeof jawaban.status === "string") terakhir = jawaban;
    } catch {
      // konten.js belum ada (mis. ekstensi baru dimuat ulang): suntikkan sekali.
      if (!sudahSuntik && sejakMs >= 2000) {
        sudahSuntik = true;
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ["konten.js"] });
        } catch {
          // halaman galat Chrome dsb.
        }
      }
    }
    const keputusan = putuskanTunggu({
      jenis: tugas.jenis,
      sejakMs,
      status: terakhir?.status ?? null,
      adaItemList: Boolean(terakhir?.adaItemList),
    });
    if (keputusan === "KIRIM") {
      return terakhir ?? { status: "GAGAL_MUAT", pesan: "Skrip ekstensi tidak menjawab di halaman TikTok" };
    }
    await tidur(1000);
  }
}

function pesanMasalah(hasil) {
  if (hasil.pesan) return String(hasil.pesan).slice(0, 500);
  if (hasil.alasan === "ANGKA_TIDAK_TERBACA" && hasil.kurang?.length) return `Angka tidak terbaca: ${hasil.kurang.join(", ")}`;
  if (hasil.alasan === "DATA_TIDAK_COCOK") return `Data halaman tidak cocok dengan alamat yang dibuka${hasil.diagnosa ? ` (${hasil.diagnosa})` : ""}`.slice(0, 500);
  if (hasil.diagnosa) return `Data halaman tidak ditemukan — ${hasil.diagnosa}`.slice(0, 500);
  return undefined;
}

// ============================================================ satu tugas

async function kerjakanTugas(tugas) {
  let hasil;
  const url = urlTugasSah(tugas.url);
  if (!url) {
    hasil = { status: "GAGAL_MUAT", pesan: "Alamat tugas bukan link tiktok.com" };
  } else {
    let tabId = null;
    try {
      tabId = await bukaTabLatar(url);
      await tulis({ kunci: { sejak: Date.now(), tugasId: tugas.id } });
      const muat = await tungguMuat(tabId);
      hasil = muat.ok ? await mintaHasil(tabId, tugas) : { status: "GAGAL_MUAT", pesan: muat.pesan };
    } catch (e) {
      hasil = { status: "GAGAL_MUAT", pesan: pesanGalat(e) };
    } finally {
      if (tabId !== null) await tutupTabOtomatis(tabId);
    }
  }
  if (hasil.status === "OK" && hasil.data?.jenis !== tugas.jenis) {
    hasil = {
      status: "TIDAK_TERBACA",
      pesan: `Halaman yang terbuka bukan ${tugas.jenis === "PROFIL" ? "profil" : "konten"} yang diminta`,
    };
  }

  const sekarang = Date.now();
  let kode = "OK";
  let laporTerkirim = false;
  if (hasil.status === "OK") {
    const r = await kirimAtauAntre("/hasil", { tugasId: tugas.id, data: hasil.data });
    if (r.terkirim && r.json?.ok === false) {
      await catatGalat(`Elorae menolak hasil: ${r.json.kode ?? "?"}`);
      if (r.json.kode === "MUATAN_TIDAK_SAH") {
        // Tanpa laporan ini tugasnya tinggal DIPINJAM sampai lease habis lalu kembali ANTRE tanpa
        // menambah percobaan — dan akan gagal dengan cara yang sama tanpa akhir.
        kode = "TIDAK_TERBACA";
        await kirimAtauAntre("/masalah", { tugasId: tugas.id, kode, pesan: "Elorae menolak muatan hasil (MUATAN_TIDAK_SAH)" });
      }
    } else if (r.antre) await catatGalat("Elorae tidak terjangkau; hasil disimpan dan dikirim ulang nanti");
  } else {
    kode = kodeMasalah(hasil.status);
    const pesan = pesanMasalah(hasil);
    const r = await kirimAtauAntre("/masalah", { tugasId: tugas.id, kode, ...(pesan ? { pesan } : {}) });
    laporTerkirim = Boolean(r.terkirim);
    await catatGalat(`${kode}${pesan ? ": " + pesan : ""}`);
  }

  const s = await baca("gagalBeruntun", "jadwal", "jedaLokal", "statusServer");
  const lanjut = setelahTugas(s.gagalBeruntun ?? 0, kode, sekarang, s.statusServer?.data?.pengaturan?.jedaOtomatisMenit);
  if (lanjut.jedaLokal?.tungguServer) lanjut.jedaLokal.laporTerkirim = laporTerkirim;
  const jadwal = jadwalSetelahTugas(s.jadwal, s.statusServer?.data?.pengaturan, sekarang);
  await tulis({ gagalBeruntun: lanjut.gagalBeruntun, jedaLokal: lanjut.jedaLokal ?? s.jedaLokal ?? null, jadwal });
  jadwalkanAlarmBerikut(jadwal.berikutnyaAt);
}

// ============================================================ detak

let sedangBerdetak = false;

async function detak() {
  if (sedangBerdetak) return;
  sedangBerdetak = true;
  try {
    await detakInti();
  } catch (e) {
    console.warn("[Elorae] detak gagal:", pesanGalat(e));
    await catatGalat(pesanGalat(e));
  } finally {
    sedangBerdetak = false;
    await perbaruiLencana();
  }
}

async function detakInti() {
  const awal = await baca("koneksi", "otomatis", "kunci");
  const koneksi = awal.koneksi?.token ? awal.koneksi : null;
  if (!koneksi) return simpanRingkasan({ keadaan: "BELUM_TERSAMBUNG" });

  // Kunci basi: service worker mati di tengah tugas → bereskan tab sisa.
  if (awal.kunci && !kunciMasihAktif(awal.kunci, Date.now())) {
    await tutupSemuaTabOtomatis();
    await tulis({ kunci: null });
  }

  await kirimAntrean();
  if (!awal.otomatis) return simpanRingkasan({ keadaan: "MATI" });

  const status = await ambilStatus();
  const s = await baca("koneksi", "otomatis", "kunci", "jedaLokal", "jadwal");
  const jedaLokal = perbaruiJedaLokal(s.jedaLokal ?? null, status, Date.now());
  if (jedaLokal !== (s.jedaLokal ?? null)) await tulis({ jedaLokal });

  const putusan = putuskanLangkah(
      {
        tersambung: Boolean(s.koneksi?.token),
        otomatis: Boolean(s.otomatis),
        status,
        jedaLokal,
        kunci: s.kunci,
        jadwal: s.jadwal,
      },
      Date.now(),
  );
  await simpanRingkasan(putusan);
  if (putusan.langkah !== "AMBIL") return;

  await tulis({ kunci: { sejak: Date.now() } });
  try {
    const r = await panggilDenganToken("/tugas", { body: {} });
    if (r.gagal) {
      if (r.gagal !== "TOKEN_TIDAK_SAH") await catatGalat(`Tidak bisa meminta tugas (${r.gagal}${r.status ? " " + r.status : ""})`);
      return;
    }
    if (r.json?.ok !== true) {
      await catatGalat(`Elorae menolak permintaan tugas: ${r.json?.kode ?? "?"}`);
      return;
    }
    const tugas = r.json.tugas;
    if (!tugas) {
      const alasan = r.json.alasan ?? "ANTREAN_KOSONG";
      const { jadwal } = await baca("jadwal");
      const baru = jadwalSetelahAlasan(jadwal, alasan, Date.now());
      await tulis({ jadwal: baru });
      // Untuk DIJEDA, `berikutnyaAt` hanyalah jadwal tanya ulang kita, bukan akhir jeda di server.
      if (alasan === "DIJEDA") await simpanRingkasan({ langkah: "DIAM", keadaan: "DIJEDA", alasan: status?.alasanJeda ?? null });
      else await simpanRingkasan({ langkah: "DIAM", keadaan: alasan, sampai: baru.berikutnyaAt });
      jadwalkanAlarmBerikut(baru.berikutnyaAt);
      return;
    }
    await simpanRingkasan({ langkah: "DIAM", keadaan: "SIBUK" });
    await kerjakanTugas(tugas);
    const { jedaLokal: jedaBaru, jadwal: jadwalBaru } = await baca("jedaLokal", "jadwal");
    if (jedaBaru) await simpanRingkasan({ langkah: "DIAM", keadaan: "DIJEDA", alasan: jedaBaru.alasan, sampai: jedaBaru.sampai });
    else await simpanRingkasan({ langkah: "DIAM", keadaan: "MENUNGGU", sampai: jadwalBaru?.berikutnyaAt });
  } finally {
    await tulis({ kunci: null });
  }
}

async function simpanRingkasan(r) {
  await tulis({ ringkasan: { ...r, at: Date.now() } });
}

async function perbaruiLencana() {
  try {
    const { koneksi, terputus, ringkasan, jedaLokal } = await baca("koneksi", "terputus", "ringkasan", "jedaLokal");
    const perhatian =
      (!koneksi?.token && terputus) ||
      jedaLokal?.tungguServer ||
      (ringkasan?.keadaan === "DIJEDA" && ["CAPTCHA", "LOGIN"].includes(ringkasan.alasan));
    await chrome.action.setBadgeText({ text: perhatian ? "!" : "" });
    if (perhatian) await chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
  } catch {
    // lencana tidak penting
  }
}

// ============================================================ pesan dari popup & panel

const DARI_HALAMAN_EKSTENSI = new Set(["ringkasan", "sambung", "putuskan", "setelOtomatis"]);
const DARI_TIKTOK = new Set(["simpanManual", "apakahTabOtomatis", "bacaPanel", "setelPanel", "bacaPatokan"]);

chrome.runtime.onMessage.addListener((pesan, pengirim, balas) => {
  if (pengirim.id !== chrome.runtime.id || !pesan || typeof pesan.jenis !== "string") return false;
  const dariEkstensi = !pengirim.tab && typeof pengirim.url === "string" && pengirim.url.startsWith(chrome.runtime.getURL(""));
  const dariTikTok = Boolean(pengirim.tab) && typeof pengirim.url === "string" && pengirim.url.startsWith(ASAL_TIKTOK);
  if (DARI_HALAMAN_EKSTENSI.has(pesan.jenis) && !dariEkstensi) return false;
  if (DARI_TIKTOK.has(pesan.jenis) && !dariTikTok) return false;
  if (!DARI_HALAMAN_EKSTENSI.has(pesan.jenis) && !DARI_TIKTOK.has(pesan.jenis)) return false;
  tanganiPesan(pesan, pengirim)
    .then(balas)
    .catch((e) => balas({ ok: false, kode: "GALAT", pesan: pesanGalat(e) }));
  return true;
});

async function tanganiPesan(pesan, pengirim) {
  switch (pesan.jenis) {
    case "ringkasan":
      return susunRingkasanPopup(Boolean(pesan.segarkan));
    case "sambung":
      return sambung(pesan.eloraeUrl, pesan.kode);
    case "putuskan":
      return putuskan();
    case "setelOtomatis": {
      const nyala = Boolean(pesan.nyala);
      const { jadwal } = await baca("jadwal");
      await tulis({ otomatis: nyala, jadwal: { ...(jadwal ?? {}), berikutnyaAt: null, alasanMundur: null } });
      if (nyala) detak();
      else await simpanRingkasan({ langkah: "DIAM", keadaan: "MATI" });
      return { ok: true };
    }
    case "apakahTabOtomatis": {
      const daftar = await daftarTabOtomatis();
      return { otomatis: daftar.includes(pengirim.tab.id) };
    }
    case "bacaPanel": {
      const { panelKecil } = await baca("panelKecil");
      return { kecil: Boolean(panelKecil) };
    }
    case "setelPanel":
      await tulis({ panelKecil: Boolean(pesan.kecil) });
      return { ok: true };
    case "simpanManual":
      return simpanManual(pesan.url, pesan.data);
    case "bacaPatokan":
      return bacaPatokan(Boolean(pesan.paksa));
    default:
      return { ok: false, kode: "TIDAK_DIKENAL" };
  }
}

async function sambung(alamat, kode) {
  const asal = normalAsal(alamat);
  if (!asal) {
    return { ok: false, pesan: `Alamat Elorae harus salah satu dari: ${ASAL_ELORAE.join(", ")}` };
  }
  const kodeBersih = String(kode ?? "").replace(/\s+/g, "");
  if (!kodeBersih) return { ok: false, pesan: "Isi kode sambung dari Elorae." };
  const r = await panggil(asal, "/sambung", { body: { kode: kodeBersih, versi: versi() } });
  if (r.gagal === "JARINGAN") return { ok: false, pesan: `Elorae tidak terjangkau di ${asal}. Pastikan Elorae menyala.` };
  if (r.gagal === "TERLALU_SERING") return { ok: false, pesan: "Terlalu sering mencoba. Tunggu satu menit lalu coba lagi." };
  const j = r.json;
  if (j?.ok === true && typeof j.token === "string" && j.token) {
    await tulis({
      koneksi: { eloraeUrl: asal, token: j.token, perangkat: j.perangkat ?? null },
      terputus: null,
      jedaLokal: null,
      gagalBeruntun: 0,
      antreanKirim: [],
      galatTerakhir: null,
    });
    await perbaruiLencana();
    detak();
    return { ok: true, perangkat: j.perangkat ?? null };
  }
  const TEKS = {
    KODE_TIDAK_SAH: "Kode sambung salah atau sudah dipakai.",
    KODE_KEDALUWARSA: "Kode sambung sudah kedaluwarsa (berlaku 15 menit). Buat kode baru di Elorae.",
  };
  if (j?.kode) return { ok: false, pesan: TEKS[j.kode] ?? `Elorae menolak: ${j.kode}` };
  return { ok: false, pesan: `Elorae menjawab tidak terduga (HTTP ${r.status ?? "?"}).` };
}

async function putuskan() {
  await tutupSemuaTabOtomatis();
  const { koneksi } = await baca("koneksi");
  // Cabut token di Elorae juga (POST /putus). Kalau Elorae tidak terjangkau, sambungan tetap
  // diputus di sini; perangkatnya bisa dicabut dari Kreatif → Pemantauan.
  let dicabutDiElorae = false;
  if (koneksi?.token && koneksi?.eloraeUrl) {
    const r = await panggil(koneksi.eloraeUrl, "/putus", { body: {}, token: koneksi.token });
    dicabutDiElorae = Boolean(r.json?.ok) || r.gagal === "TOKEN_TIDAK_SAH";
  }
  await tulis({
    koneksi: koneksi ? { eloraeUrl: koneksi.eloraeUrl } : null,
    terputus: null,
    otomatis: false,
    kunci: null,
    jedaLokal: null,
    jadwal: null,
    gagalBeruntun: 0,
    antreanKirim: [],
    statusServer: null,
    ringkasan: { keadaan: "BELUM_TERSAMBUNG", at: Date.now() },
  });
  await perbaruiLencana();
  return { ok: true, dicabutDiElorae };
}

async function simpanManual(url, data) {
  if (typeof url !== "string" || !url.startsWith(ASAL_TIKTOK)) return { ok: false, kode: "URL_TIDAK_SAH" };
  if (!data || (data.jenis !== "PROFIL" && data.jenis !== "KONTEN")) return { ok: false, kode: "DATA_TIDAK_SAH" };
  const r = await panggilDenganToken("/manual", { body: { url, data } });
  if (["BELUM_TERSAMBUNG", "TOKEN_TIDAK_SAH", "JARINGAN", "TERLALU_SERING"].includes(r.gagal)) return { ok: false, kode: r.gagal };
  if (r.gagal) return { ok: false, kode: `HTTP_${r.status ?? "?"}` };
  if (r.json?.ok === true) return { ok: true, cocok: r.json.cocok ?? null };
  return { ok: false, kode: r.json?.kode ?? "DITOLAK" };
}

async function susunRingkasanPopup(segarkan) {
  const s0 = await baca("koneksi");
  if (segarkan && s0.koneksi?.token) {
    const status = await ambilStatus();
    const s = await baca("otomatis", "kunci", "jedaLokal", "jadwal", "ringkasan");
    const jedaLokal = perbaruiJedaLokal(s.jedaLokal ?? null, status, Date.now());
    const putusan = putuskanLangkah(
      { tersambung: true, otomatis: Boolean(s.otomatis), status, jedaLokal, kunci: s.kunci, jadwal: s.jadwal },
      Date.now(),
    );
    // "Siap" di popup berarti detak berikutnya akan mengambil tugas; tampilkan sebagai berjalan.
    if (!sedangBerdetak) await simpanRingkasan(putusan.langkah === "AMBIL" ? { ...putusan, keadaan: "MENUNGGU" } : putusan);
  }
  const s = await baca("koneksi", "terputus", "otomatis", "ringkasan", "statusServer", "galatTerakhir", "jadwal");
  const pengaturan = bersihkanPengaturan(s.statusServer?.data?.pengaturan);
  const ringkasan = s.ringkasan ?? { keadaan: s.koneksi?.token ? "MENUNGGU" : "BELUM_TERSAMBUNG" };
  return {
    tersambung: Boolean(s.koneksi?.token),
    eloraeUrl: s.koneksi?.eloraeUrl ?? null,
    perangkat: s.koneksi?.perangkat ?? null,
    terputus: s.terputus ?? null,
    otomatis: Boolean(s.otomatis),
    keadaan: ringkasan.keadaan,
    teksKeadaan: teksKeadaan(ringkasan, pengaturan),
    berikutnyaAt: Number.isFinite(s.jadwal?.berikutnyaAt) ? s.jadwal.berikutnyaAt : null,
    hariIni: s.statusServer?.data?.hariIni ?? null,
    statusAt: s.statusServer?.at ?? null,
    galatTerakhir: s.galatTerakhir ?? null,
    versi: versi(),
  };
}
