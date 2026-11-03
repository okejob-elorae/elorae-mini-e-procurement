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
          "Penjualan per hari untuk 7, 30, atau 90 hari terakhir, atau rentang tanggal yang Anda pilih. Kotak saluran memilih apa yang digambar: semua (marketplace dibanding lapangan), satu kelompok (satu garis per saluran), atau satu saluran saja (Shopee, TikTok, Tokopedia, Jubelio lain, putus, van, SPG). Klik nama saluran di keterangan grafik untuk melihat saluran itu saja. Angka di samping judul membandingkan dengan periode sebelumnya yang sama panjang. Periode dan saluran yang dipilih tersimpan di alamat halaman, jadi tautan yang dibagikan atau halaman yang dimuat ulang membuka grafik yang sama.",
          "Marketplace dihitung per tanggal pesanan Jubelio, tanpa pesanan yang batal atau retur. Di lapangan, putus dihitung per tanggal kirim; van dan SPG per tanggal jual, bersih dari retur pembeli yang sudah disetujui kantor. Transfer konsinyasi bukan penjualan dan tidak dihitung.",
          "Penjualan SPG di toko konsinyasi dihitung dengan harga Elorae, bukan harga di toko: nilai nota dikurangi margin toko saat ini (nota Rp 100.000 di toko bermargin 25% masuk Rp 75.000). Dengan begitu garisnya sebanding dengan putus dan van, yang juga memakai harga Elorae.",
        ],
      },
      {
        judul: "Perlu ditindaklanjuti",
        isi: [
          "Pekerjaan yang biasanya kelewat kalau hanya melihat angka di bawahnya: PO terlambat atau menunggu persetujuan, stok minus, pesanan salesman menunggu persetujuan, pesanan marketplace belum dikirim, retur menunggu keputusan, BKM menunggu verifikasi, faktur lewat janji bayar, nota tagihan tanpa nomor faktur pajak, perubahan data toko, dan jurnal yang gagal diposting.",
          "Juga antrean tim lapangan dan SPG yang menunggu keputusan kantor: izin, sakit, dan cuti; biaya perjalanan yang menunggu persetujuan atau pembayaran; tukar barang yang menunggu persetujuan atau diselesaikan gudang; mutasi antar toko dan selisihnya; barang hilang yang belum ditetapkan penanggungnya; usulan toko baru; janji bayar dari lapangan yang belum dikonfirmasi; kiriman rusak dan isi gudang barang rusak; permintaan koreksi BKM dan nota retur dari sales; tukar shift SPG; dan permintaan stok SPG di toko yang belum punya salesman pemegang.",
          "Sejak keputusan pemilik 2026-11-02 ada tiga baris lagi, masing-masing hanya untuk pemegang izin yang memutuskannya: retur pembeli SPG yang menunggu persetujuan (izin Setujui retur pembeli SPG; tautannya membuka tab Menunggu), komisi SPG dari bulan pembayaran sebelumnya yang sudah boleh dibayar tetapi belum ditandai dibayar (izin membayar gaji & komisi SPG; tautannya membuka kartu tunggakan di Komisi SPG — baris yang ditahan karena gaji pokok, jadwal bulanan, atau catatan check-in tokonya belum ada tidak dihitung di sini, melainkan di baris tahannya sendiri), dan harga jual atau produk baru yang menunggu dikonfirmasi sebelum sampai ke Jubelio (izin Konfirmasi harga Jubelio).",
          "Jawaban pemilik 2026-11-02 berikutnya menambah baris, masing-masing hanya untuk yang bisa membuka daftarnya dan memegang izin yang memutuskannya: klaim barang hilang ke ekspedisi yang menunggu jawaban ekspedisi (izin Kelola piutang), pembayaran klaim ekspedisi yang menunggu cek (izin Periksa pembayaran, di halaman Barang hilang), klaim ekspedisi yang ditolak sehingga penanggung lain harus ditetapkan (izin memutuskan penanggung barang hilang); selisih retur toko yang penanggungnya belum diputuskan (izin Putuskan penanggung selisih retur); barang retur pembeli SPG yang ditolak dan menunggu keputusan barangnya (izin Setujui retur pembeli SPG); jadwal bulanan SPG yang menunggu persetujuan (izin Setujui jadwal SPG); catatan check-in toko SPG yang belum dimasukkan atau menunggu diperiksa (izin mencatat dan izin memeriksa catatan check-in, dua izin terpisah); utang SPG yang sudah berhenti yang belum lunas atau belum dicatat (izin membayar gaji & komisi SPG) dan pembayaran utang SPG yang menunggu cek mutasi bank (izin Periksa pembayaran); penerimaan barang yang belum ada invoice pemasoknya dan belum diminta, permintaan invoice yang lebih dari 7 hari belum diterima (izin Kelola Vendor Billing), selisih harga invoice yang menunggu keputusan (izin Putuskan selisih harga invoice), GRN tanpa PO yang menunggu konfirmasi admin (izin Konfirmasi penerimaan tanpa PO); dan harga di Jubelio yang berbeda dengan harga ERP terkonfirmasi (izin Konfirmasi harga Jubelio).",
          "Pembayaran klaim ekspedisi yang menunggu cek tampil di halaman Barang hilang, yang tidak terbuka untuk Keuangan (pemilik: Keuangan hanya halaman Komisi SPG), jadi baris itu tidak tampil untuk pemegang izin Periksa pembayaran saja. Yang mencatat pembayaran klaim tidak boleh memeriksanya sendiri — barisnya tetap terlihat olehnya, tetapi pemeriksaannya harus dikerjakan orang lain.",
          "Setiap baris membuka daftar tempat pekerjaan itu diselesaikan, sudah tersaring, sehingga angkanya sama dengan jumlah baris di daftar itu. Titik merah berarti terlambat, kuning berarti menunggu. Baris hanya tampil bila Anda bisa membuka daftarnya sekaligus memutuskan isinya.",
          "Jurnal gagal diposting membuka daftar Jurnal tertunda: setiap baris menyebut dokumennya, sebab kegagalannya, dan tombol untuk memetakan akun atau memposting ulang.",
          "BKM menunggu verifikasi hanya menghitung BKM yang boleh Anda putuskan. BKM yang Anda laporkan atau catat sendiri tidak boleh Anda verifikasi, jadi BKM itu tampil di baris terpisah \"BKM Anda menunggu admin keuangan lain\". Jumlah kedua baris sama dengan isi daftar BKM yang menunggu verifikasi.",
          "Nilai di baris PO terlambat adalah nilai PO-nya. Laporan operasional (tab Pengadaan) menyebut nilai barang yang belum diterima, jadi angkanya bisa lebih kecil.",
        ],
      },
      {
        judul: { kunci: "dashboard.kpiSalesSummary" },
        isi: [
          "Terealisasi dihitung sejak data pertama, bukan 30 hari: nota tagihan pesanan putus ditambah penjualan van. Nota putus terbit saat pengirimannya dibuat; nota yang dibatalkan bernilai nol dan nota yang dikoreksi saat serah terima senilai yang ditagih. Angka di bawahnya menyebut jumlah pengiriman, dari berapa pesanan, dan jumlah nota van: satu pesanan yang dikirim dua kali terhitung dua pengiriman tetapi satu pesanan. Tautannya membuka daftar pesanan putus yang disetujui, yang juga memuat pesanan yang belum dikirim (baris berikutnya), dan nota van ada di Penjualan van.",
          "Disetujui, belum dikirim: pesanan putus yang sudah disetujui tetapi belum satu pun dikirim, senilai total pesanannya. Tautannya membuka daftar pesanan lapangan dengan saringan yang sama.",
          "Penjualan marketplace hari ini memakai tanggal WIB. Pesanan belum dikirim adalah pesanan marketplace yang masih menunggu diambil, dikemas, atau dikirim di Antrian Pemenuhan.",
        ],
      },
      {
        judul: { kunci: "dashboard.salesmanTitle" },
        isi: [{ kunci: "dashboard.salesmanDesc" }, "Diurutkan dari yang terbesar; batangnya membandingkan nilai terealisasi antarsalesman."],
      },
      {
        judul: "Umur semua piutang dari jatuh tempo",
        isi: "SEMUA sisa piutang yang masih terbuka, dikelompokkan menurut umurnya dari tanggal jatuh tempo: belum jatuh tempo, 1–30 hari, 31–60 hari, dan lebih dari 60 hari. Termasuk faktur yang sudah dikontrabon, yang BKM-nya menunggu verifikasi, dan yang tertahan retur, jadi jumlahnya bisa jauh lebih besar dari baris \"Lewat jatuh tempo\" di sebelahnya. Klik untuk membuka Piutang.",
      },
      {
        judul: { kunci: "dashboard.kpiReceivablesAttention" },
        isi: "Lewat janji bayar: faktur yang janji bayarnya (kontrabon) sudah lewat. Lewat jatuh tempo: faktur yang tanggal jatuh temponya sudah lewat dan belum dikontrabon serta belum dilaporkan BKM-nya; faktur yang sebagian tertahan retur ikut dengan bagian di luar tahanan yang sudah lewat jatuh tempo — angka dan definisinya sama dengan saringan \"Lewat jatuh tempo\" di halaman Piutang. Tertahan retur: faktur yang potongan returnya masih ditahan karena menunggu hitungan gudang atau keputusan selisih retur; faktur yang sebagian tertahan bisa tampil di kedua baris.",
      },
      {
        judul: { kunci: "dashboard.kpiProductionOnly" },
        isi: "Perintah kerja yang sedang diproduksi (beserta yang selesai hari ini) dan yang selesai sebagian, masing-masing menaut ke daftar perintah kerja dengan status itu. Bahan kurang menghitung bahan yang belum dikeluarkan untuk perintah kerja yang masih aktif (draf, diterbitkan, sedang produksi, atau sebagian) dibanding stok yang tersedia; rincian per bahan ada di Laporan operasional.",
      },
      {
        judul: { kunci: "dashboard.kpiPurchasing" },
        isi: "PO terlambat: PO yang sudah dikirim ke pemasok (berstatus dikirim atau sebagian diterima), tanggal tibanya sebelum hari ini (WIB), dan barangnya belum lengkap. PO menunggu persetujuan: PO yang masih draf. Pemasok aktif disertai jumlah penerimaan barang minggu ini; tautannya membuka daftar pemasok yang tersaring aktif, jadi pemasok nonaktif tidak ikut terhitung.",
      },
      {
        judul: { kunci: "dashboard.stockMixTitle" },
        isi: "Nilai persediaan yang ada di gudang, dibagi bahan baku (kain dan aksesoris) dan barang jadi. Klik untuk membuka Inventori.",
      },
      {
        judul: { kunci: "dashboard.kpiStockAttention" },
        isi: "Dihitung per barang (semua varian dijumlah), dengan tersedia = stok di tangan dikurangi yang sudah dipesan, sama dengan ringkasan di Inventori. Stok menipis: tersedianya di atas nol tetapi sudah sampai titik pesan ulang. Stok habis: tidak ada yang tersedia. Stok minus: tersedianya di bawah nol, karena yang sudah dipesan (dicadangkan) lebih banyak dari stok yang ada. Satu barang hanya masuk satu kelompok.",
      },
      {
        judul: "Kapsul di tengah atas",
        isi: [
          "Kapsul gelap di tengah atas layar (terang bila tema gelap) memberi kabar tentang apa yang sedang terjadi, di semua halaman. Bila tidak ada apa-apa, kapsulnya tidak tampil.",
          "Yang bisa muncul: hasil tindakan (\"Menyimpan…\" lalu \"Tersimpan\", atau pesan galat), proses panjang seperti resync settlement beserta persennya, \"Tanpa sinyal\" dengan jumlah yang belum terkirim, \"Mengirim…\" lalu \"Terkirim\" saat sinyal kembali, dan notifikasi baru beserta judulnya.",
          "Bila beberapa hal terjadi bersamaan, yang paling penting tampil di kapsul: galat, lalu proses, lalu sinyal, lalu notifikasi, lalu pesan biasa. Yang berikutnya tampil sebagai lingkaran kecil di sampingnya, dan \"+N\" berarti masih ada N pesan lain sejenis.",
          "Ketuk kapsul untuk menutup pesan, membuka notifikasinya, atau mengirim ulang yang belum terkirim. Pesan biasa hilang sendiri dalam beberapa detik, pesan galat sekitar delapan detik. Keadaan yang berlangsung lama (tanpa sinyal, proses panjang, antrean yang belum terkirim) menyusut menjadi ikon dan angka sesudah beberapa detik supaya tidak menutupi judul halaman; ketuk untuk melebarkannya lagi. Bila perangkat Anda disetel \"kurangi gerakan\", kapsulnya muncul tanpa animasi.",
        ],
      },
    ],
  },
];
