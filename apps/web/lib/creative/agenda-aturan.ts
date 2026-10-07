/**
 * Agenda Ruang KOL — aturan murni, aman untuk klien.
 *
 * Agenda adalah catatan PRIBADI (`KolAgenda.ownerId`): pertemuan, tenggat,
 * rencana kirim, dengan daftar persiapan yang dicentang. Daftar persiapan
 * diketik satu baris satu butir; awalan `[x]` (atau `[v]`, `- [x]`) berarti
 * sudah selesai. Disimpan sebagai JSON `[{teks, selesai}]`.
 *
 * Bedanya dengan KOL Manager: jam yang salah format dan "ingatkan H-n" di luar
 * 0–30 DITOLAK dengan pesan, tidak dikosongkan atau dijepit diam-diam — orang
 * yang mengetik harus tahu isiannya tidak tersimpan seperti yang ia kira.
 */

import { bacaTanggal } from "@/lib/tanggal-isian";
import { SEMUA_JENIS_AGENDA, type JenisAgenda } from "./tahap";

export type ButirChecklist = { teks: string; selesai: boolean };

/** `title` VARCHAR(191) di MariaDB; batas lain menjaga baris tetap wajar. */
export const BATAS_AGENDA = { judul: 191, catatan: 2000, butir: 50, teksButir: 200, ingatMaks: 30 } as const;

const POLA_AWALAN = /^(?:[-*•]\s*)?\[\s*([xXvV✓ ]?)\s*\]\s*/;
const POLA_STRIP = /^[-*•]\s+/;

/** Satu baris → butir; `null` untuk baris kosong. */
function bacaBaris(baris: string): ButirChecklist | null {
  const mentah = baris.trim();
  if (!mentah) return null;
  const m = POLA_AWALAN.exec(mentah);
  if (m) {
    const teks = mentah.slice(m[0].length).trim();
    return teks ? { teks, selesai: m[1].trim() !== "" } : null;
  }
  const teks = mentah.replace(POLA_STRIP, "").trim();
  return teks ? { teks, selesai: false } : null;
}

/** Teks isian (satu baris satu butir) → butir. Tidak memotong; batasnya diperiksa `validasiAgenda`. */
export function teksKeChecklist(teks: string | null | undefined): ButirChecklist[] {
  return (teks ?? "")
    .split(/\r?\n/)
    .map(bacaBaris)
    .filter((b): b is ButirChecklist => b !== null);
}

/** Butir → teks isian, untuk membuka ulang agenda di formulir. */
export function checklistKeTeks(butir: readonly ButirChecklist[]): string {
  return butir.map((b) => (b.selesai ? `[x] ${b.teks}` : b.teks)).join("\n");
}

/** Pembaca kolom `checklist` yang pemaaf: rusak atau kosong = tanpa butir. */
export function bacaChecklist(nilai: string | null | undefined): ButirChecklist[] {
  if (!nilai || !nilai.trim()) return [];
  let x: unknown;
  try {
    x = JSON.parse(nilai);
  } catch {
    return [];
  }
  if (!Array.isArray(x)) return [];
  return x
    .map((b): ButirChecklist | null => {
      if (!b || typeof b !== "object") return null;
      const o = b as Record<string, unknown>;
      const teks = typeof o.teks === "string" ? o.teks.trim() : "";
      return teks ? { teks, selesai: o.selesai === true } : null;
    })
    .filter((b): b is ButirChecklist => b !== null);
}

/** Butir → nilai kolom; `null` bila tidak ada butir. */
export function tulisChecklist(butir: readonly ButirChecklist[]): string | null {
  return butir.length ? JSON.stringify(butir.map((b) => ({ teks: b.teks, selesai: b.selesai }))) : null;
}

/** Tetapkan satu butir selesai/belum. `null` bila indeksnya tidak ada. */
export function centangButir(butir: readonly ButirChecklist[], indeks: number, selesai: boolean): ButirChecklist[] | null {
  if (!Number.isInteger(indeks) || indeks < 0 || indeks >= butir.length) return null;
  return butir.map((b, i) => (i === indeks ? { ...b, selesai } : b));
}

export function jumlahBelum(butir: readonly ButirChecklist[]): number {
  return butir.filter((b) => !b.selesai).length;
}

/** "9:30", "09.30", "0930" → "09:30"; `null` bila bukan jam yang sah. */
export function rapikanJam(teks: string | null | undefined): string | null {
  const t = (teks ?? "").trim();
  const m = /^([01]?\d|2[0-3])[:.]?([0-5]\d)$/.exec(t);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

export type KolomAgenda = "judul" | "tanggal" | "jam" | "jenis" | "checklist" | "catatan" | "ingatHari";

export type KodeGalatAgenda =
  | "JUDUL_WAJIB"
  | "JUDUL_TERLALU_PANJANG"
  | "TANGGAL_TIDAK_VALID"
  | "JAM_TIDAK_VALID"
  | "JENIS_TIDAK_VALID"
  | "INGAT_TIDAK_VALID"
  | "CATATAN_TERLALU_PANJANG"
  | "BUTIR_TERLALU_BANYAK"
  | "BUTIR_TERLALU_PANJANG";

export type GalatAgenda = { kolom: KolomAgenda; kode: KodeGalatAgenda };

export type AgendaBersih = {
  judul: string;
  /** Hari WIB "YYYY-MM-DD". */
  tanggal: string;
  /** "HH:mm" atau null. */
  jam: string | null;
  jenis: JenisAgenda;
  checklist: ButirChecklist[];
  catatan: string | null;
  campaignId: string | null;
  kolId: string | null;
  kolaborasiId: string | null;
  ingatHari: number;
};

export type HasilValidasiAgenda = { ok: true; agenda: AgendaBersih } | { ok: false; galat: GalatAgenda[] };

const teksAtauKosong = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const idAtauNull = (v: unknown): string | null => {
  const t = teksAtauKosong(v).trim();
  return t && t.length <= 64 ? t : null;
};

/**
 * Periksa isian formulir agenda. `checklist` boleh teks (satu baris satu
 * butir) atau larik butir; `ingatHari` boleh angka atau teks angka. Semua
 * galat dikembalikan sekaligus supaya formulir bisa menandai setiap isian.
 */
export function validasiAgenda(input: unknown): HasilValidasiAgenda {
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const galat: GalatAgenda[] = [];

  const judul = teksAtauKosong(o.judul).trim();
  if (!judul) galat.push({ kolom: "judul", kode: "JUDUL_WAJIB" });
  else if (judul.length > BATAS_AGENDA.judul) galat.push({ kolom: "judul", kode: "JUDUL_TERLALU_PANJANG" });

  const tanggal = teksAtauKosong(o.tanggal).trim();
  if (!bacaTanggal(tanggal)) galat.push({ kolom: "tanggal", kode: "TANGGAL_TIDAK_VALID" });

  const jamMentah = teksAtauKosong(o.jam).trim();
  const jam = jamMentah ? rapikanJam(jamMentah) : null;
  if (jamMentah && !jam) galat.push({ kolom: "jam", kode: "JAM_TIDAK_VALID" });

  const jenisMentah = teksAtauKosong(o.jenis).trim() || "TUGAS";
  const jenis = (SEMUA_JENIS_AGENDA as readonly string[]).includes(jenisMentah) ? (jenisMentah as JenisAgenda) : null;
  if (!jenis) galat.push({ kolom: "jenis", kode: "JENIS_TIDAK_VALID" });

  const ingatMentah = o.ingatHari === undefined || o.ingatHari === null || o.ingatHari === "" ? 0 : Number(teksAtauKosong(o.ingatHari).trim());
  const ingatHari = Number.isInteger(ingatMentah) && ingatMentah >= 0 && ingatMentah <= BATAS_AGENDA.ingatMaks ? ingatMentah : null;
  if (ingatHari === null) galat.push({ kolom: "ingatHari", kode: "INGAT_TIDAK_VALID" });

  const catatanMentah = teksAtauKosong(o.catatan).trim();
  if (catatanMentah.length > BATAS_AGENDA.catatan) galat.push({ kolom: "catatan", kode: "CATATAN_TERLALU_PANJANG" });

  const checklist = Array.isArray(o.checklist)
    ? bacaChecklist(JSON.stringify(o.checklist))
    : teksKeChecklist(teksAtauKosong(o.checklist));
  if (checklist.length > BATAS_AGENDA.butir) galat.push({ kolom: "checklist", kode: "BUTIR_TERLALU_BANYAK" });
  else if (checklist.some((b) => b.teks.length > BATAS_AGENDA.teksButir)) galat.push({ kolom: "checklist", kode: "BUTIR_TERLALU_PANJANG" });

  if (galat.length || !jenis || ingatHari === null) return { ok: false, galat };
  return {
    ok: true,
    agenda: {
      judul,
      tanggal,
      jam,
      jenis,
      checklist,
      catatan: catatanMentah || null,
      campaignId: idAtauNull(o.campaignId),
      kolId: idAtauNull(o.kolId),
      kolaborasiId: idAtauNull(o.kolaborasiId),
      ingatHari,
    },
  };
}
