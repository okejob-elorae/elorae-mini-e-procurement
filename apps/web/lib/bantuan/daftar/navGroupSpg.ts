import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/spg-sales",
    bagian: "navGroupSpg",
    judul: { kunci: "spgSale.backoffice.list.pageTitle" },
    isi: [
      { kunci: "spgSale.backoffice.list.subtitle" },
      "Setiap nota dibuat SPG dari HP di tokonya. Pembeli membayar di kasir toko; nota mencatat barang, promo konter, diskon manual, dan nilai bersihnya. Nota yang dicatat tanpa sinyal ditandai dan terkirim belakangan.",
    ],
  },
  {
    rute: "/backoffice/spg-sales/[id]",
    bagian: "navGroupSpg",
    judul: "Rincian nota SPG",
    isi: "Satu nota penjualan SPG: toko, waktu, lokasi saat dicatat, barang per baris dengan promo dan potongannya, serta total bersih sesudah promo konter dan diskon manual. Nota lama yang mencatat uang tunai masih menampilkan uang diterima dan kembaliannya.",
    kartu: [{ judul: { kunci: "spgRetur.kantor.judul" }, isi: { kunci: "spgRetur.kantor.penjelasan" } }],
  },
  {
    rute: "/backoffice/kinerja-spg",
    bagian: "navGroupSpg",
    judul: { kunci: "kinerjaSpg.judul" },
    isi: [
      { kunci: "kinerjaSpg.deskripsi" },
      "Satu baris per SPG per toko untuk bulan yang dipilih. Pilih nama SPG untuk rincian hariannya.",
      "Tabelnya dua tampilan supaya muat di laptop: Penjualan (nilai, capaian target, nota, potong, pengunjung, konversi) dan Kehadiran & layanan (jadwal, masuk, terlambat, tanpa izin, izin, tutup hari, titip pesan). Rata-rata per nota dan retur pembeli hanya tampil di layar lebar; angkanya juga ada di rincian SPG.",
    ],
    kartu: [
      {
        judul: { kunci: "kinerjaSpg.keterangan.judul" },
        isi: [
          { kunci: "kinerjaSpg.keterangan.jadwal" },
          "Terlambat: check-in pertama lebih dari jam mulai shift ditambah toleransi keterlambatan yang diatur di Pengaturan → SPG; menitnya dihitung dari jam mulai.",
          { kunci: "kinerjaSpg.keterangan.izin" },
          { kunci: "kinerjaSpg.keterangan.nilai" },
          { kunci: "kinerjaSpg.keterangan.pengunjung" },
          { kunci: "kinerjaSpg.keterangan.konversi" },
          { kunci: "kinerjaSpg.keterangan.target" },
          { kunci: "kinerjaSpg.keterangan.tutup" },
          { kunci: "kinerjaSpg.keterangan.titip" },
          { kunci: "kinerjaSpg.keterangan.retur" },
        ],
      },
    ],
  },
  {
    rute: "/backoffice/kinerja-spg/[userId]",
    bagian: "navGroupSpg",
    judul: "Rincian kinerja SPG",
    isi: [
      { kunci: "kinerjaSpg.rincian.deskripsi" },
      "Satu bagian per toko tempat SPG itu bekerja di bulan yang dipilih.",
    ],
    kartu: [{ judul: "Rincian harian per toko", isi: { kunci: "kinerjaSpg.rincian.catatanBintang" } }],
  },
  {
    rute: "/backoffice/spg-tutup-hari",
    bagian: "navGroupSpg",
    judul: { kunci: "spgTutupHari.kantor.judul" },
    isi: [
      { kunci: "spgTutupHari.kantor.deskripsi" },
      "Tampilan per hari menunjukkan setiap toko yang punya SPG: sudah atau belum tutup, angka laporannya, pengunjung, konversi, total kasir, dan selisihnya. Tampilan rentang merekap beberapa hari per toko.",
      "Setiap hari pukul 21.30 WIB, SPG di toko yang hari itu sudah punya nota tetapi belum mengirim laporan tutup hari mendapat pengingat.",
      "Angka pengunjung, seperti di Kinerja SPG, dari penghitung +1 di HP SPG; hari yang tidak dihitung memakai angka yang diketik di laporan tutup hari (ditandai \"dari laporan tutup hari\"). Bila SPG mengetik angka lain di laporannya, angka itu tampil di bawahnya sebagai \"Laporan\". Kinerja SPG membagi kelebihan angka laporan ke SPG yang hadir tetapi tidak menghitung, jadi totalnya bisa lebih besar daripada angka penghitung di sini. Konversi = nota ÷ pengunjung; di tampilan rentang konversinya dari laporan tutup hari.",
    ],
  },
  {
    rute: "/backoffice/spg-tutup-hari/[id]",
    bagian: "navGroupSpg",
    judul: "Rincian tutup hari",
    isi: [
      "Satu laporan tutup hari: isi laporan (angka sistem saat dikirim dan isian SPG), angka per SPG saat ini, barang terlaris, kiriman yang diterima, barang yang dicari pembeli, dan riwayat setiap kiriman laporan (sebelum → sesudah).",
      "Bila angka sistem berubah sesudah laporan dikirim, misalnya karena nota dari HP tanpa sinyal baru terkirim, layar menandainya.",
    ],
  },
  {
    rute: "/backoffice/promo-konter",
    bagian: "navGroupSpg",
    judul: { kunci: "promoKonter.judul" },
    isi: [
      { kunci: "promoKonter.deskripsi" },
      "Tiga tab: daftar promo, pemakaian per promo, dan nota dengan diskon manual SPG. Rentang tanggal bawaannya bulan berjalan. Melihat butuh izin melihat promo; mengubah butuh izin mengelola promo.",
    ],
    kartu: [
      {
        judul: { kunci: "promoKonter.aturan.judul" },
        isi: [
          { kunci: "promoKonter.aturan.pengantar" },
          { kunci: "promoKonter.aturan.satu" },
          { kunci: "promoKonter.aturan.prioritas" },
          { kunci: "promoKonter.aturan.paket" },
          { kunci: "promoKonter.aturan.belanja" },
          { kunci: "promoKonter.aturan.manual" },
          { kunci: "promoKonter.aturan.waktu" },
        ],
      },
      { judul: { kunci: "promoKonter.pemakaian.tanggunganJudul" }, isi: { kunci: "promoKonter.pemakaian.tanggunganIsi" } },
      { judul: { kunci: "promoKonter.pemakaian.judul" }, isi: { kunci: "promoKonter.pemakaian.catatan" } },
    ],
  },
  {
    rute: "/backoffice/promo-konter/baru",
    bagian: "navGroupSpg",
    judul: { kunci: "promoKonter.judulBaru" },
    isi: { kunci: "promoKonter.deskripsiBaru" },
    kartu: [
      {
        judul: { kunci: "promoKonter.aturan.judul" },
        isi: [
          { kunci: "promoKonter.aturan.pengantar" },
          { kunci: "promoKonter.aturan.satu" },
          { kunci: "promoKonter.aturan.prioritas" },
          { kunci: "promoKonter.aturan.paket" },
          { kunci: "promoKonter.aturan.belanja" },
          { kunci: "promoKonter.aturan.manual" },
          { kunci: "promoKonter.aturan.waktu" },
        ],
      },
      { judul: { kunci: "promoKonter.form.diskonManualJudul" }, isi: { kunci: "promoKonter.form.diskonManualIsi" } },
    ],
  },
  {
    rute: "/backoffice/promo-konter/[id]",
    bagian: "navGroupSpg",
    judul: { kunci: "promoKonter.judulUbah" },
    isi: { kunci: "promoKonter.deskripsiUbah" },
    kartu: [
      {
        judul: { kunci: "promoKonter.aturan.judul" },
        isi: [
          { kunci: "promoKonter.aturan.pengantar" },
          { kunci: "promoKonter.aturan.satu" },
          { kunci: "promoKonter.aturan.prioritas" },
          { kunci: "promoKonter.aturan.paket" },
          { kunci: "promoKonter.aturan.belanja" },
          { kunci: "promoKonter.aturan.manual" },
          { kunci: "promoKonter.aturan.waktu" },
        ],
      },
      { judul: { kunci: "promoKonter.form.diskonManualJudul" }, isi: { kunci: "promoKonter.form.diskonManualIsi" } },
    ],
  },
  {
    rute: "/backoffice/spg-pelanggan",
    bagian: "navGroupSpg",
    judul: { kunci: "spgPelanggan.kantor.judul" },
    isi: [
      { kunci: "spgPelanggan.kantor.deskripsi" },
      "Tab Pelanggan menunjukkan per toko berapa pembeli tercatat dan seberapa sering mereka belanja; pilih toko untuk melihat daftarnya. Tab Titip pesan menunjukkan per toko berapa permintaan di tiap status dan barang yang paling sering dititip.",
      "Tiga layar ini saling terkait dan saling ditautkan di kepala halaman: titip pesan (pembeli menunggu barang tertentu), barang dicari pembeli (yang ditanyakan tetapi tidak ada di rak), dan permintaan kiriman SPG. Permintaan pembeli yang sering muncul sebaiknya diteruskan SPG menjadi permintaan kiriman ke salesman pemegang toko.",
    ],
    kartu: [
      { judul: "Pelanggan satu toko", isi: { kunci: "spgPelanggan.kantor.samarPetunjuk" } },
      { judul: { kunci: "spgPelanggan.kantor.titipJudul" }, isi: { kunci: "spgPelanggan.kantor.titipPetunjuk" } },
    ],
  },
  {
    rute: "/backoffice/jadwal-spg",
    bagian: "navGroupSpg",
    judul: { kunci: "jadwalSpg.judul" },
    isi: [
      { kunci: "jadwalSpg.deskripsi" },
      "Satu minggu (Senin–Minggu) per toko. Tab Jadwal disunting sebagai draf lalu disimpan sekali; tab Tukar shift berisi ajuan tukar shift. Melihat cukup dengan izin melihat penjualan SPG; menyusun jadwal dan memutuskan tukar shift butuh izin mengelola toko.",
    ],
    kartu: [
      {
        judul: { kunci: "jadwalSpg.kisiJudul" },
        isi: "Hari yang sudah lewat hanya bisa dibaca, beserta kenyataannya. Terlambat berarti check-in lebih dari toleransi keterlambatan (diatur di Pengaturan → SPG) sesudah shift mulai; menitnya dihitung dari jam mulai. Tidak masuk berarti shift kerja tanpa check-in di toko ini.",
      },
      {
        judul: { kunci: "jadwalSpg.tab.tukar" },
        isi: "SPG mengajukan tukar shift dari HP, dan rekannya harus menyetujui lebih dulu sebelum ajuan sampai ke kantor. Kantor menyetujui atau menolak; sesudah disetujui, jadwal kedua SPG bertukar.",
      },
    ],
  },
  {
    rute: "/backoffice/komisi-spg",
    bagian: "navGroupSpg",
    judul: { kunci: "komisiSpg.judul" },
    isi: [
      { kunci: "komisiSpg.deskripsi" },
      "Dasar pembagian antar SPG di satu toko dan menyalakan komisi ini diatur di Pengaturan → SPG. Komisi bisa ditetapkan mulai tanggal 1 bulan berikutnya. Menetapkan dan menandai dibayar butuh izin mengelola piutang; bulan yang sudah ada pembayarannya tidak bisa ditetapkan ulang.",
      "Beban barang hilang yang ditanggung SPG dipotong dari komisinya saat ditetapkan; batas potongannya diatur di Pengaturan → SPG.",
      "Komisi tidak terbentuk sendiri: baris resminya baru ada setelah keuangan menekan Tetapkan per toko. Beranda mengingatkan pemegang izin mengelola piutang dengan jumlah toko putus ber-SPG yang komisi bulan lalunya belum ditetapkan; tautannya membuka bulan lalu di halaman ini.",
    ],
    kartu: [{ judul: { kunci: "komisiSpg.konsi.judul" }, isi: { kunci: "komisiSpg.konsi.isi" } }],
  },
  {
    rute: "/backoffice/spg-requests",
    bagian: "navGroupSpg",
    judul: { kunci: "spgRequests.pageTitle" },
    isi: [
      { kunci: "spgRequests.pageDescription" },
      "Bawaannya hanya permintaan yang perlu ditangani (baru dan diproses); yang sudah selesai atau ditolak dibuka lewat tabnya sendiri. Mengubah status butuh izin mengelola toko.",
      "Penanda Toko tanpa pemegang: toko itu belum punya salesman pemegang, jadi permintaannya tidak sampai ke HP salesman mana pun dan kantor yang menanganinya. Setiap permintaan baru dari toko seperti itu membunyikan lonceng pengelola toko; saringan Hanya toko tanpa pemegang menampilkan permintaan itu saja.",
      "Tiga layar ini saling terkait dan saling ditautkan di kepala halaman: titip pesan (pembeli menunggu barang tertentu), barang dicari pembeli (yang ditanyakan tetapi tidak ada di rak), dan permintaan kiriman SPG. Permintaan pembeli yang sering muncul sebaiknya diteruskan SPG menjadi permintaan kiriman ke salesman pemegang toko.",
    ],
  },
  {
    rute: "/backoffice/spg-lost-sales",
    bagian: "navGroupSpg",
    judul: { kunci: "spgLostSales.pageTitle" },
    isi: [
      { kunci: "spgLostSales.pageDescription" },
      "Periode dihitung dalam hari kalender WIB termasuk hari ini.",
      "Tiga layar ini saling terkait dan saling ditautkan di kepala halaman: titip pesan (pembeli menunggu barang tertentu), barang dicari pembeli (yang ditanyakan tetapi tidak ada di rak), dan permintaan kiriman SPG. Permintaan pembeli yang sering muncul sebaiknya diteruskan SPG menjadi permintaan kiriman ke salesman pemegang toko.",
    ],
    kartu: [{ judul: { kunci: "spgLostSales.summaryTitle" }, isi: { kunci: "spgLostSales.summaryHint" } }],
  },
  {
    rute: "/backoffice/spg-transfers",
    bagian: "navGroupSpg",
    judul: { kunci: "spgMutasi.kantor.judul" },
    isi: [
      { kunci: "spgMutasi.kantor.deskripsi" },
      "Alurnya: SPG toko asal mengajukan, kantor menyetujui bila arah itu butuh persetujuan, SPG toko asal mengirim, lalu SPG toko tujuan menerima. Arah mana yang boleh, yang butuh persetujuan, dan yang ditolak diatur di Pengaturan → Salesman. Stok gudang utama tidak bergerak; yang berpindah adalah buku stok kedua toko.",
      "Menyetujui, menolak, mengalihkan, membatalkan, dan memutuskan selisih butuh izin menyetujui pesanan lapangan. Menerima atas nama toko butuh izin mengelola toko, untuk toko tujuan tanpa SPG atau kiriman yang sudah melewati batas hari pengingat.",
    ],
  },
  {
    rute: "/backoffice/spg-transfers/[id]",
    bagian: "navGroupSpg",
    judul: "Rincian mutasi antar toko",
    isi: [
      "Satu mutasi: toko asal dan tujuan, barang dan jumlahnya, dan riwayat setiap langkahnya. Surat jalan bisa dicetak atau disimpan sebagai PDF dari sini; sebelum barang dikirim, surat jalan tercetak dengan cap DRAF.",
      "Bila barang diterima kurang dari yang dikirim, kantor memutuskan selisihnya: hilang (hanya dicatat, stok tidak berubah, dan catatan barang hilang dibuka untuk toko asal di SPG → Barang hilang) atau kembali (stok toko asal ditambah sebesar kekurangannya).",
    ],
  },
  {
    rute: "/backoffice/spg-kiriman-rusak",
    bagian: "navGroupSpg",
    judul: { kunci: "spgRusak.kantor.judul" },
    isi: [
      { kunci: "spgRusak.kantor.deskripsi" },
      "Barang rusak tetap dihitung diterima, tetapi tidak masuk stok toko sampai gudang memutuskan. Layak jual menambah stok toko; kembali ke gudang berarti SPG mengirimnya balik lewat nota retur, dan barang itu tidak pernah masuk stok toko.",
      "Pengawas SPG bisa melihat daftar ini; yang memutuskan adalah gudang (izin mengelola persediaan).",
    ],
  },
  {
    rute: "/backoffice/barang-hilang",
    bagian: "navGroupSpg",
    judul: { kunci: "barangHilang.kantor.judul" },
    isi: [
      { kunci: "barangHilang.kantor.deskripsi" },
      "Pengawas SPG bisa melihat. Mencatat barang hilang secara manual, menetapkan penanggung, dan menandai pelunasan butuh izin mengelola piutang.",
      "Barang hilang yang dicatat manual untuk toko yang sudah punya buku stok langsung mengurangi buku toko itu (gerakan Barang hilang di kartu stok toko), jadi opname berikutnya atas potong yang sama tidak membuka catatan kedua. Membatalkan catatannya mengembalikan potong itu ke buku, kecuali barangnya sudah dihitung opname sesudah catatan dibuat — opname itu yang berlaku. Toko tanpa buku stok tidak dibukakan buku; stok titipannya dikurangi catatan yang sudah ditetapkan.",
    ],
  },
  {
    rute: "/backoffice/barang-hilang/[id]",
    bagian: "navGroupSpg",
    judul: "Rincian barang hilang",
    isi: [
      "Satu catatan barang hilang: asalnya, barang dan nilainya, penanggung beserta pelunasan bagiannya, dan riwayat keputusannya.",
      { kunci: "barangHilang.keputusan.akibat" },
      "Penanggung bisa dibagi ke beberapa pihak, dan jumlah semua bagian harus sama dengan total. Keringanan diskon pegawai, bila dipakai, persennya diketik setiap kali memutuskan dan selisihnya ditanggung Elorae. Keputusan bisa diubah atau dibatalkan selama belum ada potongan atau tagihan atas catatan ini.",
    ],
    kartu: [{ judul: { kunci: "barangHilang.rincian.rincianJudul" }, isi: { kunci: "barangHilang.rincian.dasarTerimaIsi" } }],
  },
];
