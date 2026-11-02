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
      "Halaman ini bisa dibuka dengan izin Buka Pengaturan; memperbarui token, pratinjau dan impor katalog, menyimpan nilai bawaan (termasuk margin dan biaya tambahan bawaan untuk rekomendasi harga), dan menghapus produk butuh izin Kelola pengguna & keamanan — tanpa izin itu isian dan tombolnya terkunci dan halaman menyebutkannya.",
    ],
    kartu: [
      { judul: { kunci: "jubelio.settings.token.title" }, isi: { kunci: "jubelio.settings.token.description" } },
      {
        judul: { kunci: "jubelio.settings.catalog.title" },
        isi: [
          { kunci: "jubelio.settings.catalog.description" },
          "Pratinjau menjalankan sinkron sebagai uji coba tanpa menyimpan apa pun; Impor katalog benar-benar menyimpannya, jadi selalu meminta konfirmasi lebih dulu.",
          "Impor katalog dan sinkron otomatis dari Jubelio tidak pernah mengubah harga jual barang yang sudah ada di ERP; barang yang baru dibuat dari Jubelio memakai harga Jubelio sebagai harga yang sudah dikonfirmasi (keputusan pemilik 2026-11-02).",
        ],
      },
      {
        judul: { kunci: "jubelio.settings.defaults.title" },
        isi: [
          { kunci: "jubelio.settings.defaults.description" },
          "Menyimpan nilai bawaan hanya menyimpan nilai-nilai ini; dipakai saat sebuah barang dikirim ke Jubelio berikutnya. Harga jual barang tidak tersentuh. Margin dan biaya tambahan bawaan hanya bahan rekomendasi harga di halaman barang, untuk barang yang tidak punya sendiri; menyimpannya tidak mengubah harga jual barang mana pun (keputusan pemilik 2026-11-01).",
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
      "Perubahan pemetaan baru tersimpan setelah tombol Simpan pemetaan ditekan. Barang yang kategorinya belum dipetakan tidak bisa diajukan lewat migrasi massal, dan di Konfirmasi harga barisnya tidak bisa dicentang sampai kategorinya dipetakan.",
      "Halaman ini bisa dibuka dengan izin Buka Pengaturan dan Muat kategori tetap bisa dipakai; mengubah dan menyimpan pemetaan butuh izin Kelola pengguna & keamanan — tanpa izin itu pilihan kategori dan tombol Simpan terkunci.",
    ],
  },
  {
    rute: "/backoffice/jubelio/migration",
    bagian: "jubelio",
    judul: { kunci: "jubelio.migration.title" },
    isi: [
      "Mengajukan barang jadi buatan ERP ke Jubelio sekaligus. Hanya barang yang belum terhubung ke Jubelio yang tampil.",
      "Barang yang dipilih DIAJUKAN, bukan langsung dikirim: masuk daftar Jubelio → Konfirmasi harga dan baru dibuat di Jubelio setelah harganya dikonfirmasi (keputusan pemilik 2026-11-02). Barang yang sudah diajukan ditandai Menunggu konfirmasi harga dan tidak bisa dicentang lagi; kartu di atas menghitung berapa yang masih menunggu.",
      "Barang yang tidak bisa dicentang karena datanya: \"Belum punya kategori\" berarti barangnya belum diberi kategori (tautannya membuka barang itu); \"Kategori belum dipetakan\" berarti kategorinya belum dihubungkan di Kategori Jubelio (tautannya membuka halaman itu).",
      "Setelah harganya dikonfirmasi, produknya dibuat sebagai listing sungguhan di akun Jubelio. Antreannya diproses bertahap; kemajuannya bisa dipantau di Pemantauan Jubelio (antrean kirim).",
      "Halaman ini bisa dibuka dengan izin Buka Pengaturan; mengajukan butuh izin Kelola pengguna & keamanan — tanpa izin itu centang dan tombolnya terkunci dan halaman menyebutkannya.",
    ],
  },
  {
    rute: "/backoffice/jubelio/harga",
    bagian: "jubelio",
    judul: { kunci: "jubelio.harga.title" },
    isi: [
      "Harga jual dibuat dan diubah di ERP — di halaman barang atau lewat impor barang. Harga itu baru sampai ke Jubelio setelah dikonfirmasi di sini; sampai saat itu Jubelio tetap memakai harga yang terakhir dikonfirmasi. Di ERP sendiri (pesanan lapangan, SPG) harga baru langsung berlaku.",
      "Produk baru buatan ERP — dari formulir barang, impor barang dengan centang Jubelio, tombol Ajukan ke Jubelio di halaman barang, atau migrasi massal — menunggu di sini sebagai \"Belum di Jubelio\" dan baru dibuat di Jubelio setelah harganya dikonfirmasi.",
      "Perubahan nama, deskripsi, foto, varian, atau status aktif tetap dikirim otomatis ke Jubelio, dengan harga yang sudah dikonfirmasi. Impor katalog dan sinkron dari Jubelio tidak pernah mengubah harga jual barang yang sudah ada di ERP.",
    ],
    kartu: [
      {
        judul: "Setujui & kirim ke Jubelio",
        isi: "Centang satu atau beberapa baris lalu tekan tombolnya. Baris yang harga ERP-nya berubah sejak halaman dibuka tidak dikirim — muat ulang halaman lalu periksa lagi. Setiap konfirmasi tercatat di Jejak audit.",
      },
      {
        judul: "Kembalikan ke harga Jubelio",
        isi: "Untuk perubahan harga yang tidak jadi: harga jual di ERP diganti kembali menjadi harga yang ada di Jubelio, tercatat di riwayat harga jual barang, dan harga itu dikirim ulang ke Jubelio.",
      },
      {
        judul: "Batalkan pengajuan",
        isi: "Untuk produk baru yang tidak perlu dijual di marketplace: barangnya keluar dari daftar dan tidak dibuat di Jubelio. Bisa diajukan lagi dari halaman barang.",
      },
      {
        judul: "Baris yang tidak bisa dicentang",
        isi: "Barang tanpa harga ERP, atau yang kategorinya belum dipetakan ke Jubelio, tidak bisa dikirim sampai diperbaiki. Barang yang sudah di Jubelio tetapi belum punya harga terkonfirmasi tidak menerima perubahan apa pun dari ERP sampai harganya diisi dan dikonfirmasi.",
      },
      {
        judul: "Siapa yang bisa",
        isi: "Halaman ini dan semua tombolnya butuh izin Konfirmasi harga Jubelio — bawaannya hanya admin; bisa diberikan ke peran lain di Pengaturan → Peran & izin. Angka di Beranda menghitung baris yang sama dengan daftar ini.",
      },
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
