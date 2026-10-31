import { KANAL_JURNAL, type KanalJurnal } from "@/lib/finance/journals/kanal";
import {
  bacaJenisPotongPemasok,
  hitungPotongPemasok,
  INFO_POTONG_PEMASOK,
  type JenisPotongPemasok,
} from "@/lib/finance/pajak/pemotongan";
import type { TarifPajakKreatif } from "@/lib/creative/pph";

/**
 * Voucher kas & bank (rancangan akuntansi & pajak lengkap, bagian D1) — MURNI,
 * aman untuk komponen klien.
 *
 * Tiga jenis dokumen dalam satu tabel `CashVoucher`:
 * - `OUT` — bukti kas/bank KELUAR (BKK): baris akun beban/aset yang dibayar,
 *   dengan potongan PPh 23 / 21 / 4(2) opsional (yang ditahan menjadi hutang
 *   PPh, yang keluar dari rekening = bruto − potongan).
 * - `IN` — bukti kas/bank MASUK dari kantor (BKMK — "K" supaya tidak tertukar
 *   dengan BKM pelunasan toko): baris akun pendapatan/lainnya.
 * - `TRANSFER` — pindah dana antar rekening kas/bank (termasuk isi ulang kas kecil).
 *
 * Jurnalnya (`SUMBER_VOUCHER_KAS`, sourceId = id voucher) ditulis DI TRANSAKSI
 * YANG SAMA dengan voucher: voucher adalah dokumen keuangan, jadi voucher tanpa
 * jurnal tidak pernah ada. Batal = status CANCELLED + jurnal pembalik
 * (`SUMBER_VOUCHER_KAS_BALIK`, id sama).
 *
 * Semua uang dihitung dalam SEN (bilangan bulat) supaya jumlah baris jurnal =
 * total persis.
 */

export const JENIS_VOUCHER = ["OUT", "IN", "TRANSFER"] as const;
export type JenisVoucher = (typeof JENIS_VOUCHER)[number];

export function bacaJenisVoucher(v: unknown): JenisVoucher | null {
  return typeof v === "string" && (JENIS_VOUCHER as readonly string[]).includes(v) ? (v as JenisVoucher) : null;
}

/** DocType penomoran per jenis (`generateDocNumber`). */
export const DOC_TYPE_VOUCHER: Readonly<Record<JenisVoucher, "CASHOUT" | "CASHIN" | "CASHTRF">> = {
  OUT: "CASHOUT",
  IN: "CASHIN",
  TRANSFER: "CASHTRF",
};

export const SUMBER_VOUCHER_KAS = "CASH_VOUCHER";
export const SUMBER_VOUCHER_KAS_BALIK = "CASH_VOUCHER_REVERSAL";

export const STATUS_VOUCHER = { BERLAKU: "POSTED", BATAL: "CANCELLED" } as const;

/** Batas isian. */
export const MAKS_BARIS_VOUCHER = 50;
export const MAKS_PANJANG_MEMO = 191;
export const MAKS_PANJANG_PIHAK = 191;
export const MAKS_PANJANG_KETERANGAN = 1000;
/** Satu voucher tidak lebih dari Rp 100 miliar — penjaga salah ketik nol. */
export const MAKS_NILAI_SEN = 100_000_000_000 * 100;

/** Kode tolak — setiap kode punya kalimat `financeKas.err.<KODE>` di kedua bahasa. */
export const KODE_GALAT_VOUCHER = [
  "JENIS_TIDAK_SAH",
  "TANGGAL_TIDAK_SAH",
  "TANGGAL_MASA_DEPAN",
  "REKENING_WAJIB",
  "REKENING_TUJUAN_WAJIB",
  "REKENING_SAMA",
  "BARIS_KOSONG",
  "TERLALU_BANYAK_BARIS",
  "JUMLAH_TIDAK_SAH",
  "AKUN_BARIS_WAJIB",
  "KANAL_TIDAK_SAH",
  "POTONG_TIDAK_SAH",
  "POTONG_HANYA_KELUAR",
  "POTONG_MELEBIHI",
  "TEKS_TERLALU_PANJANG",
  "NILAI_TERLALU_BESAR",
] as const;
export type KodeGalatVoucher = (typeof KODE_GALAT_VOUCHER)[number];

/** Rupiah dari isian formulir → sen. `"1.500.000"`, `"1500000"`, `"1500000.5"`, `"1.500.000,50"`, angka. Null bila tidak sah atau negatif. */
export function bacaRupiahSen(nilai: unknown): number | null {
  if (typeof nilai === "number") {
    if (!Number.isFinite(nilai) || nilai < 0) return null;
    return Math.round(Number((nilai * 100).toFixed(4)));
  }
  if (typeof nilai !== "string") return null;
  const t = nilai.trim().replace(/\s/g, "").replace(/^rp\.?/i, "");
  if (!t) return null;
  // Format Indonesia: titik ribuan, koma desimal.
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t) || /^\d+,\d{1,2}$/.test(t)) {
    const [bulat, pecahan = ""] = t.split(",");
    return Number(bulat.replace(/\./g, "")) * 100 + Number(pecahan.padEnd(2, "0"));
  }
  if (/^\d+(\.\d{1,2})?$/.test(t)) {
    const [bulat, pecahan = ""] = t.split(".");
    return Number(bulat) * 100 + Number(pecahan.padEnd(2, "0"));
  }
  return null;
}

export const dariSen = (sen: number): number => sen / 100;

export type IsianBarisVoucher = {
  kategoriId?: string | null;
  akunId?: string | null;
  jumlah: unknown;
  memo?: string | null;
  kanal?: string | null;
  tokoId?: string | null;
  /** Baris ini masuk dasar potongan PPh. Bila voucher berpotongan dan tidak ada baris yang ditandai, semua baris dianggap kena. */
  kenaPotong?: boolean | null;
};

export type IsianVoucher = {
  jenis: unknown;
  /** "YYYY-MM-DD" (WIB). */
  tanggal: unknown;
  rekeningId: unknown;
  rekeningTujuanId?: unknown;
  /** Untuk TRANSFER. */
  jumlahTransfer?: unknown;
  pihak?: unknown;
  pemasokId?: unknown;
  keterangan?: unknown;
  baris?: unknown;
  jenisPotong?: unknown;
  adaNpwp?: unknown;
  fotoUrl?: unknown;
};

export type BarisVoucherSah = {
  kategoriId: string | null;
  akunId: string | null;
  sen: number;
  memo: string | null;
  kanal: KanalJurnal | null;
  tokoId: string | null;
  kenaPotong: boolean;
};

export type VoucherSah = {
  jenis: JenisVoucher;
  tanggal: string;
  rekeningId: string;
  rekeningTujuanId: string | null;
  pihak: string | null;
  pemasokId: string | null;
  keterangan: string | null;
  fotoUrl: string | null;
  baris: BarisVoucherSah[];
  /** TRANSFER: jumlah yang dipindah. OUT/IN: Σ baris. */
  totalSen: number;
  jenisPotong: JenisPotongPemasok | null;
  adaNpwp: boolean;
};

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function teksOpsional(v: unknown, maks: number): { ok: true; nilai: string | null } | { ok: false } {
  if (v == null) return { ok: true, nilai: null };
  if (typeof v !== "string") return { ok: false };
  const t = v.trim();
  if (!t) return { ok: true, nilai: null };
  if (t.length > maks) return { ok: false };
  return { ok: true, nilai: t };
}

function idOpsional(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : null;
}

/** Tanggal "YYYY-MM-DD" yang benar-benar ada di kalender. */
export function tanggalKalenderSah(t: string): boolean {
  if (!POLA_TANGGAL.test(t)) return false;
  const [y, m, d] = t.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Periksa dan rapikan isian voucher. `hariIni` = "YYYY-MM-DD" WIB: tanggal
 * sesudahnya ditolak (kas tidak boleh bergerak di hari yang belum terjadi).
 * Pemeriksaan akun (ada, aktif, tanpa turunan, bukan akun kas/hutang usaha)
 * dikerjakan penulis di server.
 */
export function periksaVoucher(
  input: IsianVoucher,
  hariIni: string,
): { ok: true; voucher: VoucherSah } | { ok: false; kode: KodeGalatVoucher; baris?: number } {
  const jenis = bacaJenisVoucher(input.jenis);
  if (!jenis) return { ok: false, kode: "JENIS_TIDAK_SAH" };
  const tanggal = typeof input.tanggal === "string" ? input.tanggal.trim() : "";
  if (!tanggalKalenderSah(tanggal)) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  if (tanggal > hariIni) return { ok: false, kode: "TANGGAL_MASA_DEPAN" };
  const rekeningId = idOpsional(input.rekeningId);
  if (!rekeningId) return { ok: false, kode: "REKENING_WAJIB" };

  const pihak = teksOpsional(input.pihak, MAKS_PANJANG_PIHAK);
  const keterangan = teksOpsional(input.keterangan, MAKS_PANJANG_KETERANGAN);
  const foto = teksOpsional(input.fotoUrl, 500);
  if (!pihak.ok || !keterangan.ok || !foto.ok) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };

  const dasar = {
    jenis,
    tanggal,
    rekeningId,
    pihak: pihak.nilai,
    pemasokId: idOpsional(input.pemasokId),
    keterangan: keterangan.nilai,
    fotoUrl: foto.nilai,
  };

  if (jenis === "TRANSFER") {
    const tujuan = idOpsional(input.rekeningTujuanId);
    if (!tujuan) return { ok: false, kode: "REKENING_TUJUAN_WAJIB" };
    if (tujuan === rekeningId) return { ok: false, kode: "REKENING_SAMA" };
    const sen = bacaRupiahSen(input.jumlahTransfer);
    if (sen == null || sen <= 0) return { ok: false, kode: "JUMLAH_TIDAK_SAH" };
    if (sen > MAKS_NILAI_SEN) return { ok: false, kode: "NILAI_TERLALU_BESAR" };
    if (input.jenisPotong != null && input.jenisPotong !== "") return { ok: false, kode: "POTONG_HANYA_KELUAR" };
    return {
      ok: true,
      voucher: { ...dasar, rekeningTujuanId: tujuan, baris: [], totalSen: sen, jenisPotong: null, adaNpwp: true },
    };
  }

  if (!Array.isArray(input.baris) || input.baris.length === 0) return { ok: false, kode: "BARIS_KOSONG" };
  if (input.baris.length > MAKS_BARIS_VOUCHER) return { ok: false, kode: "TERLALU_BANYAK_BARIS" };
  const baris: BarisVoucherSah[] = [];
  let totalSen = 0;
  for (let i = 0; i < input.baris.length; i++) {
    const b = input.baris[i] as IsianBarisVoucher | null;
    if (!b || typeof b !== "object") return { ok: false, kode: "AKUN_BARIS_WAJIB", baris: i + 1 };
    const kategoriId = idOpsional(b.kategoriId);
    const akunId = idOpsional(b.akunId);
    if (!kategoriId && !akunId) return { ok: false, kode: "AKUN_BARIS_WAJIB", baris: i + 1 };
    const sen = bacaRupiahSen(b.jumlah);
    if (sen == null || sen <= 0) return { ok: false, kode: "JUMLAH_TIDAK_SAH", baris: i + 1 };
    const memo = teksOpsional(b.memo, MAKS_PANJANG_MEMO);
    if (!memo.ok) return { ok: false, kode: "TEKS_TERLALU_PANJANG", baris: i + 1 };
    let kanal: KanalJurnal | null = null;
    if (b.kanal != null && b.kanal !== "") {
      if (!(Object.values(KANAL_JURNAL) as string[]).includes(String(b.kanal))) return { ok: false, kode: "KANAL_TIDAK_SAH", baris: i + 1 };
      kanal = b.kanal as KanalJurnal;
    }
    totalSen += sen;
    baris.push({ kategoriId, akunId, sen, memo: memo.nilai, kanal, tokoId: idOpsional(b.tokoId), kenaPotong: b.kenaPotong === true });
  }
  if (totalSen > MAKS_NILAI_SEN) return { ok: false, kode: "NILAI_TERLALU_BESAR" };

  let jenisPotong: JenisPotongPemasok | null = null;
  if (input.jenisPotong != null && input.jenisPotong !== "") {
    jenisPotong = bacaJenisPotongPemasok(input.jenisPotong);
    if (!jenisPotong) return { ok: false, kode: "POTONG_TIDAK_SAH" };
    if (jenis !== "OUT") return { ok: false, kode: "POTONG_HANYA_KELUAR" };
  }
  return {
    ok: true,
    voucher: {
      ...dasar,
      rekeningTujuanId: null,
      baris,
      totalSen,
      jenisPotong,
      adaNpwp: input.adaNpwp !== false,
    },
  };
}

/** Dasar potongan PPh: Σ baris bertanda; bila tidak ada yang bertanda, semua baris. */
export function dasarPotongSen(baris: readonly Pick<BarisVoucherSah, "sen" | "kenaPotong">[]): number {
  const bertanda = baris.filter((b) => b.kenaPotong);
  return (bertanda.length > 0 ? bertanda : baris).reduce((s, b) => s + b.sen, 0);
}

export type HitunganVoucher = {
  totalSen: number;
  dasarPotongSen: number;
  potongSen: number;
  netoSen: number;
};

/**
 * Bruto, potongan, dan neto voucher. Potongan memakai `hitungPotongPemasok`
 * (sama dengan pembayaran pemasok dan fee KOL), atas dasar potongan — bukan
 * selalu seluruh voucher, supaya voucher campuran (sewa + listrik) hanya
 * memotong bagian sewanya.
 */
export function hitungVoucher(v: Pick<VoucherSah, "jenis" | "baris" | "totalSen" | "jenisPotong" | "adaNpwp">, tarif?: TarifPajakKreatif): HitunganVoucher {
  if (v.jenis !== "OUT" || !v.jenisPotong) return { totalSen: v.totalSen, dasarPotongSen: 0, potongSen: 0, netoSen: v.totalSen };
  const dasar = dasarPotongSen(v.baris);
  const r = hitungPotongPemasok(dasar / 100, v.jenisPotong, { adaNpwp: v.adaNpwp }, tarif);
  const potongSen = Math.round(r.pph * 100);
  return { totalSen: v.totalSen, dasarPotongSen: dasar, potongSen, netoSen: v.totalSen - potongSen };
}

/** Baris jurnal dengan akun yang sudah pasti (bukan peran). */
export type BarisJurnalAkun = {
  chartAccountId: string;
  debit: number;
  credit: number;
  memo?: string;
  channel?: KanalJurnal | null;
  storeId?: string | null;
};

/**
 * Baris jurnal voucher. `akunBaris[i]` = akun baris ke-i (dari kategori atau
 * pilihan langsung); `akunHutangPph` = akun peran hutang PPh potongannya.
 *
 * OUT: DR akun baris (bruto) / CR rekening (neto) / CR hutang PPh (potongan).
 * IN: DR rekening (total) / CR akun baris.
 * TRANSFER: DR rekening tujuan / CR rekening asal.
 */
export function barisJurnalVoucher(
  v: Pick<VoucherSah, "jenis" | "rekeningId" | "rekeningTujuanId" | "baris" | "totalSen" | "jenisPotong">,
  hitung: HitunganVoucher,
  akunBaris: readonly string[],
  akunHutangPph: string | null,
): BarisJurnalAkun[] {
  const rp = (sen: number) => sen / 100;
  if (v.jenis === "TRANSFER") {
    return [
      { chartAccountId: v.rekeningTujuanId as string, debit: rp(v.totalSen), credit: 0, memo: "Transfer masuk" },
      { chartAccountId: v.rekeningId, debit: 0, credit: rp(v.totalSen), memo: "Transfer keluar" },
    ];
  }
  const barisAkun: BarisJurnalAkun[] = v.baris.map((b, i) => ({
    chartAccountId: akunBaris[i],
    debit: v.jenis === "OUT" ? rp(b.sen) : 0,
    credit: v.jenis === "IN" ? rp(b.sen) : 0,
    ...(b.memo ? { memo: b.memo } : {}),
    ...(b.kanal ? { channel: b.kanal } : {}),
    ...(b.tokoId ? { storeId: b.tokoId } : {}),
  }));
  if (v.jenis === "IN") {
    return [{ chartAccountId: v.rekeningId, debit: rp(v.totalSen), credit: 0 }, ...barisAkun];
  }
  const hasil: BarisJurnalAkun[] = [...barisAkun];
  if (hitung.netoSen > 0) hasil.push({ chartAccountId: v.rekeningId, debit: 0, credit: rp(hitung.netoSen) });
  if (hitung.potongSen > 0 && v.jenisPotong) {
    if (!akunHutangPph) throw new Error("akun hutang PPh wajib untuk voucher berpotongan");
    hasil.push({ chartAccountId: akunHutangPph, debit: 0, credit: rp(hitung.potongSen), memo: INFO_POTONG_PEMASOK[v.jenisPotong].peranHutang });
  }
  return hasil;
}

/** Uraian jurnal voucher (data, selalu Bahasa Indonesia). */
export function uraianJurnalVoucher(jenis: JenisVoucher, nomor: string, pihak: string | null, keterangan: string | null): string {
  const awal = jenis === "OUT" ? "Kas/bank keluar" : jenis === "IN" ? "Kas/bank masuk" : "Transfer antar rekening";
  const tambahan = [pihak, keterangan].filter((x): x is string => Boolean(x)).join(" · ");
  const teks = `${awal} ${nomor}${tambahan ? ` · ${tambahan}` : ""}`;
  return teks.length > 500 ? `${teks.slice(0, 497)}…` : teks;
}

// ── Kategori biaya ────────────────────────────────────────────────────────────

/**
 * Kategori bawaan (permintaan pemilik lewat rancangan D1): dipasang sekali
 * dengan tombol "Isi kategori bawaan", akunnya ditebak dari nama akun BEBAN
 * yang ada (`tebakAkunKategori`) dan bisa diubah sesudahnya.
 */
export type KategoriBawaan = {
  nama: string;
  jenis: "OUT" | "IN";
  kataKunci: readonly string[];
  potong: JenisPotongPemasok | null;
  /** Tipe akun yang dicari. */
  tipeAkun: "BEBAN" | "PENDAPATAN";
};

export const KATEGORI_BAWAAN: readonly KategoriBawaan[] = [
  { nama: "Sewa", jenis: "OUT", kataKunci: ["sewa"], potong: "PPH4_2", tipeAkun: "BEBAN" },
  { nama: "Listrik & air", jenis: "OUT", kataKunci: ["listrik", "air", "utilitas"], potong: null, tipeAkun: "BEBAN" },
  { nama: "Internet & telepon", jenis: "OUT", kataKunci: ["internet", "telepon", "telekomunikasi", "listrik"], potong: null, tipeAkun: "BEBAN" },
  { nama: "Gaji & upah", jenis: "OUT", kataKunci: ["gaji", "upah"], potong: null, tipeAkun: "BEBAN" },
  { nama: "Ongkos kirim", jenis: "OUT", kataKunci: ["ongkir", "ongkos kirim", "pengiriman", "ekspedisi"], potong: null, tipeAkun: "BEBAN" },
  { nama: "Iklan & promosi", jenis: "OUT", kataKunci: ["iklan", "promosi"], potong: null, tipeAkun: "BEBAN" },
  { nama: "Alat tulis & perlengkapan kantor", jenis: "OUT", kataKunci: ["atk", "alat tulis", "perlengkapan kantor", "perlengkapan"], potong: null, tipeAkun: "BEBAN" },
  { nama: "Biaya admin bank", jenis: "OUT", kataKunci: ["admin bank", "biaya bank", "bank"], potong: null, tipeAkun: "BEBAN" },
  { nama: "Lain-lain", jenis: "OUT", kataKunci: ["lain"], potong: null, tipeAkun: "BEBAN" },
  { nama: "Pendapatan lain-lain", jenis: "IN", kataKunci: ["pendapatan lain", "lain"], potong: null, tipeAkun: "PENDAPATAN" },
  { nama: "Bunga / jasa giro", jenis: "IN", kataKunci: ["bunga", "jasa giro"], potong: null, tipeAkun: "PENDAPATAN" },
];

export type AkunUntukTebakan = { id: string; code: string; name: string; type: string };

/**
 * Akun untuk kategori bawaan: akun bertipe sama yang namanya memuat kata kunci
 * pertama yang cocok (urut kata kunci, lalu kode); bila tidak ada, akun yang
 * namanya memuat "lain"; bila tidak ada juga, akun bertipe itu berkode
 * terkecil. Null bila tidak ada akun bertipe itu sama sekali.
 */
export function tebakAkunKategori(k: KategoriBawaan, akun: readonly AkunUntukTebakan[]): string | null {
  const calon = [...akun].filter((a) => a.type === k.tipeAkun).sort((a, b) => a.code.localeCompare(b.code));
  if (calon.length === 0) return null;
  const nama = (a: AkunUntukTebakan) => a.name.toLowerCase();
  for (const kunci of k.kataKunci) {
    const hit = calon.find((a) => nama(a).includes(kunci));
    if (hit) return hit.id;
  }
  return (calon.find((a) => nama(a).includes("lain")) ?? calon[0]).id;
}

/** Kode tolak kategori. */
export const KODE_GALAT_KATEGORI = ["NAMA_WAJIB", "NAMA_SUDAH_ADA", "JENIS_TIDAK_SAH", "AKUN_TIDAK_SAH", "POTONG_TIDAK_SAH", "TIDAK_DITEMUKAN", "TANPA_AKUN"] as const;
export type KodeGalatKategori = (typeof KODE_GALAT_KATEGORI)[number];
