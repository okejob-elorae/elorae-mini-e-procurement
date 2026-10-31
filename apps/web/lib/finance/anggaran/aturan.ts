import type { AccountType } from "@/lib/constants/enums";

/*
 * Anggaran per akun per bulan — aturan murni (aman untuk komponen klien).
 *
 * Anggaran disimpan di `Budget` (akun × tahun × bulan) untuk akun LABA RUGI
 * (pendapatan, HPP, beban) yang bisa diposting. Nilainya ditulis per sisi
 * normal akun, sama dengan saldo yang dibaca laporan: pendapatan dan beban
 * positif; akun kontra (retur, potongan penjualan) bersaldo negatif bila
 * dianggarkan. Sel kosong = belum dianggarkan (tidak sama dengan nol).
 */

export const BULAN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const JENIS_AKUN_ANGGARAN: readonly AccountType[] = ["PENDAPATAN", "HPP", "BEBAN"];
export const TAHUN_MIN = 2000;
export const TAHUN_MAKS = 2100;
/** Batas wajar satu sel (Rp 1 kuadriliun) — `Decimal(18,2)` muat jauh lebih, ini penangkal salah ketik. */
const NILAI_MAKS = 1e15;

export type IsianAnggaran = {
  tahun: number;
  baris: { chartAccountId: string; bulan: (number | null)[] }[];
};

export type KodeTolakAnggaran = "TAHUN_TIDAK_SAH" | "ISIAN_RUSAK" | "NILAI_TIDAK_SAH" | "AKUN_TIDAK_SAH";

const keSen = (v: number): number => Math.round(Number((v * 100).toFixed(4)));

export function tahunSah(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= TAHUN_MIN && v <= TAHUN_MAKS;
}

/** Validasi isian dari klien. Nilai dibulatkan ke sen. */
export function bacaIsianAnggaran(input: unknown): { ok: true; isian: IsianAnggaran } | { ok: false; kode: KodeTolakAnggaran } {
  if (!input || typeof input !== "object") return { ok: false, kode: "ISIAN_RUSAK" };
  const { tahun, baris } = input as { tahun?: unknown; baris?: unknown };
  if (!tahunSah(tahun)) return { ok: false, kode: "TAHUN_TIDAK_SAH" };
  if (!Array.isArray(baris)) return { ok: false, kode: "ISIAN_RUSAK" };
  const dilihat = new Set<string>();
  const hasil: IsianAnggaran["baris"] = [];
  for (const b of baris) {
    if (!b || typeof b !== "object") return { ok: false, kode: "ISIAN_RUSAK" };
    const { chartAccountId, bulan } = b as { chartAccountId?: unknown; bulan?: unknown };
    if (typeof chartAccountId !== "string" || !chartAccountId || dilihat.has(chartAccountId)) return { ok: false, kode: "ISIAN_RUSAK" };
    if (!Array.isArray(bulan) || bulan.length !== BULAN.length) return { ok: false, kode: "ISIAN_RUSAK" };
    const sel: (number | null)[] = [];
    for (const v of bulan) {
      if (v === null) {
        sel.push(null);
        continue;
      }
      if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > NILAI_MAKS) return { ok: false, kode: "NILAI_TIDAK_SAH" };
      sel.push(keSen(v) / 100 + 0);
    }
    dilihat.add(chartAccountId);
    hasil.push({ chartAccountId, bulan: sel });
  }
  return { ok: true, isian: { tahun, baris: hasil } };
}

/** Anggaran setahun dibagi rata ke 12 bulan dalam rupiah utuh; sisa pembulatan masuk Desember. */
export function ratakanTahunan(total: number): number[] {
  const t = Math.round(total);
  const per = Math.trunc(t / 12);
  return BULAN.map((_, i) => (i < 11 ? per : t - per * 11));
}

/** Salin nilai dengan kenaikan/penurunan `persen`, dibulatkan ke rupiah. Sel kosong tetap kosong. */
export function salinDenganPersen(nilai: (number | null)[], persen: number): (number | null)[] {
  const faktor = 1 + (Number.isFinite(persen) ? persen : 0) / 100;
  return nilai.map((v) => (v === null ? null : Math.round(v * faktor) + 0));
}

/** Jumlah sel terisi; null bila tidak ada yang terisi. */
export function totalBaris(nilai: (number | null)[]): number | null {
  const isi = nilai.filter((v): v is number => v !== null);
  if (isi.length === 0) return null;
  return isi.reduce((s, v) => s + keSen(v), 0) / 100 + 0;
}

/**
 * Realisasi dibanding anggaran. `selisih` = realisasi − anggaran.
 * Pendapatan BAIK bila realisasi ≥ anggaran; HPP dan beban BAIK bila ≤.
 * Tanpa anggaran (null) tidak dinilai; anggaran nol tidak punya persen.
 */
export function capaianAnggaran(
  type: AccountType,
  anggaran: number | null,
  realisasi: number,
): { selisih: number; persenCapaian: number | null; baik: boolean | null } {
  const selisih = (keSen(realisasi) - keSen(anggaran ?? 0)) / 100 + 0;
  if (anggaran === null) return { selisih, persenCapaian: null, baik: null };
  const persenCapaian = keSen(anggaran) === 0 ? null : (keSen(realisasi) * 100) / keSen(anggaran);
  const baik = type === "PENDAPATAN" ? keSen(realisasi) >= keSen(anggaran) : keSen(realisasi) <= keSen(anggaran);
  return { selisih, persenCapaian, baik };
}

/** Bulan yang dicakup laporan: satu bulan, atau sejak Januari sampai bulan itu. */
export function rentangBulan(bulan: number, cakupan: "bulan" | "ytd"): number[] {
  const b = Math.min(12, Math.max(1, Math.trunc(bulan)));
  return cakupan === "bulan" ? [b] : BULAN.filter((x) => x <= b);
}

/**
 * Isian sel anggaran dari layar → angka. Menerima penulisan Indonesia
 * ("1.250.000", "1.250.000,50", "Rp 1.250.000") dan angka polos ("1250000",
 * "-500"). Kosong → null (belum dianggarkan). Tidak terbaca → "rusak".
 */
export function bacaAngkaIsian(teks: string): number | null | "rusak" {
  const t = teks.replace(/rp/gi, "").replace(/\s/g, "");
  if (!t) return null;
  const negatif = /^-/.test(t) || /^\(.*\)$/.test(t);
  const inti = t.replace(/^[-(]+|\)+$/g, "");
  if (!/^[\d.,]+$/.test(inti)) return "rusak";
  let angka: string;
  if (inti.includes(",")) {
    // Koma = pemisah desimal; titik = ribuan.
    if ((inti.match(/,/g) ?? []).length > 1) return "rusak";
    angka = inti.replace(/\./g, "").replace(",", ".");
  } else if ((inti.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(inti)) {
    // "1.250.000" atau "250.000": titik = ribuan.
    angka = inti.replace(/\./g, "");
  } else {
    angka = inti;
  }
  const n = Number(angka);
  if (!Number.isFinite(n)) return "rusak";
  return (negatif ? -n : n) + 0;
}

/** Angka sel untuk ditampilkan di isian: rupiah tanpa "Rp", pemisah titik; kosong untuk null. */
export function tulisAngkaIsian(nilai: number | null): string {
  if (nilai === null) return "";
  const bulat = Math.round(nilai * 100) / 100;
  const [utuh, pecahan] = Math.abs(bulat).toFixed(2).split(".");
  const kelompok = utuh.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${bulat < 0 ? "-" : ""}${kelompok}${pecahan !== "00" ? `,${pecahan}` : ""}`;
}
