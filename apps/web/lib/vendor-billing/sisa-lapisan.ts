/*
 * Berapa bagian satu penerimaan (GRN, penerimaan barang jadi) yang MASIH ADA di sebuah lokasi stok —
 * untuk menaikkan atau menurunkan HPP sisa stoknya saat selisih harga invoice diterima (keputusan
 * pemilik 2026-11-02, P49: "stok tersisa ikut naik; yang sudah terjual tidak bisa dikoreksi").
 *
 * Mengikuti harga rata-rata bergerak yang dipakai sistem hari ini: setiap barang keluar mengambil
 * rata-rata seluruh stok, jadi setiap lapisan penerimaan ikut terambil sebanding. Sesudah entri
 * terakhir penerimaan itu, setiap entri KELUAR (qty < 0) dari saldo B ke saldo B' menyisakan
 * B' ÷ B dari lapisannya; begitu saldo habis (≤ 0), lapisannya habis. Entri masuk (qty > 0) dan
 * penilaian ulang (qty 0) tidak mengubah bagiannya — lapisan lain ikut bercampur, tetapi potongan
 * lapisan ini tidak berkurang.
 *
 * Barang yang keluar dari Gudang Utama ke Gudang Toko konsinyasi atau ke van kanvas masih milik
 * Elorae (keputusan pemilik 2026-11-01, Q1: "barang yang dikirim ke toko masuk gudang toko itu
 * (masih milik Elorae)"). Bagiannya DIBAWA ke lokasi tujuan (`lacakLapisan` dengan `bawa`), lalu
 * di sana dikurangi lagi oleh keluarnya barang dari lokasi itu dengan aturan yang sama.
 *
 * Murni, tanpa impor; diuji di `sisa-lapisan.test.ts`.
 */

export type EntriLapisan = { qty: number; balanceQty: number; refType: string; refId: string };

/** Bagian (0..1) lapisan yang tersisa sesudah entri-entri ini, urut waktu. */
export function sisaLapisan(entri: ReadonlyArray<{ qty: number; balanceQty: number }>): number {
  let r = 1;
  for (const e of entri) {
    if (!(e.qty < 0)) continue;
    const sebelum = e.balanceQty - e.qty;
    if (sebelum <= 0 || e.balanceQty <= 0) return 0;
    r *= e.balanceQty / sebelum;
  }
  return Math.max(0, Math.min(1, r));
}

/**
 * Seperti `sisaLapisan`, tetapi entri keluar yang `bawa`-nya benar tidak hilang: bagian lapisan yang
 * ikut keluar (bagian sebelum × qty keluar ÷ saldo sebelum) dicatat bersama entrinya, supaya
 * pemanggil melanjutkannya di lokasi tujuan. Bagian lain yang keluar (terjual, terpakai, rusak,
 * diretur) hilang dari perhitungan.
 */
export function lacakLapisan(
  entri: readonly EntriLapisan[],
  bawa: (e: EntriLapisan) => boolean,
): { sisa: number; dibawa: Array<{ refType: string; refId: string; porsi: number }> } {
  let r = 1;
  const dibawa: Array<{ refType: string; refId: string; porsi: number }> = [];
  for (const e of entri) {
    if (!(e.qty < 0)) continue;
    const sebelum = e.balanceQty - e.qty;
    if (sebelum <= 0 || r <= 0) {
      r = 0;
      break;
    }
    const keluar = (r * -e.qty) / sebelum;
    if (bawa(e) && keluar > 0) dibawa.push({ refType: e.refType, refId: e.refId, porsi: Math.min(r, keluar) });
    if (e.balanceQty <= 0) {
      r = 0;
      break;
    }
    r *= e.balanceQty / sebelum;
  }
  return { sisa: Math.max(0, Math.min(1, r)), dibawa };
}

/**
 * Bagian (dalam sen, bertanda sama dengan `nilaiSen`) untuk setiap lokasi menurut porsinya, lalu sisa
 * untuk "sudah keluar". Σ bagian lokasi tidak pernah melebihi |nilaiSen|.
 */
export function bagiNilaiPerLokasi(nilaiSen: number, porsi: readonly number[]): { lokasi: number[]; keluar: number } {
  const tanda = nilaiSen < 0 ? -1 : 1;
  const mutlak = Math.abs(Math.round(nilaiSen));
  const bagian = porsi.map((p) => Math.max(0, Math.round(mutlak * Math.max(0, Math.min(1, p)))));
  let lebih = bagian.reduce((s, b) => s + b, 0) - mutlak;
  for (let i = bagian.length - 1; lebih > 0 && i >= 0; i--) {
    const kurang = Math.min(lebih, bagian[i]);
    bagian[i] -= kurang;
    lebih -= kurang;
  }
  const keluar = mutlak - bagian.reduce((s, b) => s + b, 0);
  return { lokasi: bagian.map((b) => tanda * b), keluar: tanda * keluar };
}
