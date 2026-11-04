import { bacaKunciBulan, type TahunBulan } from "@/lib/finance/periode/periode";
import { bacaTanggal } from "@/lib/tanggal-isian";
import {
  ATURAN_KATEGORI,
  aturanBerlaku,
  bacaKategoriAset,
  bacaMetode,
  METODE_PENYUSUTAN,
  UMUR_KOMERSIAL_MAKS,
  type KategoriAset,
  type MetodePenyusutan,
} from "./kelompok";
import { akumulasiTargetSampai, type SpesifikasiPenyusutan } from "./jadwal";

/*
 * Aturan isian aset tetap, pelepasan, dan sumber jurnalnya (bagian D3).
 * Murni — aman untuk komponen klien (formulir memakai pemeriksaan yang sama
 * dengan server).
 */

/** sourceType jurnal aset tetap. */
export const SUMBER_ASET = {
  /** Perolehan yang dicatat lewat formulir aset (DR aset / CR akun lawan). sourceId = id aset. */
  PEROLEHAN: "FIXED_ASSET",
  /** Pembatalan aset yang perolehannya dijurnal di sini. sourceId = id aset. */
  PEROLEHAN_BATAL: "FIXED_ASSET_REVERSAL",
  /** Penyusutan bulanan. sourceId = `<id aset>/<YYYY-MM>`. */
  PENYUSUTAN: "DEPRECIATION",
  /** Pelepasan / penjualan. sourceId = id aset. */
  PELEPASAN: "ASSET_DISPOSAL",
  /** Pembatalan pelepasan. sourceId = id aset. */
  PELEPASAN_BATAL: "ASSET_DISPOSAL_REVERSAL",
} as const;

export function idSumberPenyusutan(asetId: string, periode: string): string {
  return `${asetId}/${periode}`;
}

/** `<id aset>/<YYYY-MM>` → bagiannya; null bila bentuknya lain. */
export function bacaIdSumberPenyusutan(sourceId: string | null | undefined): { asetId: string; periode: string; tb: TahunBulan } | null {
  const m = /^(.+)\/(\d{4}-\d{2})$/.exec(sourceId ?? "");
  if (!m) return null;
  const tb = bacaKunciBulan(m[2]);
  return tb ? { asetId: m[1], periode: m[2], tb } : null;
}

export const STATUS_ASET = { AKTIF: "ACTIVE", DILEPAS: "DISPOSED", BATAL: "CANCELLED" } as const;

/**
 * Cara perolehan dicatat:
 * - `JURNAL` — jurnal perolehan dibuat sekarang: DR akun aset / CR akun lawan
 *   (kas/bank atau hutang). Tanggalnya tanggal perolehan.
 * - `SUDAH_DICATAT` — perolehannya sudah dijurnal di tempat lain (voucher kas,
 *   pembayaran pemasok, jurnal manual) ke akun aset; di sini tidak dijurnal lagi.
 * - `SALDO_AWAL` — aset lama yang nilainya sudah masuk saldo awal buku besar.
 */
export const CARA_PEROLEHAN = ["JURNAL", "SUDAH_DICATAT", "SALDO_AWAL"] as const;
export type CaraPerolehan = (typeof CARA_PEROLEHAN)[number];

export const KODE_GALAT_ASET = [
  "NAMA_WAJIB",
  "TEKS_TERLALU_PANJANG",
  "KATEGORI_TIDAK_SAH",
  "TANGGAL_TIDAK_SAH",
  "TANGGAL_MASA_DEPAN",
  "BIAYA_TIDAK_SAH",
  "NILAI_SISA_TIDAK_SAH",
  "NILAI_SISA_FISKAL",
  "UMUR_TIDAK_SAH",
  "METODE_TIDAK_SAH",
  "TARIF_TIDAK_SAH",
  "MULAI_TIDAK_SAH",
  "MULAI_SEBELUM_PEROLEHAN",
  "AKUMULASI_TIDAK_SAH",
  "AKUMULASI_PEMBELIAN_BARU",
  "CARA_TIDAK_SAH",
  "AKUN_LAWAN_WAJIB",
  "NILAI_TERLALU_BESAR",
] as const;
export type KodeGalatIsianAset = (typeof KODE_GALAT_ASET)[number];

/** Batas nilai satu aset: Rp 1 triliun (kolom Decimal(18,2) jauh di atasnya). */
const MAKS_SEN = 1_000_000_000_000 * 100;

/** Rupiah dari isian → sen. `"1.500.000"`, `"1500000"`, `"1.500.000,50"`, `"1500000.5"`, angka. Null bila tidak sah atau negatif. */
export function bacaRupiahSen(nilai: unknown): number | null {
  if (typeof nilai === "number") {
    if (!Number.isFinite(nilai) || nilai < 0) return null;
    return Math.round(Number((nilai * 100).toFixed(4)));
  }
  if (typeof nilai !== "string") return null;
  const t = nilai.trim().replace(/\s/g, "").replace(/^rp\.?/i, "");
  if (!t) return null;
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

export type IsianAset = {
  nama: string;
  kategori: string;
  /** "YYYY-MM-DD". */
  tanggalPerolehan: string;
  biaya: unknown;
  nilaiSisa?: unknown;
  /** Hanya untuk kategori komersial. */
  umurBulan?: unknown;
  metode?: string | null;
  /** Saldo menurun komersial (% setahun); kelompok fiskal memakai tarifnya sendiri. */
  tarifSaldoMenurun?: unknown;
  /** "YYYY-MM"; bawaan bulan perolehan. */
  mulaiDisusutkan?: string | null;
  akumulasiAwal?: unknown;
  cara: string;
  /** Akun lawan jurnal perolehan (kas/bank atau hutang) — wajib bila `cara = JURNAL`. */
  akunLawanId?: string | null;
  akunAsetId?: string | null;
  akunAkumulasiId?: string | null;
  akunBebanId?: string | null;
  lokasi?: string | null;
  pemasokId?: string | null;
  catatan?: string | null;
};

export type AsetBersih = {
  nama: string;
  kategori: KategoriAset;
  tanggalPerolehan: string;
  biaya: number;
  nilaiSisa: number;
  umurBulan: number;
  metode: MetodePenyusutan;
  tarifSaldoMenurun: number | null;
  mulaiDisusutkan: TahunBulan;
  akumulasiAwal: number;
  cara: CaraPerolehan;
  akunLawanId: string | null;
  akunAsetId: string | null;
  akunAkumulasiId: string | null;
  akunBebanId: string | null;
  lokasi: string | null;
  pemasokId: string | null;
  catatan: string | null;
};

const teks = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Pemeriksaan isian aset. `hariIni` = "YYYY-MM-DD" WIB. */
export function periksaIsianAset(
  isian: IsianAset,
  hariIni: string,
): { ok: true; aset: AsetBersih } | { ok: false; kode: KodeGalatIsianAset } {
  const nama = teks(isian.nama);
  if (!nama) return { ok: false, kode: "NAMA_WAJIB" };
  if (nama.length > 191) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  const lokasi = teks(isian.lokasi);
  const catatan = teks(isian.catatan);
  if ((lokasi?.length ?? 0) > 191 || (catatan?.length ?? 0) > 2000) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };

  const kategori = bacaKategoriAset(isian.kategori);
  if (!kategori) return { ok: false, kode: "KATEGORI_TIDAK_SAH" };
  const aturan = ATURAN_KATEGORI[kategori];

  const tgl = bacaTanggal(isian.tanggalPerolehan);
  if (!tgl) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  if (isian.tanggalPerolehan > hariIni) return { ok: false, kode: "TANGGAL_MASA_DEPAN" };

  const biaya = bacaRupiahSen(isian.biaya);
  if (biaya == null || biaya <= 0) return { ok: false, kode: "BIAYA_TIDAK_SAH" };
  if (biaya > MAKS_SEN) return { ok: false, kode: "NILAI_TERLALU_BESAR" };

  const sisaMentah = isian.nilaiSisa === undefined || isian.nilaiSisa === null || isian.nilaiSisa === "" ? 0 : bacaRupiahSen(isian.nilaiSisa);
  if (sisaMentah == null || sisaMentah >= biaya) return { ok: false, kode: "NILAI_SISA_TIDAK_SAH" };
  if (aturan.fiskal && sisaMentah > 0) return { ok: false, kode: "NILAI_SISA_FISKAL" };

  const metodeIsian = isian.metode ? bacaMetode(isian.metode) : null;
  if (isian.metode && (!metodeIsian || !aturan.metodeBoleh.includes(metodeIsian))) return { ok: false, kode: "METODE_TIDAK_SAH" };

  let umurIsian: number | null = null;
  if (aturan.umurBulan == null) {
    const u = Number(isian.umurBulan);
    if (!Number.isInteger(u) || u < 1 || u > UMUR_KOMERSIAL_MAKS) return { ok: false, kode: "UMUR_TIDAK_SAH" };
    umurIsian = u;
  }

  let tarifIsian: number | null = null;
  if (aturan.tarifSaldoMenurun == null && metodeIsian === METODE_PENYUSUTAN.SALDO_MENURUN) {
    if (isian.tarifSaldoMenurun !== undefined && isian.tarifSaldoMenurun !== null && isian.tarifSaldoMenurun !== "") {
      const t = Number(String(isian.tarifSaldoMenurun).replace(",", "."));
      if (!Number.isFinite(t) || t <= 0 || t > 100 || Math.round(t * 100) !== t * 100) return { ok: false, kode: "TARIF_TIDAK_SAH" };
      tarifIsian = t;
    }
  }
  const berlaku = aturanBerlaku(kategori, { umurBulan: umurIsian, metode: metodeIsian, tarifSaldoMenurun: tarifIsian });

  const bulanPerolehan: TahunBulan = { tahun: tgl.tahun, bulan: tgl.bulan };
  let mulai = bulanPerolehan;
  if (teks(isian.mulaiDisusutkan)) {
    const m = bacaKunciBulan(isian.mulaiDisusutkan);
    if (!m) return { ok: false, kode: "MULAI_TIDAK_SAH" };
    if (m.tahun * 12 + m.bulan < bulanPerolehan.tahun * 12 + bulanPerolehan.bulan) return { ok: false, kode: "MULAI_SEBELUM_PEROLEHAN" };
    mulai = m;
  }

  const akumMentah = isian.akumulasiAwal === undefined || isian.akumulasiAwal === null || isian.akumulasiAwal === "" ? 0 : bacaRupiahSen(isian.akumulasiAwal);
  if (akumMentah == null || akumMentah > biaya - sisaMentah) return { ok: false, kode: "AKUMULASI_TIDAK_SAH" };

  const cara = (CARA_PEROLEHAN as readonly string[]).includes(isian.cara) ? (isian.cara as CaraPerolehan) : null;
  if (!cara) return { ok: false, kode: "CARA_TIDAK_SAH" };
  // Pembelian yang dijurnal sekarang adalah harta baru bagi Elorae: penyusutannya mulai dari nol.
  if (cara === "JURNAL" && akumMentah > 0) return { ok: false, kode: "AKUMULASI_PEMBELIAN_BARU" };
  const akunLawanId = teks(isian.akunLawanId);
  if (cara === "JURNAL" && !akunLawanId) return { ok: false, kode: "AKUN_LAWAN_WAJIB" };

  return {
    ok: true,
    aset: {
      nama,
      kategori,
      tanggalPerolehan: isian.tanggalPerolehan,
      biaya: biaya / 100,
      nilaiSisa: sisaMentah / 100,
      umurBulan: berlaku.umurBulan,
      metode: berlaku.metode,
      tarifSaldoMenurun: berlaku.tarifSaldoMenurun,
      mulaiDisusutkan: mulai,
      akumulasiAwal: akumMentah / 100,
      cara,
      akunLawanId: cara === "JURNAL" ? akunLawanId : null,
      akunAsetId: teks(isian.akunAsetId),
      akunAkumulasiId: teks(isian.akunAkumulasiId),
      akunBebanId: teks(isian.akunBebanId),
      lokasi,
      pemasokId: teks(isian.pemasokId),
      catatan,
    },
  };
}

export function spekDariAset(a: {
  cost: number;
  residualValue: number;
  usefulLifeMonths: number;
  method: string;
  decliningRatePercent: number | null;
  mulai: TahunBulan;
}): SpesifikasiPenyusutan {
  return {
    biaya: a.cost,
    nilaiSisa: a.residualValue,
    umurBulan: a.usefulLifeMonths,
    metode: a.method === METODE_PENYUSUTAN.SALDO_MENURUN ? METODE_PENYUSUTAN.SALDO_MENURUN : METODE_PENYUSUTAN.GARIS_LURUS,
    tarifSaldoMenurun: a.decliningRatePercent,
    mulai: a.mulai,
  };
}

/**
 * Selisih akumulasi awal terhadap jadwal di bulan SEBELUM `bulanPertamaSistem`:
 * positif = akumulasi awal kurang dari jadwal (bulan pertama yang diposting
 * menyusulkan selisihnya sekaligus), negatif = lebih (bulan-bulan berikutnya nol
 * sampai jadwal menyusul). Formulir memakainya untuk memperingatkan.
 */
export function selisihAkumulasiAwal(spek: SpesifikasiPenyusutan, akumulasiAwal: number, bulanPertamaSistem: TahunBulan): number {
  const sebelum: TahunBulan =
    bulanPertamaSistem.bulan === 1 ? { tahun: bulanPertamaSistem.tahun - 1, bulan: 12 } : { tahun: bulanPertamaSistem.tahun, bulan: bulanPertamaSistem.bulan - 1 };
  return Math.round((akumulasiTargetSampai(spek, sebelum) - akumulasiAwal) * 100) / 100;
}


// ─── Pelepasan ───────────────────────────────────────────────────────────────

export type PeranBarisPelepasan = "AKUMULASI" | "PENERIMAAN" | "ASET" | "LABA_RUGI";

export type BarisPelepasan = { peran: PeranBarisPelepasan; debit: number; credit: number };

/**
 * Jurnal pelepasan / penjualan aset: hapus harga perolehan (CR aset) dan
 * akumulasinya (DR akumulasi), terima hasil penjualan (DR kas/bank), dan
 * selisihnya laba (CR) atau rugi (DR) pelepasan. Baris bernilai nol dibuang;
 * jumlah debit = kredit persis (sen).
 */
export function barisPelepasan(isi: { biaya: number; akumulasi: number; hasilJual: number }): BarisPelepasan[] {
  const biaya = Math.round(isi.biaya * 100);
  const akum = Math.round(isi.akumulasi * 100);
  const jual = Math.round(isi.hasilJual * 100);
  const labaRugi = jual - (biaya - akum);
  const baris: BarisPelepasan[] = [];
  if (akum > 0) baris.push({ peran: "AKUMULASI", debit: akum / 100, credit: 0 });
  if (jual > 0) baris.push({ peran: "PENERIMAAN", debit: jual / 100, credit: 0 });
  if (labaRugi < 0) baris.push({ peran: "LABA_RUGI", debit: -labaRugi / 100, credit: 0 });
  if (biaya > 0) baris.push({ peran: "ASET", debit: 0, credit: biaya / 100 });
  if (labaRugi > 0) baris.push({ peran: "LABA_RUGI", debit: 0, credit: labaRugi / 100 });
  return baris;
}

/** Bulan terakhir yang disusutkan sebelum aset dilepas: bulan SEBELUM bulan pelepasan. */
export function bulanTerakhirSebelumLepas(bulanLepas: TahunBulan): TahunBulan {
  return bulanLepas.bulan === 1 ? { tahun: bulanLepas.tahun - 1, bulan: 12 } : { tahun: bulanLepas.tahun, bulan: bulanLepas.bulan - 1 };
}
