import { bacaKunciBulan, type TahunBulan } from "@/lib/finance/periode/periode";
import { bacaKanalJurnal, type KanalJurnal } from "@/lib/finance/journals/kanal";
import { bacaTanggal } from "@/lib/tanggal-isian";

/*
 * Jurnal berulang & akrual (rancangan akuntansi & pajak lengkap, bagian D4) —
 * bagian MURNI: jadwal bulanan, isian templat, dan sumber jurnalnya. Aman untuk
 * komponen klien.
 *
 * Satu templat = satu jurnal per bulan pada hari `dayOfMonth` (bulan yang lebih
 * pendek memakai hari terakhirnya), sejak `startDate` sampai `endDate` (bila
 * ada). Idempoten per bulan: sourceType `RECURRING`, sourceId
 * `<templat>/<YYYY-MM>`. Templat ber-`autoReverse` (akrual) juga memposting
 * pembaliknya bertanggal 1 bulan berikutnya: `RECURRING_REVERSAL`, sourceId
 * yang sama, `reversalOfId` = jurnal bulannya.
 */

export const SUMBER_BERULANG = { POSTING: "RECURRING", BALIK: "RECURRING_REVERSAL" } as const;

export function idSumberBerulang(templatId: string, periode: string): string {
  return `${templatId}/${periode}`;
}

/** `<templat>/<YYYY-MM>` → bagiannya; null bila bentuknya lain. */
export function bacaIdSumberBerulang(sourceId: string | null | undefined): { templatId: string; periode: string; tb: TahunBulan } | null {
  const m = /^(.+)\/(\d{4}-\d{2})$/.exec(sourceId ?? "");
  if (!m) return null;
  const tb = bacaKunciBulan(m[2]);
  return tb ? { templatId: m[1], periode: m[2], tb } : null;
}

const dua = (n: number) => String(n).padStart(2, "0");

export function kunciTb(tb: TahunBulan): string {
  return `${tb.tahun}-${dua(tb.bulan)}`;
}

function hariTerakhir(tb: TahunBulan): number {
  return new Date(Date.UTC(tb.tahun, tb.bulan, 0)).getUTCDate();
}

/** Tanggal posting bulan `tb` ("YYYY-MM-DD"): hari `hari`, atau hari terakhir bila bulannya lebih pendek. */
export function tanggalPostingBulan(tb: TahunBulan, hari: number): string {
  const h = Math.min(Math.max(1, Math.trunc(hari)), hariTerakhir(tb));
  return `${kunciTb(tb)}-${dua(h)}`;
}

/** Tanggal pembalik akrual: tanggal 1 bulan sesudah `tb`. */
export function tanggalBalikBulan(tb: TahunBulan): string {
  const b = tb.bulan === 12 ? { tahun: tb.tahun + 1, bulan: 1 } : { tahun: tb.tahun, bulan: tb.bulan + 1 };
  return `${kunciTb(b)}-01`;
}

export type JadwalTemplat = {
  hari: number;
  /** "YYYY-MM-DD". */
  mulai: string;
  /** "YYYY-MM-DD" atau null. */
  selesai: string | null;
};

/** Batas bulan yang disusulkan sekali jalan: sepuluh tahun. */
const MAKS_BULAN = 120;

/**
 * Bulan-bulan yang jurnalnya SUDAH jatuh tempo pada `hariIni` (WIB): tanggal
 * postingnya tidak sebelum `mulai`, tidak sesudah `selesai`, dan tidak sesudah
 * hari ini. `lantai` (bulan tanggal mulai buku besar) memotong bulan sebelumnya.
 */
export function periodeJatuhTempo(jadwal: JadwalTemplat, hariIni: string, lantai: TahunBulan | null = null): TahunBulan[] {
  const awal = bacaTanggal(jadwal.mulai);
  const kini = bacaTanggal(hariIni);
  if (!awal || !kini) return [];
  const akhir = jadwal.selesai ? bacaTanggal(jadwal.selesai) : null;
  const hasil: TahunBulan[] = [];
  let tb: TahunBulan = { tahun: awal.tahun, bulan: awal.bulan };
  for (let i = 0; i < 1200 && hasil.length < MAKS_BULAN; i++) {
    const tgl = tanggalPostingBulan(tb, jadwal.hari);
    if (tgl > hariIni) break;
    if (jadwal.selesai && tgl > jadwal.selesai) break;
    if (tgl >= jadwal.mulai && (!lantai || tb.tahun * 12 + tb.bulan >= lantai.tahun * 12 + lantai.bulan)) hasil.push(tb);
    if (akhir && tb.tahun * 12 + tb.bulan >= akhir.tahun * 12 + akhir.bulan) break;
    tb = tb.bulan === 12 ? { tahun: tb.tahun + 1, bulan: 1 } : { tahun: tb.tahun, bulan: tb.bulan + 1 };
  }
  return hasil;
}

/** Tanggal posting berikutnya sesudah hari ini (untuk layar), null bila sudah berakhir. */
export function postingBerikutnya(jadwal: JadwalTemplat, hariIni: string): string | null {
  const awal = bacaTanggal(jadwal.mulai);
  const kini = bacaTanggal(hariIni);
  if (!awal || !kini) return null;
  let tb: TahunBulan = awal.tahun * 12 + awal.bulan > kini.tahun * 12 + kini.bulan ? { tahun: awal.tahun, bulan: awal.bulan } : { tahun: kini.tahun, bulan: kini.bulan };
  for (let i = 0; i < 24; i++) {
    const tgl = tanggalPostingBulan(tb, jadwal.hari);
    if (jadwal.selesai && tgl > jadwal.selesai) return null;
    if (tgl > hariIni && tgl >= jadwal.mulai) return tgl;
    tb = tb.bulan === 12 ? { tahun: tb.tahun + 1, bulan: 1 } : { tahun: tb.tahun, bulan: tb.bulan + 1 };
  }
  return null;
}

// ─── Isian templat ───────────────────────────────────────────────────────────

export const KODE_GALAT_TEMPLAT = [
  "NAMA_WAJIB",
  "TEKS_TERLALU_PANJANG",
  "HARI_TIDAK_SAH",
  "TANGGAL_TIDAK_SAH",
  "SELESAI_SEBELUM_MULAI",
  "BARIS_KURANG",
  "TERLALU_BANYAK_BARIS",
  "AKUN_BARIS_WAJIB",
  "BARIS_TIDAK_SAH",
  "JUMLAH_TIDAK_SAH",
  "TIDAK_SEIMBANG",
  "KANAL_TIDAK_SAH",
] as const;
export type KodeGalatTemplat = (typeof KODE_GALAT_TEMPLAT)[number];

export type IsianBarisJurnal = {
  akunId: string | null | undefined;
  debit: unknown;
  kredit: unknown;
  memo?: string | null;
  kanal?: string | null;
};

export type BarisJurnalBersih = {
  akunId: string;
  debit: number;
  kredit: number;
  memo: string | null;
  kanal: KanalJurnal | null;
};

export const MAKS_BARIS_JURNAL = 50;

/** Nominal baris (rupiah, dua desimal) → sen; kosong = 0; null bila tidak sah. */
export function senBaris(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  const s = Math.round(n * 100);
  // Lebih dari dua desimal (mis. 1,005) tidak sah — sen adalah satuan terkecil buku besar.
  if (Math.abs(s - n * 100) > 1e-6) return null;
  return s;
}

/**
 * Baris jurnal manual / templat: buang baris yang kosong sama sekali, lalu
 * setiap baris harus berakun dan diisi TEPAT satu sisi; minimal dua baris;
 * total debit = total kredit (sen). Sama dengan pemeriksaan `postJournal`.
 */
export function periksaBarisJurnal(
  baris: IsianBarisJurnal[],
): { ok: true; baris: BarisJurnalBersih[]; total: number } | { ok: false; kode: KodeGalatTemplat; baris?: number } {
  if (baris.length > MAKS_BARIS_JURNAL) return { ok: false, kode: "TERLALU_BANYAK_BARIS" };
  const bersih: BarisJurnalBersih[] = [];
  let dr = 0;
  let cr = 0;
  for (let i = 0; i < baris.length; i++) {
    const b = baris[i];
    const d = senBaris(b.debit);
    const k = senBaris(b.kredit);
    if (d == null || k == null) return { ok: false, kode: "JUMLAH_TIDAK_SAH", baris: i + 1 };
    const akun = typeof b.akunId === "string" && b.akunId.trim() ? b.akunId.trim() : null;
    if (!akun && d === 0 && k === 0) continue;
    if (!akun) return { ok: false, kode: "AKUN_BARIS_WAJIB", baris: i + 1 };
    if ((d > 0) === (k > 0)) return { ok: false, kode: "BARIS_TIDAK_SAH", baris: i + 1 };
    let kanal: KanalJurnal | null = null;
    if (b.kanal) {
      kanal = bacaKanalJurnal(b.kanal);
      if (!kanal) return { ok: false, kode: "KANAL_TIDAK_SAH", baris: i + 1 };
    }
    const memo = typeof b.memo === "string" && b.memo.trim() ? b.memo.trim() : null;
    if (memo && memo.length > 191) return { ok: false, kode: "TEKS_TERLALU_PANJANG", baris: i + 1 };
    bersih.push({ akunId: akun, debit: d / 100, kredit: k / 100, memo, kanal });
    dr += d;
    cr += k;
  }
  if (bersih.length < 2) return { ok: false, kode: "BARIS_KURANG" };
  if (dr !== cr) return { ok: false, kode: "TIDAK_SEIMBANG" };
  return { ok: true, baris: bersih, total: dr / 100 };
}

export type IsianTemplat = {
  nama: string;
  keterangan?: string | null;
  hari: unknown;
  /** "YYYY-MM-DD". */
  mulai: string;
  selesai?: string | null;
  balikOtomatis: boolean;
  baris: IsianBarisJurnal[];
};

export type TemplatBersih = {
  nama: string;
  keterangan: string | null;
  hari: number;
  mulai: string;
  selesai: string | null;
  balikOtomatis: boolean;
  baris: BarisJurnalBersih[];
  total: number;
};

export function periksaTemplat(isian: IsianTemplat): { ok: true; templat: TemplatBersih } | { ok: false; kode: KodeGalatTemplat; baris?: number } {
  const nama = typeof isian.nama === "string" ? isian.nama.trim() : "";
  if (!nama) return { ok: false, kode: "NAMA_WAJIB" };
  if (nama.length > 191) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  const keterangan = typeof isian.keterangan === "string" && isian.keterangan.trim() ? isian.keterangan.trim() : null;
  if ((keterangan?.length ?? 0) > 2000) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  const hari = Number(isian.hari);
  if (!Number.isInteger(hari) || hari < 1 || hari > 31) return { ok: false, kode: "HARI_TIDAK_SAH" };
  if (!bacaTanggal(isian.mulai)) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  const selesai = typeof isian.selesai === "string" && isian.selesai.trim() ? isian.selesai.trim() : null;
  if (selesai && !bacaTanggal(selesai)) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  if (selesai && selesai < isian.mulai) return { ok: false, kode: "SELESAI_SEBELUM_MULAI" };
  const b = periksaBarisJurnal(isian.baris ?? []);
  if (!b.ok) return b;
  return {
    ok: true,
    templat: { nama, keterangan, hari, mulai: isian.mulai, selesai, balikOtomatis: isian.balikOtomatis === true, baris: b.baris, total: b.total },
  };
}

/**
 * Keadaan templat untuk layar, diturunkan dari `active` dan riwayat jejaknya
 * (tidak ada kolom status): isi templat yang baru dibuat/diubah MENUNGGU
 * persetujuan orang lain; yang sudah disetujui lalu dihentikan = DIHENTIKAN;
 * yang tanggal selesainya lewat = SELESAI.
 */
export type KeadaanTemplat = "MENUNGGU_PERSETUJUAN" | "AKTIF" | "DIHENTIKAN" | "SELESAI";

export function keadaanTemplat(isi: {
  aktif: boolean;
  /** Ada persetujuan SESUDAH perubahan isi terakhir. */
  sudahDisetujui: boolean;
  selesai: string | null;
  hariIni: string;
}): KeadaanTemplat {
  if (isi.selesai && isi.selesai < isi.hariIni) return "SELESAI";
  if (isi.aktif) return "AKTIF";
  return isi.sudahDisetujui ? "DIHENTIKAN" : "MENUNGGU_PERSETUJUAN";
}
