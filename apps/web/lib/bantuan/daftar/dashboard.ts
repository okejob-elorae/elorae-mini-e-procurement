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
        ],
      },
      {
        judul: "Perlu ditindaklanjuti",
        isi: "Pekerjaan yang biasanya kelewat kalau hanya melihat angka di bawahnya: PO terlambat atau menunggu persetujuan, barang terjual melebihi stok, pesanan salesman menunggu persetujuan, pesanan marketplace belum dikirim, retur menunggu keputusan, BKM menunggu verifikasi, faktur lewat janji bayar, nota tagihan tanpa nomor faktur pajak, perubahan data toko, dan jurnal yang gagal diposting. Setiap baris membuka daftar tempat pekerjaan itu diselesaikan. Titik merah berarti terlambat, kuning berarti menunggu. Baris hanya tampil untuk pekerjaan yang boleh Anda kerjakan.",
      },
      {
        judul: { kunci: "dashboard.kpiSalesSummary" },
        isi: "Terealisasi dihitung sejak data pertama, bukan 30 hari: pesanan putus yang sudah dikirim ditambah penjualan van. Penjualan marketplace hari ini memakai tanggal WIB. Pesanan belum dikirim adalah pesanan marketplace yang masih menunggu diambil, dikemas, atau dikirim di Antrian Pemenuhan.",
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
        isi: "Perintah kerja yang sedang berjalan dan yang selesai hari ini. Bahan kurang menghitung bahan yang belum dikeluarkan untuk perintah kerja yang masih aktif (draf, diterbitkan, sedang produksi, atau sebagian) dibanding stok yang tersedia; rincian per bahan ada di Laporan operasional.",
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
        isi: "Stok menipis: barang yang stoknya sudah di bawah atau sama dengan titik pesan ulang. Stok kelebihan pesan: barang yang tersedianya minus, karena yang sudah dipesan (dicadangkan) lebih banyak dari stok yang ada.",
      },
    ],
  },
];
