import type { PostingRole } from "@/lib/constants/journal-roles";
import type { KanalJurnal } from "@/lib/finance/journals/kanal";
import { pisahPpn, type PengaturanPpn } from "./ppn";

/**
 * Baris jurnal ber-PPN untuk penulis jurnal LAMA (penjualan marketplace, retur,
 * kanvas, settlement, penerimaan barang, sampel KOL) — murni, tanpa Prisma.
 *
 * PPN-nya SELALU dihitung `pisahPpn` (`./ppn.ts`); berkas ini hanya menyusun
 * barisnya. Dengan status PKP `BELUM_DITETAPKAN` / `NON_PKP` (bawaan) hasilnya
 * sama persis dengan baris sebelum PPN ada: tanpa baris PPN, pendapatan =
 * total.
 *
 * Setiap baris PPN membawa memo `DPP <angka>` (`memoDpp`): rekap masa PPN
 * membaca DPP keluaran/masukan dari buku besar lewat memo itu, karena baris
 * jurnal tidak punya kolom DPP. Jangan menulis memo lain di baris PPN.
 */

export type DimensiJurnal = { channel?: KanalJurnal | null; storeId?: string | null };

/** Bentuk baris yang dimakan `generateAutoJournal` (AutoJournalLine) — ditulis ulang di sini supaya berkas ini bebas Prisma. */
export type BarisJurnalPpn = {
  role: PostingRole;
  debit: number;
  credit: number;
  memo?: string;
  channel?: KanalJurnal | null;
  storeId?: string | null;
};

const AWALAN_MEMO_DPP = "DPP ";
/** "DPP 123.00" sendiri, atau di belakang nama peran: "PPN_KELUARAN · DPP 123.00". */
const POLA_MEMO_DPP = /(?:^|·\s*)DPP (\d+(?:\.\d{1,2})?)$/;
const PEMISAH_MEMO = " · ";

/** Memo baris PPN: besaran DPP (selalu positif; arah dibaca dari sisi debit/kredit barisnya). */
export function memoDpp(dpp: number): string {
  const sen = Math.round(Number((Math.abs(Number.isFinite(dpp) ? dpp : 0) * 100).toFixed(4)));
  return `${AWALAN_MEMO_DPP}${(sen / 100).toFixed(2)}`;
}

/**
 * Memo gabungan untuk penulis yang membaca saldonya kembali per PERAN dari memo
 * baris (penyelaras jurnal lapangan): nama peran dulu, lalu DPP. `peranDariMemo`
 * dan `dppDariMemo` sama-sama bisa membacanya.
 */
export function memoPeranDpp(peran: string, dpp: number): string {
  return `${peran}${PEMISAH_MEMO}${memoDpp(dpp)}`;
}

/** Nama peran di depan memo gabungan, atau memonya utuh bila bukan gabungan. */
export function peranDariMemo(memo: string | null | undefined): string | null {
  if (typeof memo !== "string" || !memo.trim()) return null;
  return memo.split(PEMISAH_MEMO)[0].trim();
}

/** DPP dari memo baris PPN, atau null bila memonya bukan memo DPP. */
export function dppDariMemo(memo: string | null | undefined): number | null {
  const m = typeof memo === "string" ? POLA_MEMO_DPP.exec(memo.trim()) : null;
  return m ? Number(m[1]) : null;
}

const keSen = (n: number): number => Math.sign(n) * Math.round(Number((Math.abs(n) * 100).toFixed(4)));
const dariSen = (s: number): number => s / 100 + 0;

function dimensi(d: DimensiJurnal | undefined): DimensiJurnal {
  return {
    ...(d?.channel ? { channel: d.channel } : {}),
    ...(d?.storeId ? { storeId: d.storeId } : {}),
  };
}

/** Baris bernilai positif di satu sisi; nilai nol tidak menghasilkan baris (postJournal menolak baris kosong). */
function baris(role: PostingRole, sisi: "D" | "K", nilai: number, ekstra: Partial<BarisJurnalPpn> = {}): BarisJurnalPpn[] {
  const sen = keSen(nilai);
  if (sen === 0) return [];
  const n = dariSen(Math.abs(sen));
  // Nilai negatif membalik sisi, supaya setiap baris tetap satu sisi positif.
  const debit = (sisi === "D") === sen > 0;
  return [{ role, debit: debit ? n : 0, credit: debit ? 0 : n, ...ekstra }];
}

export type HasilPenjualanPpn = {
  /** Yang dibayar pembeli (piutang/kas) — sama persis dengan nilai masukan. */
  total: number;
  /** Pendapatan (DPP). */
  pendapatan: number;
  ppn: number;
  baris: BarisJurnalPpn[];
};

/**
 * Penjualan bernilai `total` (harga jual; termasuk PPN bila
 * `pengaturan.hargaJualTermasukPpn`): DR `peranDebit` total / CR
 * `peranPendapatan` DPP / CR `PPN_KELUARAN` PPN. `balik` membalik semua sisi
 * (retur penjualan).
 *
 * `paksaPpn`: retur mengikuti jurnal penjualan ASALNYA, bukan pengaturan hari
 * ini — `true` = penjualan asal memungut PPN (hitung PPN walau status sekarang
 * bukan PKP), `false` = penjualan asal tanpa PPN (jangan pernah memungut),
 * `undefined` = putuskan dari pengaturan dan tanggal.
 *
 * Dimensi (`channel`, `storeId`) ikut di setiap baris kecuali baris PPN.
 */
export function barisPenjualanPpn(input: {
  total: number;
  peranDebit: PostingRole;
  peranPendapatan?: PostingRole;
  pengaturan: PengaturanPpn;
  tanggal: Date;
  dimensi?: DimensiJurnal;
  balik?: boolean;
  paksaPpn?: boolean;
}): HasilPenjualanPpn {
  const pengaturan: PengaturanPpn =
    input.paksaPpn === true
      ? { ...input.pengaturan, statusPkp: "PKP", berlakuSejak: null }
      : input.paksaPpn === false
        ? { ...input.pengaturan, statusPkp: "NON_PKP" }
        : input.pengaturan;
  const p = pisahPpn(input.total, { pengaturan, tanggal: input.tanggal });
  const dim = dimensi(input.dimensi);
  const masuk = input.balik ? "K" : "D";
  const keluar = input.balik ? "D" : "K";
  return {
    total: p.total,
    pendapatan: p.dpp,
    ppn: p.ppn,
    baris: [
      ...baris(input.peranDebit, masuk, p.total, dim),
      ...baris(input.peranPendapatan ?? "SALES_REVENUE", keluar, p.dpp, dim),
      ...baris("PPN_KELUARAN", keluar, p.ppn, { memo: memoDpp(p.dpp) }),
    ],
  };
}

/**
 * PPN MASUKAN atas pembelian/biaya yang harganya TERMASUK PPN (biaya
 * marketplace): `{ dpp, ppn }` dengan dpp + ppn = nilai persis. Tanpa PPN
 * (bukan PKP / sebelum `berlakuSejak`) → `{ dpp: nilai, ppn: 0 }`.
 */
export function pisahPpnMasukanTermasuk(nilai: number, pengaturan: PengaturanPpn, tanggal: Date): { dpp: number; ppn: number } {
  const p = pisahPpn(nilai, { termasukPpn: true, pengaturan, tanggal });
  return { dpp: p.dpp, ppn: p.ppn };
}

/** Baris DR `PPN_MASUKAN` (memo DPP); kosong bila PPN nol. `balik` → kredit (pembatalan). */
export function barisPpnMasukan(ppn: number, dpp: number, balik = false): BarisJurnalPpn[] {
  return baris("PPN_MASUKAN", balik ? "K" : "D", ppn, { memo: memoDpp(dpp) });
}

/**
 * PPN KELUARAN atas pemberian cuma-cuma (sampel KOL, hadiah) — PMK 11/2025:
 * DPP nilai lain = 11/12 × (harga jual − laba kotor) = 11/12 × HPP, jadi `dpp`
 * di sini = nilai HPP barang yang diberikan dan PPN = pisahPpn(HPP, tanpa PPN).
 * PPN-nya ditanggung Elorae (ikut beban), bukan dipungut dari penerima.
 */
export function ppnPemberianCumaCuma(nilaiHpp: number, pengaturan: PengaturanPpn, tanggal: Date): { dpp: number; ppn: number } {
  const p = pisahPpn(nilaiHpp, { termasukPpn: false, pengaturan, tanggal });
  return { dpp: p.berlaku ? p.dpp : nilaiHpp, ppn: p.ppn };
}

/** Tambah dimensi ke setiap baris yang belum membawanya (mis. baris HPP). */
export function denganDimensi<T extends { role: string }>(daftar: readonly T[], d: DimensiJurnal): (T & DimensiJurnal)[] {
  return daftar.map((b) => {
    const ada = b as T & DimensiJurnal;
    return {
      ...ada,
      ...(!ada.channel && d.channel ? { channel: d.channel } : {}),
      ...(!ada.storeId && d.storeId ? { storeId: d.storeId } : {}),
    };
  });
}
