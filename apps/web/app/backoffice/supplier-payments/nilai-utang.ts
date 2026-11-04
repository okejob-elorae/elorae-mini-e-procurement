/*
 * Angka utang untuk register pembayaran pemasok. `listPOs` sudah menghitung
 * `utang` per baris (total PO − sisa yang tidak akan datang karena "Tutup PO"
 * − kredit retur pemasok, lihat `lib/purchase-orders/utang.ts`); register
 * memakai angka itu, bukan total PO penuh. Baris tanpa `utang` jatuh ke total PO.
 * Tampilan saja — jurnal pembayaran pemasok tetap membaca GL.
 */

import { hitungTotalPo } from "@/lib/purchase-orders/ppn";

type Angka = number | string | { toString(): string } | null | undefined;

function angka(v: Angka): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : 0;
}

export function utangBaris(po: { grandTotal: Angka; utang?: { utang: Angka } | null }): number {
  return po.utang ? angka(po.utang.utang) : angka(po.grandTotal);
}

/** Σ utang PO yang belum dibayar, dijumlah dalam sen supaya tidak tersisa pecahan floating-point. */
export function totalUtangBelumDibayar(rows: ReadonlyArray<{ paidAt: Date | null; utang: number }>): number {
  const sen = rows.filter((r) => !r.paidAt).reduce((s, r) => s + Math.round(r.utang * 100), 0);
  return sen / 100;
}

/**
 * Pisahkan nilai PO yang belum dibayar menjadi:
 * - `utangDiterima`: barang yang SUDAH diterima, dihargai dengan harga PO (PPN
 *   baris "Exclude PPN" ikut, rumus `hitungTotalPo`), dikurangi kredit retur
 *   pemasok — inilah utang sebenarnya;
 * - `komitmen`: sisa nilai PO yang barangnya belum datang (`utang − utangDiterima`).
 * Tampilan saja; GL tetap membaca jurnal GRN.
 */
export function pisahUtangPo(po: {
  grandTotal: Angka;
  ppnRatePercent: number | null;
  utang?: { utang: Angka; kreditRetur?: Angka } | null;
  items: ReadonlyArray<{ qty: Angka; receivedQty: Angka; price: Angka; ppnIncluded: boolean }>;
}): { utangDiterima: number; komitmen: number } {
  const utang = utangBaris(po);
  const diterima = po.items
    .map((l) => ({ qty: angka(l.receivedQty), price: angka(l.price), ppnIncluded: l.ppnIncluded }))
    .filter((l) => l.qty > 0);
  let nilaiDiterima = 0;
  try {
    nilaiDiterima = hitungTotalPo(diterima, po.ppnRatePercent).grandTotal;
  } catch {
    // Tarif PPN tersimpan tidak sah: hitung tanpa PPN daripada gagal menampilkan.
    nilaiDiterima = hitungTotalPo(diterima, null).grandTotal;
  }
  const kredit = Math.max(angka(po.utang?.kreditRetur), 0);
  const utangDiterimaSen = Math.max(Math.round(nilaiDiterima * 100) - Math.round(kredit * 100), 0);
  const komitmenSen = Math.max(Math.round(utang * 100) - utangDiterimaSen, 0);
  return { utangDiterima: utangDiterimaSen / 100, komitmen: komitmenSen / 100 };
}

/** Kartu register: Σ utang barang diterima dan Σ komitmen PO yang belum dibayar, dalam sen. */
export function ringkasUtangBelumDibayar(
  rows: ReadonlyArray<{ paidAt: Date | null; utangDiterima: number; komitmen: number }>,
): { utangDiterima: number; jumlahPoUtang: number; komitmen: number; jumlahPoKomitmen: number } {
  let utangSen = 0;
  let komitmenSen = 0;
  let jumlahPoUtang = 0;
  let jumlahPoKomitmen = 0;
  for (const r of rows) {
    if (r.paidAt) continue;
    const u = Math.round(r.utangDiterima * 100);
    const k = Math.round(r.komitmen * 100);
    utangSen += u;
    komitmenSen += k;
    if (u > 0) jumlahPoUtang += 1;
    if (k > 0) jumlahPoKomitmen += 1;
  }
  return { utangDiterima: utangSen / 100, jumlahPoUtang, komitmen: komitmenSen / 100, jumlahPoKomitmen };
}
