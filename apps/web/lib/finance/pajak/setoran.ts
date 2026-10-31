import type { PostingRole } from "@/lib/constants/journal-roles";
import { bacaMasaPajak } from "./masa";

/**
 * Setoran pajak (`TaxPayment`) — murni, aman untuk komponen klien.
 *
 * Satu setoran = satu jenis pajak untuk satu masa, dibayar lewat kode billing
 * dan dibuktikan dengan NTPN. Jurnalnya (ditulis bersama setorannya, satu
 * transaksi): DR hutang pajak jenis itu / CR rekening bank yang membayar
 * (`cashAccountId`, atau peran `BANK` bila kosong). PPh 25 adalah angsuran —
 * tidak ada hutangnya, jadi didebit ke pajak dibayar dimuka (`PPH25_PREPAID`).
 *
 * Kode akun pajak (KAP) dan jenis setoran (KJS) di bawah adalah kode umum
 * untuk membuat kode billing — PERIKSA di Coretax sebelum membayar (riset
 * 2026-10-08, bukan nasihat pajak).
 */

export type JenisSetoran = "PPN" | "PPH21" | "PPH23" | "PPH4_2" | "PPH_FINAL" | "PPH25";

export const SEMUA_JENIS_SETORAN: readonly JenisSetoran[] = ["PPN", "PPH21", "PPH23", "PPH4_2", "PPH_FINAL", "PPH25"];

export const INFO_SETORAN: Readonly<
  Record<JenisSetoran, { label: string; peranDebit: PostingRole; kapKjs: string; keterangan: string }>
> = {
  PPN: { label: "PPN dalam negeri", peranDebit: "PPN_PAYABLE", kapKjs: "411211-100", keterangan: "Kurang bayar masa PPN (rekap masa yang sudah final)." },
  PPH21: { label: "PPh 21", peranDebit: "PPH21_PAYABLE", kapKjs: "411121-100", keterangan: "PPh 21 yang dipotong dari pembayaran ke orang pribadi (KOL, penjahit)." },
  PPH23: { label: "PPh 23", peranDebit: "PPH23_PAYABLE", kapKjs: "411124-104", keterangan: "PPh 23 yang dipotong dari pembayaran jasa ke badan." },
  PPH4_2: { label: "PPh 4(2) sewa", peranDebit: "PPH4_2_PAYABLE", kapKjs: "411128-403", keterangan: "PPh final 10% atas sewa tanah/bangunan yang dipotong." },
  PPH_FINAL: { label: "PPh final UMKM", peranDebit: "PPH_FINAL_PAYABLE", kapKjs: "411128-420", keterangan: "PPh final 0,5% dari omzet bulanan." },
  PPH25: { label: "PPh 25 (angsuran)", peranDebit: "PPH25_PREPAID", kapKjs: "411126-100", keterangan: "Angsuran PPh badan bulanan — dicatat sebagai pajak dibayar dimuka." },
};

export function bacaJenisSetoran(v: unknown): JenisSetoran | null {
  return SEMUA_JENIS_SETORAN.includes(v as JenisSetoran) ? (v as JenisSetoran) : null;
}

/** NTPN: 16 huruf/angka (spasi dan tanda hubung diabaikan), disimpan huruf besar. */
export function rapikanNtpn(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{16}$/.test(t) ? t : null;
}

/** Kode billing: 15 angka (spasi/tanda hubung diabaikan). Kosong → null (boleh). */
export function rapikanKodeBilling(v: unknown): string | null | false {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  if (typeof v !== "string") return false;
  const t = v.replace(/[\s-]/g, "");
  return /^\d{15}$/.test(t) ? t : false;
}

export type IsianSetoran = {
  jenis: unknown;
  masa: unknown;
  jumlah: unknown;
  tanggalBayar: unknown;
  ntpn: unknown;
  kodeBilling?: unknown;
  rekeningId?: unknown;
  catatan?: unknown;
};

export type GalatSetoran =
  | "JENIS_TIDAK_SAH"
  | "MASA_TIDAK_SAH"
  | "JUMLAH_TIDAK_SAH"
  | "TANGGAL_TIDAK_SAH"
  | "TANGGAL_DEPAN"
  | "NTPN_TIDAK_SAH"
  | "BILLING_TIDAK_SAH"
  | "CATATAN_PANJANG";

export type SetoranSah = {
  jenis: JenisSetoran;
  masa: string;
  /** Rupiah penuh. */
  jumlah: number;
  tanggalBayar: string;
  ntpn: string;
  kodeBilling: string | null;
  rekeningId: string | null;
  catatan: string | null;
};

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Periksa isian setoran. Jumlah rupiah PENUH (pajak disetor tanpa sen), dan
 * masa tidak boleh sesudah bulan tanggal bayar — setoran untuk masa yang belum
 * berjalan hampir selalu salah ketik tahun, jadi ditolak.
 */
export function periksaSetoran(isian: IsianSetoran, hariIni: string): { ok: true; setoran: SetoranSah } | { ok: false; galat: GalatSetoran } {
  const jenis = bacaJenisSetoran(isian.jenis);
  if (!jenis) return { ok: false, galat: "JENIS_TIDAK_SAH" };
  const masa = bacaMasaPajak(isian.masa);
  if (!masa) return { ok: false, galat: "MASA_TIDAK_SAH" };
  const jumlah = typeof isian.jumlah === "string" ? Number(isian.jumlah.replace(/[^\d.-]/g, "")) : Number(isian.jumlah);
  if (!Number.isFinite(jumlah) || jumlah <= 0 || !Number.isInteger(jumlah) || jumlah > 1e15) return { ok: false, galat: "JUMLAH_TIDAK_SAH" };
  const tanggal = typeof isian.tanggalBayar === "string" ? isian.tanggalBayar.trim() : "";
  if (!POLA_TANGGAL.test(tanggal) || Number.isNaN(new Date(`${tanggal}T00:00:00+07:00`).getTime())) return { ok: false, galat: "TANGGAL_TIDAK_SAH" };
  if (tanggal > hariIni) return { ok: false, galat: "TANGGAL_DEPAN" };
  if (masa > tanggal.slice(0, 7)) return { ok: false, galat: "MASA_TIDAK_SAH" };
  const ntpn = rapikanNtpn(isian.ntpn);
  if (!ntpn) return { ok: false, galat: "NTPN_TIDAK_SAH" };
  const billing = rapikanKodeBilling(isian.kodeBilling);
  if (billing === false) return { ok: false, galat: "BILLING_TIDAK_SAH" };
  const catatan = typeof isian.catatan === "string" && isian.catatan.trim() ? isian.catatan.trim() : null;
  if (catatan && catatan.length > 500) return { ok: false, galat: "CATATAN_PANJANG" };
  const rekeningId = typeof isian.rekeningId === "string" && isian.rekeningId.trim() ? isian.rekeningId.trim() : null;
  return { ok: true, setoran: { jenis, masa, jumlah, tanggalBayar: tanggal, ntpn, kodeBilling: billing, rekeningId, catatan } };
}

/** Peran / akun baris jurnal setoran. `rekening` = id akun bank pilihan, atau null → peran BANK. */
export function barisSetoran(s: { jenis: JenisSetoran; jumlah: number }): { debit: PostingRole; nilai: number } {
  return { debit: INFO_SETORAN[s.jenis].peranDebit, nilai: s.jumlah };
}
