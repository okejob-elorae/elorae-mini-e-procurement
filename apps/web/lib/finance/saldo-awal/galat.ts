/*
 * Kode penolakan saldo awal dan templat bagan akun — murni, aman untuk klien.
 * Setiap kode punya pesan `saldoAwal.galat.<KODE>` di kedua bahasa
 * (`galat.test.ts`). Pesan boleh memakai {baris}, {peran}, {periode}, {rincian}.
 */

export const KODE_GALAT_SALDO_AWAL = [
  // isian (validasi.ts)
  "ISIAN_TIDAK_SAH",
  "ANGKA_TIDAK_SAH",
  "TERLALU_BANYAK",
  "AKUN_GANDA",
  "BARANG_GANDA",
  "KANAL_GANDA",
  "PEMASOK_GANDA",
  "KANAL_TIDAK_SAH",
  // penulis (writer.ts)
  "TANPA_TANGGAL_MULAI",
  "PERIODE_TERTUTUP",
  "PERAN_BELUM_DIPETAKAN",
  "AKUN_TIDAK_SAH",
  "AKUN_MILIK_JENIS_LAIN",
  "BARANG_TIDAK_DIKENAL",
  "PEMASOK_TIDAK_DIKENAL",
  "ALASAN_KOREKSI_WAJIB",
  "CATATAN_TERLALU_PANJANG",
  "AKUN_TIDAK_BISA_DIPOSTING",
  "TANPA_DRAF",
  // aksi
  "TANPA_AKSES",
  "BENTROK",
  "GAGAL",
] as const;

export type KodeGalatSaldoAwalLengkap = (typeof KODE_GALAT_SALDO_AWAL)[number];

/** Kunci pesan untuk sebuah kode; kode tak dikenal jatuh ke pesan umum. */
export function kunciGalatSaldoAwal(kode: string): `galat.${KodeGalatSaldoAwalLengkap}` {
  return (KODE_GALAT_SALDO_AWAL as readonly string[]).includes(kode) ? (`galat.${kode}` as `galat.${KodeGalatSaldoAwalLengkap}`) : "galat.GAGAL";
}

export type NilaiGalat = { baris?: number; peran?: string; periode?: string; rincian?: string };

/** Nilai sisipan pesan — selalu lengkap, supaya pesan yang memakai {x} tidak pernah menampilkan kurung kurawal. */
export function nilaiGalat(g: NilaiGalat): Record<string, string | number> {
  return { baris: g.baris ?? "-", peran: g.peran ?? "-", periode: g.periode ?? "-", rincian: g.rincian ?? "-" };
}
