/*
 * Rincian per warna di formulir PO bahan (2026-10-07, meniru "Rincian per
 * warna" PLAN PRODUKSI SSG): hitung warna, bagi rata, isi massal, dan roll.
 * Murni, aman di klien.
 *
 * Semua hitungan qty memakai SEN (bilangan bulat × 100), jadi jumlah baris
 * hasil pembagian selalu persis sama dengan totalnya — baris terakhir yang
 * menyerap sisa pembulatan, bukan galat titik mengambang.
 */

/** Paling banyak baris yang boleh dibuat "Hitung warna" sekali jalan. */
export const MAKS_BARIS_WARNA = 50;

/** Nilai → sen (bilangan bulat). Geseran kecil menahan 28,349999… menjadi 28,35. */
export function keSen(n: number): number {
  return Math.round(n * 100 + (n >= 0 ? 1e-6 : -1e-6));
}

/** Dua desimal, dibulatkan setengah ke atas. */
export function bulat2(n: number): number {
  return keSen(n) / 100;
}

/** Satuan kilogram — kode satuan "KG" dalam huruf apa pun. */
export function satuanKg(kode: string | null | undefined): boolean {
  return (kode ?? "").trim().toLowerCase() === "kg";
}

/**
 * Isian angka yang toleran koma: "0,27", "0.27", "1.250,5", "1250". Kosong,
 * negatif, atau bukan angka → null.
 */
export function bacaAngkaIsian(teks: string | null | undefined): number | null {
  let t = (teks ?? "").trim().replace(/\s+/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) t = t.replace(",", ".");
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Bagi `total` menjadi `n` bagian dua desimal yang sama besar. Bagian TERAKHIR
 * menyerap sisa pembulatan, jadi jumlah semua bagian = `total` persis.
 */
export function bagiRata(total: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1 || !Number.isFinite(total) || total < 0) return [];
  const t = keSen(total);
  let per = Math.round(t / n);
  if (per * (n - 1) > t) per = Math.floor(t / n);
  const hasil = Array.from({ length: n }, () => per / 100);
  hasil[n - 1] = (t - per * (n - 1)) / 100;
  return hasil;
}

export type HasilHitungWarna =
  | { ok: true; jumlah: number; per: number; baris: number[] }
  | { ok: false; sebab: "ISIAN_TIDAK_SAH" | "TERLALU_BANYAK" };

/**
 * "Hitung warna": total ÷ minimum per warna → jumlah warna
 * `max(1, round(total ÷ min))`, masing-masing `round(total ÷ jumlah, 2)`, baris
 * terakhir menyerap sisa sehingga jumlahnya = total.
 */
export function hitungWarna(total: number, minPerWarna: number): HasilHitungWarna {
  if (!(total > 0) || !(minPerWarna > 0) || !Number.isFinite(total) || !Number.isFinite(minPerWarna)) {
    return { ok: false, sebab: "ISIAN_TIDAK_SAH" };
  }
  const jumlah = Math.max(1, Math.round(total / minPerWarna));
  if (jumlah > MAKS_BARIS_WARNA) return { ok: false, sebab: "TERLALU_BANYAK" };
  const baris = bagiRata(total, jumlah);
  return { ok: true, jumlah, per: baris[0], baris };
}

/**
 * Jumlah roll = ceil(qty ÷ kg per roll) — hanya untuk satuan kg dengan kg per
 * roll yang diisi. Selain itu null (kolom roll menampilkan "—").
 */
export function jumlahRoll(
  qty: number,
  kgPerRoll: number | null | undefined,
  kodeSatuan: string | null | undefined,
): number | null {
  if (!satuanKg(kodeSatuan) || kgPerRoll == null || !(kgPerRoll > 0)) return null;
  if (!(qty > 0)) return 0;
  return Math.ceil(keSen(qty) / keSen(kgPerRoll));
}
