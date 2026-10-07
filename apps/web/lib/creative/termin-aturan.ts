/**
 * Termin pembayaran fee KOL — aturan murni, aman untuk komponen klien.
 *
 * Fee kolaborasi dibayar lewat satu atau beberapa termin (`KolPaymentTerm`).
 * "Jumlah" sebuah termin selalu dalam BASIS fee kolaborasinya:
 * - mode DIPOTONG: fee = bruto; jumlah termin = bruto, KOL menerima neto.
 * - mode GROSS_UP: fee = neto yang diterima KOL; jumlah termin = neto, bruto
 *   dicari (`hitungDariNeto`) dan PPh ditanggung Elorae.
 * Jadi Σ jumlah termin yang hidup = fee, dan `KolBrief.paidAmount` (Σ jumlah
 * termin dibayar) tetap bisa dibandingkan dengan fee seperti sebelumnya.
 *
 * Termin yang sudah DIBAYAR terkunci. Rencana termin baru hanya membagi SISA
 * (fee − yang sudah dibayar); persen di rencana adalah bagian dari sisa itu,
 * yang untuk kolaborasi yang belum dibayar sama dengan persen dari fee.
 *
 * `KolBrief.payStatus/paidAmount/paidAt` DITURUNKAN dari termin
 * (`turunkanBayar`) — tidak pernah diketik.
 */

import { geserHari, bacaTanggal } from "@/lib/tanggal-isian";
import { bagiJumlah, hitungTermin, type ModePajak, type RincianPph, type SubjekPajak, type TarifPajakKreatif } from "./pph";
import type { StatusBayar } from "./tahap";

export type StatusTermin = "BELUM" | "DIBAYAR" | "BATAL";
export type PemicuTermin = "DEAL" | "TAYANG" | "TANGGAL";
export const SEMUA_PEMICU: readonly PemicuTermin[] = ["DEAL", "TAYANG", "TANGGAL"];

export const BATAS_TERMIN = 12;
export const BATAS_LABEL_TERMIN = 60;
export const BATAS_HARI_TERMIN = 365;
export const LABEL_PELUNASAN = "Pelunasan";

const keSen = (n: number): number => Math.round(Number(((Number.isFinite(n) ? n : 0) * 100).toFixed(4)));
const dariSen = (s: number): number => s / 100;

/** Jumlah termin dalam basis fee: neto untuk gross-up, bruto untuk dipotong. */
export function nilaiBasis(t: { bruto: number; neto: number; grossUp: boolean }): number {
  return t.grossUp ? t.neto : t.bruto;
}

export type TerminUntukTurunan = { status: StatusTermin; bruto: number; neto: number; grossUp: boolean; dibayarHari: string | null };

export type TurunanBayar = { payStatus: StatusBayar; paidAmount: number; paidAtHari: string | null };

/**
 * Keadaan bayar kolaborasi dari terminnya. Fee nol atau tanpa termin hidup →
 * TIDAK_PERLU. Semua termin hidup dibayar → LUNAS; sebagian → SEBAGIAN.
 * `paidAtHari` = tanggal bayar termin terakhir.
 */
export function turunkanBayar(fee: number, termin: readonly TerminUntukTurunan[]): TurunanBayar {
  const hidup = termin.filter((t) => t.status !== "BATAL");
  if (keSen(fee) <= 0 || hidup.length === 0) return { payStatus: "TIDAK_PERLU", paidAmount: 0, paidAtHari: null };
  const dibayar = hidup.filter((t) => t.status === "DIBAYAR");
  const paidSen = dibayar.reduce((s, t) => s + keSen(nilaiBasis(t)), 0);
  const paidAtHari = dibayar.map((t) => t.dibayarHari).filter((h): h is string => Boolean(h)).sort().at(-1) ?? null;
  const payStatus: StatusBayar = dibayar.length === 0 ? "BELUM" : dibayar.length === hidup.length ? "LUNAS" : "SEBAGIAN";
  return { payStatus, paidAmount: dariSen(paidSen), paidAtHari: payStatus === "BELUM" ? null : paidAtHari };
}

export type RencanaTermin = {
  label: string;
  /** Bagian dari SISA (dasar PERSEN). */
  persen?: number | null;
  /** Jumlah dalam basis fee (dasar JUMLAH). */
  jumlah?: number | null;
  pemicu: PemicuTermin;
  hariSesudah?: number | null;
  /** Hari WIB untuk pemicu TANGGAL. */
  tanggal?: string | null;
  catatan?: string | null;
};

export type DasarRencana = "PERSEN" | "JUMLAH";

export type KodeTolakTermin =
  | "SISA_NEGATIF"
  | "SUDAH_LUNAS"
  | "KOSONG"
  | "TERLALU_BANYAK"
  | "LABEL_WAJIB"
  | "LABEL_PANJANG"
  | "PEMICU_TIDAK_VALID"
  | "HARI_TIDAK_VALID"
  | "TANGGAL_WAJIB"
  | "TANGGAL_TIDAK_VALID"
  | "PERSEN_TIDAK_VALID"
  | "TOTAL_PERSEN"
  | "JUMLAH_TIDAK_VALID"
  | "TOTAL_JUMLAH"
  | "CATATAN_PANJANG";

export type TerminTerhitung = {
  label: string;
  /** Persen dari FEE (untuk tampilan), dua desimal. */
  persenFee: number;
  /** Jumlah dalam basis fee. */
  jumlah: number;
  pemicu: PemicuTermin;
  hariSesudah: number;
  tanggal: string | null;
  catatan: string | null;
  rincian: RincianPph;
};

export type HasilRencana = { ok: true; sisa: number; baris: TerminTerhitung[] } | { ok: false; kode: KodeTolakTermin; indeks?: number };

const bulat2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Hitung termin yang belum dibayar dari rencana.
 *
 * Dasar PERSEN: Σ persen = 100 (dua desimal), jumlah dibagi dengan sisa
 * terbesar sehingga Σ jumlah = sisa PERSIS. Dasar JUMLAH: Σ jumlah = sisa.
 * Setiap termin dihitung PPh-nya sendiri (per pembayaran, tidak kumulatif).
 */
export function rencanakanTermin(input: {
  fee: number;
  mode: ModePajak;
  subjek: SubjekPajak;
  tarif: TarifPajakKreatif;
  /** Jumlah basis termin yang sudah dibayar (terkunci). */
  dibayar: readonly number[];
  rencana: readonly RencanaTermin[];
  dasar: DasarRencana;
}): HasilRencana {
  const feeSen = keSen(input.fee);
  const dibayarSen = input.dibayar.reduce((s, n) => s + keSen(n), 0);
  const sisaSen = feeSen - dibayarSen;
  if (sisaSen < 0) return { ok: false, kode: "SISA_NEGATIF" };
  const sisa = dariSen(sisaSen);
  if (sisaSen === 0) return input.rencana.length === 0 ? { ok: true, sisa, baris: [] } : { ok: false, kode: "SUDAH_LUNAS" };
  if (input.rencana.length === 0) return { ok: false, kode: "KOSONG" };
  if (input.rencana.length > BATAS_TERMIN) return { ok: false, kode: "TERLALU_BANYAK" };

  for (const [i, r] of input.rencana.entries()) {
    const label = (r.label ?? "").trim();
    if (!label) return { ok: false, kode: "LABEL_WAJIB", indeks: i };
    if (label.length > BATAS_LABEL_TERMIN) return { ok: false, kode: "LABEL_PANJANG", indeks: i };
    if (!(SEMUA_PEMICU as readonly string[]).includes(r.pemicu)) return { ok: false, kode: "PEMICU_TIDAK_VALID", indeks: i };
    const hari = r.hariSesudah ?? 0;
    if (!Number.isInteger(hari) || hari < 0 || hari > BATAS_HARI_TERMIN) return { ok: false, kode: "HARI_TIDAK_VALID", indeks: i };
    if (r.pemicu === "TANGGAL") {
      if (!r.tanggal?.trim()) return { ok: false, kode: "TANGGAL_WAJIB", indeks: i };
      if (!bacaTanggal(r.tanggal)) return { ok: false, kode: "TANGGAL_TIDAK_VALID", indeks: i };
    }
    if ((r.catatan ?? "").length > 1000) return { ok: false, kode: "CATATAN_PANJANG", indeks: i };
  }

  let jumlah: number[];
  if (input.dasar === "PERSEN") {
    const persen = input.rencana.map((r) => r.persen);
    for (const [i, p] of persen.entries()) {
      if (typeof p !== "number" || !Number.isFinite(p) || p <= 0 || p > 100) return { ok: false, kode: "PERSEN_TIDAK_VALID", indeks: i };
    }
    const total = persen.reduce<number>((s, p) => s + Math.round((p as number) * 100), 0);
    if (total !== 10_000) return { ok: false, kode: "TOTAL_PERSEN" };
    jumlah = bagiJumlah(sisa, persen as number[]);
    const nol = jumlah.findIndex((j) => keSen(j) <= 0);
    if (nol >= 0) return { ok: false, kode: "JUMLAH_TIDAK_VALID", indeks: nol };
  } else {
    jumlah = [];
    for (const [i, r] of input.rencana.entries()) {
      const j = r.jumlah;
      if (typeof j !== "number" || !Number.isFinite(j) || keSen(j) <= 0) return { ok: false, kode: "JUMLAH_TIDAK_VALID", indeks: i };
      jumlah.push(dariSen(keSen(j)));
    }
    if (jumlah.reduce((s, n) => s + keSen(n), 0) !== sisaSen) return { ok: false, kode: "TOTAL_JUMLAH" };
  }

  const baris = input.rencana.map((r, i) => ({
    label: r.label.trim(),
    persenFee: feeSen > 0 ? bulat2((keSen(jumlah[i]) / feeSen) * 100) : 0,
    jumlah: jumlah[i],
    pemicu: r.pemicu,
    hariSesudah: r.hariSesudah ?? 0,
    tanggal: r.pemicu === "TANGGAL" ? r.tanggal!.trim() : null,
    catatan: r.catatan?.trim() || null,
    rincian: hitungTermin(jumlah[i], input.mode, input.subjek, input.tarif),
  }));
  return { ok: true, sisa, baris };
}

/** Rencana bawaan: satu termin "Pelunasan" 100% sesudah tayang + jatuh tempo ambang. */
export function rencanaBawaan(jatuhTempoBayarHari: number): RencanaTermin[] {
  return [{ label: LABEL_PELUNASAN, persen: 100, pemicu: "TAYANG", hariSesudah: jatuhTempoBayarHari }];
}

/**
 * Jatuh tempo termin (hari WIB), atau null selama pemicunya belum terjadi
 * (belum deal / belum tayang).
 */
export function jatuhTempoTermin(
  t: { pemicu: PemicuTermin; hariSesudah: number; tanggal?: string | null },
  dasar: { dealHari: string | null; tayangHari: string | null },
): string | null {
  if (t.pemicu === "TANGGAL") return t.tanggal && bacaTanggal(t.tanggal) ? t.tanggal : null;
  const awal = t.pemicu === "DEAL" ? dasar.dealHari : dasar.tayangHari;
  return awal ? geserHari(awal, Math.max(0, t.hariSesudah)) : null;
}

/**
 * Bobot untuk membagi ulang sisa ke termin yang belum dibayar mengikuti
 * PROPORSI jumlah lamanya (fee berubah, mode berubah) — dipakai bersama
 * `bagiJumlah(sisa, bobot)`. Proporsi nol semua → seluruhnya ke termin pertama.
 */
export function bobotUlang(jumlahLama: readonly number[]): number[] {
  if (jumlahLama.length === 0) return [];
  const sen = jumlahLama.map((n) => Math.max(0, keSen(n)));
  const total = sen.reduce((a, b) => a + b, 0);
  if (total <= 0) return jumlahLama.map((_, i) => (i === 0 ? 100 : 0));
  return sen.map((s) => (s / total) * 100);
}

/** Kunci status kolaborasi untuk peringatan "data pajak belum lengkap". */
export function perluDataPajak(jenis: SubjekPajak["jenis"], dataPajakLengkap: boolean): boolean {
  return jenis !== "TIDAK_DIPOTONG" && !dataPajakLengkap;
}
