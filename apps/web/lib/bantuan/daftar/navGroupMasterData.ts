import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/suppliers",
    bagian: "navGroupMasterData",
    judul: { kunci: "supplier.pageTitle" },
    isi: [
      { kunci: "supplier.pageDescription" },
      "Nomor rekening pemasok disimpan terenkripsi dan selalu tampil tersamar; untuk melihatnya, buka rincian pemasok lalu masukkan PIN Anda. Menghapus pemasok juga meminta PIN.",
    ],
  },
  {
    rute: "/backoffice/suppliers/types",
    bagian: "navGroupMasterData",
    judul: { kunci: "supplierTypes.pageTitle" },
    isi: { kunci: "supplierTypes.pageDescription" },
  },
  {
    rute: "/backoffice/stores",
    bagian: "navGroupMasterData",
    judul: { kunci: "stores.title" },
    isi: [
      "Daftar semua toko beserta syarat kerja samanya: putus atau konsinyasi, tempo bayar, margin, area, kelas, dan sales pemegangnya. Saring menurut area, sales, atau kelas; toko nonaktif disembunyikan kecuali Anda memintanya.",
      "Tombol di atas daftar: Usulan toko baru (calon toko dari lapangan), Area (kelompok wilayah toko; area tidak bisa dihapus, hanya dinonaktifkan), Pindahkan toko (rotasi sales: semua toko satu area atau satu sales dipindah ke sales lain, dan setiap perpindahan tercatat di jejak audit), dan Kelas toko. Toko dengan perubahan data yang menunggu persetujuan diberi tanda di daftarnya.",
    ],
  },
  {
    rute: "/backoffice/stores/new",
    bagian: "navGroupMasterData",
    judul: { kunci: "stores.new" },
    isi: "Mendaftarkan toko baru: identitas, area dan sales pemegang, kontak, lokasi di peta, serta syarat kerja sama. Sales pemegang adalah orang yang mendatangi toko dan menagih piutangnya. Hanya pengguna dengan izin kelola toko yang bisa membuka halaman ini.",
  },
  {
    rute: "/backoffice/stores/[id]",
    bagian: "navGroupMasterData",
    judul: { kunci: "stores.detail.infoTitle" },
    isi: "Satu halaman untuk satu toko: data dan syarat kerja samanya, catatan tim, stok di toko, tautan portal pesan, riwayat kunjungan, pesanan terakhir, dan barang yang pernah dikirim. Bila salesman mengusulkan perubahan data toko dari HP, usulannya tampil paling atas untuk disetujui atau ditolak.",
    kartu: [
      {
        judul: { kunci: "stores.storeChanges.reviewTitle" },
        isi: "Usulan perubahan nama, alamat, telepon, kontak, atau lokasi dari salesman. Data toko tidak berubah sebelum disetujui; yang diterapkan hanya isian yang memang diubah. Menolak butuh alasan.",
      },
      {
        judul: { kunci: "catatanToko.judul" },
        isi: { kunci: "catatanToko.subjudulKantor" },
      },
      {
        judul: { kunci: "stores.stockCard.title" },
        isi: { kunci: "stores.stockCard.hint" },
      },
      {
        judul: { kunci: "portalToko.kelola.judul" },
        isi: { kunci: "portalToko.kelola.subjudul" },
      },
      {
        judul: { kunci: "stores.detail.historyTitle" },
        isi: [
          "Lima puluh kunjungan terakhir: jam masuk dan keluar, siapa, hasil kunjungan, titik GPS, dan foto. Kunjungan yang masuk di luar radius toko diberi tanda jaraknya.",
          { kunci: "stores.detail.tandaCatatan" },
        ],
      },
      {
        judul: { kunci: "stores.orders.cardTitle" },
        isi: "Lima pesanan lapangan terbaru toko ini (putus dan konsinyasi), tanpa yang ditolak. Total pesanan konsinyasi baru tampil setelah disetujui. Klik baris untuk membuka pesanannya.",
      },
      {
        judul: { kunci: "stores.sentItems.cardTitle" },
        isi: "Jumlah barang yang pernah dikirim ke toko ini, per artikel dan ukuran.",
      },
    ],
  },
  {
    rute: "/backoffice/stores/[id]/edit",
    bagian: "navGroupMasterData",
    judul: { kunci: "stores.edit" },
    isi: "Mengubah data dan syarat kerja sama toko, termasuk kelas toko, batas kredit, radius check-in, dan sales pemegang. Mengganti pemegang berarti sales baru yang menagih seluruh piutang toko ini, termasuk faktur dari sales sebelumnya. Batas kredit di sini menimpa batas bawaan di Pengaturan → Salesman hanya untuk toko ini.",
  },
  {
    rute: "/backoffice/stores/[id]/target-stok",
    bagian: "navGroupMasterData",
    judul: { kunci: "storeStockTargets.title" },
    isi: "Stok minimum dan maksimum per ukuran untuk toko ini. Begitu stok di toko menyentuh minimum, salesman diberi saran isi ulang sampai maksimum.",
    kartu: [
      {
        judul: "Toko putus",
        isi: { kunci: "storeStockTargets.putusNote" },
      },
      {
        judul: "Daftar target",
        isi: { kunci: "storeStockTargets.hint" },
      },
    ],
  },
  {
    rute: "/backoffice/stores/kelas",
    bagian: "navGroupMasterData",
    judul: { kunci: "kelasToko.halaman.judul" },
    isi: "Usulan kelas A/B/C dari nilai beli setiap toko aktif selama 180 hari terakhir. Kelas menentukan seberapa sering sales diingatkan mendatangi toko; jarak kunjungan per kelas diatur di Pengaturan → Salesman. Anda memilih toko mana yang mengikuti usulannya; menerapkan butuh izin kelola toko.",
    kartu: [
      {
        judul: { kunci: "kelasToko.halaman.caraJudul" },
        isi: [
          "Toko diperingkat menurut nilai belinya 180 hari terakhir. Toko putus: rupiah nota pengiriman. Toko yang belum membeli apa pun tidak diberi usulan.",
          { kunci: "kelasToko.halaman.konsiCatatan" },
        ],
      },
    ],
  },
  {
    rute: "/backoffice/stores/usulan",
    bagian: "navGroupMasterData",
    judul: { kunci: "storeProposals.title" },
    isi: [
      { kunci: "storeProposals.subtitle" },
      "Melihat cukup dengan izin lihat toko; menyetujui atau menolak butuh izin kelola toko.",
    ],
  },
  {
    rute: "/backoffice/stores/usulan/[id]",
    bagian: "navGroupMasterData",
    judul: "Rincian usulan toko",
    isi: "Data calon toko yang dikirim salesman dari lapangan (nama, alamat, kontak, lokasi, foto, catatan), dibandingkan dengan toko yang sudah ada. Setujui untuk langsung mendaftarkannya, atau tolak dengan alasan; alasan penolakan dikirim ke salesman pengusul dan tampil di HP-nya.",
    kartu: [
      {
        judul: { kunci: "storeProposals.dupTitle" },
        isi: [
          "Toko dan usulan lain yang namanya mirip atau lokasinya berdekatan.",
          { kunci: "storeProposals.dupBody" },
        ],
      },
      {
        judul: { kunci: "storeProposals.approveTitle" },
        isi: { kunci: "storeProposals.approveBody" },
      },
    ],
  },
  {
    rute: "/backoffice/items",
    bagian: "navGroupMasterData",
    judul: { kunci: "navigation.navItemsAll" },
    isi: "Katalog semua barang: kain, aksesoris, dan barang jadi. Saring menurut jenis atau cari nama dan SKU. Buka baris untuk melihat varian dan resep bahan (BOM) barangnya; mengubah dan menghapus ada di menu titik tiga setiap baris.",
  },
  {
    rute: "/backoffice/items/new",
    bagian: "navGroupMasterData",
    judul: { kunci: "items.newPage.title" },
    isi: "Menambah barang baru ke katalog: jenis, nama, satuan, kategori, harga, titik pesan ulang, varian, dan untuk barang jadi resep bahannya (BOM).",
    kartu: [
      {
        judul: { kunci: "itemProductInfo.title" },
        isi: { kunci: "itemProductInfo.description" },
      },
    ],
  },
  {
    rute: "/backoffice/items/[id]",
    bagian: "navGroupMasterData",
    judul: "Rincian barang",
    isi: [
      "Mengubah data barang dan foto galerinya (foto produk dan foto per varian). Tab Riwayat Harga mencatat setiap perubahan harga jual beserta pemicunya: penerimaan barang jadi, perubahan margin, perubahan default, atau edit manual.",
      "Tombol Label barcode membuka cetak label untuk barang ini. Admin juga punya tombol Kirim stok ke Jubelio, yang memasukkan stok barang ini ke antrean kiriman ke Jubelio.",
    ],
    kartu: [
      {
        judul: { kunci: "itemProductInfo.title" },
        isi: { kunci: "itemProductInfo.description" },
      },
    ],
  },
  {
    rute: "/backoffice/items/categories",
    bagian: "navGroupMasterData",
    judul: { kunci: "items.categories.pageTitle" },
    isi: { kunci: "items.categories.pageDescription" },
  },
  {
    rute: "/backoffice/items/size-charts",
    bagian: "navGroupMasterData",
    judul: { kunci: "sizeCharts.judul" },
    isi: { kunci: "sizeCharts.deskripsi" },
  },
  {
    rute: "/backoffice/items/labels",
    bagian: "navGroupMasterData",
    judul: { kunci: "labelBarcode.judul" },
    isi: { kunci: "labelBarcode.deskripsi" },
    kartu: [
      {
        judul: { kunci: "labelBarcode.opsi.judul" },
        isi: "Pilihan cetak (gaya label dan lainnya) diingat di peramban ini.",
      },
      {
        judul: { kunci: "labelBarcode.pratinjau.judul" },
        isi: { kunci: "labelBarcode.pratinjau.deskripsi" },
      },
    ],
  },
  {
    rute: "/backoffice/lead-time",
    bagian: "navGroupMasterData",
    judul: { kunci: "leadTime.title" },
    isi: [
      { kunci: "leadTime.subtitle" },
      "Rantai proses tiap pemasok dipakai untuk menyarankan tanggal tiba saat membuat PO dan perintah kerja, dan untuk menunjukkan posisi pengerjaan di rincian PO dan perintah kerja.",
    ],
    kartu: [
      {
        judul: { kunci: "leadTime.tabs.pustaka" },
        isi: [
          "Daftar semua proses beserta lamanya.",
          { kunci: "leadTime.pustaka.banner" },
          { kunci: "leadTime.pustaka.bannerApproval" },
        ],
      },
      {
        judul: { kunci: "leadTime.tabs.papan" },
        isi: "Memasang proses ke tiap pemasok: pilih proses di kiri lalu klik kartu pemasoknya, atau terapkan SOP (mengganti rantai yang ada atau menambahkannya di belakang). Lama tiap langkah bisa ditimpa khusus untuk pemasok itu.",
      },
      {
        judul: { kunci: "leadTime.tabs.sop" },
        isi: [
          "Rantai proses baku yang bisa diterapkan ke pemasok.",
          { kunci: "leadTime.sop.helper" },
        ],
      },
    ],
  },
];
