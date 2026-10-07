import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/dashboard",
    bagian: "dashboard",
    judul: { kunci: "dashboard.title" },
    isi: [
      "Ringkasan kantor dalam satu halaman. Urutannya mengikuti pertanyaan pagi: ke mana arah penjualan, apa yang perlu ditindaklanjuti, lalu Penjualan, Piutang, Produksi & pembelian, dan Stok.",
      "Hampir setiap angka adalah tautan ke daftar yang sudah tersaring, jadi pekerjaannya bisa langsung diselesaikan di halaman itu. Tombol \"Diperbarui\" di kanan atas memuat ulang semua angka. Tabel rinci (produksi, PO terlambat, pengadaan, setoran CMT, inventori) ada di Laporan operasional lewat tautan \"Lihat laporan lengkap\" di bagian bawah.",
    ],
    kartu: [
      {
        judul: { kunci: "dashboard.trendTitle" },
        isi: [
          "Penjualan per hari untuk 7, 30, atau 90 hari terakhir, atau rentang tanggal yang Anda pilih. Kotak saluran memilih apa yang digambar: semua (marketplace dibanding lapangan), satu kelompok (satu garis per saluran), atau satu saluran saja (Shopee, TikTok, Tokopedia, Jubelio lain, putus, van, SPG). Klik nama saluran di keterangan grafik untuk melihat saluran itu saja. Angka di samping judul membandingkan dengan periode sebelumnya yang sama panjang.",
          "Marketplace dihitung per tanggal pesanan Jubelio, tanpa pesanan yang batal atau retur. Di lapangan, putus dihitung per tanggal kirim; van dan SPG per tanggal jual, bersih dari barang yang dikembalikan pembeli. Transfer konsinyasi bukan penjualan dan tidak dihitung.",
          "Penjualan SPG di toko konsinyasi dihitung dengan harga Elorae, bukan harga di toko: nilai nota dikurangi margin toko saat ini (nota Rp 100.000 di toko bermargin 25% masuk Rp 75.000). Dengan begitu garisnya sebanding dengan putus dan van, yang juga memakai harga Elorae.",
        ],
      },
      {
        judul: "Perlu ditindaklanjuti",
        isi: [
          "Pekerjaan yang biasanya kelewat kalau hanya melihat angka di bawahnya: PO terlambat atau menunggu persetujuan, stok minus, pesanan salesman menunggu persetujuan, pesanan marketplace belum dikirim, retur menunggu keputusan, BKM menunggu verifikasi, faktur lewat janji bayar, nota tagihan tanpa nomor faktur pajak, perubahan data toko, dan jurnal yang gagal diposting.",
          "Juga antrean tim lapangan dan SPG yang menunggu keputusan kantor: izin, sakit, dan cuti; biaya perjalanan yang menunggu persetujuan atau pembayaran; tukar barang yang menunggu persetujuan atau diselesaikan gudang; mutasi antar toko dan selisihnya; barang hilang yang belum ditetapkan penanggungnya; usulan toko baru; janji bayar dari lapangan yang belum dikonfirmasi; kiriman rusak dan isi gudang barang rusak; permintaan koreksi BKM dan nota retur dari sales; tukar shift SPG; dan permintaan stok SPG di toko yang belum punya salesman pemegang.",
          "Setiap baris membuka daftar tempat pekerjaan itu diselesaikan, sudah tersaring, sehingga angkanya sama dengan jumlah baris di daftar itu. Titik merah berarti terlambat, kuning berarti menunggu. Baris hanya tampil bila Anda bisa membuka daftarnya sekaligus memutuskan isinya.",
          "Jurnal gagal diposting membuka daftar Jurnal tertunda: setiap baris menyebut dokumennya, sebab kegagalannya, dan tombol untuk memetakan akun atau memposting ulang.",
          "BKM menunggu verifikasi hanya menghitung BKM yang boleh Anda putuskan. BKM yang Anda laporkan atau catat sendiri tidak boleh Anda verifikasi, jadi BKM itu tampil di baris terpisah \"BKM Anda menunggu admin keuangan lain\". Jumlah kedua baris sama dengan isi daftar BKM yang menunggu verifikasi.",
          "Nilai di baris PO terlambat adalah nilai PO-nya. Laporan operasional (tab Pengadaan) menyebut nilai barang yang belum diterima, jadi angkanya bisa lebih kecil.",
        ],
      },
      {
        judul: { kunci: "dashboard.kpiSalesSummary" },
        isi: [
          "Terealisasi dihitung sejak data pertama, bukan 30 hari: pesanan putus yang sudah dikirim ditambah penjualan van. Angka di bawahnya menghitung pengiriman dan nota van, bukan pesanan: satu pesanan yang dikirim dua kali terhitung dua pengiriman, jadi angkanya bisa berbeda dengan jumlah pesanan di daftar pesanan lapangan.",
          "Disetujui, belum dikirim: pesanan putus yang sudah disetujui tetapi belum satu pun dikirim, senilai total pesanannya. Tautannya membuka daftar pesanan lapangan dengan saringan yang sama.",
          "Penjualan marketplace hari ini memakai tanggal WIB. Pesanan belum dikirim adalah pesanan marketplace yang masih menunggu diambil, dikemas, atau dikirim di Antrian Pemenuhan.",
        ],
      },
      {
        judul: { kunci: "dashboard.salesmanTitle" },
        isi: [{ kunci: "dashboard.salesmanDesc" }, "Diurutkan dari yang terbesar; batangnya membandingkan nilai terealisasi antarsalesman."],
      },
      {
        judul: "Umur piutang dari jatuh tempo",
        isi: "Sisa piutang yang masih terbuka, dikelompokkan menurut umurnya dari tanggal jatuh tempo: belum jatuh tempo, 1–30 hari, 31–60 hari, dan lebih dari 60 hari. Klik untuk membuka Piutang.",
      },
      {
        judul: { kunci: "dashboard.kpiReceivablesAttention" },
        isi: "Lewat janji bayar: faktur yang janji bayarnya sudah lewat. Tertahan retur: potongan retur yang masih ditahan karena gudang belum menutup hitungan barangnya.",
      },
      {
        judul: { kunci: "dashboard.kpiProductionOnly" },
        isi: "Perintah kerja yang sedang diproduksi (beserta yang selesai hari ini) dan yang selesai sebagian, masing-masing menaut ke daftar perintah kerja dengan status itu. Bahan kurang menghitung bahan yang belum dikeluarkan untuk perintah kerja yang masih aktif (draf, diterbitkan, sedang produksi, atau sebagian) dibanding stok yang tersedia; rincian per bahan ada di Laporan operasional.",
      },
      {
        judul: { kunci: "dashboard.kpiPurchasing" },
        isi: "PO terlambat: PO yang sudah dikirim ke pemasok (berstatus dikirim atau sebagian diterima), tanggal tibanya sebelum hari ini (WIB), dan barangnya belum lengkap. PO menunggu persetujuan: PO yang masih draf. Pemasok aktif disertai jumlah penerimaan barang minggu ini.",
      },
      {
        judul: { kunci: "dashboard.stockMixTitle" },
        isi: "Nilai persediaan yang ada di gudang, dibagi bahan baku (kain dan aksesoris) dan barang jadi. Klik untuk membuka Inventori.",
      },
      {
        judul: { kunci: "dashboard.kpiStockAttention" },
        isi: "Dihitung per barang (semua varian dijumlah), dengan tersedia = stok di tangan dikurangi yang sudah dipesan, sama dengan ringkasan di Inventori. Stok menipis: tersedianya di atas nol tetapi sudah sampai titik pesan ulang. Stok habis: tidak ada yang tersedia. Stok minus: tersedianya di bawah nol, karena yang sudah dipesan (dicadangkan) lebih banyak dari stok yang ada. Satu barang hanya masuk satu kelompok.",
      },
    ],
  },
];
