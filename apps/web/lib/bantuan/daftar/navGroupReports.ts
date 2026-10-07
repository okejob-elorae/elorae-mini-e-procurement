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
      { kunci: "financeReports.trialBalance.subtitle" },
      "Isinya hanya jurnal yang sudah diposting; selama belum ada jurnal pada periode itu, laporannya kosong. Catatan seimbang atau tidak seimbang di bawah tabel adalah pemeriksaan kerusakan data, karena setiap jurnal sudah diperiksa seimbang saat diposting.",
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
    ],
  },
  {
    rute: "/backoffice/finance/reports/balance-sheet",
    bagian: "navGroupReports",
    judul: { kunci: "financeReports.balanceSheet.pageTitle" },
    isi: [
      { kunci: "financeReports.balanceSheet.subtitle" },
      "Saldo dihitung kumulatif sampai tanggal yang dipilih. Baris Laba (Rugi) Belum Ditutup menggantikan jurnal penutup yang belum ada, sehingga aset tetap seimbang dengan liabilitas ditambah ekuitas.",
      "Bila jurnal paling awal bertanggal sesudah posisi sebenarnya dimulai, halaman ini mengingatkan agar saldo awal dicatat lewat jurnal manual. Laporan bisa diunduh sebagai Excel atau dicetak sebagai PDF.",
      "Catatan \"Aset seimbang dengan liabilitas + ekuitas\" adalah pemeriksaan kerusakan data: karena setiap jurnal sudah seimbang saat diposting, kesamaan itu memang diharapkan. Selama belum ada jurnal sampai tanggal posisi, catatan itu tidak tampil dan laporannya kosong. Isian tanggal kosong berarti posisi per hari ini; tanggalnya tertulis di bawah judul.",
    ],
  },
  {
    rute: "/backoffice/finance/reports/cash-flow",
    bagian: "navGroupReports",
    judul: { kunci: "financeReports.cashFlow.pageTitle" },
    isi: [
      { kunci: "financeReports.cashFlow.subtitle" },
      "Laporan disusun dari jurnal buku besar, dan hanya bisa disusun bila sudah ada akun kas: lewat peran Bank atau Kas di Pemetaan Akun, atau akun yang ditetapkan sebagai Kas di Klasifikasi Arus Kas. Akun yang belum diklasifikasi ke operasional, investasi, atau pendanaan ditampilkan terpisah, tetapi totalnya tetap benar.",
      "Selama belum ada jurnal pada periode itu, laporannya kosong. Bila tersedia, angkanya dibandingkan dengan periode sebelumnya yang sama panjangnya. Laporan bisa diunduh sebagai Excel atau dicetak sebagai PDF.",
      "Catatan bahwa perubahan kas cocok dengan pergerakan saldo kas adalah pemeriksaan kerusakan data: karena setiap jurnal sudah seimbang saat diposting, kecocokan itu memang diharapkan. Periode yang dipakai tertulis di bawah judul; isian kosong berarti sejak awal sampai hari ini.",
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
