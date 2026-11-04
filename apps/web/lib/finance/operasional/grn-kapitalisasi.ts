import { ppnBerlaku, type PengaturanPpn } from "@/lib/finance/pajak/ppn";

/*
 * PPN pembelian yang DIKAPITALISASI ke nilai persediaan saat Elorae BUKAN PKP
 * (status NON_PKP atau BELUM_DITETAPKAN, atau sebelum `berlakuSejak`) — MURNI.
 *
 * Baris PO "Exclude PPN" berarti pemasok menagih PPN DI ATAS harga. Pembeli
 * PKP mengkreditkannya (`PPN_MASUKAN`, `lib/finance/pajak/grn-ppn.ts`);
 * pembeli bukan PKP TIDAK bisa, jadi PPN itu bagian dari harga perolehan
 * barang: masuk kartu stok (harga rata-rata) dan hutang ke pemasok bruto.
 * Dulu PPN ini hilang dari keduanya — hutang lebih kecil dari tagihan pemasok
 * dan persediaan lebih murah dari yang dibayar.
 *
 * PPN dihitung SAMA dengan PO-nya (`hitungTotalPo`): tarif PO atas Σ nilai
 * baris "Exclude PPN", dibulatkan ke bawah ke rupiah, lalu dibagi ke baris
 * sebanding nilainya (sisa sen terbesar) — jadi GRN yang menerima seluruh PO
 * berhutang persis sebesar total PO, dan kredit retur pemasok
 * (`hitungKreditRetur`, rumus yang sama) membalik angka yang sama.
 */

export type BarisGrnKapitalisasi = { itemId: string; variantSku?: string | null; nilai: number };
export type BarisPoKapitalisasi = { itemId: string; variantSku?: string | null; ppnIncluded: boolean };

const kunci = (itemId: string, varian?: string | null) => `${itemId}\t${varian?.trim() ?? ""}`;
const keSen = (n: number): number => Math.round(Number(((Number.isFinite(n) ? n : 0) * 100).toFixed(4)));

/** PPN yang ditambahkan ke nilai tiap baris GRN (rupiah), urutan sama dengan `baris`. Semua nol bila tidak berlaku. */
export function ppnKapitalisasiGrn(input: {
  baris: readonly BarisGrnKapitalisasi[];
  barisPo: readonly BarisPoKapitalisasi[] | null;
  tarifPo: number | null;
  pengaturan: PengaturanPpn;
  tanggal: Date;
}): number[] {
  const nol = input.baris.map(() => 0);
  if (!input.barisPo || input.tarifPo == null || !(input.tarifPo > 0)) return nol;
  // PKP: PPN-nya dikreditkan sebagai PPN masukan, bukan biaya.
  if (ppnBerlaku(input.pengaturan, input.tanggal)) return nol;
  const eksklusif = new Set(input.barisPo.filter((b) => !b.ppnIncluded).map((b) => kunci(b.itemId, b.variantSku)));
  const nilaiSen = input.baris.map((b) => (eksklusif.has(kunci(b.itemId, b.variantSku)) ? Math.max(0, keSen(b.nilai)) : 0));
  const dasarSen = nilaiSen.reduce((s, x) => s + x, 0);
  if (dasarSen <= 0) return nol;
  // Sama dengan `hitungTotalPo`: dasar × tarif / 100, ke bawah ke rupiah penuh.
  const ppnSen = Math.floor((dasarSen * input.tarifPo) / 100 / 100) * 100;
  if (ppnSen <= 0) return nol;
  // Bagi sebanding nilai baris, sisa sen ke pecahan terbesar.
  const mentah = nilaiSen.map((n) => (n * ppnSen) / dasarSen);
  const bulat = mentah.map((m) => Math.floor(m));
  let sisa = ppnSen - bulat.reduce((s, x) => s + x, 0);
  const urut = mentah.map((m, i) => ({ i, pecahan: m - Math.floor(m) })).sort((a, b) => b.pecahan - a.pecahan || a.i - b.i);
  for (const u of urut) {
    if (sisa <= 0) break;
    if (nilaiSen[u.i] === 0) continue;
    bulat[u.i] += 1;
    sisa -= 1;
  }
  return bulat.map((s) => s / 100);
}
