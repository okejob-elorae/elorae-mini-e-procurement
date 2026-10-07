/*
 * Pulau status — pemancar kecil di atas keadaan murni (`keadaan.ts`).
 *
 * Dipanggil dari mana saja di peramban (komponen, jembatan toast, pemantau
 * sinyal); `PulauStatus` berlangganan lewat `useSyncExternalStore`. Satu
 * pengatur waktu saja yang hidup: diarahkan ke kedaluwarsa terdekat dan
 * dijadwalkan ulang setiap kali keadaannya berubah.
 *
 * Tidak menarik React, jadi aman diimpor dari modul mana pun.
 */
import {
  aturLuring,
  gagalProses as gagalProsesMurni,
  kabarNotifikasi as kabarNotifikasiMurni,
  kedaluwarsaBerikutnya,
  keadaanAwal,
  mulaiProses as mulaiProsesMurni,
  perbaruiProses as perbaruiProsesMurni,
  rapikan,
  selesaiProses as selesaiProsesMurni,
  tambahPesan,
  tutupPesan as tutupPesanMurni,
  tutupTampilan,
  type ButirTampilan,
  type KeadaanPulau,
  type MasukanLuring,
  type MasukanNotifikasi,
  type MasukanPesan,
} from "./keadaan";

let keadaan: KeadaanPulau = keadaanAwal();
let pengatur: ReturnType<typeof setTimeout> | null = null;
let nomor = 0;
const pendengar = new Set<() => void>();

function jadwalkan() {
  if (pengatur !== null) {
    clearTimeout(pengatur);
    pengatur = null;
  }
  const waktu = kedaluwarsaBerikutnya(keadaan);
  if (waktu === null) return;
  pengatur = setTimeout(() => {
    pengatur = null;
    ubah((k) => k);
  }, Math.max(0, waktu - Date.now()));
}

function ubah(f: (k: KeadaanPulau, sekarang: number) => KeadaanPulau) {
  const sekarang = Date.now();
  const baru = rapikan(f(keadaan, sekarang), sekarang);
  if (baru === keadaan) {
    jadwalkan();
    return;
  }
  keadaan = baru;
  jadwalkan();
  for (const p of [...pendengar]) p();
}

/** Berlangganan perubahan; mengembalikan fungsi berhenti. */
export function langgan(p: () => void): () => void {
  pendengar.add(p);
  return () => {
    pendengar.delete(p);
  };
}

/** Keadaan saat ini — objek yang sama selama tidak ada yang berubah. */
export function ambilKeadaan(): KeadaanPulau {
  return keadaan;
}

const KEADAAN_SERVER = keadaanAwal();
/** Snapshot untuk render server: selalu diam. */
export function ambilKeadaanServer(): KeadaanPulau {
  return KEADAAN_SERVER;
}

/** Tampilkan pesan (sukses, galat, info, peringatan, memuat, biasa). Mengembalikan id-nya. */
export function tampilkanPesan(m: MasukanPesan): string {
  const id = m.id ?? `pesan-auto-${++nomor}`;
  ubah((k, sekarang) => tambahPesan(k, { ...m, id }, sekarang));
  return id;
}

export function tutupPesan(id: string): void {
  ubah((k) => tutupPesanMurni(k, id));
}

/** Proses panjang (impor, sinkron). Id yang sama hanya memperbarui labelnya. */
export function mulaiProses(id: string, label: string): void {
  ubah((k) => mulaiProsesMurni(k, id, label));
}

/** Persen NYATA (0–100), atau null bila tidak diketahui. */
export function perbaruiProses(id: string, persen: number | null, label?: string): void {
  ubah((k) => perbaruiProsesMurni(k, id, persen, label));
}

/** Tanpa `teks` prosesnya hilang diam-diam (mis. layar ditinggalkan). */
export function selesaiProses(id: string, teks?: string): void {
  ubah((k, sekarang) => selesaiProsesMurni(k, id, teks, sekarang));
}

export function gagalProses(id: string, teks: string): void {
  ubah((k, sekarang) => gagalProsesMurni(k, id, teks, sekarang));
}

export function kabarNotifikasi(m: MasukanNotifikasi): void {
  ubah((k, sekarang) => kabarNotifikasiMurni(k, m, sekarang));
}

export function setLuring(m: MasukanLuring): void {
  ubah((k, sekarang) => aturLuring(k, m, sekarang));
}

/** Pengguna mengetuk kapsul untuk menutup yang sedang tampil. */
export function tutupButir(butir: ButirTampilan): void {
  ubah((k) => tutupTampilan(k, butir));
}

/** Hanya untuk tes: kembali ke keadaan awal tanpa pendengar dan pengatur waktu. */
export function _aturUlangPulau(): void {
  if (pengatur !== null) clearTimeout(pengatur);
  pengatur = null;
  keadaan = keadaanAwal();
  pendengar.clear();
  nomor = 0;
}
