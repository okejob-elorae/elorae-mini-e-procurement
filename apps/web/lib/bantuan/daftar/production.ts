import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/forecast",
    bagian: "production",
    judul: { kunci: "forecast.title" },
    isi: [
      { kunci: "forecast.subtitle" },
      "Forecast dihitung per artikel dari data penjualan marketplace yang diimpor di Impor Data Penjualan, untuk tahun yang dipilih di kanan atas. Pengaturan lookback, growth factor, dan weight decay disimpan per tahun.",
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
    ],
    kartu: [{ judul: { kunci: "planning.tabs.jahitan" }, isi: { kunci: "planning.cmt.subtitle" } }],
  },
  {
    rute: "/backoffice/production/colors",
    bagian: "production",
    judul: { kunci: "navigation.navProductionColors" },
    isi: [
      { kunci: "productionColors.subtitle" },
      "Tab Semua Warna untuk mencari dan menyaring warna, Buku Warna menampilkan warna sesuai halaman fan deck Pantone, Favorit berisi warna yang Anda bintangi, dan Analisis Foto mencocokkan warna dari gambar yang diunggah ke warna Pantone terdekat.",
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
    rute: "/backoffice/purchase-orders",
    bagian: "production",
    judul: { kunci: "purchaseOrders.pageTitle" },
    isi: [
      { kunci: "purchaseOrders.pageDescription" },
      "PO dibuat sebagai draf, lalu diajukan ke pemasok. PO yang tanggal tibanya sudah lewat sementara barangnya belum lengkap dihitung terlambat.",
    ],
  },
  {
    rute: "/backoffice/purchase-orders/new",
    bagian: "production",
    judul: { kunci: "purchaseOrders.newPageTitle" },
    isi: [
      { kunci: "purchaseOrders.newPageDescription" },
      "Hanya pemasok yang sudah disetujui yang bisa dipilih. PO tersimpan sebagai draf dan baru sampai ke pemasok setelah diajukan dari halaman rinciannya.",
    ],
  },
  {
    rute: "/backoffice/purchase-orders/[id]",
    bagian: "production",
    judul: "Rincian pesanan pembelian",
    isi: [
      "Satu PO: pemasok, tanggal tiba, jatuh tempo pembayaran, baris barang, dan riwayat statusnya. Dari sini PO dicetak, diubah, diajukan, atau dibatalkan.",
      "PO draf bisa diubah dan diajukan langsung. Mengubah PO yang sudah diajukan atau sudah ada penerimaannya butuh PIN; membatalkan PO selalu butuh PIN dan alasan.",
    ],
  },
  {
    rute: "/backoffice/supplier-payments",
    bagian: "production",
    judul: { kunci: "supplierPayments.pageTitle" },
    isi: [
      { kunci: "supplierPayments.pageDescription" },
      "Menandai PO lunas memposting jurnal pembayaran untuk hutang yang sudah dibukukan dari penerimaan barangnya; membatalkan tanda lunas memposting jurnal kebalikannya. Bila jurnalnya tidak bisa diposting, Anda diberi tahu alasannya.",
    ],
  },
  {
    rute: "/backoffice/work-orders",
    bagian: "production",
    judul: { kunci: "workOrders.pageTitle" },
    isi: { kunci: "workOrders.pageDescription" },
  },
  {
    rute: "/backoffice/work-orders/new",
    bagian: "production",
    judul: { kunci: "workOrders.form.newTitle" },
    isi: { kunci: "workOrders.form.newDescription" },
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
      "Satu perintah kerja: kemajuan setoran, alokasi kain per roll, terbitan material, penerimaan barang jadi, dan rekonsiliasi pemakaian.",
      "Perintah kerja draf diterbitkan atau dibatalkan dari sini; yang sudah terbit bisa dibatalkan selama belum masuk produksi. Setelah terbit, material dikeluarkan lewat Terbitkan Material dan hasil jadi diterima lewat Terima Barang Jadi.",
      { kunci: "workOrders.detail.additionalDesc" },
    ],
    kartu: [
      {
        judul: { kunci: "workOrders.allocationPerRoll" },
        isi: [{ kunci: "workOrders.notaKainPerRollDesc" }, { kunci: "workOrders.detail.rollStatusHint" }],
      },
      { judul: { kunci: "workOrders.detail.hppTitle" }, isi: { kunci: "workOrders.detail.hppDescription" } },
      {
        judul: { kunci: "workOrders.consumptionPlan" },
        isi: "Qty rencana potong (cutting) dibanding qty yang sudah dikirim ke CMT, per material.",
      },
      { judul: { kunci: "workOrders.reconciliation" }, isi: { kunci: "workOrders.detail.reconciliationDesc" } },
    ],
  },
  {
    rute: "/backoffice/work-orders/[id]/edit",
    bagian: "production",
    judul: { kunci: "workOrders.form.editTitle" },
    isi: "Hanya perintah kerja draf yang bisa diubah.",
    kartu: [
      { judul: { kunci: "workOrders.form.cardTitle" }, isi: { kunci: "workOrders.form.cardDescription" } },
      { judul: { kunci: "workOrders.form.materialPlanTitle" }, isi: { kunci: "workOrders.form.materialPlanDesc" } },
    ],
  },
  {
    rute: "/backoffice/work-orders/[id]/issue",
    bagian: "production",
    judul: { kunci: "workOrders.issueMaterials" },
    isi: "Mengeluarkan kain atau aksesoris dari gudang ke vendor untuk satu perintah kerja. Kain diterbitkan per roll utuh; total roll yang dialokasikan minimal sama dengan qty kain yang diterbitkan.",
    kartu: [
      { judul: { kunci: "workOrders.form.materialPlanTitle" }, isi: { kunci: "workOrders.plannedVsIssued" } },
      { judul: { kunci: "workOrders.issuePage.formTitle" }, isi: { kunci: "workOrders.issuePage.formDescription" } },
    ],
  },
  {
    rute: "/backoffice/work-orders/[id]/receive",
    bagian: "production",
    judul: { kunci: "workOrders.receive.title" },
    isi: "Mencatat barang jadi yang disetor vendor untuk satu perintah kerja: yang lolos QC dan yang ditolak, dirinci per varian.",
    kartu: [{ judul: { kunci: "workOrders.receive.cardTitle" }, isi: { kunci: "workOrders.receive.cardDescription" } }],
  },
  {
    rute: "/backoffice/work-orders/[id]/reconciliation",
    bagian: "production",
    judul: "Rekonsiliasi perintah kerja",
    isi: "Membandingkan pemakaian material sebenarnya dengan rencananya untuk satu perintah kerja, beserta selisih biayanya. Hasilnya bisa dicetak atau disimpan sebagai PDF.",
    kartu: [
      { judul: { kunci: "workOrders.recon.efficiency" }, isi: { kunci: "workOrders.recon.usedVsIssued" } },
      {
        judul: "Selisih per material",
        isi: "Per material: rencana potong (cutting), yang dikirim ke CMT, dan setoran, beserta selisihnya dari estimasi per baris.",
      },
    ],
  },
  {
    rute: "/backoffice/work-orders/nota-register",
    bagian: "production",
    judul: { kunci: "notaRegister.pageTitle" },
    isi: [
      { kunci: "notaRegister.pageSubtitle" },
      "Saring menurut vendor, tanggal, dan jenis terbitan, lalu cetak notanya dari daftar.",
    ],
  },
  {
    rute: "/backoffice/vendor-returns",
    bagian: "production",
    judul: { kunci: "vendorReturnsList.pageTitle" },
    isi: { kunci: "vendorReturnsList.pageDescription" },
  },
  {
    rute: "/backoffice/vendor-returns/new",
    bagian: "production",
    judul: { kunci: "vendorReturn.form.newTitle" },
    isi: [{ kunci: "vendorReturn.createReturnSubtitle" }, "Retur tersimpan sebagai draf; stok belum bergerak sampai retur diproses dari halaman rinciannya."],
    kartu: [{ judul: { kunci: "vendorReturn.form.cardTitle" }, isi: { kunci: "vendorReturn.form.cardDescription" } }],
  },
  {
    rute: "/backoffice/vendor-returns/[id]",
    bagian: "production",
    judul: "Rincian retur ke pemasok",
    isi: [
      "Satu retur ke pemasok beserta nota returnya yang bisa dicetak.",
      "Memproses retur draf mengurangi stok kain atau aksesoris yang dikembalikan (roll kainnya ditutup) atau stok reject barang jadi. Retur yang sudah diproses diselesaikan dengan nomor resi dan bukti terima.",
    ],
    kartu: [
      { judul: { kunci: "vendorReturn.summaryTitle" }, isi: { kunci: "vendorReturn.totalValueAndWO" } },
      { judul: { kunci: "vendorReturn.linesTitle" }, isi: { kunci: "vendorReturn.itemsReturned" } },
    ],
  },
  {
    rute: "/backoffice/vendor-returns/[id]/edit",
    bagian: "production",
    judul: { kunci: "vendorReturn.form.editTitle" },
    isi: { kunci: "vendorReturn.form.editSubtitle" },
    kartu: [{ judul: { kunci: "vendorReturn.form.cardTitle" }, isi: { kunci: "vendorReturn.form.cardDescription" } }],
  },
];
