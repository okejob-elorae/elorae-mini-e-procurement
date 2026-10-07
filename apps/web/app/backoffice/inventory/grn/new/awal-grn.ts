/**
 * Isi awal formulir GRN saat dibuka:
 * - `po`: pakai PO dari `?poId=` (tombol "Terima barang" di rincian PO);
 * - `draf`: pulihkan draf di perangkat;
 * - `konflik`: ada draf berisi untuk PO lain — draf dipulihkan dan pengguna
 *   diberi pilihan membuangnya untuk menerima PO dari tautan;
 * - `kosong`: formulir baru.
 */
export function awalFormulirGrn(
  poIdAwal: string,
  draf: { poId: string; bermakna: boolean } | null,
): "po" | "draf" | "konflik" | "kosong" {
  if (!poIdAwal) return draf ? "draf" : "kosong";
  if (!draf) return "po";
  if (draf.poId === poIdAwal) return "draf";
  if (!draf.bermakna) return "po";
  return "konflik";
}
