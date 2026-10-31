/**
 * Daftar isi Pengaturan → Salesman: kelompok kartu dan jangkarnya. Satu
 * tempat — halaman memasang `id` yang sama (dijaga `daftar-isi.spec.ts`),
 * judulnya memakai kunci i18n judul kartu itu sendiri.
 *
 * Kartu khusus SPG (mutasi antar toko, hari kerja SPG) ada di Pengaturan → SPG;
 * target bulanan SPG tetap di kartu `#target` di sini (daftar isi SPG menautnya).
 */
import type { KelompokDaftarIsi } from "../DaftarIsiPengaturan";

export type { KartuDaftarIsi, KelompokDaftarIsi } from "../DaftarIsiPengaturan";

export const DAFTAR_ISI_SALESMAN: KelompokDaftarIsi[] = [
  {
    id: "kunjungan",
    judul: "settings.salesman.toc.kunjungan",
    kartu: [
      { id: "batas-kunjungan", judul: "settings.salesman.visitTitle" },
      { id: "hasil-kunjungan", judul: "settings.salesman.kunjungan.hasil.judul" },
      { id: "check-in", judul: "settings.salesman.kunjungan.checkin.judul" },
      { id: "kelas-toko", judul: "kelasToko.pengaturan.judul" },
      { id: "pembagian-toko", judul: "settings.salesman.shareTitle" },
    ],
  },
  {
    id: "target-komisi",
    judul: "settings.salesman.toc.targetKomisi",
    kartu: [
      { id: "target", judul: "settings.salesman.targetTitle" },
      { id: "komisi", judul: "komisiSalesman.kartu.judul" },
    ],
  },
  {
    id: "pesanan-kredit",
    judul: "settings.salesman.toc.pesananKredit",
    kartu: [
      { id: "kredit", judul: "settings.salesman.kredit.judul" },
      { id: "minimum-pesanan", judul: "minimumPesanan.judul" },
      { id: "jarak-jauh", judul: "pwa.jarakJauh.pengaturan.judul" },
      { id: "portal-toko", judul: "portalToko.pengaturan.judul" },
    ],
  },
  {
    id: "biaya-absensi",
    judul: "settings.salesman.toc.biayaAbsensi",
    kartu: [
      { id: "biaya", judul: "biayaPerjalanan.pengaturan.judul" },
      { id: "absensi", judul: "absensi.pengaturan.judul" },
    ],
  },
];
