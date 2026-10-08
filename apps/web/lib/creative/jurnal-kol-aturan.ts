/**
 * Jurnal Ruang KOL — aturan murni (tanpa Prisma). Penulisnya `jurnal-kol.ts`.
 *
 * Empat sumber jurnal, semuanya lewat seam jurnal otomatis yang sama dengan
 * modul lain (`generateAutoJournal` / `postJournal`), idempoten per
 * (sourceType, sourceId):
 *
 * - `KOL_FEE` `<kolaborasi>#<n>` — pengakuan fee saat kolaborasi mencapai
 *   TAYANG ("fee diakui saat tayang"): DR Beban KOL / CR Hutang KOL sebesar
 *   bruto termin hidup, plus reklasifikasi uang muka (termin yang dibayar
 *   sebelum tayang): DR Hutang KOL / CR Uang muka KOL. Jurnal ke-n berikutnya
 *   hanya SELISIH — fee berubah sesudah tayang, kolaborasi dimundurkan, atau
 *   pembayaran dibatalkan — supaya buku selalu sama dengan keadaan sekarang.
 * - `KOL_PAYMENT` `<kolaborasi>#<termin>#<bayarKe>` — pembayaran termin:
 *   DR Uang muka KOL (belum tayang) atau Hutang KOL (sudah tayang) sebesar
 *   bruto / CR Bank neto / CR Hutang PPh 21 atau 23 sebesar PPh.
 * - `KOL_PAYMENT_REVERSAL` (id yang sama dengan pembayarannya) — cermin baris
 *   jurnal pembayaran, akun yang sama, tanggal yang sama.
 * - `KOL_SAMPLE` `<pengiriman>` — sampel berangkat: DR Beban KOL / CR
 *   Persediaan sebesar Σ HPP × qty. Barang jadi keluar dari `INVENTORY_FG`
 *   (tempat penerimaan barang jadi memasukkannya), selain itu `INVENTORY` —
 *   lewat `peranPersediaan` yang sama dengan jurnal HPP lain.
 *
 * Setiap baris membawa `memo` = nama perannya. Saldo yang "sudah dibukukan"
 * per kolaborasi dihitung dari memo itu, bukan dari akun — pemetaan akun boleh
 * berubah tanpa membuat selisihnya salah. Satu pengecualian: baris PPN
 * keluaran sampel bermemo `DPP <angka>` (`memoDpp`) — rekap masa PPN membaca
 * DPP dari memo itu, dan tidak ada saldo KOL yang dihitung dari baris PPN.
 *
 * Semua baris jurnal KOL membawa kanal `KOL` (dimensi laba per kanal) —
 * dipasang penulisnya (`jurnal-kol.ts`), bukan di aturan ini.
 *
 * Sampel berangkat ketika status PKP (`pajak.ppn`) = PKP: pemberian
 * cuma-cuma terutang PPN keluaran (PMK 11/2025, DPP nilai lain 11/12 × HPP)
 * yang ditanggung Elorae — DR Beban KOL (HPP + PPN) / CR Persediaan HPP / CR
 * `PPN_KELUARAN` PPN. Bukan PKP (bawaan): tanpa baris PPN, seperti dulu.
 */

import { nilaiPerPeranPersediaan } from "@/lib/finance/journals/peran-persediaan";
import { memoDpp } from "@/lib/finance/pajak/jurnal-ppn";

export const SUMBER_KOL = {
  FEE: "KOL_FEE",
  BAYAR: "KOL_PAYMENT",
  BALIK: "KOL_PAYMENT_REVERSAL",
  SAMPEL: "KOL_SAMPLE",
} as const;

export const SEMUA_SUMBER_KOL: readonly string[] = Object.values(SUMBER_KOL);

export type PeranKol =
  | "KOL_EXPENSE"
  | "KOL_PAYABLE"
  | "KOL_PREPAID"
  | "PPH21_PAYABLE"
  | "PPH23_PAYABLE"
  | "BANK"
  | "INVENTORY"
  | "INVENTORY_FG"
  | "PPN_KELUARAN";

/** `memo` = nama peran, kecuali baris PPN keluaran sampel (`DPP <angka>`). */
export type BarisJurnalKol = { role: PeranKol; debit: number; credit: number; memo: string };

const dariSen = (s: number) => s / 100;
const keSen = (n: number): number => Math.round(Number(((Number.isFinite(n) ? n : 0) * 100).toFixed(4)));

export const idFee = (kolaborasiId: string, ke: number) => `${kolaborasiId}#${ke}`;
export const idBayar = (kolaborasiId: string, terminId: string, bayarKe: number) => `${kolaborasiId}#${terminId}#${bayarKe}`;
/** Id kolaborasi dari sourceId jurnal KOL (fee/bayar/balik); sampel memakai id pengirimannya. */
export const kolaborasiDariSumber = (sourceId: string) => sourceId.split("#")[0] ?? sourceId;

/** Pasangan debit/kredit untuk nilai bertanda (sen): positif → A debit; negatif → B debit. */
function pasangan(a: PeranKol, b: PeranKol, sen: number): BarisJurnalKol[] {
  if (sen === 0) return [];
  const n = dariSen(Math.abs(sen));
  return sen > 0
    ? [
        { role: a, debit: n, credit: 0, memo: a },
        { role: b, debit: 0, credit: n, memo: b },
      ]
    : [
        { role: b, debit: n, credit: 0, memo: b },
        { role: a, debit: 0, credit: n, memo: a },
      ];
}

export type KeadaanBuku = {
  /** Σ memo KOL_EXPENSE (debit − kredit) di jurnal KOL_FEE kolaborasi ini. */
  bebanSen: number;
  /** Σ memo KOL_PREPAID (debit − kredit) di semua jurnal kolaborasi ini. */
  uangMukaSen: number;
  /** Σ memo KOL_PREPAID + KOL_PAYABLE (debit − kredit) di jurnal pembayaran & pembaliknya. */
  dibayarBukuSen: number;
};

/**
 * Selisih yang harus dibukukan supaya buku sama dengan keadaan sekarang.
 * - Beban: diakui → Σ bruto termin hidup; belum/tidak lagi diakui → 0.
 * - Uang muka: diakui → 0 (semua sudah jadi pengurang hutang); belum diakui →
 *   sebesar yang dibayar menurut buku.
 */
export function selisihPengakuan(input: { diakui: boolean; brutoHidupSen: number; buku: KeadaanBuku }): { bebanSen: number; uangMukaSen: number } {
  const targetBeban = input.diakui ? input.brutoHidupSen : 0;
  const targetUangMuka = input.diakui ? 0 : input.buku.dibayarBukuSen;
  return { bebanSen: targetBeban - input.buku.bebanSen, uangMukaSen: targetUangMuka - input.buku.uangMukaSen };
}

/** Baris jurnal KOL_FEE dari selisihnya; kosong bila tidak ada yang berubah. */
export function barisPengakuan(selisih: { bebanSen: number; uangMukaSen: number }): BarisJurnalKol[] {
  return [...pasangan("KOL_EXPENSE", "KOL_PAYABLE", selisih.bebanSen), ...pasangan("KOL_PREPAID", "KOL_PAYABLE", selisih.uangMukaSen)];
}

/** Baris jurnal pembayaran satu termin. */
export function barisPembayaran(t: { bruto: number; pph: number; neto: number; pasal: "21" | "23" | null }, diakui: boolean): BarisJurnalKol[] {
  const sisi: PeranKol = diakui ? "KOL_PAYABLE" : "KOL_PREPAID";
  const baris: BarisJurnalKol[] = [];
  const bruto = dariSen(keSen(t.bruto));
  const neto = dariSen(keSen(t.neto));
  const pph = dariSen(keSen(t.pph));
  if (bruto > 0) baris.push({ role: sisi, debit: bruto, credit: 0, memo: sisi });
  if (neto > 0) baris.push({ role: "BANK", debit: 0, credit: neto, memo: "BANK" });
  if (pph > 0) {
    const peranPph: PeranKol = t.pasal === "23" ? "PPH23_PAYABLE" : "PPH21_PAYABLE";
    baris.push({ role: peranPph, debit: 0, credit: pph, memo: peranPph });
  }
  return baris;
}

const senBaris = (b: { qty: number; unitCost: number }) => Math.round(keSen(b.unitCost) * (Number.isFinite(b.qty) ? b.qty : 0));

/** Σ HPP × qty baris pengiriman, aman-sen. */
export function nilaiSampel(baris: readonly { qty: number; unitCost: number }[]): number {
  return dariSen(baris.reduce((s, b) => s + senBaris(b), 0));
}

/**
 * Baris jurnal sampel berangkat: DR Beban KOL sebesar total, CR persediaan per
 * peran (`INVENTORY_FG` untuk barang jadi, `INVENTORY` selain itu).
 *
 * `ppn` (opsional, dari `ppnPemberianCumaCuma`): PPN keluaran pemberian
 * cuma-cuma yang ditanggung Elorae — ikut beban, CR `PPN_KELUARAN` bermemo DPP.
 */
export function barisSampel(
  baris: readonly { qty: number; unitCost: number; tipeBarang: string | null | undefined }[],
  ppn?: { ppn: number; dpp: number },
): BarisJurnalKol[] {
  const kelompok = nilaiPerPeranPersediaan(baris.map((b) => ({ tipeBarang: b.tipeBarang, nilai: dariSen(senBaris(b)) })));
  const totalSen = kelompok.reduce((s, k) => s + keSen(k.nilai), 0);
  if (totalSen <= 0) return [];
  const ppnSen = ppn ? Math.max(0, keSen(ppn.ppn)) : 0;
  return [
    { role: "KOL_EXPENSE", debit: dariSen(totalSen + ppnSen), credit: 0, memo: "KOL_EXPENSE" },
    ...kelompok.filter((k) => keSen(k.nilai) > 0).map((k) => ({ role: k.role, debit: 0, credit: k.nilai, memo: k.role }) as BarisJurnalKol),
    ...(ppnSen > 0 && ppn ? [{ role: "PPN_KELUARAN" as const, debit: 0, credit: dariSen(ppnSen), memo: memoDpp(ppn.dpp) }] : []),
  ];
}

type BarisBuku = { memo: string | null; debit: number; credit: number };

/** Keadaan buku satu kolaborasi dari baris jurnal-jurnalnya (per sourceType). */
export function bacaKeadaanBuku(jurnal: readonly { sourceType: string | null; lines: readonly BarisBuku[] }[]): KeadaanBuku {
  let beban = 0;
  let uangMuka = 0;
  let dibayar = 0;
  for (const j of jurnal) {
    for (const l of j.lines) {
      const neto = keSen(l.debit) - keSen(l.credit);
      if (l.memo === "KOL_EXPENSE" && j.sourceType === SUMBER_KOL.FEE) beban += neto;
      if (l.memo === "KOL_PREPAID") uangMuka += neto;
      if ((l.memo === "KOL_PREPAID" || l.memo === "KOL_PAYABLE") && (j.sourceType === SUMBER_KOL.BAYAR || j.sourceType === SUMBER_KOL.BALIK)) dibayar += neto;
    }
  }
  return { bebanSen: beban, uangMukaSen: uangMuka, dibayarBukuSen: dibayar };
}

/** Pasal PPh termin dari subjek pajaknya. */
export function pasalDariJenis(jenis: string): "21" | "23" | null {
  return jenis === "ORANG_PRIBADI" ? "21" : jenis === "BADAN" ? "23" : null;
}
