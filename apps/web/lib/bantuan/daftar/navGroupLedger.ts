import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/finance/journals",
    bagian: "navGroupLedger",
    judul: { kunci: "financeJournals.pageTitle" },
    isi: [
      { kunci: "financeJournals.subtitle" },
      "Jurnal otomatis dibuat oleh transaksi sumbernya (penerimaan barang, penjualan, retur, settlement, opname, dan lainnya) dan hanya untuk peran posting yang sudah dipetakan di Pemetaan Akun. Jurnal manual dibuat lewat tombol Jurnal Baru oleh yang berizin mengelola jurnal.",
    ],
  },
  {
    rute: "/backoffice/finance/journals/new",
    bagian: "navGroupLedger",
    judul: { kunci: "financeJournals.newJournal" },
    isi: "Mencatat jurnal manual, misalnya penyesuaian atau saldo awal. Jurnal minimal dua baris, setiap baris diisi debit atau kredit (tidak keduanya), total debit harus sama dengan total kredit, dan hanya akun aktif tanpa turunan yang bisa dipilih. Jurnal langsung diposting saat disimpan.",
  },
  {
    rute: "/backoffice/finance/journals/[id]",
    bagian: "navGroupLedger",
    judul: "Rincian jurnal",
    isi: "Satu jurnal: tanggal, sumbernya (manual atau transaksi yang membuatnya), dan baris debit-kreditnya per akun.",
  },
  {
    rute: "/backoffice/finance/journals/ledger/[accountId]",
    bagian: "navGroupLedger",
    judul: { kunci: "financeJournals.ledger.title" },
    isi: "Semua baris jurnal satu akun dalam rentang tanggal yang dipilih, dengan saldo awal, saldo berjalan, dan saldo akhir. Dibuka dari Bagan Akun.",
  },
  {
    rute: "/backoffice/finance/coa",
    bagian: "navGroupLedger",
    judul: { kunci: "finance.coa.title" },
    isi: [
      "Daftar akun buku besar dalam bentuk pohon. Kode akun turunan harus diawali kode induknya.",
      "Akun tidak dihapus, hanya dinonaktifkan: akun nonaktif tidak muncul saat membuat jurnal baru tetapi tetap terlihat di riwayat. Jurnal hanya bisa diposting ke akun aktif yang tidak punya turunan.",
      "Melihat butuh izin melihat bagan akun; menambah dan mengubah akun butuh izin mengelola bagan akun.",
    ],
  },
  {
    rute: "/backoffice/finance/account-mapping",
    bagian: "navGroupLedger",
    judul: { kunci: "financeAccountMapping.title" },
    isi: [
      { kunci: "financeAccountMapping.subtitle" },
      "Setiap baris adalah satu peran posting beserta keterangannya. Peran yang belum dipetakan membuat jurnal otomatisnya tertunda dan ditandai, tanpa menahan transaksi sumbernya. Mengubah pemetaan butuh izin mengelola jurnal.",
    ],
  },
  {
    rute: "/backoffice/finance/cash-flow-sections",
    bagian: "navGroupLedger",
    judul: { kunci: "financeCashFlowSections.title" },
    isi: [
      { kunci: "financeCashFlowSections.subtitle" },
      "Akun yang belum ditetapkan mengikuti klasifikasi bawaan menurut jenisnya; pilihan di sini menimpa bawaan itu dan bisa dikembalikan. Klasifikasi Kas dan Setara Kas hanya bisa diberikan ke akun aset. Akun pendapatan, harga pokok, dan beban tidak diklasifikasi karena sudah termasuk dalam laba bersih.",
      "Akun yang belum diklasifikasi tetap dihitung dalam total laporan arus kas, tetapi ditampilkan terpisah. Mengubah klasifikasi butuh izin mengelola jurnal.",
    ],
  },
  {
    rute: "/backoffice/finance/settlements",
    bagian: "navGroupLedger",
    judul: { kunci: "financeSettlements.pageTitle" },
    isi: [
      { kunci: "financeSettlements.subtitle" },
      "Pilih marketplace (Shopee atau TikTok) lalu unggah berkas laporan penghasilannya. Berkas yang formatnya tidak cocok ditolak dengan daftar baris yang bermasalah. Mengunggah dan mencocokkan butuh izin mengelola settlement.",
    ],
  },
  {
    rute: "/backoffice/finance/settlements/[id]",
    bagian: "navGroupLedger",
    judul: "Rincian settlement",
    isi: [
      "Satu settlement marketplace: baris yang sudah cocok dengan pesanan penjualan beserta perbandingannya dengan data Jubelio, dan baris yang belum cocok.",
      "Baris yang belum cocok bisa disinkron ulang dari Jubelio, lalu settlement dicocokkan ulang. Jurnal settlement baru bisa diposting bila checksum-nya cocok dengan ringkasan berkas.",
    ],
    kartu: [
      { judul: { kunci: "financeSettlements.unmatchedLinesTitle" }, isi: { kunci: "financeSettlements.coverageNote" } },
      { judul: { kunci: "financeSettlements.compare.jubelioTitle" }, isi: { kunci: "financeSettlements.compare.jubelioFeesNote" } },
    ],
  },
  {
    rute: "/backoffice/finance/faktur-pajak",
    bagian: "navGroupLedger",
    judul: { kunci: "fakturPajak.pageTitle" },
    isi: [
      { kunci: "fakturPajak.subtitle" },
      "Setiap nota tagihan pengiriman putus punya satu baris di sini sejak nota itu terbit, berstatus Menunggu. Keuangan menandainya Dibuat dengan nomor faktur, atau Tidak Perlu dengan alasan; keduanya bisa dikembalikan ke Menunggu dengan alasan, dan setiap perubahan tercatat di jejak audit.",
      "Melihat butuh izin melihat faktur pajak; mengubah status butuh izin mengelola faktur pajak.",
    ],
  },
];
