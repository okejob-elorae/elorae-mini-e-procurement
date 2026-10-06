import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/inventory",
    bagian: "inventory",
    judul: { kunci: "inventory.pageTitle" },
    isi: [
      "Stok gudang utama: level stok, penerimaan barang, kain per roll, dan penyesuaian. Tombol di atas membuka Terima Barang, Kartu Stok, Penyesuaian, dan Barang Reject; Cetak Laporan mencetak nilai persediaan saat ini.",
      "Di tab Level Stok, tersedia = stok fisik dikurangi yang sudah dicadangkan pesanan. Statusnya: Negatif (tersedia di bawah nol), Habis (tepat nol), Menipis (di bawah atau sama dengan titik pesan ulang barangnya), dan Aman.",
      "Di tab Penerimaan Barang, penerimaan yang melebihi jumlah PO lebih dari batas lebih-terima barangnya menunggu persetujuan pemilik; pemilik bisa menyetujui atau menolaknya dari baris itu.",
    ],
  },
  {
    rute: "/backoffice/inventory/stock-card",
    bagian: "inventory",
    judul: { kunci: "inventory.stockCard.title" },
    isi: { kunci: "inventory.stockCard.subtitle" },
  },
  {
    rute: "/backoffice/inventory/grn/new",
    bagian: "inventory",
    judul: { kunci: "inventory.grnForm.pageTitle" },
    isi: [
      { kunci: "inventory.grnForm.pageSubtitle" },
      "Untuk kain, panjang setiap roll dicatat satu per satu. Bila jumlah yang diterima melebihi jumlah PO lebih dari batas lebih-terima barangnya, penerimaan ini menunggu persetujuan pemilik di tab Penerimaan Barang sebelum status PO ikut berubah.",
      "Menyimpan GRN butuh sinyal. Selama diisi, isian formulir (termasuk foto) disimpan sebagai draf di perangkat ini untuk akun Anda, jadi sinyal putus atau halaman tertutup tidak menghapusnya; draf hilang setelah GRN tersimpan atau setelah Anda menekan Buang draf. Bila sambungan putus tepat saat menyimpan, periksa tab Penerimaan Barang dulu sebelum menyimpan ulang supaya GRN tidak tercatat dua kali.",
      "GRN yang dulu disimpan di perangkat saat offline tidak pernah terkirim ke sistem. Daftarnya muncul di atas formulir: muat ke formulir lalu simpan, atau hapus bila sudah dicatat ulang.",
    ],
  },
  {
    rute: "/backoffice/inventory/adjustment/new",
    bagian: "inventory",
    judul: { kunci: "inventory.adjNew.title" },
    isi: "Menambah atau mengurangi jumlah stok satu barang di luar penerimaan dan penjualan, dengan konfirmasi PIN. Alasan selalu wajib; untuk pengurangan, foto bukti juga wajib.",
  },
  {
    rute: "/backoffice/inventory/adjustment/[id]",
    bagian: "inventory",
    judul: { kunci: "inventory.stockAdjustment" },
    isi: "Rincian satu penyesuaian stok: barang, jenis, perubahan jumlah, jumlah sebelum dan sesudah, alasan, serta siapa dan kapan. Tombol cetak menghasilkan Nota Barang Keluar.",
  },
  {
    rute: "/backoffice/inventory/rejected-goods",
    bagian: "inventory",
    judul: { kunci: "inventory.rejected.title" },
    isi: [{ kunci: "inventory.rejected.subtitle" }, { kunci: "inventory.rejected.cardDescription" }],
  },
  {
    rute: "/backoffice/inventory/stock-opname",
    bagian: "inventory",
    judul: { kunci: "stockOpname.title" },
    isi: [
      "Daftar sesi hitung fisik. Setiap sesi mencakup satu jenis barang: barang jadi, kain (per roll), atau aksesoris.",
      "Alurnya: dibuat (stok saat itu dipotret), dihitung, diajukan, lalu disetujui atau dibatalkan. Penghitung tidak bisa menyetujui hitungannya sendiri. Begitu disetujui, selisih hitungan menjadi penyesuaian stok dan jurnalnya diposting.",
    ],
  },
  {
    rute: "/backoffice/inventory/stock-opname/new",
    bagian: "inventory",
    judul: { kunci: "stockOpname.new" },
    isi: "Membuka sesi hitung fisik baru untuk satu cakupan barang. Stok tercatat saat sesi dibuat menjadi pembanding hitungannya.",
  },
  {
    rute: "/backoffice/inventory/stock-opname/[id]",
    bagian: "inventory",
    judul: "Rincian stock opname",
    isi: [
      "Ringkasan sesi, progres hitung, dan tinjauan setiap baris. Dari sini sesi diajukan, disetujui, atau dibatalkan.",
      "Bila stok sebuah barang berubah karena transaksi selama sesi berjalan, persetujuan berhenti dulu dan menampilkan barang-barangnya; pastikan hitungannya masih benar sebelum melanjutkan. Setelah disetujui, jurnal selisihnya bisa dilihat di sini, atau diposting ulang bila tadi gagal.",
    ],
  },
  {
    rute: "/backoffice/inventory/stock-opname/[id]/count",
    bagian: "inventory",
    judul: { kunci: "stockOpname.count" },
    isi: "Memasukkan hasil hitung fisik per barang untuk sesi ini, dengan mengetik jumlahnya atau memindai barcode.",
  },
  {
    rute: "/backoffice/inventory/reconciliation",
    bagian: "inventory",
    judul: { kunci: "stockReconciliation.title" },
    isi: [
      "Membandingkan stok barang jadi di Elorae dengan stok di Jubelio. Pemeriksaan berjalan otomatis setiap 6 jam bila jadwalnya dinyalakan, atau langsung lewat tombol Jalankan Sekarang.",
    ],
    kartu: [
      {
        judul: { kunci: "stockReconciliation.config" },
        isi: [
          "Selisih yang lebih besar dari ambang auto-koreksi selalu hanya ditandai. Selisih sampai ambang mengikuti arah yang dipilih:",
          "Tandai saja: tidak ada yang diubah. Samakan Jubelio: stok Elorae diubah mengikuti Jubelio. Kirim ulang stok Elorae: stok Elorae dikirim lagi ke Jubelio.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/inventory/reconciliation/[runId]",
    bagian: "inventory",
    judul: "Hasil pemeriksaan rekonsiliasi",
    isi: "Hasil satu pemeriksaan: jumlah di Elorae dan Jubelio per barang, selisihnya, dan tindakan yang diambil (sinkron, auto-koreksi, ditandai, atau diselesaikan manual). Baris yang ditandai bisa diselesaikan satu per satu: samakan dengan Jubelio, atau kirim ulang stok Elorae.",
  },
  {
    rute: "/backoffice/gudang-rusak",
    bagian: "inventory",
    judul: { kunci: "gudangRusak.kantor.judul" },
    isi: [
      { kunci: "gudangRusak.kantor.deskripsi" },
      "Diperbaiki: barang keluar dari sini dan masuk stok jual gudang. Dijual obral: keluar dari sini dan nilai jualnya dicatat; stok jual tidak berubah. Dimusnahkan: keluar dari sini tanpa masuk ke mana pun. Memutuskan butuh izin kelola persediaan.",
    ],
  },
];
