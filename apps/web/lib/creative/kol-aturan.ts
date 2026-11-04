/**
 * Aturan database KOL — murni, aman untuk klien (2026-10-07).
 *
 * Label, profil ukuran, tempelan "Tambah massal", ketepatan waktu tayang, dan
 * pola cari nomor WA. Penulis dan kueri memakai fungsi yang sama dengan layar,
 * supaya yang tampil di pratinjau persis yang disimpan. Nada pil tahap dan
 * teks "Salin alamat" ada di `kolaborasi-tampil.ts` (dipakai bersama).
 */

import { formatDateOnlyJakarta } from "@/lib/date-only";
import { bacaBilanganBulat } from "./angka-masuk";
import type { Platform } from "./aturan";
import { normalisasiHandle } from "./kembar";
import { tahapAktif, type Tahap } from "./tahap";
import { normalisasiWa } from "./wa";

/* ───────────────────────────── blokir ───────────────────────────── */

/**
 * KOL "jangan diajak lagi". Tetap bisa dicari dan dibuka, tetapi kolaborasi
 * baru dengannya ditolak — pemeriksaannya di penulis kolaborasi, memakai
 * fungsi ini.
 */
export function kolDiblokir(kol: { blockedAt?: Date | string | null } | null | undefined): boolean {
  return Boolean(kol?.blockedAt);
}

/* ───────────────────────────── label ───────────────────────────── */

export const BATAS_LABEL = { jumlah: 12, panjang: 30 } as const;

/**
 * Label dipisah koma (titik koma juga diterima). Spasi dirapikan, "#" di depan
 * dibuang, dan label yang sama tanpa memandang huruf besar-kecil hanya muncul
 * sekali — "Favorit" dan "favorit" adalah satu label.
 */
export function bacaLabel(teks: string | readonly string[] | null | undefined): string[] {
  const potong = Array.isArray(teks) ? teks : String(teks ?? "").split(/[,;]/);
  const hasil: string[] = [];
  const sudah = new Set<string>();
  for (const mentah of potong) {
    const l = String(mentah ?? "")
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, BATAS_LABEL.panjang)
      .trim();
    if (!l) continue;
    const kunci = l.toLowerCase();
    if (sudah.has(kunci)) continue;
    sudah.add(kunci);
    hasil.push(l);
    if (hasil.length >= BATAS_LABEL.jumlah) break;
  }
  return hasil;
}

/** Bentuk simpan kolom `Kol.label`: "a, b, c", atau null bila kosong. */
export function tulisLabel(teks: string | readonly string[] | null | undefined): string | null {
  const l = bacaLabel(teks);
  return l.length ? l.join(", ") : null;
}

export function punyaLabel(teks: string | null | undefined, label: string): boolean {
  const cari = label.trim().toLowerCase();
  if (!cari) return true;
  return bacaLabel(teks).some((l) => l.toLowerCase() === cari);
}

/* ─────────────────────────── profil ukuran ─────────────────────────── */

export type ProfilUkuran = {
  atasan: string | null;
  bawahan: string | null;
  tinggiCm: number | null;
  hijab: boolean | null;
  catatan: string | null;
};

export const UKURAN_KOSONG: ProfilUkuran = { atasan: null, bawahan: null, tinggiCm: null, hijab: null, catatan: null };

const teksPendek = (v: unknown, maks: number): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = String(v).replace(/\s+/g, " ").trim().slice(0, maks).trim();
  return t || null;
};

function tinggiSah(v: unknown): number | null {
  const n = typeof v === "number" ? v : bacaBilanganBulat(typeof v === "string" ? v : null);
  if (n === null || !Number.isFinite(n)) return null;
  const bulat = Math.round(n);
  return bulat >= 50 && bulat <= 250 ? bulat : null;
}

function rapikanUkuran(p: Partial<Record<keyof ProfilUkuran, unknown>> | null | undefined): ProfilUkuran {
  if (!p || typeof p !== "object") return { ...UKURAN_KOSONG };
  return {
    atasan: teksPendek(p.atasan, 20),
    bawahan: teksPendek(p.bawahan, 20),
    tinggiCm: tinggiSah(p.tinggiCm),
    hijab: typeof p.hijab === "boolean" ? p.hijab : null,
    catatan: teksPendek(p.catatan, 300),
  };
}

/** Kolom `Kol.sizeProfile` (JSON teks) → profil. Isi yang rusak dibaca kosong, tidak melempar. */
export function bacaProfilUkuran(teks: string | null | undefined): ProfilUkuran {
  if (!teks) return { ...UKURAN_KOSONG };
  try {
    return rapikanUkuran(JSON.parse(teks));
  } catch {
    return { ...UKURAN_KOSONG };
  }
}

export function ukuranKosong(p: ProfilUkuran): boolean {
  return p.atasan === null && p.bawahan === null && p.tinggiCm === null && p.hijab === null && p.catatan === null;
}

/** Profil → JSON teks dengan urutan kunci tetap, atau null bila seluruhnya kosong. */
export function tulisProfilUkuran(p: Partial<Record<keyof ProfilUkuran, unknown>> | null | undefined): string | null {
  const r = rapikanUkuran(p);
  if (ukuranKosong(r)) return null;
  return JSON.stringify({ atasan: r.atasan, bawahan: r.bawahan, tinggiCm: r.tinggiCm, hijab: r.hijab, catatan: r.catatan });
}

/* ─────────────────────────── tambah massal ─────────────────────────── */

export const BATAS_TEMPEL = 500;

/** "Cek kembar" menampilkan paling banyak sekian kelompok. */
export const BATAS_KELOMPOK_KEMBAR = 200;

export type GalatTempel = "HANDLE_KOSONG" | "PENGIKUT_TIDAK_TERBACA" | "WA_TIDAK_SAH";

export type BarisTempel = {
  /** Nomor baris di kotak tempel (mulai 1), supaya galat bisa ditunjuk. */
  nomor: number;
  /** Handle bentuk pembanding (tanpa @, huruf kecil), atau null bila kosong. */
  handle: string | null;
  handleAsli: string;
  nama: string | null;
  pengikut: number | null;
  pengikutTeks: string;
  /** Nomor WA "62…", atau null. */
  wa: string | null;
  waTeks: string;
  kota: string | null;
  galat: GalatTempel[];
};

const JUDUL_KOLOM = new Set(["username", "handle", "akun", "user", "nama akun", "@username"]);

/**
 * Pecah satu baris tempelan menjadi kolom. Tab dulu, lalu titik koma, lalu
 * koma. Dengan koma, angka pengikut seperti "1,2jt" atau "1,250" terbelah dua;
 * potongan angka pendek sesudah angka di kolom pengikut digabung kembali.
 */
export function pecahKolom(baris: string): string[] {
  if (baris.includes("\t")) return baris.split("\t").map((s) => s.trim());
  if (baris.includes(";")) return baris.split(";").map((s) => s.trim());
  const mentah = baris.split(",").map((s) => s.trim());
  const hasil: string[] = [];
  for (const p of mentah) {
    const sebelum = hasil[hasil.length - 1];
    if (
      hasil.length === 3 &&
      sebelum !== undefined &&
      /^\d+([.,]\d+)*$/.test(sebelum) &&
      /^\d{1,3}\s*(k|rb|ribu|jt|juta|m)?$/i.test(p)
    ) {
      hasil[hasil.length - 1] = `${sebelum},${p}`;
      continue;
    }
    hasil.push(p);
  }
  return hasil;
}

/**
 * Teks "Tambah massal" → baris. Format: `username, nama, pengikut[, WA, kota]`
 * — hanya username yang wajib. Baris kosong dan baris berawalan "#" dilewati;
 * baris pertama yang berisi judul kolom ("username", "handle") juga.
 */
export function uraiTempelan(teks: string): BarisTempel[] {
  const hasil: BarisTempel[] = [];
  const barisan = String(teks ?? "").replace(/\r\n?/g, "\n").split("\n");
  let pertama = true;
  barisan.forEach((isi, i) => {
    const t = isi.trim();
    if (!t || t.startsWith("#")) return;
    const kolom = pecahKolom(t);
    if (pertama) {
      pertama = false;
      if (JUDUL_KOLOM.has((kolom[0] ?? "").toLowerCase())) return;
    }
    const [handleAsli = "", nama = "", pengikutTeks = "", waTeks = "", kota = ""] = kolom;
    const galat: GalatTempel[] = [];
    const handle = normalisasiHandle(handleAsli);
    if (!handle) galat.push("HANDLE_KOSONG");
    const pengikut = pengikutTeks ? bacaBilanganBulat(pengikutTeks) : null;
    if (pengikutTeks && pengikut === null) galat.push("PENGIKUT_TIDAK_TERBACA");
    const wa = waTeks ? normalisasiWa(waTeks) : null;
    if (waTeks && wa === null) galat.push("WA_TIDAK_SAH");
    hasil.push({
      nomor: i + 1,
      handle,
      handleAsli,
      nama: nama.trim() || null,
      pengikut,
      pengikutTeks,
      wa,
      waTeks,
      kota: kota.trim() || null,
      galat,
    });
  });
  return hasil;
}

/** Nomor baris yang handle-nya sudah muncul di baris sebelumnya → nomor baris pertama itu. */
export function kembarDalamTempelan(baris: readonly Pick<BarisTempel, "nomor" | "handle">[]): Map<number, number> {
  const pertama = new Map<string, number>();
  const hasil = new Map<number, number>();
  for (const b of baris) {
    if (!b.handle) continue;
    const ada = pertama.get(b.handle);
    if (ada === undefined) pertama.set(b.handle, b.nomor);
    else hasil.set(b.nomor, ada);
  }
  return hasil;
}

/* ─────────────────────────── profil & ringkasan ─────────────────────────── */

/** Tautan profil: yang tersimpan menang; bila kosong dibuat dari handle untuk platform yang polanya pasti. */
export function urlProfil(platform: Platform, handle: string, urlTersimpan?: string | null): string | null {
  const simpan = urlTersimpan?.trim();
  if (simpan) return /^https?:\/\//i.test(simpan) ? simpan : `https://${simpan}`;
  const h = normalisasiHandle(handle);
  if (!h) return null;
  switch (platform) {
    case "INSTAGRAM":
      return `https://www.instagram.com/${h}`;
    case "TIKTOK":
      return `https://www.tiktok.com/@${h}`;
    case "YOUTUBE":
      return `https://www.youtube.com/@${h}`;
    default:
      return null;
  }
}

/** Huruf avatar: dua huruf pertama dari dua kata pertama ("Nadia Putri" → "NP"). */
export function inisial(nama: string | null | undefined): string {
  const kata = String(nama ?? "")
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (kata.length === 0) return "?";
  if (kata.length === 1) return kata[0].slice(0, 2).toUpperCase();
  return `${kata[0][0]}${kata[1][0]}`.toUpperCase();
}

export type HitunganKolaborasiKol = {
  total: number;
  selesai: number;
  berjalan: number;
  ghosting: number;
  ditolak: number;
  batal: number;
};

export function hitungKolaborasiKol(tahap: readonly Tahap[]): HitunganKolaborasiKol {
  const h: HitunganKolaborasiKol = { total: tahap.length, selesai: 0, berjalan: 0, ghosting: 0, ditolak: 0, batal: 0 };
  for (const t of tahap) {
    if (t === "SELESAI") h.selesai += 1;
    else if (t === "GHOSTING") h.ghosting += 1;
    else if (t === "DITOLAK") h.ditolak += 1;
    else if (t === "BATAL") h.batal += 1;
    else if (tahapAktif(t)) h.berjalan += 1;
  }
  return h;
}

/**
 * Persen tepat waktu: dari kolaborasi yang punya rencana tayang DAN sudah ada
 * konten tayang, berapa yang konten pertamanya tayang pada hari (WIB) yang sama
 * atau sebelum rencana. Yang belum tayang tidak dinilai — belum terlambat
 * bukan berarti tepat waktu.
 */
export function persenTepatWaktu(
  baris: readonly { plannedLiveAt: Date | string | null; liveAtPertama: Date | string | null }[],
): { tepat: number; dinilai: number; persen: number | null } {
  let tepat = 0;
  let dinilai = 0;
  for (const b of baris) {
    if (!b.plannedLiveAt || !b.liveAtPertama) continue;
    const rencana = formatDateOnlyJakarta(new Date(b.plannedLiveAt));
    const tayang = formatDateOnlyJakarta(new Date(b.liveAtPertama));
    dinilai += 1;
    if (tayang <= rencana) tepat += 1;
  }
  return { tepat, dinilai, persen: dinilai ? Math.round((tepat / dinilai) * 100) : null };
}

/**
 * Pola nomor WA untuk pencarian "contains" pada `waNormal`: digit saja, awalan
 * 0 / +62 / 8 disamakan menjadi "62…". Null bila kata cari bukan nomor
 * (kurang dari 4 digit, atau ada hurufnya).
 */
export function polaCariWa(q: string): string | null {
  const t = q.trim();
  if (!/^[+\d\s().-]+$/.test(t)) return null;
  let d = t.replace(/\D/g, "");
  if (d.length < 4) return null;
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  else if (d.startsWith("8")) d = `62${d}`;
  return d;
}
