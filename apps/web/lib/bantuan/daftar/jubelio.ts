import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/jubelio/admin",
    bagian: "jubelio",
    judul: { kunci: "jubelio.admin.title" },
    isi: [
      "Satu halaman untuk memantau seluruh hubungan dengan Jubelio: panggilan API keluar (waktu respons dan pembatasan laju), webhook yang masuk dari Jubelio, dan antrean kirim (outbox) dari ERP ke Jubelio.",
      "Angka ringkasan di atas setiap daftar menghitung 24 jam terakhir. Arahkan kursor ke label status untuk melihat nama status teknisnya.",
      "Baris webhook atau antrean kirim hanya bisa dicoba lagi bila statusnya Gagal permanen atau Dilewati; mengirim ulang selalu meminta konfirmasi lebih dulu.",
    ],
    kartu: [
      { judul: { kunci: "jubelio.admin.bulkPushTitle" }, isi: [
        { kunci: "jubelio.admin.bulkPushBody" },
        "Tombolnya ada di samping judul halaman. Sebelum mengirim, dialog konfirmasi menyebut berapa barang yang akan masuk antrean.",
      ] },
      {
        judul: "Status",
        isi: "Diterima / Menunggu = baru masuk antrean; Sedang diproses = sedang dikerjakan; Selesai = berhasil; Dilewati = tidak perlu dikirim (misalnya sudah sama); Gagal permanen = sudah dicoba berulang kali dan berhenti.",
      },
    ],
  },
  {
    rute: "/backoffice/jubelio/settings",
    bagian: "jubelio",
    judul: { kunci: "jubelio.settings.title" },
    isi: [
      { kunci: "jubelio.settings.subtitle" },
      "Bila layanan integrasi (apps/api) tidak bisa dihubungi atau menolak permintaan, kartu yang bersangkutan menampilkan pesannya dalam bahasa Indonesia; teks teknis untuk pengelola sistem ada di balik Rincian.",
    ],
    kartu: [
      { judul: { kunci: "jubelio.settings.token.title" }, isi: { kunci: "jubelio.settings.token.description" } },
      {
        judul: { kunci: "jubelio.settings.catalog.title" },
        isi: [
          { kunci: "jubelio.settings.catalog.description" },
          "Pratinjau menjalankan sinkron sebagai uji coba tanpa menyimpan apa pun; Impor katalog benar-benar menyimpannya, jadi selalu meminta konfirmasi lebih dulu.",
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
      "Mengirim barang jadi buatan ERP ke Jubelio sekaligus. Hanya barang yang belum terhubung ke Jubelio yang tampil.",
      "Barang yang tidak bisa dicentang pasti dilewati Jubelio: \"Belum punya kategori\" berarti barangnya belum diberi kategori (tautannya membuka barang itu); \"Kategori belum dipetakan\" berarti kategorinya belum dihubungkan di Kategori Jubelio (tautannya membuka halaman itu).",
      "Pengiriman ini membuat listing produk sungguhan di akun Jubelio. Antreannya diproses bertahap; kemajuannya bisa dipantau di Pemantauan Jubelio (antrean kirim).",
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
