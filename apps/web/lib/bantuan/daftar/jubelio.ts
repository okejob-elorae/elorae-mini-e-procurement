import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/jubelio/admin",
    bagian: "jubelio",
    judul: { kunci: "jubelio.admin.title" },
    isi: [
      { kunci: "jubelio.admin.subtitle" },
      "Di bawah angka ringkasan ada tiga daftar: panggilan API terbaru, event webhook masuk dari Jubelio, dan antrean kirim (outbox) ke Jubelio. Baris webhook atau outbox hanya bisa dicoba lagi bila statusnya Gagal permanen atau Dilewati.",
    ],
    kartu: [{ judul: { kunci: "jubelio.admin.bulkPushTitle" }, isi: { kunci: "jubelio.admin.bulkPushBody" } }],
  },
  {
    rute: "/backoffice/jubelio/settings",
    bagian: "jubelio",
    judul: { kunci: "jubelio.settings.title" },
    isi: { kunci: "jubelio.settings.subtitle" },
    kartu: [
      { judul: { kunci: "jubelio.settings.token.title" }, isi: { kunci: "jubelio.settings.token.description" } },
      {
        judul: { kunci: "jubelio.settings.catalog.title" },
        isi: [
          { kunci: "jubelio.settings.catalog.description" },
          "Pratinjau menjalankan sinkron sebagai uji coba tanpa menyimpan apa pun; Impor katalog benar-benar menyimpannya.",
        ],
      },
      {
        judul: { kunci: "jubelio.settings.defaults.title" },
        isi: [
          { kunci: "jubelio.settings.defaults.description" },
          "Menyimpan nilai bawaan menghitung ulang dan mengirim ulang barang yang terdampak ke Jubelio.",
        ],
      },
      { judul: { kunci: "jubelio.settings.cleanup.title" }, isi: { kunci: "jubelio.settings.cleanup.description" } },
    ],
  },
  {
    rute: "/backoffice/jubelio/categories",
    bagian: "jubelio",
    judul: { kunci: "jubelio.categories.title" },
    isi: [
      { kunci: "jubelio.categories.subtitle" },
      "Perubahan pemetaan baru tersimpan setelah tombol Simpan pemetaan ditekan. Barang yang kategorinya belum dipetakan dilewati saat migrasi massal ke Jubelio.",
    ],
  },
  {
    rute: "/backoffice/jubelio/migration",
    bagian: "jubelio",
    judul: { kunci: "jubelio.migration.title" },
    isi: [
      "Mengirim barang jadi buatan ERP ke Jubelio sekaligus. Hanya barang yang belum terhubung ke Jubelio yang tampil, dan barang yang kategorinya belum dipetakan di Kategori Jubelio akan dilewati.",
      "Pengiriman ini membuat listing produk sungguhan di akun Jubelio. Antreannya diproses bertahap; kemajuannya bisa dipantau di Jubelio API (antrean kirim).",
    ],
  },
  {
    rute: "/backoffice/jubelio/couriers",
    bagian: "jubelio",
    judul: { kunci: "jubelioCouriers.pageTitle" },
    isi: [
      { kunci: "jubelioCouriers.pageSubtitle" },
      "Daftarnya diperbarui dengan tombol Sinkron dari Jubelio.",
    ],
  },
];
