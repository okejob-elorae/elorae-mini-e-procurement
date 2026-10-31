import { geserHari } from "@/lib/tanggal-isian";
import { hariKerjaKah, kalenderKerja, type KalenderKerja, type TanggalMerah } from "@/lib/production/hari-kerja";
import { geserMasaPajak, hariTerakhirMasa } from "./masa";
import type { JenisSetoran } from "./setoran";

/**
 * Kalender pajak bulanan — murni, aman untuk komponen klien.
 *
 * Jatuh tempo untuk masa M (riset 2026-10-08: PMK 81/2024 Ps 94, PER-11/PJ/2025
 * Ps 44 — bukan nasihat pajak, periksa ke konsultan):
 * - setor PPh 21, 23, 4(2), PPh final, PPh 25: tanggal 15 bulan M+1;
 * - lapor SPT Masa PPh 21/26 dan SPT Masa PPh Unifikasi (23, 4(2)): tanggal 20 M+1;
 * - unggah faktur pajak keluaran ke Coretax: tanggal 20 M+1 (lewat = faktur tidak sah);
 * - setor DAN lapor PPN: akhir bulan M+1 (setor sebelum lapor);
 * - jatuh tempo di hari libur (Sabtu, Minggu, tanggal merah) → hari kerja berikutnya
 *   (PMK 81/2024 Ps 100). Tanggal merah memakai daftar yang sama dengan jadwal
 *   produksi (`produksi.tanggalMerah`), diketik per tahun di Lead Time.
 *
 * Status per butir dihitung dari angka buku besar (terutang) dan setoran yang
 * tercatat (`TaxPayment`): baris Beranda muncul untuk setoran yang belum lunas
 * dan jatuh tempo dalam `HARI_PERINGATAN` hari atau sudah lewat.
 */

export type JenisButir = "SETOR" | "LAPOR" | "UNGGAH_FAKTUR";
export type PajakButir = JenisSetoran | "PPH_UNIFIKASI" | "FAKTUR";

export type ButirKalender = {
  kunci: string;
  pajak: PajakButir;
  jenis: JenisButir;
  masa: string;
  /** Jatuh tempo sesudah digeser dari hari libur ("YYYY-MM-DD"). */
  jatuhTempo: string;
  /** Jatuh tempo menurut aturan sebelum digeser. */
  jatuhTempoAturan: string;
};

export const HARI_PERINGATAN = 3;

/** Hari kerja pemerintah: Senin–Jumat, tanpa tanggal merah. */
export function kalenderPajak(tanggalMerah: readonly TanggalMerah[]): KalenderKerja {
  return kalenderKerja([1, 2, 3, 4, 5], tanggalMerah);
}

/** Geser ke hari kerja berikutnya bila `teks` hari libur. */
export function geserKeHariKerja(teks: string, kal: KalenderKerja): string {
  let t = teks;
  for (let i = 0; i < 40 && !hariKerjaKah(t, kal); i++) t = geserHari(t, 1);
  return t;
}

export type ProfilKalender = {
  /** Status PKP: PPN wajib disetor/dilapor, faktur wajib diunggah. */
  pkp: boolean;
  /** Rezim PPh final UMKM aktif. */
  finalUmkm: boolean;
  /** Rezim PPh badan normal (angsuran PPh 25). */
  pphNormal: boolean;
  /** Jenis potongan yang ada terutangnya di masa itu (PPh 21/23/4(2)). */
  potongan: readonly ("PPH21" | "PPH23" | "PPH4_2")[];
};

function butir(pajak: PajakButir, jenis: JenisButir, masa: string, aturan: string, kal: KalenderKerja): ButirKalender {
  return { kunci: `${jenis}:${pajak}:${masa}`, pajak, jenis, masa, jatuhTempo: geserKeHariKerja(aturan, kal), jatuhTempoAturan: aturan };
}

/** Semua kewajiban untuk masa `masa`, urut jatuh tempo. */
export function kewajibanMasa(masa: string, profil: ProfilKalender, kal: KalenderKerja): ButirKalender[] {
  const berikut = geserMasaPajak(masa, 1);
  const tgl = (hari: number) => `${berikut}-${String(hari).padStart(2, "0")}`;
  const akhir = hariTerakhirMasa(berikut);
  const daftar: ButirKalender[] = [];
  for (const p of profil.potongan) daftar.push(butir(p, "SETOR", masa, tgl(15), kal));
  if (profil.finalUmkm) daftar.push(butir("PPH_FINAL", "SETOR", masa, tgl(15), kal));
  if (profil.pphNormal) daftar.push(butir("PPH25", "SETOR", masa, tgl(15), kal));
  if (profil.potongan.includes("PPH21")) daftar.push(butir("PPH21", "LAPOR", masa, tgl(20), kal));
  if (profil.potongan.some((p) => p === "PPH23" || p === "PPH4_2")) daftar.push(butir("PPH_UNIFIKASI", "LAPOR", masa, tgl(20), kal));
  if (profil.pkp) {
    daftar.push(butir("FAKTUR", "UNGGAH_FAKTUR", masa, tgl(20), kal));
    daftar.push(butir("PPN", "SETOR", masa, akhir, kal));
    daftar.push(butir("PPN", "LAPOR", masa, akhir, kal));
  }
  return daftar.sort((a, b) => a.jatuhTempo.localeCompare(b.jatuhTempo) || a.kunci.localeCompare(b.kunci));
}

export type StatusBayar = "LUNAS" | "SEBAGIAN" | "BELUM" | "NIHIL" | "TANPA_ANGKA" | "INFO";
export type StatusTenggat = "LEWAT" | "SEGERA" | "NANTI";

export type ButirBerstatus = ButirKalender & {
  /** Terutang menurut buku besar/rekap; null = tidak diketahui (PPh 25, PPN belum direkap). */
  terutang: number | null;
  disetor: number;
  sisa: number | null;
  status: StatusBayar;
  tenggat: StatusTenggat;
  /** Perlu tindakan: setoran belum lunas dan jatuh tempo ≤ HARI_PERINGATAN hari lagi atau sudah lewat. */
  perluTindakan: boolean;
  /** Terutang masih PERKIRAAN dari buku besar (PPN yang rekap masanya belum final). */
  perkiraan?: boolean;
};

const keSen = (n: number) => Math.round(Number((n * 100).toFixed(4)));

/** Selisih hari kalender antara dua teks tanggal (b − a). */
function selisihHari(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function beriStatus(b: ButirKalender, angka: { terutang: number | null; disetor: number }, hariIni: string): ButirBerstatus {
  const tenggat: StatusTenggat = hariIni > b.jatuhTempo ? "LEWAT" : selisihHari(hariIni, b.jatuhTempo) <= HARI_PERINGATAN ? "SEGERA" : "NANTI";
  if (b.jenis !== "SETOR") {
    return { ...b, terutang: null, disetor: 0, sisa: null, status: "INFO", tenggat, perluTindakan: false };
  }
  const disetorSen = Math.max(0, keSen(angka.disetor));
  if (angka.terutang == null) {
    const status: StatusBayar = disetorSen > 0 ? "LUNAS" : "TANPA_ANGKA";
    return { ...b, terutang: null, disetor: disetorSen / 100, sisa: null, status, tenggat, perluTindakan: false };
  }
  const terutangSen = Math.max(0, keSen(angka.terutang));
  const sisaSen = Math.max(0, terutangSen - disetorSen);
  const status: StatusBayar = terutangSen === 0 ? "NIHIL" : sisaSen === 0 ? "LUNAS" : disetorSen > 0 ? "SEBAGIAN" : "BELUM";
  return {
    ...b,
    terutang: terutangSen / 100,
    disetor: disetorSen / 100,
    sisa: sisaSen / 100,
    status,
    tenggat,
    perluTindakan: sisaSen > 0 && tenggat !== "NANTI",
  };
}

export type SaringKalender = "semua" | "segera" | "lewat";
export const SEMUA_SARING_KALENDER: readonly SaringKalender[] = ["semua", "segera", "lewat"];

export function bacaSaringKalender(v: unknown): SaringKalender {
  return SEMUA_SARING_KALENDER.includes(v as SaringKalender) ? (v as SaringKalender) : "semua";
}

/**
 * Satu definisi saringan untuk halaman kalender DAN baris Beranda:
 * "segera" = setoran belum lunas yang jatuh tempo ≤ 3 hari lagi; "lewat" =
 * setoran belum lunas yang jatuh temponya sudah lewat.
 */
export function cocokSaring(b: ButirBerstatus, saring: SaringKalender): boolean {
  if (saring === "semua") return true;
  if (!b.perluTindakan) return false;
  return saring === "lewat" ? b.tenggat === "LEWAT" : b.tenggat === "SEGERA";
}
