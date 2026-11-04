/**
 * Kolom "Selisih retur" di laporan komisi salesman — aturan murni, tanpa basis data, aman diimpor
 * komponen klien.
 *
 * Selisih retur yang dibebankan ke SALES (P22) dipotong dari komisinya: kantor menandai berapa yang
 * dipotong bulan itu (`tandaiBebanReturDipotong`), dan potongan yang ternyata melebihi besarnya
 * sekarang karena barangnya ketemu dikembalikan (P87, `tandaiKelebihanReturDikembalikan`). Angka di
 * sini dibaca persis dari yang ditulis kedua penulis itu (`lib/receivables/potong-beban-retur.ts`):
 * - sisa dan kelebihan dihitung atas beban SALES orang itu yang DITETAPKAN atau LUNAS — himpunan yang
 *   sama yang dipakai penulisnya untuk menolak `MELEBIHI_SISA` / `MELEBIHI_KELEBIHAN`, jadi saran di
 *   layar tidak pernah lebih dari yang diterima penulis;
 * - potongan bulan ini = baris `ReturnChargeDeduction` ber-`refId` `<sales>:<bulan>:<kunci>` (positif);
 *   pengembalian bulan ini = yang ber-`refId` `kembali:<sales>:<bulan>:<kunci>` (negatif di tabel,
 *   ditampilkan positif).
 */

export type PotonganReturSales = {
  /** Beban yang masih harus dipotong (besar − sudah dipotong), semua bulan. */
  sisa: number;
  /** Yang ditandai dipotong dari komisi bulan laporan. */
  dipotongBulanIni: number;
  /** Potongan yang melebihi besar bebannya sekarang — dikembalikan ke sales (P87). */
  kelebihan: number;
  /** Yang ditandai dikembalikan bersama komisi bulan laporan. */
  dikembalikanBulanIni: number;
};

/** Awalan `refId` potongan seorang sales untuk satu bulan — sama dengan penulisnya. */
export const awalanPotongRetur = (salesmanId: string, bulan: string) => `${salesmanId}:${bulan}:`;

/** Awalan `refId` pengembalian kelebihan potongan seorang sales untuk satu bulan — sama dengan penulisnya. */
export const awalanKembaliRetur = (salesmanId: string, bulan: string) => `kembali:${salesmanId}:${bulan}:`;

const keSen = (n: number) => Math.round(n * 100);

/**
 * Ringkasan per sales. Setiap id yang diminta mendapat baris (nol semua bila tidak punya beban), supaya
 * layar dan Excel membaca satu bentuk.
 */
export function ringkasPotonganRetur(m: {
  salesmanIds: readonly string[];
  bulan: string;
  /** Beban SALES yang DITETAPKAN atau LUNAS milik para sales ini. */
  beban: ReadonlyArray<{ bearerUserId: string | null; amount: number; settledAmount: number }>;
  /** Baris potongan komisi salesman (`refType` `KomisiSalesman`) yang mungkin milik bulan ini. */
  potongan: ReadonlyArray<{ refId: string; amount: number }>;
}): Record<string, PotonganReturSales> {
  const hasil: Record<string, PotonganReturSales> = {};
  for (const id of new Set(m.salesmanIds)) {
    let sisaSen = 0;
    let lebihSen = 0;
    for (const b of m.beban) {
      if (b.bearerUserId !== id) continue;
      const besar = keSen(b.amount);
      const dipotong = keSen(b.settledAmount);
      sisaSen += Math.max(0, besar - dipotong);
      lebihSen += Math.max(0, dipotong - besar);
    }
    const potong = awalanPotongRetur(id, m.bulan);
    const kembali = awalanKembaliRetur(id, m.bulan);
    let potongSen = 0;
    let kembaliSen = 0;
    for (const p of m.potongan) {
      if (p.refId.startsWith(potong)) potongSen += keSen(p.amount);
      else if (p.refId.startsWith(kembali)) kembaliSen -= keSen(p.amount);
    }
    hasil[id] = {
      sisa: sisaSen / 100,
      dipotongBulanIni: potongSen / 100,
      kelebihan: lebihSen / 100,
      dikembalikanBulanIni: kembaliSen / 100,
    };
  }
  return hasil;
}
