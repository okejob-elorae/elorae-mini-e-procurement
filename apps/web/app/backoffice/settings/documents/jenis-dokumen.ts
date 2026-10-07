import type { DocType } from "@elorae/db";

/**
 * Jenis dokumen di Pengaturan → Nomor dokumen: SEMUA anggota `DocType` Prisma
 * yang dinomori `generateDocNumber`, dikelompokkan menurut bidang kerja.
 *
 * Sengaja `Partial` (pola `KOLOM_NOMOR_DOKUMEN`): DocType baru tanpa kelompok
 * tetap tampil di kelompok Lainnya dan TIDAK mematahkan build — CLAUDE.md
 * mencatat build Docker yang patah sesudah migrasi berjalan sebagai bentuk
 * berbahaya. Kelengkapannya dijaga `jenis-dokumen.spec.ts`. Peta ini BUKAN
 * `DocType` lokal 8 anggota di `@/lib/constants/enums`.
 */
export type KelompokDokumen = "pembelianGudang" | "produksi" | "penjualanLapangan" | "kanvas" | "lainnya";

const KELOMPOK: Partial<Record<DocType, Exclude<KelompokDokumen, "lainnya">>> = {
  PO: "pembelianGudang",
  GRN: "pembelianGudang",
  ADJ: "pembelianGudang",
  RET: "pembelianGudang",
  OPN: "pembelianGudang",
  WO: "produksi",
  ISSUE: "produksi",
  RECEIPT: "produksi",
  PUTUS: "penjualanLapangan",
  KONSI: "penjualanLapangan",
  DELIVERY: "penjualanLapangan",
  SPGSALE: "penjualanLapangan",
  VANLOAD: "kanvas",
  VANSALE: "kanvas",
  VANRECON: "kanvas",
};

export const URUTAN_KELOMPOK: readonly KelompokDokumen[] = ["pembelianGudang", "produksi", "penjualanLapangan", "kanvas", "lainnya"];

const URUTAN_JENIS = Object.keys(KELOMPOK) as DocType[];

/** Jenis yang sudah dikelompokkan, urut tampil (per kelompok, lalu urutan kunci di peta). */
export const SEMUA_JENIS_DOKUMEN: readonly DocType[] = URUTAN_KELOMPOK.flatMap((k) =>
  URUTAN_JENIS.filter((d) => KELOMPOK[d] === k),
);

export function kelompokDokumen(d: DocType): KelompokDokumen {
  return KELOMPOK[d] ?? "lainnya";
}

/** Urutkan jenis dari server menurut kelompok; jenis tanpa kelompok di akhir (Lainnya). */
export function urutkanJenisDokumen(daftar: readonly DocType[]): DocType[] {
  const posisi = (d: DocType) => {
    const i = SEMUA_JENIS_DOKUMEN.indexOf(d);
    return i === -1 ? SEMUA_JENIS_DOKUMEN.length : i;
  };
  return [...daftar].sort((a, b) => posisi(a) - posisi(b) || a.localeCompare(b));
}

export type PeriodeReset = "YEARLY" | "MONTHLY" | "NEVER";

export type KonfigNomor = {
  prefix: string;
  resetPeriod: PeriodeReset | string;
  padding: number;
  lastNumber: number;
  year: number;
  month: number;
};

/**
 * Nomor yang akan dibagikan berikutnya bila konfigurasi ini disimpan —
 * cerminan `naikkanPenghitung` + `susunNomor` di `lib/docNumber.ts`.
 * Pratinjau saja: nomor yang sudah dipakai di luar penghitung masih dilompati
 * oleh generatornya.
 */
export function contohNomorBerikutnya(k: KonfigNomor, kini: Date): string {
  const tahun = kini.getFullYear();
  const bulan = kini.getMonth() + 1;
  let angka: number;
  if (k.resetPeriod === "NEVER") angka = k.lastNumber + 1;
  else if (k.resetPeriod === "YEARLY") angka = k.year === tahun ? k.lastNumber + 1 : 1;
  else angka = k.year === tahun && k.month === bulan ? k.lastNumber + 1 : 1;
  const awalan = k.prefix.endsWith("/") ? k.prefix : `${k.prefix}/`;
  const periode = k.resetPeriod === "MONTHLY" ? `${tahun}/${String(bulan).padStart(2, "0")}/` : `${tahun}/`;
  return `${awalan}${periode}${String(angka).padStart(k.padding || 4, "0")}`;
}

export const PANJANG_AWALAN_MAKS = 20;
export type GalatIsianNomor = "AWALAN_KOSONG" | "AWALAN_PANJANG" | "DIGIT_TIDAK_SAH";

/** Isian satu baris; dipakai layar (alasan tombol mati) dan server (penolakan). */
export function periksaIsianNomor(isian: { prefix: string; padding: string | number }): GalatIsianNomor | null {
  const prefix = isian.prefix.trim();
  if (!prefix) return "AWALAN_KOSONG";
  if (prefix.length > PANJANG_AWALAN_MAKS) return "AWALAN_PANJANG";
  const teks = String(isian.padding).trim();
  if (!/^\d+$/.test(teks)) return "DIGIT_TIDAK_SAH";
  const digit = Number(teks);
  if (digit < 1 || digit > 8) return "DIGIT_TIDAK_SAH";
  return null;
}
