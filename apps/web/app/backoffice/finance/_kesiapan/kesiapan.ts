import { POSTING_ROLES, type PostingRole } from "@/lib/constants/journal-roles";
import type { RingkasanSaldoAwal } from "@/lib/finance/saldo-awal/kesiapan";

/*
 * Kesiapan buku besar — dasar spanduk "Buku besar belum aktif" di Jurnal dan
 * keempat laporan keuangan. Murni (tanpa Prisma) supaya dites dan dipakai di
 * komponen klien; datanya dibaca `baca.ts`.
 *
 * KEPUTUSAN SEMENTARA (2026-10-06, usulan Claude, menunggu pemilik): "aktif"
 * berarti SEMUA peran wajib terpetakan ke akun bertipe benar, sudah ada jurnal,
 * DAN tanggal mulai buku besar (`finance.glCutoverDate`) sudah ditetapkan —
 * tanpa tanggal itu penjualan marketplace tidak pernah dijurnal. Ubah di sini.
 */

/**
 * Peran yang TIDAK menahan "aktif": lima rincian biaya marketplace jatuh ke
 * peran cadangan `MARKETPLACE_FEE` bila belum dipetakan, dan `TAX` belum
 * dipakai jurnal otomatis mana pun.
 */
export const PERAN_OPSIONAL: readonly PostingRole[] = [
  "MARKETPLACE_FEE_ADMIN",
  "MARKETPLACE_FEE_SERVICE",
  "MARKETPLACE_FEE_COMMISSION",
  "MARKETPLACE_FEE_PROCESSING",
  "MARKETPLACE_FEE_OTHER",
  "TAX",
  // Ruang KOL: hanya dibutuhkan bila jurnal fee/pembayaran/sampel KOL dipakai.
  "KOL_EXPENSE",
  "KOL_PAYABLE",
  "KOL_PREPAID",
  "PPH21_PAYABLE",
  "PPH23_PAYABLE",
  // Akuntansi & pajak lengkap (2026-10-08): semua opsional dulu. Sebuah peran
  // baru pantas WAJIB hanya bila sumber jurnalnya aktif (mis. PPN_* begitu
  // status PKP ditetapkan) — itu keputusan per sumber, bukan di daftar ini.
  "AR_STORE",
  "AR_CONSIGNMENT",
  "INVENTORY_CONSIGNMENT",
  "INVENTORY_DAMAGED",
  "SALES_RETURN",
  "SALES_DISCOUNT",
  "PPN_MASUKAN",
  "PPN_KELUARAN",
  "PPN_PAYABLE",
  "PPH4_2_PAYABLE",
  "PPH_FINAL_PAYABLE",
  "PPH_FINAL_EXPENSE",
  "PPH22_PREPAID",
  "PPH23_PREPAID",
  "PPH25_PREPAID",
  "SPG_COMMISSION_EXPENSE",
  "SALES_COMMISSION_EXPENSE",
  "COMMISSION_PAYABLE",
  "LOSS_EXPENSE",
  "LOSS_RECOVERY",
  "TRAVEL_EXPENSE",
  "REIMBURSE_PAYABLE",
  "FIXED_ASSET",
  "ACCUM_DEPRECIATION",
  "DEPRECIATION_EXPENSE",
  "ASSET_DISPOSAL_GAIN_LOSS",
  "RETAINED_EARNINGS",
  "OPENING_EQUITY",
  "BANK_CHARGES",
  "OTHER_INCOME",
  "PREPAID_EXPENSE",
  "ACCRUED_EXPENSE",
];

/** Peran cadangan: dipakai rincian biaya marketplace yang belum dipetakan. */
export const PERAN_CADANGAN: PostingRole = "MARKETPLACE_FEE";

export const PERAN_WAJIB: readonly PostingRole[] = POSTING_ROLES.filter((p) => !PERAN_OPSIONAL.includes(p));

export type AlasanBelumAktif = "PEMETAAN" | "TANPA_JURNAL" | "TANPA_TANGGAL_MULAI";

export type DataKesiapan = {
  /** Peran yang terpetakan ke akun bertipe BENAR (pemetaan salah tipe tidak dihitung). */
  peranTerpetakan: string[];
  jumlahJurnal: number;
  /** `finance.glCutoverDate` ("YYYY-MM-DD") atau null bila belum ditetapkan. */
  tanggalMulai: string | null;
  jurnalTertunda: number;
  /**
   * Ringkasan saldo awal per jenis (`lib/finance/saldo-awal/kesiapan.ts`).
   * Hanya ditampilkan — TIDAK menahan "aktif": usaha baru sah tanpa piutang,
   * hutang, atau persediaan awal. Tidak ada (undefined/null) = tidak dibaca.
   */
  saldoAwal?: RingkasanSaldoAwal | null;
  /**
   * Status PKP (`pajak.ppn`, `lib/finance/pajak/ppn.ts`). PKP → peran PPN
   * (`PERAN_WAJIB_PKP`) ikut WAJIB: tanpa itu setiap jurnal penjualan dan
   * pembelian ber-PPN gagal. BELUM_DITETAPKAN → spanduk mengingatkan, tetapi
   * tidak menahan "aktif". Tidak ada (undefined) = tidak dibaca.
   */
  statusPkp?: "BELUM_DITETAPKAN" | "PKP" | "NON_PKP";
};

/** Peran yang wajib dipetakan begitu perusahaan PKP. */
export const PERAN_WAJIB_PKP: readonly PostingRole[] = ["PPN_KELUARAN", "PPN_MASUKAN", "PPN_PAYABLE"];

export type KesiapanBukuBesar = DataKesiapan & {
  totalPeran: number;
  jumlahTerpetakan: number;
  totalPeranWajib: number;
  jumlahWajibTerpetakan: number;
  peranWajibBelum: PostingRole[];
  aktif: boolean;
  alasan: AlasanBelumAktif[];
};

export function nilaiKesiapan(data: DataKesiapan): KesiapanBukuBesar {
  const terpetakan = new Set(data.peranTerpetakan);
  const jumlahTerpetakan = POSTING_ROLES.filter((p) => terpetakan.has(p)).length;
  const wajib = data.statusPkp === "PKP" ? [...PERAN_WAJIB, ...PERAN_WAJIB_PKP] : PERAN_WAJIB;
  const peranWajibBelum = wajib.filter((p) => !terpetakan.has(p));
  const alasan: AlasanBelumAktif[] = [];
  if (peranWajibBelum.length > 0) alasan.push("PEMETAAN");
  if (data.jumlahJurnal <= 0) alasan.push("TANPA_JURNAL");
  if (!data.tanggalMulai) alasan.push("TANPA_TANGGAL_MULAI");
  return {
    ...data,
    totalPeran: POSTING_ROLES.length,
    jumlahTerpetakan,
    totalPeranWajib: wajib.length,
    jumlahWajibTerpetakan: wajib.length - peranWajibBelum.length,
    peranWajibBelum,
    aktif: alasan.length === 0,
    alasan,
  };
}

/**
 * Spanduk tampil bila buku besar belum aktif, aktif tetapi masih ada jurnal
 * yang gagal, atau status PKP belum ditetapkan (rancangan B2: "memunculkan
 * spanduk" sampai pemilik memilih).
 */
export function perluSpanduk(k: KesiapanBukuBesar): boolean {
  return !k.aktif || k.jurnalTertunda > 0 || k.statusPkp === "BELUM_DITETAPKAN";
}

/** Ada baris jurnal pada periode laporan — bila tidak, laporan menampilkan keadaan kosong, bukan Rp 0. */
export function adaMutasi(baris: { debit: number; credit: number }[]): boolean {
  return baris.some((b) => b.debit !== 0 || b.credit !== 0);
}

type SimpulMutasi = { debit: number; credit: number; children: SimpulMutasi[] };

/** `adaMutasi` untuk pohon akun laporan (versi cetak hanya menerima pohonnya). */
export function adaMutasiPohon(simpul: SimpulMutasi[]): boolean {
  return simpul.some((s) => s.debit !== 0 || s.credit !== 0 || adaMutasiPohon(s.children));
}

/**
 * Laba Rugi berisi bila ada mutasi di akun pendapatan, HPP, atau beban. Jurnal
 * yang hanya menyentuh akun neraca (penerimaan barang, pembayaran pemasok)
 * tidak mengisinya. Dipakai layar DAN cetak supaya keduanya sepakat.
 */
export function adaMutasiLabaRugi(r: {
  pendapatan: SimpulMutasi[];
  hpp: SimpulMutasi[];
  beban: SimpulMutasi[];
}): boolean {
  return adaMutasiPohon([...r.pendapatan, ...r.hpp, ...r.beban]);
}

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function tanggalSah(v: string): string | null {
  const t = v.trim();
  if (!POLA_TANGGAL.test(t)) return null;
  return Number.isNaN(new Date(`${t}T00:00:00.000+07:00`).getTime()) ? null : t;
}

/**
 * Periode yang BENAR-BENAR dipakai laporan, untuk ditulis di layar: isian
 * kosong berarti sejak awal (`dari` null) sampai hari ini WIB — sama dengan
 * yang dihitung halaman server (`parseDateOnly…` ?? `endOfTodayJakarta`).
 */
export function periodeLaporan(
  isian: { dari: string; sampai: string },
  hariIni: string,
): { dari: string | null; sampai: string } {
  return { dari: tanggalSah(isian.dari), sampai: tanggalSah(isian.sampai) ?? hariIni };
}
