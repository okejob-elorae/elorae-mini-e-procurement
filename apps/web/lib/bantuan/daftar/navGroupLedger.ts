import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/finance/journals",
    bagian: "navGroupLedger",
    judul: { kunci: "financeJournals.pageTitle" },
    isi: [
      { kunci: "financeJournals.subtitle" },
      "Jurnal otomatis dibuat oleh transaksi sumbernya (penerimaan barang, penjualan, retur, settlement, opname, dan lainnya) dan hanya untuk peran posting yang sudah dipetakan di Pemetaan Akun. Jurnal manual dibuat lewat tombol Jurnal Baru oleh yang berizin mengelola jurnal.",
      "Tab Tertunda berisi dokumen yang jurnal otomatisnya gagal diposting — angka yang sama dengan baris \"Jurnal gagal diposting\" di Beranda. Setiap baris menyebut dokumennya, sebab kegagalannya, dan dua tautan: Petakan akun (bila sebabnya akun belum dipetakan atau salah) dan Posting ulang, yang membuka halaman tempat tombol \"Post journal\" dokumen itu berada. Jurnal penjualan marketplace tidak punya tombol: sapuan tiap 5 menit mempostingnya sendiri begitu sebabnya beres. Baris hilang dari tab ini sendiri begitu jurnalnya berhasil diposting.",
      "Spanduk \"Buku besar belum aktif\" muncul selama peran wajib di Pemetaan Akun belum lengkap, belum ada satu jurnal pun, atau tanggal mulai buku besar belum ditetapkan. Selama itu laporan keuangan belum mencerminkan transaksi operasional. Tanggal mulai buku besar saat ini hanya bisa ditetapkan oleh tim teknis.",
      "Saringan Sumber bisa memilih jurnal manual atau satu jenis jurnal otomatis (penerimaan barang, penjualan, settlement, opname, dan lainnya).",
    ],
  },
  {
    rute: "/backoffice/finance/journals/new",
    bagian: "navGroupLedger",
    judul: { kunci: "financeJournals.newJournal" },
    isi: "Mencatat jurnal manual, misalnya penyesuaian atau saldo awal. Jurnal minimal dua baris, setiap baris diisi debit atau kredit (tidak keduanya), total debit harus sama dengan total kredit, dan hanya akun aktif tanpa turunan yang bisa dipilih. Selama tombol Posting jurnal belum bisa ditekan, kekurangan pertamanya ditulis di bawah tombol. Jurnal langsung diposting saat disimpan.",
  },
  {
    rute: "/backoffice/finance/journals/[id]",
    bagian: "navGroupLedger",
    judul: "Rincian jurnal",
    isi: "Satu jurnal: tanggal, sumbernya (manual atau transaksi yang membuatnya), dan baris debit-kreditnya per akun. Tombol di samping label sumber membuka dokumen yang membuat jurnal ini (penerimaan barang dan pembayaran pemasok terbuka di PO-nya, hasil produksi di SPK-nya, muatan van di halaman van kanvasernya). Nama akun di setiap baris membuka buku besar akun itu pada bulan jurnal ini.",
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
      "Baris di bawah judul menghitung peran yang sudah terpetakan dan peran wajib yang sudah terpetakan ke akun bertipe benar. Peran berlabel Opsional tidak menahan buku besar: lima rincian biaya marketplace jatuh ke peran Biaya Marketplace (berlabel Cadangan) bila belum dipetakan, dan peran Pajak belum dipakai jurnal otomatis mana pun.",
      "Akun hanya bisa dipilih bila tipenya cocok dengan perannya. Bila belum ada akun bertipe itu, buat dulu di Bagan Akun. Mengganti akun yang sudah terpetakan meminta konfirmasi, karena semua jurnal otomatis berikutnya untuk peran itu akan masuk ke akun baru; jurnal yang sudah diposting tidak berubah.",
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
      "Setiap nota tagihan pengiriman putus punya satu baris di sini sejak nota itu terbit, berstatus Belum ada faktur. Keuangan menandainya Faktur terbit dengan nomor faktur, atau Tidak perlu faktur dengan alasan (di menu ⋯ pada barisnya); keduanya bisa dikembalikan ke Belum ada faktur dengan alasan, dan setiap perubahan tercatat di jejak audit. Istilah statusnya sama dengan Arsip Dokumen.",
      "No. Nota membuka pesanan lapangannya, tempat nota tagihan dicetak ulang dan isi barangnya terlihat — bahan untuk membuat e-Faktur. Kolom Tanggal nota adalah tanggal nota tagihan, bukan tanggal faktur pajak. Kolom Dicetak hanya tampil di layar lebar.",
      "Melihat butuh izin melihat faktur pajak; mengubah status butuh izin mengelola faktur pajak.",
    ],
  },
];
