import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/forecast",
    bagian: "production",
    judul: { kunci: "forecast.title" },
    isi: [
      { kunci: "forecast.subtitle" },
      "Forecast dihitung per artikel dari data penjualan marketplace yang diimpor di Impor Data Penjualan, untuk tahun yang dipilih di kanan atas. Pengaturan lookback, growth factor, dan weight decay disimpan per tahun.",
      "Tahun yang bisa dipilih: dua tahun ke belakang sampai dua tahun ke depan. Mulai Juli (WIB) halaman ini langsung membuka tahun depan, karena saat itulah produksi tahun depan direncanakan.",
      "Jalankan Forecast mati selama belum ada data penjualan sama sekali. Dengan data kurang dari 12 bulan forecast tetap bisa dijalankan, tetapi pola musimannya belum terbaca.",
      "Melihat cukup dengan izin melihat forecast; mengubah pengaturan, menjalankan forecast, dan mengimpor data butuh izin mengelola forecast.",
    ],
    kartu: [
      {
        judul: { kunci: "forecast.tabs.abc" },
        isi: "Artikel dikelompokkan menurut omzet (A tinggi, B sedang, C rendah) dan kestabilan permintaannya (X stabil, Y berubah-ubah, Z tidak menentu). Setiap kotak memuat saran singkat; klik kotaknya untuk melihat artikelnya.",
      },
      { judul: { kunci: "forecast.bridge.title" }, isi: { kunci: "forecast.bridge.note" } },
    ],
  },
  {
    rute: "/backoffice/forecast/import",
    bagian: "production",
    judul: { kunci: "forecast.import.title" },
    isi: [
      "Tempat mengunggah berkas penjualan Shopee atau TikTok (.xlsx) per bulan sebagai bahan forecast. Hanya baris pesanan selesai yang disimpan; baris dengan channel, ID pesanan, dan SKU yang sama dengan impor sebelumnya dilewati.",
      "Satu channel dan satu bulan hanya bisa diimpor sekali. Untuk mengimpor ulang, hapus dulu impor lamanya di Riwayat Impor. Halaman ini butuh izin mengelola forecast.",
    ],
    kartu: [
      {
        judul: { kunci: "forecast.import.coverage" },
        isi: "Bulan mana saja yang sudah punya data per channel. Analisis musiman butuh minimal 12 bulan data.",
      },
    ],
  },
  {
    rute: "/backoffice/forecast/reconciliation",
    bagian: "production",
    judul: { kunci: "forecast.reconciliation.title" },
    isi: [
      { kunci: "forecast.reconciliation.subtitle" },
      { kunci: "forecast.reconciliation.stockDisclaimer" },
      "Halaman ini dibuka dari Forecast; tombol kembali menuju Forecast. Bila belum ada data penjualan yang diimpor, halaman menawarkan tombol ke Impor data penjualan.",
    ],
    kartu: [{ judul: { kunci: "forecast.reconciliation.unmappedTitle" }, isi: { kunci: "forecast.reconciliation.unmappedHint" } }],
  },
  {
    rute: "/backoffice/production/planning",
    bagian: "production",
    judul: { kunci: "planning.title" },
    isi: [
      { kunci: "planning.subtitle" },
      "Satu plan per tahun, diisi lewat tab Isi Grid atau diimpor dari Excel dengan template yang bisa diunduh. Plan berstatus draf sampai diaktifkan; perintah kerja dibuat dari tab Pembagian Jahitan setelah plan aktif.",
      "Membuat dan mengubah plan butuh izin mengelola plan kerja. Mengunci dan membuka kunci plan hanya bisa dilakukan admin; plan yang terkunci tidak bisa diubah, tetapi perintah kerja tetap bisa dibuat.",
      "Tahun plan baru dibuat lewat tombol Tambah tahun. Tahun yang sedang dibuka tersimpan di alamat halaman (?tahun=), jadi tautannya bisa dibagikan.",
      "Buat perintah kerja dari satu tahap butuh vendor CMT dan varian SKU di tahap itu, dan barang jadi bervarian di kategorinya. Bila berhasil, halaman pindah ke perintah kerja yang baru; bila tidak, alasannya disebut.",
    ],
    kartu: [{ judul: { kunci: "planning.tabs.jahitan" }, isi: { kunci: "planning.cmt.subtitle" } }],
  },
  {
    rute: "/backoffice/production/colors",
    bagian: "production",
    judul: { kunci: "navigation.navProductionColors" },
    isi: [
      { kunci: "productionColors.subtitle" },
      "Tab Semua warna untuk mencari dan menyaring warna, Buku Warna menampilkan warna sesuai halaman fan deck Pantone, Favorit berisi warna yang Anda tandai dengan ikon hati, dan Analisis Foto mencocokkan warna dari gambar yang diunggah ke warna Pantone terdekat.",
    ],
  },
  {
    rute: "/backoffice/production/palette",
    bagian: "production",
    judul: { kunci: "productionPalette.title" },
    isi: [
      { kunci: "productionPalette.description" },
      "Dengan warna kain dinyalakan, palet menjadi palet sablon: tintanya disusun di atas kain itu. Membuka halaman cukup dengan izin melihat warna produksi; menyimpan palet dan daftar tinta dasar butuh izin mengelola warna produksi.",
    ],
    kartu: [
      { judul: { kunci: "productionPalette.bestSellers.title" }, isi: { kunci: "productionPalette.bestSellers.description" } },
      { judul: { kunci: "productionPalette.imageTitle" }, isi: { kunci: "productionPalette.imageDescription" } },
      { judul: { kunci: "productionPalette.design.title" }, isi: { kunci: "productionPalette.design.description" } },
      { judul: { kunci: "productionPalette.swatchesTitle" }, isi: { kunci: "productionPalette.swatchesHint" } },
      {
        judul: "CMYK dan Pantone di rincian warna",
        isi: [{ kunci: "productionPalette.cmykNote" }, { kunci: "productionPalette.pantoneNote" }],
      },
      { judul: { kunci: "productionPalette.inksTitle" }, isi: { kunci: "productionPalette.inksHint" } },
      { judul: { kunci: "productionPrint.printTitle" }, isi: { kunci: "productionPrint.printDescription" } },
      {
        judul: { kunci: "productionPalette.readabilityBook.title" },
        isi: "Setiap Pantone C ditampilkan sebagai tulisan di atas warna kain yang dipilih, dengan angka kontrasnya — makin besar makin mudah dibaca. Pilih satu warna untuk melihat contoh tulisannya.",
      },
      { judul: { kunci: "productionPrint.inksTitle" }, isi: { kunci: "productionPrint.inksDescription" } },
      { judul: { kunci: "productionPalette.contrastTitle" }, isi: { kunci: "productionPalette.contrastDescription" } },
      {
        judul: { kunci: "productionPalette.contrastTitleFabric" },
        isi: "Tiap tinta sebagai tulisan di atas warna kain. Angkanya rasio kontras; labelnya memakai skala sablon yang sama dengan di baris tinta, bukan WCAG.",
      },
    ],
  },
  {
    rute: "/backoffice/work-orders",
    bagian: "production",
    judul: { kunci: "workOrders.pageTitle" },
    isi: [
      { kunci: "workOrders.pageDescription" },
      "Pencarian mencari nomor perintah kerja, vendor, dan nama atau SKU barang jadi di seluruh data, bukan hanya halaman yang tampil. Saringan status, cari, dan \"Terlambat saja\" tersimpan di alamat halaman, jadi bisa dibagikan.",
      "Lencana \"Terlambat N hari\" muncul pada perintah kerja yang masih berjalan (diterbitkan, sedang diproduksi, atau sebagian) dan sudah lewat tanggal targetnya, dihitung per hari kalender WIB. Draf, selesai, dan batal tidak pernah terlambat.",
      "Menerbitkan dan membatalkan selalu lewat kotak konfirmasi. Pembatalan wajib memakai alasan, dan ditolak selama masih ada bahan di CMT: kembalikan bahannya dulu di rincian perintah kerja.",
    ],
  },
  {
    rute: "/backoffice/work-orders/new",
    bagian: "production",
    judul: { kunci: "workOrders.form.newTitle" },
    isi: [
      { kunci: "workOrders.form.newDescription" },
      "Jumlah pcs bisa diisi dengan dua cara. \"Ketik jumlah pcs\" (bawaan): isi jumlah pcs langsung, lalu kebutuhan bahan utama dihitung dari BOM. \"Hitung dari bahan utama\": isi berapa bahan utama (kain) yang tersedia, lalu jumlah pcs dihitung dari konsumsi per pcs dan susutnya; sisa bahan yang tidak cukup untuk satu pcs ditampilkan.",
      "Barang jadi yang punya varian otomatis memakai mode \"SKU (per varian)\", supaya hasil produksinya masuk stok per ukuran. Mode \"Umum (pcs)\" tetap bisa dipilih untuk barang tanpa varian.",
    ],
    kartu: [
      { judul: { kunci: "workOrders.form.cardTitle" }, isi: { kunci: "workOrders.form.cardDescription" } },
      { judul: { kunci: "workOrders.form.materialPlanTitle" }, isi: { kunci: "workOrders.form.materialPlanDesc" } },
    ],
  },
  {
    rute: "/backoffice/work-orders/[id]",
    bagian: "production",
    judul: "Rincian perintah kerja",
    isi: [
      "Satu perintah kerja: kemajuan setoran, alokasi kain per roll, bahan (rencana, keluar, kembali, masih di CMT), pengeluaran bahan, dan penerimaan barang jadi. Rekonsiliasi pemakaian dibuka dari tombol Rekonsiliasi di atas.",
      "Perintah kerja draf bisa diubah, diterbitkan, atau dibatalkan dari sini. Setelah terbit, bahan dikeluarkan lewat Keluarkan bahan dan hasil jadi diterima lewat Terima barang jadi. Perintah kerja yang sudah selesai tidak bisa mengeluarkan bahan atau menerima barang jadi lagi.",
      "Pembatalan butuh alasan dan hanya bisa selama belum ada penerimaan barang jadi dan tidak ada bahan yang masih di CMT. Bila masih ada, penolakannya menyebut bahan dan jumlahnya; kembalikan dulu lewat Kembalikan bahan.",
      { kunci: "workOrders.detail.additionalDesc" },
    ],
    kartu: [
      {
        judul: { kunci: "workOrders.allocationPerRoll" },
        isi: [{ kunci: "workOrders.notaKainPerRollDesc" }, { kunci: "workOrders.detail.rollStatusHint" }],
      },
      { judul: { kunci: "workOrders.detail.hppTitle" }, isi: { kunci: "workOrders.detail.hppDescription" } },
      {
        judul: "Bahan",
        isi: [
          "Per bahan: kebutuhan per pcs dari BOM (beserta susutnya), kebutuhan total seluruh perintah kerja (rencana), yang sudah dikeluarkan, yang sudah kembali ke gudang, dan yang masih di CMT. Angka keluar dan kembali dibaca dari dokumen pengeluaran dan pengembalian, bukan dari salinan di rencana.",
          "Kembalikan bahan: isi jumlah yang benar-benar kembali dari CMT (sisa potong, atau supaya perintah kerja bisa dibatalkan). Jumlahnya tidak boleh melebihi yang masih di CMT. Stok bahan di gudang bertambah dan dinilai pada harga saat bahan itu keluar ke perintah kerja ini, bukan harga gudang hari ini. Setiap pengembalian tercatat sebagai penyesuaian stok (nomor ADJ) bersumber pengembalian bahan perintah kerja, dan masuk riwayat di bawah tabel.",
          "Nilai bahan yang sudah kembali tidak ikut dibebankan ke barang jadi yang diterima sesudahnya. Kain yang kembali masuk ke stok, tetapi tidak dikembalikan ke roll tertentu.",
          "Bila barang jadi sudah diterima, sebagian (atau seluruh) biaya bahan sudah masuk HPP barang jadi itu. Bahan yang kembali sesudahnya dinilai paling banyak sebesar biaya bahan yang belum dibebankan; sesudah penerimaan penutup nilainya 0, supaya nilai persediaan tidak terhitung dua kali. Pesan sesudah simpan menyebut bila nilainya dibatasi. Aturan ini sementara, menunggu keputusan pemilik.",
          "Menekan Simpan dua kali (atau mengulang sesudah sambungan putus) tanpa mengubah isian tidak mengembalikan bahan dua kali.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/work-orders/[id]/edit",
    bagian: "production",
    judul: { kunci: "workOrders.form.editTitle" },
    isi: [
      "Hanya perintah kerja draf yang bisa diubah.",
      "Vendor yang sudah tercatat di perintah kerja tetap ada di pilihan walaupun belum (atau tidak lagi) disetujui, ditandai \"belum disetujui\". Vendor baru hanya bisa dipilih dari pemasok yang sudah disetujui.",
    ],
    kartu: [
      { judul: { kunci: "workOrders.form.cardTitle" }, isi: { kunci: "workOrders.form.cardDescription" } },
      { judul: { kunci: "workOrders.form.materialPlanTitle" }, isi: { kunci: "workOrders.form.materialPlanDesc" } },
    ],
  },
  {
    rute: "/backoffice/work-orders/[id]/issue",
    bagian: "production",
    judul: { kunci: "workOrders.issueMaterials" },
    isi: [
      "Mengeluarkan kain atau aksesoris dari gudang ke vendor untuk satu perintah kerja. Kain diterbitkan per roll utuh; total roll yang dialokasikan minimal sama dengan qty kain yang diterbitkan.",
      "Bila simpan gagal (mis. sambungan putus), tekan Simpan lagi tanpa mengubah isian: pengeluaran yang sudah tercatat tidak dikeluarkan dua kali.",
    ],
    kartu: [
      { judul: { kunci: "workOrders.form.materialPlanTitle" }, isi: { kunci: "workOrders.plannedVsIssued" } },
      { judul: { kunci: "workOrders.issuePage.formTitle" }, isi: { kunci: "workOrders.issuePage.formDescription" } },
    ],
  },
  {
    rute: "/backoffice/work-orders/[id]/receive",
    bagian: "production",
    judul: { kunci: "workOrders.receive.title" },
    isi: [
      "Mencatat barang jadi yang disetor vendor untuk satu perintah kerja: yang lolos QC dan yang cacat, dirinci per varian.",
      "Jumlah disetor adalah SEMUA yang diserahkan CMT, termasuk yang cacat. Yang masuk stok = disetor − cacat. Contoh: CMT menyerahkan 30 bagus dan 2 cacat → isi disetor 32 dan cacat 2; masuk stok 30.",
      "Di atas formulir tampil target, yang sudah disetor, dan sisanya. Setoran yang melebihi sisa target tetap boleh dicatat (lebih produksi) dan diberi peringatan.",
      "Biaya bahan: setiap penerimaan memikul bagian sisa biaya bahan sebanding jumlah yang disetor terhadap sisa target; penerimaan yang menutup target memikul seluruh sisanya. Bahan yang sudah kembali ke gudang tidak ikut dibebankan. Pratinjau di layar memakai rumus yang sama dengan yang dicatat.",
    ],
    kartu: [{ judul: { kunci: "workOrders.receive.cardTitle" }, isi: { kunci: "workOrders.receive.cardDescription" } }],
  },
  {
    rute: "/backoffice/work-orders/[id]/reconciliation",
    bagian: "production",
    judul: "Rekonsiliasi perintah kerja",
    isi: [
      "Membandingkan pemakaian material sebenarnya dengan rencananya untuk satu perintah kerja, beserta selisih biayanya. Hasilnya bisa dicetak atau disimpan sebagai PDF.",
      "Terpakai = bahan yang dikeluarkan dikurangi yang kembali ke gudang (Kembalikan bahan) dan yang diretur ke pemasok. Retur dihitung begitu diproses (stoknya keluar), termasuk yang sudah diselesaikan; retur draf belum dihitung.",
    ],
    kartu: [
      {
        judul: { kunci: "workOrders.recon.efficiency" },
        isi: "Nilai pemakaian teoretis dibagi nilai yang benar-benar terpakai. 100% berarti pas; di bawah 100% berarti boros (kain yang terpakai 154% lebih banyak dari teori menghasilkan sekitar 39%); di atas 100% berarti hemat. Kosong bila belum ada bahan terpakai.",
      },
      {
        judul: "Selisih per bahan",
        isi: [
          "Per bahan: kebutuhan total (rencana), yang dikirim ke CMT, yang dikembalikan, yang terpakai, dan pemakaian teoretis (barang jadi yang diterima × kebutuhan per pcs × susut), beserta selisih qty, persen, dan nilainya.",
          "Status: Sesuai (selisih dalam 1%), Lebih pakai, Di bawah teori, atau Belum dikirim (bahan belum keluar sama sekali, jadi bukan penghematan). Di layar selebar 1280 kolom rencana dan dikembalikan disembunyikan; keduanya tetap ada di cetakan.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/work-orders/nota-register",
    bagian: "production",
    judul: { kunci: "notaRegister.pageTitle" },
    isi: [
      { kunci: "notaRegister.pageSubtitle" },
      "Saring menurut vendor, tanggal, dan jenis bahan; saringan langsung berlaku dan tersimpan di alamat halaman. Tanggal \"sampai\" ikut dihitung sampai akhir harinya (WIB). Nomor perintah kerja di daftar membuka rinciannya, dan notanya dicetak dari tombol cetak di setiap baris.",
    ],
  },
];
