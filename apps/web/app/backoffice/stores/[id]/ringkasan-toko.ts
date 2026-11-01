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
