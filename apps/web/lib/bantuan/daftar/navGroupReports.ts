import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/laporan",
    bagian: "navGroupReports",
    judul: { kunci: "dashboard.reportsPageTitle" },
    isi: [
      { kunci: "dashboard.reportsPageDesc" },
      "Tab Produksi dan PO terlambat langsung terisi saat halaman dibuka. Laporan pengadaan, setoran per CMT, dan inventori baru dimuat setelah filternya diatur dan tombol tampilkan ditekan.",
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
      "Isinya hanya transaksi yang sudah menghasilkan jurnal; selama belum ada jurnal pada periode itu, laporannya kosong. Kartu Cakupan data di bawah laporan menyebut sumber yang belum dijurnal. Laporan bisa diunduh sebagai Excel atau dicetak sebagai PDF.",
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
    ],
  },
  {
    rute: "/backoffice/reports/hpp",
    bagian: "navGroupReports",
    judul: { kunci: "hpp.title" },
    isi: [{ kunci: "hpp.subtitle" }, { kunci: "hpp.helpIntro" }, { kunci: "hpp.helpTableExplanation" }],
    kartu: [{ judul: { kunci: "hpp.cardTitle" }, isi: { kunci: "hpp.cardDescription" } }],
  },
];
