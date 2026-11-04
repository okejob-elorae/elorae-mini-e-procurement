import type { PostingRole } from "@/lib/constants/journal-roles";
import type { BarisJurnalPpn } from "./jurnal-ppn";

/**
 * Masa pajak ("YYYY-MM", bulan kalender WIB) dan rekap masa PPN — murni,
 * aman untuk komponen klien.
 *
 * Rekap masa PPN dibaca dari BUKU BESAR (baris akun peran `PPN_KELUARAN` dan
 * `PPN_MASUKAN` bertanggal di masa itu), bukan dari dokumen: apa pun yang
 * dibukukan sebagai PPN — penjualan, retur, kanvas, sampel KOL, penerimaan
 * barang, biaya marketplace, jurnal manual — ikut. Jurnal penyelesaian masa
 * (`PPN_MASA`, `PPN_MASA_REVERSAL`) dikecualikan dari bacaannya.
 *
 *   kurang (lebih) bayar = PPN keluaran − PPN masukan − kompensasi masa lalu
 *
 * Penyelesaian (FINAL): DR PPN keluaran sebesar keluaran masa itu;
 * - kurang bayar → CR PPN masukan (masukan + kompensasi) dan CR hutang PPN
 *   (`PPN_PAYABLE`) sebesar kurang bayarnya — dilunasi lewat setoran pajak;
 * - lebih bayar → CR PPN masukan sebesar keluaran saja; sisa PPN masukan
 *   tetap di akunnya sebagai kompensasi ke masa berikutnya (bukan restitusi).
 * Setiap baris boleh bernilai negatif (retur melebihi penjualan) — sisinya
 * dibalik, jurnal tetap seimbang.
 *
 * Batas: kredit PPN masukan sebenarnya boleh sampai 3 masa sesudahnya (UU PPN
 * Ps 9(9)) dan pajak masukan harus cocok dengan faktur di Coretax; rekap ini
 * mengkreditkan semuanya di masa dicatat. Bukan nasihat pajak.
 */

export const SUMBER_PPN_MASA = "PPN_MASA";
export const SUMBER_PPN_MASA_BALIK = "PPN_MASA_REVERSAL";
export const SUMBER_PPH_FINAL = "PPH_FINAL";
export const SUMBER_PPH_FINAL_BALIK = "PPH_FINAL_REVERSAL";
export const SUMBER_SETORAN_PAJAK = "TAX_PAYMENT";
export const SUMBER_SETORAN_PAJAK_BALIK = "TAX_PAYMENT_REVERSAL";

/** Jurnal penyelesaian yang TIDAK dihitung sebagai PPN masa (supaya rekap tidak membaca dirinya sendiri). */
export const SUMBER_BUKAN_PPN_MASA: readonly string[] = [SUMBER_PPN_MASA, SUMBER_PPN_MASA_BALIK];

const POLA_MASA = /^(\d{4})-(\d{2})$/;

/** "YYYY-MM" yang sah (tahun 2000–2999, bulan 01–12), atau null. */
export function bacaMasaPajak(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = POLA_MASA.exec(v.trim());
  if (!m) return null;
  const tahun = Number(m[1]);
  const bulan = Number(m[2]);
  return tahun >= 2000 && tahun <= 2999 && bulan >= 1 && bulan <= 12 ? `${m[1]}-${m[2]}` : null;
}

function pecah(masa: string): { tahun: number; bulan: number } {
  const m = POLA_MASA.exec(masa);
  if (!m) throw new RangeError(`Masa pajak tidak sah: ${masa}`);
  return { tahun: Number(m[1]), bulan: Number(m[2]) };
}

const dua = (n: number) => String(n).padStart(2, "0");

export function geserMasaPajak(masa: string, n: number): string {
  const { tahun, bulan } = pecah(masa);
  const idx = tahun * 12 + (bulan - 1) + n;
  return `${Math.floor(idx / 12)}-${dua((idx % 12) + 1)}`;
}

/** Masa dari sebuah instan (hari WIB). */
export function masaDariTanggal(tanggal: Date): string {
  const teks = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(tanggal);
  return teks.slice(0, 7);
}

/** [awal, akhir) masa dalam instan: 00.00 WIB tanggal 1 sampai 00.00 WIB tanggal 1 bulan berikutnya. */
export function rentangMasa(masa: string): { mulai: Date; sampai: Date } {
  const { tahun, bulan } = pecah(masa);
  const berikut = geserMasaPajak(masa, 1);
  return {
    mulai: new Date(`${tahun}-${dua(bulan)}-01T00:00:00.000+07:00`),
    sampai: new Date(`${berikut}-01T00:00:00.000+07:00`),
  };
}

/** Hari terakhir masa ("YYYY-MM-DD"). */
export function hariTerakhirMasa(masa: string): string {
  const { tahun, bulan } = pecah(masa);
  const hari = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  return `${tahun}-${dua(bulan)}-${dua(hari)}`;
}

/** Tanggal jurnal penyelesaian masa: hari terakhir masa, 00.00 WIB. */
export function tanggalJurnalMasa(masa: string): Date {
  return new Date(`${hariTerakhirMasa(masa)}T00:00:00.000+07:00`);
}

const keSen = (n: number): number => Math.sign(n) * Math.round(Number((Math.abs(n) * 100).toFixed(4)));
const dariSen = (s: number): number => s / 100 + 0;

export type AngkaPpnMasa = {
  /** Σ PPN keluaran masa (kredit − debit), bertanda. */
  keluaran: number;
  keluaranDpp: number;
  /** Σ PPN masukan masa (debit − kredit), bertanda. */
  masukan: number;
  masukanDpp: number;
  /** Lebih bayar masa sebelumnya yang dibawa ke masa ini (≥ 0). */
  kompensasi: number;
};

export type RekapPpn = AngkaPpnMasa & {
  /** keluaran − masukan − kompensasi: positif = kurang bayar (disetor), negatif = lebih bayar (dikompensasikan). */
  saldo: number;
};

export function hitungRekapPpn(a: AngkaPpnMasa): RekapPpn {
  const saldo = dariSen(keSen(a.keluaran) - keSen(a.masukan) - keSen(Math.max(0, a.kompensasi)));
  return {
    keluaran: dariSen(keSen(a.keluaran)),
    keluaranDpp: dariSen(keSen(a.keluaranDpp)),
    masukan: dariSen(keSen(a.masukan)),
    masukanDpp: dariSen(keSen(a.masukanDpp)),
    kompensasi: dariSen(keSen(Math.max(0, a.kompensasi))),
    saldo,
  };
}

/** Kompensasi yang dibawa ke masa berikutnya dari rekap FINAL masa ini. */
export function kompensasiBerikut(saldo: number): number {
  return saldo < 0 ? dariSen(-keSen(saldo)) : 0;
}

/** Baris bernilai bertanda di satu sisi; nol tidak menghasilkan baris. */
function sisi(role: PostingRole, debit: boolean, nilai: number, memo?: string): BarisJurnalPpn[] {
  const sen = keSen(nilai);
  if (sen === 0) return [];
  const n = dariSen(Math.abs(sen));
  const d = debit === sen > 0;
  return [{ role, debit: d ? n : 0, credit: d ? 0 : n, ...(memo ? { memo } : {}) }];
}

/**
 * Baris jurnal penyelesaian masa PPN. Kosong bila tidak ada yang dipindah
 * (masa tanpa PPN keluaran dan tanpa kurang bayar). Jumlah debit = kredit.
 *
 * Memo baris PPN sengaja BUKAN memo DPP: jurnal ini tidak dibaca rekap
 * (`SUMBER_BUKAN_PPN_MASA`), dan memo DPP hanya untuk baris transaksi.
 */
export function barisPenyelesaianPpn(r: RekapPpn): BarisJurnalPpn[] {
  const keluaran = keSen(r.keluaran);
  const saldo = keSen(r.saldo);
  if (saldo >= 0) {
    return [
      ...sisi("PPN_KELUARAN", true, dariSen(keluaran), "Penyelesaian PPN keluaran"),
      ...sisi("PPN_MASUKAN", false, dariSen(keluaran - saldo), "Penyelesaian PPN masukan"),
      ...sisi("PPN_PAYABLE", false, dariSen(saldo), "PPN kurang bayar"),
    ];
  }
  return [
    ...sisi("PPN_KELUARAN", true, dariSen(keluaran), "Penyelesaian PPN keluaran"),
    ...sisi("PPN_MASUKAN", false, dariSen(keluaran), "Penyelesaian PPN masukan"),
  ];
}

/** `sourceId` jurnal penyelesaian generasi ke-n (pembuka kembali menambah generasi). */
export function idSumberMasa(masa: string, generasi: number): string {
  return `${masa}#${generasi}`;
}

/** Baris pembalik: sisi ditukar, memo tetap. */
export function balikBaris<T extends { debit: number; credit: number }>(baris: readonly T[]): T[] {
  return baris.map((b) => ({ ...b, debit: b.credit, credit: b.debit }));
}
