/**
 * Penyusun antrean pantau KOL — murni, aman untuk klien.
 *
 * Keputusan sementara P3 (ingatkan pemilik):
 *   - konten kolaborasi yang tayang (punya tanggal tayang + link TikTok) dicek
 *     pada H+1, H+3, H+7, H+30 (hari WIB);
 *   - akun TikTok KOL "aktif" (punya kolaborasi berjalan) seminggu sekali,
 *     akun lain sebulan sekali (keduanya dari pengaturan);
 *   - KOL diblokir tidak pernah dicek.
 *
 * Konten yang tertinggal (perangkat mati beberapa hari, atau konten lama saat
 * pemantauan baru dinyalakan) hanya dicek di titik TERBARU yang sudah lewat,
 * sekali; titik-titik lebih awal yang belum dikerjakan dilewati (`lewati`).
 * Titik yang lewat lebih dari `BATAS_TELAT_KONTEN_HARI` tidak dibuat lagi —
 * tanpa batas ini, menyalakan pemantauan pertama kali mengantrekan setiap
 * konten yang pernah tayang.
 *
 * Kunci (`KONTEN:<id>:H<n>`, `PROFIL:<id>:<hari WIB>`) unik di tabel, jadi
 * penyusun boleh dijalankan berkali-kali sehari: yang sudah ada tidak dibuat
 * ulang.
 *
 * Performa video (2026-10-09, keputusan sementara — ingatkan pemilik):
 *   - video yang baru ditempel langsung mendapat tugas `KONTEN:<id>:SEGERA`
 *     (prioritas tertinggi, jatuh hari ini) dari penulis tempel, supaya angka
 *     pertamanya masuk dalam hitungan menit;
 *   - sesudah titik H+30, video dicek lagi setiap `hariKontenBerkala` hari
 *     sejak cek terakhirnya sampai `batasHariKonten` hari sesudah tayang
 *     (`KONTEN:<id>:B<hari WIB>`) — dengan ini video yang ditempel lama sesudah
 *     tayang (titik-titiknya sudah lewat lebih dari 14 hari) tetap terpantau;
 *   - bacaan (atau cek yang selesai/gagal) pada atau sesudah hari sebuah titik
 *     menutup titik itu dan yang sebelumnya: tidak dibuat lagi, dan yang masih
 *     ANTRE dilewati;
 *   - satu video satu tugas terbuka: tugas SEGERA/berkala yang belum selesai
 *     menahan titik baru, dan titik yang belum selesai menahan cek berkala.
 */

import { geserHari } from "@/lib/tanggal-isian";
import { selisihHari } from "./tenggat";
import type { PengaturanPantau } from "./pantau-aturan";
import { linkTiktok, normalHandle, urlKontenKanonik, urlProfilTiktok } from "./pantau-muatan";

export const TITIK_KONTEN = [1, 3, 7, 30] as const;
export type TitikKonten = (typeof TITIK_KONTEN)[number];

/** Titik konten yang terlambat lebih dari ini (hari) tidak diantrekan lagi. */
export const BATAS_TELAT_KONTEN_HARI = 14;

export const PRIORITAS_PANTAU = {
  KONTEN_SEGERA: 95,
  KONTEN: { 1: 90, 3: 85, 7: 80, 30: 70 } as Record<TitikKonten, number>,
  KONTEN_BERKALA: 60,
  PROFIL_AKTIF: 50,
  PROFIL_LAIN: 20,
} as const;

export const kunciKonten = (contentId: string, titik: number) => `KONTEN:${contentId}:H${titik}`;
export const kunciSegera = (contentId: string) => `KONTEN:${contentId}:SEGERA`;
export const kunciBerkala = (contentId: string, hari: string) => `KONTEN:${contentId}:B${hari}`;
/** Cek yang diminta orang dari layar Performa video ("Cek sekarang"); waktu dalam ms membuatnya unik. */
export const kunciMinta = (contentId: string, waktuMs: number) => `KONTEN:${contentId}:M${waktuMs}`;
export const kunciProfil = (accountId: string, hari: string) => `PROFIL:${accountId}:${hari}`;
/** Kunci titik H+n (bukan SEGERA/berkala). */
const kunciTitik = (kunci: string) => /:H\d+$/.test(kunci);

export type KontenAntrean = {
  id: string;
  link: string | null;
  liveAtHari: string | null;
  kolDiblokir: boolean;
  /** Hari WIB cek terakhir: angka terbaru, atau tugas konten yang selesai/gagal. */
  terakhirDicekHari?: string | null;
  /** Kunci tugas konten yang masih terbuka (ANTRE/DIPINJAM). */
  tugasTerbuka?: readonly string[];
};
export type AkunAntrean = { id: string; handle: string; kolDiblokir: boolean; aktif: boolean; terakhirDicekHari: string | null };

export type MasukanAntrean = {
  /** Hari WIB "YYYY-MM-DD". */
  hariIni: string;
  konten: readonly KontenAntrean[];
  akun: readonly AkunAntrean[];
  /** Kunci calon yang sudah ada di tabel (status apa pun). */
  kunciAda: ReadonlySet<string>;
  /** Akun yang masih punya tugas PROFIL terbuka (ANTRE/DIPINJAM). */
  akunTerbuka: ReadonlySet<string>;
  pengaturan: Pick<PengaturanPantau, "hariAkunAktif" | "hariAkunLain" | "hariKontenBerkala" | "batasHariKonten">;
};

export type TugasBaru = {
  kunci: string;
  jenis: "PROFIL" | "KONTEN";
  platform: "TIKTOK";
  accountId: string | null;
  contentId: string | null;
  url: string;
  titikH: number | null;
  prioritas: number;
  /** Hari WIB jatuh tempo; `jatuhAt` = awal hari itu (WIB). */
  jatuhHari: string;
};

export type HasilAntrean = { baru: TugasBaru[]; lewati: string[] };

export function susunAntreanPantau(m: MasukanAntrean): HasilAntrean {
  const baru: TugasBaru[] = [];
  const lewati: string[] = [];
  const dipakai = new Set<string>();

  for (const k of m.konten) {
    if (k.kolDiblokir || !k.liveAtHari || !k.link || !linkTiktok(k.link)) continue;
    const terbuka = k.tugasTerbuka ?? [];
    // Tugas SEGERA/berkala yang belum selesai akan membaca angka terbaru: titik yang jatuh sementara itu tertutup olehnya.
    if (terbuka.some((x) => !kunciTitik(x))) continue;
    const terakhir = k.terakhirDicekHari ?? null;

    const lewat = TITIK_KONTEN.filter((n) => geserHari(k.liveAtHari!, n) <= m.hariIni);
    const titik = lewat.at(-1);
    if (titik !== undefined) {
      const jatuh = geserHari(k.liveAtHari, titik);
      const kunci = kunciKonten(k.id, titik);
      if (terakhir && terakhir >= jatuh) {
        for (const n of lewat) lewati.push(kunciKonten(k.id, n));
      } else if (selisihHari(jatuh, m.hariIni) <= BATAS_TELAT_KONTEN_HARI) {
        if (m.kunciAda.has(kunci) || dipakai.has(kunci)) {
          // Titiknya sudah punya tugas (masih terbuka, atau ditutup tanpa bacaan): tunggu, tanpa cek berkala.
          continue;
        }
        dipakai.add(kunci);
        baru.push({
          kunci,
          jenis: "KONTEN",
          platform: "TIKTOK",
          accountId: null,
          contentId: k.id,
          url: urlKontenKanonik(k.link),
          titikH: titik,
          prioritas: PRIORITAS_PANTAU.KONTEN[titik],
          jatuhHari: jatuh,
        });
        for (const n of lewat) if (n < titik) lewati.push(kunciKonten(k.id, n));
        continue;
      }
    }

    // Cek berkala: sesudah titik terakhir, sampai batasnya, setiap N hari sejak cek terakhir.
    if (terbuka.length) continue;
    if (m.hariIni <= geserHari(k.liveAtHari, Math.max(...TITIK_KONTEN))) continue;
    if (m.hariIni > geserHari(k.liveAtHari, m.pengaturan.batasHariKonten)) continue;
    if (terakhir && selisihHari(terakhir, m.hariIni) < m.pengaturan.hariKontenBerkala) continue;
    const kunci = kunciBerkala(k.id, m.hariIni);
    if (m.kunciAda.has(kunci) || dipakai.has(kunci)) continue;
    dipakai.add(kunci);
    baru.push({
      kunci,
      jenis: "KONTEN",
      platform: "TIKTOK",
      accountId: null,
      contentId: k.id,
      url: urlKontenKanonik(k.link),
      titikH: null,
      prioritas: PRIORITAS_PANTAU.KONTEN_BERKALA,
      jatuhHari: m.hariIni,
    });
  }

  for (const a of m.akun) {
    const handle = normalHandle(a.handle);
    if (a.kolDiblokir || !handle || m.akunTerbuka.has(a.id)) continue;
    const selang = a.aktif ? m.pengaturan.hariAkunAktif : m.pengaturan.hariAkunLain;
    if (a.terakhirDicekHari && selisihHari(a.terakhirDicekHari, m.hariIni) < selang) continue;
    const kunci = kunciProfil(a.id, m.hariIni);
    if (m.kunciAda.has(kunci) || dipakai.has(kunci)) continue;
    dipakai.add(kunci);
    baru.push({
      kunci,
      jenis: "PROFIL",
      platform: "TIKTOK",
      accountId: a.id,
      contentId: null,
      url: urlProfilTiktok(handle),
      titikH: null,
      prioritas: a.aktif ? PRIORITAS_PANTAU.PROFIL_AKTIF : PRIORITAS_PANTAU.PROFIL_LAIN,
      jatuhHari: m.hariIni,
    });
  }

  return { baru, lewati };
}

/**
 * Tugas cek pertama untuk video yang baru ditempel (Performa video): jatuh hari
 * ini, prioritas di atas semua tugas lain. Dibuat penulis tempel di transaksi
 * yang sama dengan kontennya.
 */
export function tugasSegera(isi: { contentId: string; url: string; hariIni: string }): TugasBaru {
  return {
    kunci: kunciSegera(isi.contentId),
    jenis: "KONTEN",
    platform: "TIKTOK",
    accountId: null,
    contentId: isi.contentId,
    url: urlKontenKanonik(isi.url),
    titikH: null,
    prioritas: PRIORITAS_PANTAU.KONTEN_SEGERA,
    jatuhHari: isi.hariIni,
  };
}
