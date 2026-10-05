import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/sales-orders",
    bagian: "sales",
    judul: { kunci: "salesOrders.pageTitle" },
    isi: [
      { kunci: "salesOrders.pageSubtitle" },
      "Saring menurut saluran, status, atau rentang tanggal. Ringkasan di atas mengikuti saringan: jumlah dan nilai pesanan, rata-rata penjualan per hari dalam rentang itu, serta pembagian per saluran dan per status.",
    ],
  },
  {
    rute: "/backoffice/sales-orders/[id]",
    bagian: "sales",
    judul: "Rincian pesanan marketplace",
    isi: "Data pembeli, barang, total, status asli dari Jubelio, dan rincian potongan marketplace untuk satu pesanan. Jurnal pendapatan dan HPP-nya dibuat otomatis setelah pesanan dikirim; bagian Jurnal menunjukkan apakah sudah diposting.",
    kartu: [
      {
        judul: { kunci: "salesOrders.fulfillment.section" },
        isi: "Urutannya: Selesai ambil barang, Selesai kemas, lalu Kirim. Saat mengirim Anda memilih kurir dan Jubelio meminta nomor resinya; pengiriman tidak bisa dibatalkan. Daftar ambil barang dan surat jalan dicetak dari sini. Pesanan yang dibatalkan terkunci.",
      },
    ],
  },
  {
    rute: "/backoffice/fulfillment",
    bagian: "sales",
    judul: { kunci: "fulfillmentQueue.pageTitle" },
    isi: [
      { kunci: "fulfillmentQueue.pageSubtitle" },
      "Centang beberapa pesanan untuk menyelesaikan ambil barang atau kemas sekaligus. Pengiriman dilakukan per pesanan di halaman rinciannya karena butuh pilihan kurir.",
    ],
  },
  {
    rute: "/backoffice/returns",
    bagian: "sales",
    judul: { kunci: "salesReturns.list.pageTitle" },
    isi: [
      { kunci: "salesReturns.list.pageSubtitle" },
      "Retur yang masih menunggu keputusan perlu dibuka dan diputuskan per barang. Ringkasan di atas menghitung 30 hari terakhir; tingkat penerimaan dihitung dari retur yang sudah diputuskan.",
    ],
  },
  {
    rute: "/backoffice/returns/[id]",
    bagian: "sales",
    judul: "Keputusan retur",
    isi: "Putuskan setiap barang yang dikembalikan: terima atau tolak. Setelah semua diputuskan, tekan Ajukan keputusan; sejak itu retur terkunci dan tidak bisa diubah. Jurnal pembalikan penjualan dan HPP untuk barang yang diterima dibuat saat keputusan diajukan. Keputusan hanya tercatat di Elorae; pengirimannya ke Jubelio belum tersambung.",
  },
  {
    rute: "/backoffice/field-sales-orders",
    bagian: "sales",
    judul: { kunci: "fieldSalesOrders.pageTitle" },
    isi: [
      "Pesanan putus dan transfer konsinyasi yang dicatat tim sales lapangan dari HP. Daftar ini terbuka pada pesanan yang menunggu persetujuan; ganti saringan status untuk melihat yang sudah disetujui atau ditolak.",
      "Saring juga menurut jenis (putus atau konsinyasi), pre-order, dan toko.",
    ],
  },
  {
    rute: "/backoffice/field-sales-orders/[id]",
    bagian: "sales",
    judul: "Rincian pesanan lapangan",
    isi: [
      "Barang, harga, promo, dan total satu pesanan lapangan, beserta tombol Setujui dan Tolak selama pesanan menunggu persetujuan. Menolak butuh alasan.",
      "Pesanan putus: menyetujui belum mengeluarkan stok. Barang keluar dari gudang saat pengiriman dicatat di kartu Pengiriman, dan pengirimannya boleh bertahap. Bila salesman mengajukan harga lain, harga final setiap baris yang diajukan ditentukan saat menyetujui.",
      "Transfer konsinyasi bukan penjualan: saat disetujui, stoknya dicadangkan untuk toko itu.",
    ],
    kartu: [
      {
        judul: { kunci: "fieldSalesOrders.konsiSuggestions.title" },
        isi: "Khusus transfer konsinyasi yang menunggu persetujuan: barang yang belum pernah dikirim ke toko ini, satu baris per varian beserta stok tersedianya. Barang yang pernah dikirim dalam varian apa pun tidak disarankan. Barang yang Anda tambahkan ikut tercatat saat pesanan disetujui, dengan harga yang sama seperti baris salesman, dan diberi tanda ditambahkan kantor.",
      },
      {
        judul: { kunci: "fieldSalesOrders.kredit.judul" },
        isi: "Keadaan tagihan toko saat pesanan dibuat dan saat ini: sisa tagihan, faktur yang lewat janji bayar, jumlah faktur belum lunas, dan batas kreditnya. Aturannya (peringatan, tahan, atau blokir) diatur di Pengaturan → Salesman. Pesanan yang ditahan karena tagihan baru bisa disetujui setelah Anda mencentang bahwa tagihan toko sudah diperiksa.",
      },
      {
        judul: { kunci: "fieldSalesOrders.delivery.title" },
        isi: [
          "Setiap pengiriman mencatat jumlah yang dikirim per baris, tanggal nota, dan tanggal jatuh tempo. Satu pengiriman mengeluarkan stoknya, menjadi satu nota gudang dan satu nota tagihan, dan nota tagihannya otomatis menjadi piutang toko.",
          "Tanggal nota bisa dibetulkan kemudian dengan alasan; nomor dokumennya tidak berubah. Tutup sisa membatalkan semua yang belum dikirim dan melepas stok yang dicadangkan, dan tidak bisa dibatalkan. Bukti terima (foto nota bertanda tangan atau tanda tangan di layar) tampil per pengiriman.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/inden",
    bagian: "sales",
    judul: { kunci: "inden.judul" },
    isi: { kunci: "inden.deskripsi" },
  },
  {
    rute: "/backoffice/inden/baru",
    bagian: "sales",
    judul: { kunci: "inden.baruJudul" },
    isi: { kunci: "inden.baruDeskripsi" },
    kartu: [
      {
        judul: { kunci: "inden.form.bagianJendela" },
        isi: { kunci: "inden.form.bagianJendelaIsi" },
      },
      {
        judul: { kunci: "inden.form.bagianBarang" },
        isi: { kunci: "inden.form.bagianBarangIsi" },
      },
    ],
  },
  {
    rute: "/backoffice/inden/[id]",
    bagian: "sales",
    judul: "Rincian pre-order",
    isi: "Satu jendela pre-order: masa pesanannya, berapa yang sudah dipesan toko dibanding rencana produksi, dan daftar pesanannya. Jendela bisa diubah dari sini. Pesanan pre-order tidak mencadangkan stok sampai jendelanya dirilis, dan belum bisa dikirim sebelum itu.",
    kartu: [
      {
        judul: { kunci: "inden.rilis.judul" },
        isi: { kunci: "inden.rilis.isi" },
      },
      {
        judul: { kunci: "inden.barangJudul" },
        isi: { kunci: "inden.barangIsi" },
      },
      {
        judul: { kunci: "inden.form.bagianJendela" },
        isi: { kunci: "inden.form.bagianJendelaIsi" },
      },
      {
        judul: { kunci: "inden.form.bagianBarang" },
        isi: { kunci: "inden.form.bagianBarangIsi" },
      },
    ],
  },
  {
    rute: "/backoffice/canvassing",
    bagian: "sales",
    judul: { kunci: "canvassing.pageTitle" },
    isi: "Daftar sales kanvas, yaitu salesman yang menjual langsung dari stok mobil. Buka salah satu untuk melihat stok mobilnya, memuat barang, dan merekonsiliasi akhir hari.",
  },
  {
    rute: "/backoffice/canvassing/[canvasserId]",
    bagian: "sales",
    judul: "Mobil sales kanvas",
    isi: "Stok mobil satu sales kanvas, riwayat muat, dan riwayat rekonsiliasinya.",
    kartu: [
      {
        judul: { kunci: "canvassing.loadFormTitle" },
        isi: "Memindahkan barang dari gudang utama ke mobil, per varian. Hanya stok yang tersedia (stok dikurangi yang dicadangkan) yang bisa dimuat; bila satu baris kurang, seluruh muatan ditolak.",
      },
      {
        judul: { kunci: "canvassing.reconcileSectionTitle" },
        isi: "Hitung sisa barang di mobil. Jumlah terhitung dikembalikan ke stok gudang utama dan mobil dikosongkan. Selisih antara yang seharusnya ada dan yang terhitung dicatat, dan wajib diberi alasan bila tidak nol.",
      },
    ],
  },
  {
    rute: "/backoffice/canvassing/reconcile/[id]",
    bagian: "sales",
    judul: "Rincian rekonsiliasi mobil",
    isi: "Hasil satu rekonsiliasi akhir hari: siapa sales kanvasnya, siapa yang merekonsiliasi, jumlah seharusnya dan terhitung per barang, serta selisihnya. Bisa dicetak, dan jurnalnya bisa dilihat atau diposting ulang dari sini.",
  },
  {
    rute: "/backoffice/van-sales",
    bagian: "sales",
    judul: { kunci: "vanSale.backoffice.list.pageTitle" },
    isi: [
      { kunci: "vanSale.backoffice.list.subtitle" },
      "Dicatat sales kanvas di HP sebagai penjualan tunai yang langsung selesai, tanpa persetujuan. Saring menurut sales atau periode.",
    ],
  },
  {
    rute: "/backoffice/van-sales/[id]",
    bagian: "sales",
    judul: "Rincian penjualan van",
    isi: "Satu nota penjualan van: pembeli, barang, total, uang diterima, kembalian, dan lokasi GPS saat menjual. Nota bisa dicetak ulang, dan jurnalnya bisa dilihat atau diposting ulang dari sini.",
  },
  {
    rute: "/backoffice/promos",
    bagian: "sales",
    judul: { kunci: "promos.pageTitle" },
    isi: [
      { kunci: "promos.subtitle" },
      "Promo diterapkan oleh sistem saat salesman membuat pesanan putus; salesman tidak mengetik diskon. Setiap baris memakai satu promo produk dengan potongan terbesar (prioritas memutuskan bila potongannya sama), lalu satu promo pesanan dihitung dari subtotal setelah potongan itu. Saat disetujui, diskon yang tersimpan di pesanan dipakai apa adanya.",
    ],
  },
  {
    rute: "/backoffice/promos/new",
    bagian: "sales",
    judul: { kunci: "promos.new" },
    isi: "Membuat promo: jenis (persen, nominal, bertingkat, atau bonus barang), berlaku per produk atau per pesanan, syarat minimum, toko dan barang yang ikut, masa berlaku, prioritas, dan status aktif.",
    kartu: [
      {
        judul: { kunci: "promoBonus.jenis" },
        isi: { kunci: "promoBonus.catatanStok" },
      },
    ],
  },
  {
    rute: "/backoffice/promos/[id]",
    bagian: "sales",
    judul: { kunci: "promos.edit" },
    isi: "Mengubah promo yang sudah ada. Tanpa izin kelola promo, formulirnya hanya bisa dibaca.",
    kartu: [
      {
        judul: { kunci: "promoBonus.jenis" },
        isi: { kunci: "promoBonus.catatanStok" },
      },
    ],
  },
];
