import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/suppliers",
    bagian: "navGroupMasterData",
    judul: { kunci: "supplier.pageTitle" },
    isi: [
      { kunci: "supplier.pageDescription" },
      "Satu daftar, tiga cara melihat (seperti Notion/Airtable): Tabel untuk membandingkan, Galeri berupa kartu, dan Papan dengan satu kolom per jenis pemasok. Pilihan tampilan diingat di perangkat Anda dan ikut di alamat halaman. Papan menampilkan sampai 100 pemasok sekaligus, tanpa halaman.",
      "Sedang dikerjakan: untuk penjahit, jumlah SPK yang berjalan dan pcs-nya (merah bila lewat target); untuk pemasok kain/aksesoris, jumlah PO terbuka dan tanggal tiba terdekat (merah bila terlambat). Utang: nilai barang yang SUDAH diterima pada PO yang belum dibayar, dikurangi kredit retur — sama dengan Pembayaran Pemasok; PO yang barangnya belum datang bukan utang. Terakhir: PO, penerimaan barang, atau SPK terakhir. Kolom ini hanya tampil untuk yang boleh melihat PO, SPK, atau pembayaran pemasok.",
      "Tombol WhatsApp muncul bila nomor pemasok adalah nomor HP; nomor kantor tidak.",
      "Pemasok baru berstatus Menunggu persetujuan dan BELUM bisa dipilih di pesanan pembelian (PO) sampai disetujui; pemasok yang ditolak juga tidak bisa dipilih.",
      "Tombol Setujui dan Tolak tampil langsung di pemasok yang menunggu, untuk siapa pun yang memegang izin menyetujui pemasok (tidak harus peran ADMIN). Menolak butuh alasan.",
      "Cari, jenis, persetujuan, dan tampilan tersimpan di alamat halaman, jadi daftar yang tersaring bisa dibagikan.",
      "Nomor rekening pemasok disimpan terenkripsi dan selalu tampil tersamar; untuk melihatnya, buka rincian pemasok lalu masukkan PIN Anda. Menghapus pemasok meminta konfirmasi lalu PIN.",
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
    isi: [
      "Satu halaman untuk satu toko: data dan syarat kerja samanya, kredit dan piutang, catatan tim, buku stok SPG, tautan portal pesan, riwayat kunjungan, pesanan terakhir, dan barang yang pernah dikirim. Bila salesman mengusulkan perubahan data toko dari HP, usulannya tampil paling atas untuk disetujui atau ditolak.",
      "Bagian Kredit & piutang (hanya toko putus) menampilkan kelas toko, status PKP, batas kredit, dan maksimal faktur terbuka. Batas yang ditulis khusus toko ini menimpa bawaan di Pengaturan → Salesman; kosong berarti ikut bawaan. Pemegang izin piutang juga melihat sisa piutang toko, jumlah faktur yang belum lunas, dan piutang yang lewat janji bayar, dengan tautan ke daftar Faktur & Piutang tersaring toko ini. Sisa piutang selalu dihitung ulang dari pelunasan yang sudah diverifikasi.",
      "Ada dua angka stok di toko konsinyasi. Buku stok SPG (di halaman ini) dicatat SPG: kiriman yang diterima, penjualan, opname, mutasi, dan retur. Titipan menurut kiriman (di Target stok) dihitung dari kiriman dikurangi penjualan bulan yang sudah dikunci dan retur. Keduanya bisa berbeda; opname di toko yang membereskannya.",
    ],
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
    isi: [
      "Stok minimum dan maksimum per ukuran untuk toko ini. Begitu stok di toko menyentuh minimum, salesman diberi saran isi ulang sampai maksimum.",
      "Kepala kolom stok menyebut sumbernya: Stok (buku SPG) bila toko punya buku stok yang dicatat SPG, atau Titipan (menurut kiriman) bila belum — kiriman dikurangi penjualan bulan yang sudah dikunci dan retur. Angka titipan bisa minus bila penjualan tercatat lebih banyak dari kiriman.",
    ],
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
    isi: [
      "Katalog semua barang: kain, aksesoris, dan barang jadi. Tab di atas menyaring menurut jenis beserta jumlahnya; kotak di sebelah cari menyaring menurut kategori dan status aktif. Saringan tersimpan di alamat halaman, jadi daftar yang tersaring bisa dibagikan.",
      "Klik SKU atau nama barang untuk membuka dan mengubahnya. Panah di kiri baris menampilkan varian dan resep bahan (BOM). Menghapus ada di menu titik tiga dan meminta konfirmasi; barang yang sudah dipakai di dokumen tidak bisa dihapus — nonaktifkan saja.",
    ],
  },
  {
    rute: "/backoffice/items/new",
    bagian: "navGroupMasterData",
    judul: { kunci: "items.newPage.title" },
    isi: [
      "Menambah barang baru ke katalog: jenis, nama, satuan, kategori, harga, titik pesan ulang, varian, dan untuk barang jadi resep bahannya (BOM).",
      "Nama Inggris tidak wajib: bila kosong, nama Indonesia dipakai di tempat yang membutuhkan nama Inggris. SKU bisa diketik atau dibuat otomatis menurut jenisnya.",
      "Varian: tambahkan atribut (mis. Warna, Ukuran) beserta nilainya; setiap kombinasi menjadi satu varian. SKU varian harus diawali kode kategori (bila kategorinya berkode) atau SKU barang; dibiarkan kosong, SKU varian dibuat otomatis saat disimpan dengan bentuk awalan-nilai1-nilai2 (mis. KAOS-MERAH-S). Barcode varian dibuat menurut format di Pengaturan → Kode barang.",
      "Resep bahan (BOM) hanya untuk barang jadi: bahan, kebutuhan per pcs, dan susut dalam persen.",
      "Kg per roll muncul untuk bahan (bukan barang jadi) yang satuannya kg. Isinya dipakai formulir dan cetak PO untuk menghitung jumlah roll: qty ÷ kg per roll, dibulatkan ke atas.",
    ],
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
      "Tombol Label barcode membuka cetak label untuk barang ini. Admin juga punya tombol Kirim stok ke Jubelio, yang memasukkan stok barang ini ke antrean kiriman ke Jubelio setelah dikonfirmasi.",
      "Tombol Simpan barang menyimpan isian formulir. Galeri produk di bawahnya punya tombol Simpan gambar sendiri — gambar yang ditambah atau digeser belum tersimpan sebelum tombol itu ditekan.",
      "Nama Inggris tidak wajib: bila dikosongkan, nama Indonesia yang dipakai.",
      "Kg per roll (bahan bersatuan kg) dipakai formulir dan cetak PO untuk kolom Roll. Varian warna bahan yang ditambah dari formulir PO tampil di sini sebagai atribut warna; kode Pantone-nya ikut tersimpan dan tidak menjadi atribut kombinasi.",
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
        isi: [
          "Pilihan cetak (gaya label dan lainnya) diingat di peramban ini.",
          "Label tidak pernah mencetak harga, baik gaya Eloraé maupun gaya Rinci (keputusan pemilik). Harga eceran hanya tampil di layar ini sebagai keterangan.",
        ],
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
          "Proses per qty dihitung sebanding jumlah: lama = hari × jumlah ÷ kapasitas, dibulatkan ke atas menjadi hari utuh. Contoh: 7 hari per 10.000 pcs untuk 12.000 pcs = 9 hari (8,4 dibulatkan). Jumlah di bawah kapasitas memakan hari yang lebih sedikit, paling sedikit 1 hari.",
          { kunci: "leadTime.pustaka.bannerApproval" },
        ],
      },
      {
        judul: { kunci: "leadTime.tabs.papan" },
        isi: [
          "Memasang proses ke tiap pemasok: pilih proses di kiri lalu klik kartu pemasoknya, atau terapkan SOP (mengganti rantai yang ada atau menambahkannya di belakang). Lama tiap langkah bisa ditimpa khusus untuk pemasok itu.",
          "Seret-lepas, dengan mouse atau jari: seret proses dari palet kiri ke kartu pemasok — dilepas di antara dua langkah, proses disisipkan tepat di posisi itu; dilepas di bawah langkah terakhir, ditaruh di belakang. Seret pegangan ⠿ di depan langkah untuk mengubah urutan di dalam kartu. Garis di kartu menunjukkan tempat jatuhnya, dan Esc membatalkan seretan. Dengan jari, tekan pegangan ⠿ (bukan bagian lain) supaya halaman tetap bisa digulir; tombol panah naik/turun tetap ada untuk papan ketik.",
          "Centang pemasok…: pilih satu proses di palet, lalu tekan Centang pemasok… di kotak kuning. Semua pemasok tampil dengan kotak centang; yang sudah tercentang adalah pemasok yang sudah punya proses itu. Centang untuk memasangnya di akhir rantai pemasok itu, lepas centang untuk melepasnya. Melepas menghapus SEMUA langkah proses itu dari rantai pemasoknya, termasuk lama khusus yang pernah diatur, jadi sebelum diterapkan nama pemasoknya disebut dan diminta konfirmasi.",
          "Yang diterapkan hanya perubahan yang Anda buat di dialog: pemasok yang tidak Anda ubah tidak disentuh, walau orang lain sedang mengubahnya. Setiap pemasangan dan pelepasan tercatat di jejak audit.",
        ],
      },
      {
        judul: { kunci: "leadTime.tabs.sop" },
        isi: [
          "Rantai proses baku yang bisa diterapkan ke pemasok.",
          { kunci: "leadTime.sop.helper" },
          "Di dialog SOP, urutan langkah bisa diubah dengan menyeret pegangan ⠿ di depan tiap langkah (mouse atau jari), atau dengan tombol panah naik/turun. Urutan baru tersimpan saat Simpan ditekan.",
        ],
      },
      {
        judul: { kunci: "jadwalProduksi.hariKerja.tab" },
        isi: [
          "Kalender kerja produksi yang dipakai jadwal setiap tahap Plan Kerja: lama proses dihitung dalam hari kerja, sedangkan hari libur mingguan dan tanggal merah dilewati.",
          "Hari kerja bawaan Senin–Jumat, sama dengan program SSG. Centang hari lain, misalnya Sabtu, bila produksi juga berjalan di hari itu.",
          "Tombol Isi libur tanggal tetap menambahkan lima libur yang tanggalnya sama setiap tahun (Tahun Baru, Hari Buruh, Hari Lahir Pancasila, Kemerdekaan RI, Natal) untuk tahun ini atau tahun depan, tanpa menggandakan tanggal yang sudah ada. Libur yang tanggalnya bergerak (Idulfitri, Iduladha, Imlek, Nyepi, Waisak, Kenaikan, cuti bersama) ditetapkan pemerintah tiap tahun dan diketik tim sendiri setiap tahun.",
          "Tambah dan hapus tanggal merah baru berlaku setelah disimpan. Menyimpan hari kerja atau tanggal merah menyusun ulang tanggal semua tahap yang masih punya proses belum selesai, jadi selalu diminta konfirmasi dulu.",
          "Mengubah butuh izin mengelola plan kerja atau mengelola Lead Time; tanpa izin itu tab ini hanya bisa dilihat.",
        ],
      },
    ],
  },
];
