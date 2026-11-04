/**
 * Contoh berkas impor faktur yang bisa diunduh dari layar impor.
 *
 * Judul kolomnya adalah sinonim yang dikenali `lib/receivables/impor/kolom.ts`;
 * angkanya angka polos (tanpa titik ribuan) dan tanggalnya YYYY-MM-DD supaya
 * terbaca sama di Excel mana pun. Baris ketiga menulis sisa 0 = sudah lunas,
 * dilewati saat impor.
 *
 * Nomor faktur, kode, dan nama tokonya sengaja jelas-jelas CONTOH: berkas ini
 * bisa terunggah apa adanya, dan nomor yang mirip faktur sungguhan (atau kode
 * toko yang kebetulan ada) akan menjadi piutang palsu sesudah "Simpan".
 */
export const NAMA_BERKAS_CONTOH = "contoh-impor-faktur-elorae.csv";

export const CONTOH_BERKAS_IMPOR = [
  "No Faktur,Kode Toko,Nama Toko,Tanggal Faktur,Jatuh Tempo,Nilai,Sisa,Sales",
  "CONTOH/0001,CONTOH-A,Toko Contoh A,2026-08-01,2026-08-31,9400000,9400000,Nama Sales",
  "CONTOH/0002,CONTOH-B,Toko Contoh B,2026-08-05,2026-09-04,4250000,1250000,Nama Sales",
  "CONTOH/0003,CONTOH-A,Toko Contoh A,2026-08-10,2026-09-09,2500000,0,Nama Sales",
].join("\n");
