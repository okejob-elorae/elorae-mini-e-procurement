// Pemilih pengurai per platform — modul MURNI. TikTok (lib/pengurai.js), Instagram
// (lib/pengurai-instagram.js), YouTube (lib/pengurai-youtube.js) punya bentuk ekspor yang sama:
// jenisHalaman, bacaHalaman, kurangWajib, cocokDenganUrl, perluHalamanSegar, urlUntukTab.
// Threads dan Facebook TIDAK didukung (halamannya tidak memuat angka yang stabil untuk dibaca).

import * as tiktok from "./pengurai.js";
import * as instagram from "./pengurai-instagram.js";
import * as youtube from "./pengurai-youtube.js";

export const PLATFORM_DIDUKUNG = ["TIKTOK", "INSTAGRAM", "YOUTUBE"];
export const LABEL_PLATFORM = { TIKTOK: "TikTok", INSTAGRAM: "Instagram", YOUTUBE: "YouTube" };
/** Asal halaman tempat panel dan skrip ekstensi bekerja. */
export const ASAL_PLATFORM = { TIKTOK: "https://www.tiktok.com", INSTAGRAM: "https://www.instagram.com", YOUTUBE: "https://www.youtube.com" };

const MODUL = { TIKTOK: tiktok, INSTAGRAM: instagram, YOUTUBE: youtube };

/** Platform dari host sebuah alamat (semua subdomain), atau null. */
export function platformDariUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const di = (d) => host === d || host.endsWith(`.${d}`);
  if (di("tiktok.com")) return "TIKTOK";
  if (di("instagram.com")) return "INSTAGRAM";
  if (di("youtube.com") || host === "youtu.be") return "YOUTUBE";
  return null;
}

/** Halaman tempat panel bekerja: www.tiktok.com, www.instagram.com, www.youtube.com (persis). */
export function platformHalaman(url) {
  let asal;
  try {
    asal = new URL(url).origin;
  } catch {
    return null;
  }
  return PLATFORM_DIDUKUNG.find((p) => ASAL_PLATFORM[p] === asal) ?? null;
}

export function pengurai(platform) {
  return MODUL[platform] ?? null;
}

/** Platform data hasil; tidak disebut = TikTok (bentuk muatan lama). */
export function platformData(data) {
  return PLATFORM_DIDUKUNG.includes(data?.platform) ? data.platform : "TIKTOK";
}

/** `jenisHalaman` platform alamat itu, ditambah `platform`. */
export function jenisHalaman(url) {
  const p = platformDariUrl(url);
  const t = p ? MODUL[p].jenisHalaman(url) : null;
  return t ? { ...t, platform: p } : null;
}

export function kurangWajib(data) {
  return MODUL[platformData(data)].kurangWajib(data);
}

export function cocokDenganUrl(data, target) {
  if (!target || platformData(data) !== (target.platform ?? "TIKTOK")) return false;
  return MODUL[target.platform ?? "TIKTOK"].cocokDenganUrl(data, target);
}

/** Alamat yang boleh diambil dari tab platform itu untuk sebuah tugas, atau null. */
export function urlUntukTab(platform, url) {
  return MODUL[platform]?.urlUntukTab(url) ?? null;
}
