import type { KelompokDaftarIsi } from "../DaftarIsiPengaturan";

/**
 * Daftar isi Pengaturan → SPG: kelompok kartu dan jangkarnya, bentuk yang sama
 * dengan Pengaturan → Salesman. Halaman memasang `id` yang sama dalam urutan
 * yang sama (dijaga `daftar-isi.spec.ts`); judulnya kunci i18n judul kartu.
 *
 * Target bulanan SPG tidak di sini: ia satu tabel dengan target salesman di
 * Pengaturan → Salesman `#target` — kaki daftar isi menautnya.
 */
export const DAFTAR_ISI_SPG: KelompokDaftarIsi[] = [
  {
    id: "konter",
    judul: "settings.spg.toc.konter",
    kartu: [
      { id: "diskon-manual", judul: "pengaturanDiskonManualSpg.judul" },
      { id: "member", judul: "pengaturanMemberSpg.judul" },
      { id: "tutup-hari", judul: "spgTutupHari.pengaturan.judul" },
      { id: "titip-pesan", judul: "spgTitip.pengaturan.judul" },
    ],
  },
  {
    id: "jadwal",
    judul: "settings.spg.toc.jadwal",
    kartu: [
      { id: "shift", judul: "jadwalSpg.pengaturan.judul" },
      { id: "hari-kerja", judul: "pengaturanHariKerjaSpg.judul" },
    ],
  },
  {
    id: "komisi-beban",
    judul: "settings.spg.toc.komisiBeban",
    kartu: [
      { id: "komisi-putus", judul: "pengaturanKomisiPutusSpg.judul" },
      { id: "barang-hilang", judul: "pengaturanBarangHilang.judul" },
    ],
  },
  {
    id: "stok",
    judul: "settings.spg.toc.stok",
    kartu: [{ id: "mutasi", judul: "spgMutasi.pengaturan.judul" }],
  },
];

/** Kartu target bulanan (salesman + SPG) di Pengaturan → Salesman. */
export const TAUTAN_TARGET_SPG = "/backoffice/settings/salesman#target";
