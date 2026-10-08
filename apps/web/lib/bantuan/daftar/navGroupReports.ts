import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/laporan",
    bagian: "navGroupReports",
    judul: { kunci: "dashboard.reportsPageTitle" },
    isi: [
      { kunci: "dashboard.reportsPageDesc" },
      "Tab Produksi dan PO terlambat langsung terisi saat halaman dibuka. Laporan pengadaan, setoran per CMT, dan inventori baru dimuat setelah filternya diatur dan tombol tampilkan ditekan.",
      "Tiap tab laporan tampil sesuai izin Anda: pengadaan bagi yang boleh melihat pesanan pembelian, setoran per CMT bagi yang boleh melihat perintah kerja, dan inventori bagi yang boleh melihat inventori.",
      "Rentang tanggal dihitung dalam hari WIB, dari pukul 00.00 di tanggal awal sampai akhir hari di tanggal akhir. Rentang bawaan setoran per CMT adalah bulan ini (tanggal 1 sampai hari terakhir bulan). Tab yang terbuka ikut tersimpan di alamat halaman, jadi tautannya bisa dibagikan.",
    ],
    kartu: [
      { judul: { kunci: "dashboard.shortageTitle" }, isi: { kunci: "dashboard.shortageDesc" } },
      { judul: { kunci: "dashboard.woByStatusTitle" }, isi: { kunci: "dashboard.woByStatusDesc" } },
      {
        judul: { kunci: "dashboard.overdueTitle" },
        isi: "PO yang tanggal tibanya sudah lewat (sebelum hari ini, WIB) sementara statusnya masih Dikirim ke pemasok atau Diterima sebagian. Definisinya sama dengan angka PO terlambat di beranda dan saringan di Pesanan Pembelian.",
      },
      {
        judul: { kunci: "dashboard.procurementReport" },
        isi: "PO yang belum selesai beserta peringatan tanggal tiba. Bawaannya menampilkan PO berstatus Dikirim ke pemasok dan Diterima sebagian; statusnya bisa diganti di filter.",
      },
      { judul: { kunci: "dashboard.setoranCmtTitle" }, isi: { kunci: "dashboard.setoranCmtDescription" } },
      { judul: { kunci: "dashboard.snapshotTitle" }, isi: { kunci: "dashboard.snapshotDesc" } },
    ],
  },
  {
    rute: "/backoffice/finance/reports/trial-balance",
    bagian: "navGroupReports",
    judul: { kunci: "financeReports.trialBalance.pageTitle" },
    isi: [
      { kunci: "financeReports.trialBalance.subtitleSaldo" },
      "Kolom Saldo awal adalah saldo setiap akun sesaat sebelum tanggal awal periode (termasuk jurnal saldo awal dan jurnal penutup tahun sebelumnya, jadi akun pendapatan dan beban tahun yang sudah ditutup mulai dari nol). Debit dan Kredit adalah mutasi periode itu, dan Saldo akhir = saldo awal + mutasi. Akun yang tidak bermutasi tetapi bersaldo awal (misalnya modal disetor atau peralatan) tetap tampil. Tanpa tanggal awal (sejak awal), saldo awal semua akun nol.",
      "Saldo ditulis sebagai besaran dengan tanda sisinya — D untuk sisi debit, K untuk sisi kredit — supaya tidak bergantung pada sisi normal akun: kas di sisi kredit (K) berarti kas minus. Dua baris di bawah tabel menjumlahkan saldo di sisi debit dan di sisi kredit; keduanya selalu sama bila datanya utuh. Angka negatif di semua laporan keuangan ditulis dalam kurung.",
      "Isinya hanya jurnal yang sudah diposting (jurnal manual yang masih menunggu persetujuan tidak dihitung) dan tanpa jurnal penutup tahun, jadi saldo akun pendapatan dan beban tahun yang sudah ditutup tetap terlihat; selama belum ada jurnal pada periode itu, laporannya kosong. Catatan seimbang atau tidak seimbang di bawah tabel adalah pemeriksaan kerusakan data, karena setiap jurnal sudah diperiksa seimbang saat diposting.",
      "Periode yang dipakai selalu tertulis di bawah judul: isian kosong berarti sejak awal sampai hari ini. Nama akun membuka buku besar akun itu pada periode yang sama.",
      "Spanduk \"Buku besar belum aktif\" muncul di keempat laporan keuangan selama peran wajib di Pemetaan Akun belum lengkap, belum ada jurnal, atau tanggal mulai buku besar belum ditetapkan — selama itu angka Rp 0 di laporan bukan angka sungguhan. Spanduk yang sama juga menyebut jurnal yang gagal diposting; daftarnya ada di Jurnal → tab Tertunda.",
      "Laporan bisa diunduh sebagai Excel atau dicetak sebagai PDF.",
    ],
  },
  {
    rute: "/backoffice/finance/reports/income-statement",
    bagian: "navGroupReports",
    judul: { kunci: "financeReports.incomeStatement.pageTitle" },
    isi: [
      { kunci: "financeReports.incomeStatement.subtitle" },
      "Pendapatan dikurangi harga pokok penjualan menjadi laba kotor, lalu dikurangi beban operasional menjadi laba bersih. Bagiannya ditentukan oleh jenis akun di Bagan Akun.",
      "Isinya hanya transaksi yang sudah menghasilkan jurnal; selama belum ada jurnal pada periode itu, yang tampil adalah keterangan kosong, bukan deretan Rp 0. Kartu Cakupan data di bawah laporan menyebut sumber yang belum dijurnal (penjualan putus, pelunasan piutang, retur toko, konsinyasi, penjualan SPG, barang hilang, dan lainnya). Laporan bisa diunduh sebagai Excel atau dicetak sebagai PDF.",
      "Periode yang dipakai selalu tertulis di bawah judul: isian kosong berarti sejak awal sampai hari ini. Nama akun membuka buku besar akun itu pada periode yang sama. Selama buku besar belum aktif, spanduk di atas laporan mengingatkan bahwa angkanya belum mencerminkan transaksi operasional.",
      "Tabelnya tiga kolom: akun induk adalah judul kelompok tanpa angka, akun rinci di kolom Rincian, dan subtotal kelompok (\"Jumlah …\") di kolom Jumlah — hanya bila kelompoknya berisi lebih dari satu baris. Total setiap bagian juga di kolom Jumlah, jadi satu angka tidak ditulis dua kali di kolom yang sama. Akun bernilai nol disembunyikan; centang Tampilkan akun bernilai nol untuk melihat semuanya. Pilihan itu ikut ke Excel dan cetak.",
    ],
  },
  {
    rute: "/backoffice/finance/reports/balance-sheet",
    bagian: "navGroupReports",
    judul: { kunci: "financeReports.balanceSheet.pageTitle" },
    isi: [
      { kunci: "financeReports.balanceSheet.subtitle" },
      "Saldo dihitung kumulatif sampai tanggal yang dipilih. Laba tahun yang sudah ditutup (Keuangan → Tutup buku) terbaca di akun Laba ditahan. Baris Laba (Rugi) Tahun Berjalan adalah laba 1 Januari tahun posisi sampai tanggal posisi; baris Laba (Rugi) Tahun Lalu Belum Ditutup hanya muncul bila ada tahun sebelumnya yang belum ditutup. Keduanya menggantikan jurnal penutup yang belum ada, sehingga aset tetap seimbang dengan liabilitas ditambah ekuitas.",
      "Bila jurnal paling awal bertanggal sesudah posisi sebenarnya dimulai, halaman ini mengingatkan agar saldo awal dicatat (lewat Saldo awal atau jurnal manual). Laporan bisa diunduh sebagai Excel atau dicetak sebagai PDF.",
      "Catatan \"Aset seimbang dengan liabilitas + ekuitas\" adalah pemeriksaan kerusakan data: karena setiap jurnal sudah seimbang saat diposting, kesamaan itu memang diharapkan. Selama belum ada jurnal sampai tanggal posisi, catatan itu tidak tampil dan laporannya kosong. Isian tanggal kosong berarti posisi per hari ini; tanggalnya tertulis di bawah judul.",
      "Peringatan saldo awal tidak muncul bila jurnal paling awal adalah jurnal saldo awal (dari halaman Saldo awal) atau jurnal manual. Kartu Cakupan data menyebut sumber transaksi yang belum menghasilkan jurnal, sama dengan Laba Rugi dan Arus Kas.",
      "Susunan barisnya sama dengan Laba Rugi: akun induk sebagai judul kelompok, rincian di kolom Rincian, subtotal dan total di kolom Jumlah, dan akun bernilai nol disembunyikan kecuali Tampilkan akun bernilai nol dicentang.",
    ],
  },
  {
    rute: "/backoffice/finance/reports/cash-flow",
    bagian: "navGroupReports",
    judul: { kunci: "financeReports.cashFlow.pageTitle" },
    isi: [
      { kunci: "financeReports.cashFlow.subtitle" },
      "Laporan disusun dari jurnal buku besar, dan hanya bisa disusun bila sudah ada akun kas: lewat peran Bank atau Kas di Pemetaan Akun, atau akun yang ditetapkan sebagai Kas di Klasifikasi Arus Kas. Akun yang belum diklasifikasi ke operasional, investasi, atau pendanaan ditampilkan terpisah, tetapi totalnya tetap benar.",
      "Pelepasan aset tetap: laba atau rugi pelepasan dan akumulasi penyusutan yang dihapus dipindah dari operasional ke investasi lewat baris Penyesuaian pelepasan aset tetap, jadi investasi menampilkan hasil jualnya (bukan harga perolehan yang dikreditkan) dan operasional tidak ikut naik turun karena pelepasan.",
      "Selama belum ada jurnal pada periode itu, laporannya kosong. Bila tersedia, angkanya dibandingkan dengan periode sebelumnya yang sama panjangnya. Laporan bisa diunduh sebagai Excel atau dicetak sebagai PDF.",
      "Catatan bahwa perubahan kas cocok dengan pergerakan saldo kas adalah pemeriksaan kerusakan data: karena setiap jurnal sudah seimbang saat diposting, kecocokan itu memang diharapkan. Periode yang dipakai tertulis di bawah judul; isian kosong berarti sejak awal sampai hari ini.",
    ],
  },
  {
    rute: "/backoffice/finance/reports/perbandingan",
    bagian: "navGroupReports",
    judul: { kunci: "laporanLanjutan.perbandingan.judul" },
    isi: [
      "Laba Rugi atau Neraca dalam tiga kolom: periode (atau posisi) ini, sebelumnya, dan tahun lalu, masing-masing dengan selisih dan persen perubahannya. Persen dihitung terhadap besaran pembanding, jadi rugi yang mengecil tercatat membaik; pembanding nol tidak punya persen (—). Kolom selisih rupiah tampil di layar lebar dan selalu ada di Excel dan cetak.",
      "Laba Rugi: isian periode kosong berarti bulan berjalan (tanggal 1 sampai hari ini). Periode yang mulai tanggal 1 dibandingkan dengan rentang tanggal yang sama di bulan-bulan sebelumnya (satu bulan dengan bulan lalu, tiga bulan dengan tiga bulan sebelumnya; akhir bulan tetap akhir bulan); rentang bebas dibandingkan dengan jendela sama panjang tepat sebelumnya. Tahun lalu = tanggal yang sama 12 bulan sebelumnya.",
      "Neraca: posisi per tanggal dibandingkan dengan posisi akhir bulan sebelumnya dan tanggal yang sama tahun lalu. Aturan bacanya sama dengan laporan tunggalnya (jurnal penutup tahun, laba tahun berjalan dari 1 Januari).",
      "Akun induk tampil sebagai judul kelompok, akun bernilai nol di ketiga kolom disembunyikan kecuali Tampilkan akun bernilai nol dicentang. Bisa diunduh sebagai Excel atau dicetak.",
    ],
  },
  {
    rute: "/backoffice/finance/reports/rasio",
    bagian: "navGroupReports",
    judul: { kunci: "laporanLanjutan.rasio.judul" },
    isi: [
      "Rasio keuangan satu periode dibandingkan dengan periode sebelumnya (aturan pembandingnya sama dengan Laporan perbandingan). Isian periode kosong berarti bulan berjalan. Rasio yang penyebutnya nol atau negatif ditulis \"—\".",
      "Aset dan liabilitas LANCAR diturunkan dari Klasifikasi arus kas: aset Kas atau Operasional = lancar, Investasi = tidak lancar; liabilitas Pendanaan = jangka panjang, selainnya lancar. Aset tetap dan akumulasi penyusutan selalu tidak lancar. Aset yang belum diklasifikasi TIDAK dihitung lancar dan jumlahnya disebut di atas tabel.",
      "Persediaan = akun yang dipetakan ke peran persediaan (bahan, barang jadi, kanvas, konsinyasi, rusak). Dibayar dimuka = biaya dibayar dimuka, uang muka KOL, PPN masukan, dan PPh dibayar dimuka. Piutang dagang = piutang marketplace, piutang toko, dan piutang konsinyasi. Utang dagang = utang usaha.",
    ],
    kartu: [
      { judul: { kunci: "laporanLanjutan.rasio.nama.marginKotor" }, isi: "Laba kotor ÷ pendapatan bersih periode." },
      { judul: { kunci: "laporanLanjutan.rasio.nama.marginBersih" }, isi: "Laba bersih ÷ pendapatan bersih periode." },
      { judul: { kunci: "laporanLanjutan.rasio.nama.rasioLancar" }, isi: "Aset lancar ÷ liabilitas lancar, per akhir periode." },
      { judul: { kunci: "laporanLanjutan.rasio.nama.rasioCepat" }, isi: "(Aset lancar − persediaan − dibayar dimuka) ÷ liabilitas lancar, per akhir periode." },
      { judul: { kunci: "laporanLanjutan.rasio.nama.perputaranPersediaan" }, isi: "HPP periode ÷ rata-rata persediaan (saldo awal dan akhir periode dibagi dua)." },
      { judul: { kunci: "laporanLanjutan.rasio.nama.hariPersediaan" }, isi: "Jumlah hari periode ÷ perputaran persediaan — berapa hari rata-rata barang tinggal di gudang." },
      { judul: { kunci: "laporanLanjutan.rasio.nama.dso" }, isi: "Rata-rata piutang dagang ÷ pendapatan bersih × jumlah hari periode — berapa hari rata-rata uang penjualan baru masuk." },
      { judul: { kunci: "laporanLanjutan.rasio.nama.dpo" }, isi: "Rata-rata utang usaha ÷ HPP × jumlah hari periode — berapa hari rata-rata pemasok dibayar. HPP dipakai karena pembelian tidak tercatat terpisah di buku besar." },
    ],
  },
  {
    rute: "/backoffice/finance/reports/laba-kanal",
    bagian: "navGroupReports",
    judul: { kunci: "laporanLanjutan.labaKanal.judulKanal" },
    isi: [
      "Laba per kanal (Shopee, TikTok, Tokopedia, marketplace lain, toko putus, konsinyasi, kanvas, KOL) atau per toko, dari kanal dan toko yang dibawa setiap baris jurnal pendapatan, HPP, dan beban. Isian periode kosong berarti bulan berjalan.",
      "Pendapatan bersih = penjualan − retur − potongan penjualan (akun yang dipetakan ke peran Retur penjualan dan Potongan penjualan). Laba kotor = pendapatan bersih − HPP; margin = laba kotor ÷ pendapatan bersih. Beban kanal = beban yang membawa kanal itu (biaya marketplace, KOL, komisi, selisih kanvas). Laba kontribusi = laba kotor − beban kanal. Penjualan, retur, dan potongan tampil di layar lebar dan selalu ada di Excel dan cetak.",
      "Baris Tanpa kanal / Tanpa toko ditampilkan apa adanya: berisi beban umum (gaji, sewa) dan jurnal yang tidak membawa kanal. Jumlah semua baris sama dengan laba bersih Laba Rugi periode yang sama. Jurnal lama yang dibuat sebelum kanal dicatat diberi kanal dari dokumen sumbernya bila bisa (pesanan dan retur marketplace, kanvas beserta tokonya, KOL, settlement); jumlah baris yang diturunkan begitu tertulis di bawah tabel.",
      "Tab Per toko mengelompokkan menurut toko; pilih satu kanal (mis. Toko putus) untuk menyaring. Bisa diunduh sebagai Excel atau dicetak.",
    ],
  },
  {
    rute: "/backoffice/finance/anggaran/realisasi",
    bagian: "navGroupReports",
    judul: { kunci: "anggaran.realisasi.judul" },
    isi: [
      "Anggaran yang diisi di Keuangan → Anggaran dibandingkan dengan realisasi dari buku besar (sama dengan Laba Rugi), untuk satu bulan atau sejak Januari sampai bulan itu.",
      "Selisih = realisasi − anggaran; Capaian = realisasi ÷ anggaran. Pendapatan dan laba berwarna hijau bila realisasinya sama atau di atas anggaran; harga pokok dan beban hijau bila sama atau di bawah anggaran, merah bila melewatinya. Akun tanpa anggaran ditulis \"—\" dan tidak dinilai; anggaran nol tidak punya persen capaian.",
      "Akun induk tampil sebagai judul kelompok; akun yang anggaran dan realisasinya nol disembunyikan kecuali Tampilkan akun bernilai nol dicentang. Bisa diunduh sebagai Excel atau dicetak.",
    ],
  },
  {
    rute: "/backoffice/reports/hpp",
    bagian: "navGroupReports",
    judul: { kunci: "hpp.title" },
    isi: [
      { kunci: "hpp.subtitle" },
      { kunci: "hpp.helpIntro" },
      { kunci: "hpp.helpTableExplanation" },
      "Saringan barang jadi, tanggal perintah kerja dibuat, pemasok, dan status langsung berlaku dan tersimpan di alamat halaman, jadi tautannya bisa dibagikan.",
    ],
    kartu: [{ judul: { kunci: "hpp.cardTitle" }, isi: { kunci: "hpp.cardDescription" } }],
  },
];
