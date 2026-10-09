// Aturan putaran otomatis — modul MURNI (tanpa chrome.*, tanpa jaringan, waktu dari pemanggil).
// background.js hanya menjalankan keputusan dari sini, jadi semua cabang bisa dites.

import { dalamJamKerja, jedaAcak } from "./pengurai.js";

const DETIK = 1000;
const MENIT = 60 * DETIK;

/** Bawaan bila /status belum pernah terbaca atau mengirim nilai rusak (sama dengan P4 rancangan). */
export const PENGATURAN_BAWAAN = Object.freeze({
  jamMulai: "08:00",
  jamSelesai: "17:00",
  jedaMinDetik: 15,
  jedaMaksDetik: 40,
  istirahatSetiapMenit: 45,
  istirahatMinMenit: 5,
  istirahatMaksMenit: 10,
});

/** Kunci "satu tugas sekali jalan" dianggap basi (service worker mati di tengah tugas) setelah ini. */
export const BATAS_KUNCI_MS = 3 * MENIT;
export const MAKS_GAGAL_BERUNTUN = 3;
/** Jeda sesudah gagal beruntun bila /status tidak mengirim `pengaturan.jedaOtomatisMenit` (rancangan P5: 60). */
export const JEDA_GAGAL_BERUNTUN_MS = 60 * MENIT;
/** Laporan captcha sudah sampai tetapi server tak pernah terlihat menjeda → lanjut setelah ini. */
export const TENGGANG_LAPOR_MS = 2 * MENIT;
export const BATAS_TUNGGU_DATA_MS = 8 * DETIK;
export const BATAS_TUNGGU_ITEMLIST_MS = 10 * DETIK;
/**
 * Halaman yang termuat TANPA skrip data sama sekali (terlihat di tab latar 2026-10-09; dugaan:
 * halaman perantara TikTok yang lalu memuat ulang dirinya) ditunggu lebih lama sebelum dilaporkan.
 */
export const BATAS_TUNGGU_TANPA_SKRIP_MS = 25 * DETIK;
/**
 * Halaman yang jelas pemeriksaan keamanan TikTok (penanda challenge/waf) tidak ditunggu 25 detik:
 * di tab latar pemeriksaan itu tidak pernah lolos sendiri (terukur 2026-10-09).
 */
export const BATAS_TUNGGU_PEMERIKSAAN_MS = 10 * DETIK;

/** Mundur (menit) saat /tugas tidak memberi tugas. */
export const MUNDUR_MENIT = Object.freeze({
  ANTREAN_KOSONG: 5,
  KUOTA_HABIS: 30,
  DI_LUAR_JAM: 10,
  NONAKTIF: 10,
  DIJEDA: 2,
});

export const KODE_MASALAH = ["CAPTCHA", "LOGIN", "GAGAL_MUAT", "TIDAK_TERBACA", "TIDAK_DITEMUKAN", "PRIVAT", "DIBLOKIR_TIKTOK"];
const KODE_KEGAGALAN = ["GAGAL_MUAT", "TIDAK_TERBACA"];
const KODE_BERHENTI = ["CAPTCHA", "LOGIN"];

function bulatPositif(v) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : undefined;
}

function jamSah(v) {
  const m = typeof v === "string" ? /^(\d{1,2}):(\d{2})$/.exec(v.trim()) : null;
  return m && Number(m[1]) <= 24 && Number(m[2]) <= 59 ? v.trim() : undefined;
}

/** Pengaturan dari /status → nilai yang aman dipakai (rusak → bawaan; min/maks terbalik → ditukar). */
export function bersihkanPengaturan(p) {
  const b = PENGATURAN_BAWAAN;
  const sumber = p && typeof p === "object" ? p : {};
  const hasil = {
    jamMulai: jamSah(sumber.jamMulai) ?? b.jamMulai,
    jamSelesai: jamSah(sumber.jamSelesai) ?? b.jamSelesai,
    jedaMinDetik: bulatPositif(sumber.jedaMinDetik) ?? b.jedaMinDetik,
    jedaMaksDetik: bulatPositif(sumber.jedaMaksDetik) ?? b.jedaMaksDetik,
    istirahatSetiapMenit: bulatPositif(sumber.istirahatSetiapMenit) ?? b.istirahatSetiapMenit,
    istirahatMinMenit: bulatPositif(sumber.istirahatMinMenit) ?? b.istirahatMinMenit,
    istirahatMaksMenit: bulatPositif(sumber.istirahatMaksMenit) ?? b.istirahatMaksMenit,
  };
  if (hasil.jedaMinDetik > hasil.jedaMaksDetik) {
    [hasil.jedaMinDetik, hasil.jedaMaksDetik] = [hasil.jedaMaksDetik, hasil.jedaMinDetik];
  }
  if (hasil.istirahatMinMenit > hasil.istirahatMaksMenit) {
    [hasil.istirahatMinMenit, hasil.istirahatMaksMenit] = [hasil.istirahatMaksMenit, hasil.istirahatMinMenit];
  }
  return hasil;
}

export function kunciMasihAktif(kunci, sekarang) {
  return Boolean(kunci) && Number.isFinite(kunci.sejak) && sekarang - kunci.sejak < BATAS_KUNCI_MS;
}

function waktuMs(iso) {
  if (iso === null || iso === undefined || iso === "") return null;
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Server sedang menjeda perangkat ini? `dijedaSampai` di masa depan = ya. */
export function serverMenjeda(status, sekarang) {
  const sampai = waktuMs(status?.dijedaSampai);
  return sampai !== null && sampai > sekarang;
}

/**
 * Boleh meminta tugas sekarang? `k` = `{ tersambung, otomatis, status (jawaban /status atau null),
 * jedaLokal, kunci, jadwal }`. Hasil: `{ langkah: "AMBIL"|"DIAM", keadaan, alasan?, sampai? }`.
 */
export function putuskanLangkah(k, sekarang) {
  const diam = (keadaan, lain = {}) => ({ langkah: "DIAM", keadaan, ...lain });
  if (!k.tersambung) return diam("BELUM_TERSAMBUNG");
  if (!k.otomatis) return diam("MATI");
  if (kunciMasihAktif(k.kunci, sekarang)) return diam("SIBUK");
  const status = k.status;
  if (!status) return diam("TAK_TERJANGKAU");
  // Jeda diperiksa sebelum `aktif`: Elorae mengirim `aktif: false` juga selama perangkat dijeda.
  if (serverMenjeda(status, sekarang)) {
    return diam("DIJEDA", { alasan: status.alasanJeda ?? null, sampai: waktuMs(status.dijedaSampai) });
  }
  if (status.aktif === false) return diam("NONAKTIF");
  // "Cek sekarang" dari Elorae: orang sedang menunggu angkanya. Jeda berwaktu karena gagal beruntun,
  // jam kerja, istirahat, dan mundur karena antrean kosong tidak ditunggu. Captcha/login (perlu
  // orang di Chrome), kuota, dan jeda acak sesudah tugas (≤ jedaMaksDetik) tetap berlaku.
  const langsung = Number(status.permintaanLangsung) > 0;
  const jeda = k.jedaLokal;
  if (jeda?.tungguServer) return diam("DIJEDA", { alasan: jeda.alasan });
  if (!langsung && jeda && Number.isFinite(jeda.sampai) && jeda.sampai > sekarang) {
    return diam("DIJEDA", { alasan: jeda.alasan, sampai: jeda.sampai });
  }
  const p = bersihkanPengaturan(status.pengaturan);
  if (!langsung && !dalamJamKerja(sekarang, p.jamMulai, p.jamSelesai)) return diam("DI_LUAR_JAM");
  const sisa = status.hariIni?.sisa;
  if (typeof sisa === "number" && sisa <= 0) return diam("KUOTA_HABIS");
  const j = k.jadwal ?? {};
  if (!langsung && Number.isFinite(j.istirahatSampai) && j.istirahatSampai > sekarang) {
    return diam("ISTIRAHAT", { sampai: j.istirahatSampai });
  }
  const tungguMundur = Boolean(j.alasanMundur);
  if (Number.isFinite(j.berikutnyaAt) && j.berikutnyaAt > sekarang && !(langsung && tungguMundur)) {
    if (!langsung || j.berikutnyaAt - sekarang <= p.jedaMaksDetik * DETIK) {
      return diam(j.alasanMundur ?? "MENUNGGU", { sampai: j.berikutnyaAt });
    }
  }
  return { langkah: "AMBIL", keadaan: langsung ? "PERMINTAAN" : "SIAP" };
}

/**
 * Perbarui jeda lokal dengan jawaban /status terbaru. Mengembalikan jeda baru atau null (lepas).
 * - Captcha/login (`tungguServer`): berhenti sampai server menjeda lalu melepasnya. Bila
 *   laporannya sudah sampai tetapi server tak pernah terlihat menjeda, lepas setelah
 *   TENGGANG_LAPOR_MS. Laporan yang belum sampai → tetap berhenti (antrean kirim mencoba lagi).
 * - Jeda berwaktu (3 gagal berturut-turut): lepas begitu waktunya lewat.
 */
export function perbaruiJedaLokal(jeda, status, sekarang) {
  if (!jeda) return null;
  if (jeda.tungguServer) {
    if (!status) return jeda;
    if (serverMenjeda(status, sekarang)) return jeda.terlihatDijeda ? jeda : { ...jeda, terlihatDijeda: true };
    if (jeda.terlihatDijeda) return null;
    if (jeda.laporTerkirim && sekarang - jeda.sejak >= TENGGANG_LAPOR_MS) return null;
    return jeda;
  }
  if (!Number.isFinite(jeda.sampai) || jeda.sampai <= sekarang) return null;
  // Jeda berwaktu (gagal beruntun) juga dipasang Elorae. Bila Elorae sudah terlihat menjeda lalu
  // tidak lagi — orang menekan Lanjutkan di Pemantauan, atau "Cek sekarang" melepasnya — lepas juga
  // di sini; tanpa ini ekstensi tetap diam sampai jam jedanya sendiri habis.
  if (!status) return jeda;
  if (serverMenjeda(status, sekarang)) return jeda.terlihatDijeda ? jeda : { ...jeda, terlihatDijeda: true };
  if (jeda.terlihatDijeda) return null;
  return jeda;
}

/** Kode /masalah dari status halaman; yang tak dikenal → TIDAK_TERBACA. */
export function kodeMasalah(status) {
  return KODE_MASALAH.includes(status) ? status : "TIDAK_TERBACA";
}

/**
 * Setelah satu tugas selesai dengan `kode` ("OK" atau kode masalah): hitungan gagal beruntun
 * dan jeda lokal baru (null = tidak ada jeda baru). `jedaMenit` = `pengaturan.jedaOtomatisMenit`
 * dari /status; nilai yang bukan angka positif jatuh ke 60 menit.
 */
export function setelahTugas(gagalBeruntun, kode, sekarang, jedaMenit) {
  // Diblokir TikTok: berhenti selama jeda otomatis Elorae. "Cek sekarang" melewatinya (jeda berwaktu),
  // dan Elorae yang sudah terlihat menjeda lalu melepasnya melepas juga jeda ini.
  if (kode === "DIBLOKIR_TIKTOK") {
    return {
      gagalBeruntun: 0,
      jedaLokal: {
        alasan: kode,
        sejak: sekarang,
        sampai: sekarang + (Number.isFinite(jedaMenit) && jedaMenit > 0 ? jedaMenit * MENIT : JEDA_GAGAL_BERUNTUN_MS),
      },
    };
  }
  if (KODE_BERHENTI.includes(kode)) {
    return {
      gagalBeruntun: 0,
      jedaLokal: { alasan: kode, tungguServer: true, sejak: sekarang, terlihatDijeda: false, laporTerkirim: false },
    };
  }
  if (KODE_KEGAGALAN.includes(kode)) {
    const n = (Number.isInteger(gagalBeruntun) ? gagalBeruntun : 0) + 1;
    if (n >= MAKS_GAGAL_BERUNTUN) {
      return {
        gagalBeruntun: 0,
        jedaLokal: {
          alasan: "GAGAL_BERUNTUN",
          sejak: sekarang,
          sampai: sekarang + (Number.isFinite(jedaMenit) && jedaMenit > 0 ? jedaMenit * MENIT : JEDA_GAGAL_BERUNTUN_MS),
        },
      };
    }
    return { gagalBeruntun: n, jedaLokal: null };
  }
  return { gagalBeruntun: 0, jedaLokal: null };
}

// ---------------------------------------------------------------- cek cepat lewat tab TikTok

/**
 * Cek cepat (v0.9.0): halaman diambil dengan fetch DARI tab TikTok yang sudah dibuka orang — tab
 * itu sudah lolos pemeriksaan keamanan TikTok, sedangkan tab latar baru tidak pernah lolos
 * (terukur 2026-10-09: 10 halaman berturut-turut dari satu tab, ±0,5 detik per halaman, tidak ada
 * yang diblokir). Jeda antar video pendek; istirahat panjang dan jeda 15–40 detik tidak dipakai.
 */
export const JEDA_CEPAT_MIN_MS = 1000;
export const JEDA_CEPAT_MAKS_MS = 2500;
/** Satu putaran cek cepat berhenti sesudah ini; detak berikutnya melanjutkan. */
export const MAKS_PUTARAN_CEPAT_MS = 10 * MENIT;

export function jedaCepatMs(rand = Math.random) {
  const r = Math.min(Math.max(Number(rand()) || 0, 0), 0.999999);
  return JEDA_CEPAT_MIN_MS + Math.floor(r * (JEDA_CEPAT_MAKS_MS - JEDA_CEPAT_MIN_MS));
}

export function jadwalSetelahTugasCepat(jadwal, sekarang, rand = Math.random) {
  return {
    ...(jadwal ?? {}),
    istirahatSampai: null,
    berikutnyaAt: sekarang + jedaCepatMs(rand),
    terakhirKerjaAt: sekarang,
    alasanMundur: null,
  };
}

/**
 * Tab yang boleh dipakai cek cepat: www.tiktok.com, sudah termuat, tidak dibuang Chrome, dan bukan
 * tab otomatis ekstensi sendiri (yang itulah yang kena pemeriksaan). Terakhir dibuka dulu.
 */
export function pilihTabTikTok(tabs, idOtomatis) {
  const otomatis = new Set(idOtomatis ?? []);
  return (tabs ?? [])
    .filter((t) => {
      if (!t || otomatis.has(t.id) || t.discarded || t.status !== "complete") return false;
      try {
        return new URL(t.url ?? "").hostname === "www.tiktok.com";
      } catch {
        return false;
      }
    })
    .sort((x, y) => (y.lastAccessed ?? 0) - (x.lastAccessed ?? 0))
    .map((t) => t.id);
}

/** ±15% supaya istirahat tidak jatuh di menit yang sama setiap kali. */
function goyang(ms, rand) {
  let r = Number(rand());
  if (!Number.isFinite(r) || r < 0) r = 0;
  if (r >= 1) r = 0.999999999;
  return Math.round(ms * (0.85 + r * 0.3));
}

/**
 * Jadwal setelah satu tugas: jeda acak antar tugas, dan istirahat setiap ±`istirahatSetiapMenit`.
 * Celah lebih lama dari istirahat minimum sejak tugas terakhir (antrean kosong, di luar jam)
 * dihitung sebagai istirahat — hitungan istirahat dimulai ulang.
 */
export function jadwalSetelahTugas(jadwal, pengaturan, sekarang, rand = Math.random) {
  const p = bersihkanPengaturan(pengaturan);
  const lama = jadwal ?? {};
  const setiapMs = p.istirahatSetiapMenit * MENIT;
  const sesiBaru =
    !Number.isFinite(lama.terakhirKerjaAt) || sekarang - lama.terakhirKerjaAt > p.istirahatMinMenit * MENIT;
  let istirahatBerikutAt = lama.istirahatBerikutAt;
  if (sesiBaru || !Number.isFinite(istirahatBerikutAt)) istirahatBerikutAt = sekarang + goyang(setiapMs, rand);
  let berikutnyaAt = sekarang + jedaAcak(p.jedaMinDetik, p.jedaMaksDetik, rand) * DETIK;
  let istirahatSampai = null;
  if (sekarang >= istirahatBerikutAt) {
    istirahatSampai = sekarang + jedaAcak(p.istirahatMinMenit, p.istirahatMaksMenit, rand) * MENIT;
    istirahatBerikutAt = istirahatSampai + goyang(setiapMs, rand);
    berikutnyaAt = Math.max(berikutnyaAt, istirahatSampai);
  }
  return { berikutnyaAt, istirahatBerikutAt, istirahatSampai, terakhirKerjaAt: sekarang, alasanMundur: null };
}

/** /tugas tidak memberi tugas → mundur sesuai alasan, keadaan ditampilkan dari `alasanMundur`. */
export function jadwalSetelahAlasan(jadwal, alasan, sekarang) {
  const menit = MUNDUR_MENIT[alasan] ?? MUNDUR_MENIT.ANTREAN_KOSONG;
  return { ...(jadwal ?? {}), berikutnyaAt: sekarang + menit * MENIT, alasanMundur: alasan };
}

/**
 * Masih menunggu halaman atau kirim sekarang? `status` = jawaban skrip halaman (null bila belum
 * menjawab), `sejakMs` = sejak tab selesai dimuat.
 */
export function putuskanTunggu({ jenis, sejakMs, status, adaItemList, tanpaSkrip = false, pemeriksaan = false }) {
  if (status === "CAPTCHA") return "KIRIM";
  if (status !== "OK" && pemeriksaan) return sejakMs >= BATAS_TUNGGU_PEMERIKSAAN_MS ? "KIRIM" : "TUNGGU";
  if (status === "OK") {
    if (jenis !== "PROFIL" || adaItemList) return "KIRIM";
    return sejakMs >= BATAS_TUNGGU_ITEMLIST_MS ? "KIRIM" : "TUNGGU";
  }
  const batas = (status === "TIDAK_TERBACA" || status === null) && tanpaSkrip ? BATAS_TUNGGU_TANPA_SKRIP_MS : BATAS_TUNGGU_DATA_MS;
  return sejakMs >= batas ? "KIRIM" : "TUNGGU";
}

// ---------------------------------------------------------------- teks untuk popup

/** "10.05" — jam WIB dengan titik, seperti penulisan jam di Indonesia. */
export function jamWib(ms) {
  if (!Number.isFinite(ms)) return "";
  const menit = (((Math.floor(ms / MENIT) + 7 * 60) % 1440) + 1440) % 1440;
  const dua = (n) => String(n).padStart(2, "0");
  return `${dua(Math.floor(menit / 60))}.${dua(menit % 60)}`;
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function hariWib(ms) {
  return Math.floor((ms + 7 * 60 * MENIT) / (1440 * MENIT));
}

/** "16.00" bila hari WIB-nya sama dengan `sekarang`; selain itu "10 Okt 08.30". */
export function waktuWib(ms, sekarang = Date.now()) {
  if (!Number.isFinite(ms)) return "";
  if (hariWib(ms) === hariWib(sekarang)) return jamWib(ms);
  const t = new Date(ms + 7 * 60 * MENIT);
  return `${t.getUTCDate()} ${BULAN[t.getUTCMonth()]} ${jamWib(ms)}`;
}

const TEKS_ALASAN = {
  CAPTCHA:
    "TikTok meminta captcha. Buka TikTok di profil Chrome ini, selesaikan captcha, lalu tekan Lanjutkan di Elorae.",
  LOGIN: "TikTok meminta masuk (login). Masuk dengan akun TikTok khusus di profil Chrome ini, lalu tekan Lanjutkan di Elorae.",
  GAGAL_BERUNTUN: "gagal berturut-turut",
  DIBLOKIR_TIKTOK:
    "TikTok memasang pemeriksaan keamanan. Muat ulang tab TikTok di Chrome ini (selesaikan puzzle bila muncul), lalu tekan Cek sekarang di Elorae.",
  MANUAL: "dijeda dari Elorae — lanjutkan di Kreatif → Pemantauan",
};

export function teksAlasan(alasan) {
  if (!alasan) return "tanpa keterangan";
  return TEKS_ALASAN[alasan] ?? String(alasan);
}

/** Satu baris keadaan untuk popup. `p` = pengaturan (untuk jam kerja). */
export function teksKeadaan(r, p = PENGATURAN_BAWAAN, sekarang = Date.now()) {
  const peng = bersihkanPengaturan(p);
  switch (r?.keadaan) {
    case "SIAP":
    case "MENUNGGU":
      return "Berjalan";
    case "PERMINTAAN":
      return "Berjalan — mengerjakan permintaan Cek sekarang dari Elorae";
    case "SIBUK":
      return "Berjalan — sedang memeriksa satu halaman";
    case "CEPAT":
      return Number.isFinite(r.selesai) && r.selesai > 0
        ? `Berjalan cepat lewat tab TikTok — ${r.selesai} halaman sudah dicek`
        : "Berjalan cepat lewat tab TikTok";
    case "BELUM_TERSAMBUNG":
      return "Belum tersambung ke Elorae";
    case "MATI":
      return "Pemantauan otomatis mati";
    case "TAK_TERJANGKAU":
      return "Elorae tidak terjangkau — dicoba lagi setiap menit";
    case "NONAKTIF":
      return "Perangkat ini dinonaktifkan di Elorae";
    case "DIJEDA": {
      // Jeda manual disimpan Elorae "sampai tahun 2100" — jamnya tidak berarti apa-apa.
      const tampilSampai = Number.isFinite(r.sampai) && r.alasan !== "MANUAL";
      const sampai = tampilSampai ? ` (sampai ${waktuWib(r.sampai, sekarang)})` : "";
      return `Dijeda: ${teksAlasan(r.alasan)}${sampai}`;
    }
    case "DI_LUAR_JAM":
      return `Di luar jam kerja (${peng.jamMulai.replace(":", ".")}–${peng.jamSelesai.replace(":", ".")} WIB)`;
    case "KUOTA_HABIS":
      return "Kuota hari ini habis";
    case "ANTREAN_KOSONG":
      return "Antrean kosong";
    case "ISTIRAHAT":
      return `Istirahat sampai ${waktuWib(r.sampai, sekarang)}`;
    default:
      return "—";
  }
}
