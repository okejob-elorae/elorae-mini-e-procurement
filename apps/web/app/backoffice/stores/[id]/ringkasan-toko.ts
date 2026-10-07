/**
 * Bantu tampil rincian toko — murni, supaya server dan peramban menulis sama.
 */

/** Titik ribuan + koma desimal tanpa `Intl` (keluaran server dan peramban harus sama). */
function angkaId(n: number, desimal: number): string {
  const [bulat, pecahan] = n.toFixed(desimal).split(".");
  const ribuan = bulat.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return pecahan && Number(pecahan) !== 0 ? `${ribuan},${pecahan}` : ribuan;
}

/** Jarak check-in dari titik toko: meter di bawah 1 km, selebihnya km satu desimal. */
export function formatJarak(meter: number): string {
  if (meter < 1000) return `${Math.round(meter)} m`;
  return `${angkaId(meter / 1000, 1)} km`;
}

export type BatasBerlaku =
  | { sumber: "TOKO"; nilai: number }
  | { sumber: "BAWAAN"; nilai: number }
  | { sumber: "TANPA"; nilai: null };

/**
 * Batas kredit / faktur terbuka yang berlaku untuk toko: milik toko menimpa
 * bawaan Pengaturan → Salesman; kosong ikut bawaan; 0 adalah batas sah.
 * Aturan yang sama dengan `nilaiKredit` (`lib/salesman/kredit.ts`).
 */
export function batasBerlaku(milikToko: number | null | undefined, bawaan: number | null | undefined): BatasBerlaku {
  if (milikToko !== null && milikToko !== undefined) return { sumber: "TOKO", nilai: milikToko };
  if (bawaan !== null && bawaan !== undefined) return { sumber: "BAWAAN", nilai: bawaan };
  return { sumber: "TANPA", nilai: null };
}
