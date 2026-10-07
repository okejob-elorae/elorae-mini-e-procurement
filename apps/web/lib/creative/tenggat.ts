/**
 * Tenggat turunan per kolaborasi — murni, aman untuk klien.
 *
 * Tidak ada tenggat yang disimpan: semuanya dihitung dari tanggal-tanggal
 * kolaborasi + ambang (`ambang.ts`). Tenggat yang disimpan basi begitu ambang
 * diubah atau tanggal dibetulkan, dan tidak ada yang memperbaruinya.
 *
 * Semua tanggal berupa hari WIB "YYYY-MM-DD" (`formatDateOnlyJakarta` di sisi
 * server). "Lewat" baru sesudah hari berganti: tenggat yang jatuh hari ini
 * belum terlambat.
 */

import { bacaTanggal, geserHari } from "@/lib/tanggal-isian";
import type { AmbangKreatif } from "./ambang";
import { indeksTahap, isJalurKeluar, tahapAktif, type StatusBayar, type StatusDraf, type Tahap } from "./tahap";

export type JenisTenggat =
  | "FOLLOW_UP"
  | "KIRIM_SAMPEL"
  | "RESI_NYANGKUT"
  | "BATAS_TAYANG"
  | "REVIEW_DRAF"
  | "JATUH_TEMPO_BAYAR"
  | "ANGKA_H1"
  | "ANGKA_H3"
  | "ANGKA_H7";

export type PengirimanTenggat = {
  id: string;
  sentAt: string | null;
  receivedAt: string | null;
  trackingNo?: string | null;
};

export type KontenTenggat = {
  id: string;
  link: string | null;
  liveAt: string | null;
  draftStatus: StatusDraf | null;
  draftAt: string | null;
  /** Hari WIB angka terakhir dicatat untuk konten ini. */
  angkaTerakhirHari: string | null;
};

export type DataTenggat = {
  tahap: Tahap;
  tahapAt: string;
  dealAt?: string | null;
  lastContactAt?: string | null;
  /** `KolBrief.liveAt` — cadangan bila belum ada konten bertanggal tayang. */
  liveAt?: string | null;
  fee: number;
  payStatus: StatusBayar;
  pengiriman: PengirimanTenggat[];
  konten: KontenTenggat[];
};

export type Tenggat = {
  jenis: JenisTenggat;
  /** Hari WIB tenggatnya. */
  tanggal: string;
  /** Hari WIB jam hitungnya mulai. */
  sejak: string;
  lewat: boolean;
  /** Berapa hari sudah lewat (0 bila belum). */
  lewatHari: number;
  /** Id pengiriman/konten yang menjadi sumbernya, bila ada. */
  refId: string | null;
};

const HARI_MS = 86_400_000;

/** `sampai − dari` dalam hari kalender (boleh negatif); 0 bila salah satunya bukan tanggal. */
export function selisihHari(dari: string, sampai: string): number {
  const a = bacaTanggal(dari);
  const b = bacaTanggal(sampai);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.tahun, b.bulan - 1, b.hari) - Date.UTC(a.tahun, a.bulan - 1, a.hari)) / HARI_MS);
}

/** Umur dalam hari sejak `sejak` sampai `hariIni` (negatif = masih akan datang, "H-n"). */
export function umurHari(sejak: string, hariIni: string): number {
  return selisihHari(sejak, hariIni);
}

/** Lewat baru sesudah hari berganti. */
export function lewatTenggat(tanggal: string, hariIni: string): boolean {
  return hariIni > tanggal;
}

const maks = (a: string | null | undefined, b: string | null | undefined): string | null => {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
};

function buat(jenis: JenisTenggat, sejak: string, hari: number, hariIni: string, refId: string | null = null): Tenggat {
  const tanggal = geserHari(sejak, hari);
  const lewat = lewatTenggat(tanggal, hariIni);
  return { jenis, tanggal, sejak, lewat, lewatHari: lewat ? selisihHari(tanggal, hariIni) : 0, refId };
}

/** Pengiriman sudah berangkat bila tanggal kirim atau resinya terisi. */
function berangkat(p: PengirimanTenggat): boolean {
  return Boolean(p.sentAt) || Boolean(p.trackingNo?.trim());
}

export function tenggatKolaborasi(d: DataTenggat, ambang: AmbangKreatif, hariIni: string): Tenggat[] {
  const hasil: Tenggat[] = [];
  const aktif = tahapAktif(d.tahap);
  const sebelumTayang = aktif && indeksTahap(d.tahap) < indeksTahap("TAYANG");
  const adaLink = d.konten.some((k) => Boolean(k.link?.trim()));

  if (aktif && (d.tahap === "DIHUBUNGI" || d.tahap === "NEGO")) {
    const sejak = maks(d.lastContactAt, d.tahapAt);
    if (sejak) hasil.push(buat("FOLLOW_UP", sejak, ambang.followUpHari, hariIni));
  }

  if (aktif && (d.tahap === "DEAL" || d.tahap === "BRIEF_DIKIRIM") && !d.pengiriman.some(berangkat)) {
    hasil.push(buat("KIRIM_SAMPEL", d.dealAt ?? d.tahapAt, ambang.dealKeKirimHari, hariIni));
  }

  if (sebelumTayang) {
    for (const p of d.pengiriman) {
      if (p.sentAt && !p.receivedAt) hasil.push(buat("RESI_NYANGKUT", p.sentAt, ambang.kirimKeTerimaHari, hariIni, p.id));
    }
    const terimaTerakhir = d.pengiriman.reduce<string | null>((m, p) => maks(m, p.receivedAt), null);
    if (terimaTerakhir && !adaLink) {
      hasil.push(buat("BATAS_TAYANG", terimaTerakhir, ambang.terimaKeTayangHari, hariIni));
    }
  }

  if (aktif) {
    for (const k of d.konten) {
      if (k.draftStatus === "MENUNGGU" && !k.link?.trim() && k.draftAt) {
        hasil.push(buat("REVIEW_DRAF", k.draftAt, ambang.reviewDrafHari, hariIni, k.id));
      }
    }
  }

  // Bayar: tetap ditagih sesudah SELESAI atau keluar jalur — fee yang sudah
  // diakui tidak hilang karena kolaborasinya ditutup.
  if (d.fee > 0 && (d.payStatus === "BELUM" || d.payStatus === "SEBAGIAN") && !(isJalurKeluar(d.tahap) && !adaLink)) {
    const tayangTerakhir = d.konten.reduce<string | null>((m, k) => (k.link?.trim() ? maks(m, k.liveAt) : m), null) ?? d.liveAt ?? null;
    if (tayangTerakhir) hasil.push(buat("JATUH_TEMPO_BAYAR", tayangTerakhir, ambang.jatuhTempoBayarHari, hariIni));
  }

  if (aktif) {
    const titik: [JenisTenggat, number][] = [
      ["ANGKA_H1", 1],
      ["ANGKA_H3", ambang.tayangKeAngkaHari],
      ["ANGKA_H7", 7],
    ];
    for (const k of d.konten) {
      if (!k.link?.trim() || !k.liveAt) continue;
      const dipakai = new Set<string>();
      const belum = titik
        .map(([jenis, hari]) => buat(jenis, k.liveAt!, hari, hariIni, k.id))
        .filter((t) => {
          if (dipakai.has(t.tanggal)) return false;
          dipakai.add(t.tanggal);
          return !k.angkaTerakhirHari || k.angkaTerakhirHari < t.tanggal;
        })
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal));
      const terlewat = belum.filter((t) => t.lewat);
      // Yang sudah lewat cukup satu (yang terbaru); H+1 dan H+3 yang sama-sama
      // lewat hanya menuntut satu pengisian angka.
      if (terlewat.length) hasil.push(terlewat[terlewat.length - 1]);
      hasil.push(...belum.filter((t) => !t.lewat));
    }
  }

  return hasil.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.jenis.localeCompare(b.jenis));
}
