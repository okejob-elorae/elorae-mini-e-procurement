import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/inventory",
    bagian: "inventory",
    judul: { kunci: "inventory.pageTitle" },
    isi: [
      "Stok gudang utama: level stok, penerimaan barang, kain per roll, dan penyesuaian. Tombol di atas membuka Terima Barang, Kartu Stok, Penyesuaian, dan Barang cacat produksi; Cetak Laporan mencetak nilai persediaan saat ini. Tab yang sedang dibuka ikut tersimpan di alamat halaman, jadi tautannya bisa dibagikan.",
      "Di tab Level Stok, tersedia = stok fisik dikurangi yang sudah dicadangkan pesanan. Statusnya: Negatif (tersedia di bawah nol), Habis (tepat nol), Menipis (di bawah atau sama dengan titik pesan ulang barangnya), dan Aman.",
      "Di tab Penerimaan Barang, nomor GRN membuka rinciannya (barang, qty, harga, foto, jurnal) dan nomor PO membuka PO-nya. Penerimaan yang melebihi jumlah PO lebih dari batas lebih-terima barangnya menunggu persetujuan pemilik; pemilik menyetujui atau menolaknya dari baris itu atau dari rincian GRN.",
      "Di tab Penyesuaian, penyesuaian otomatis (penjualan, muat van, dan sejenisnya) disembunyikan kecuali dipilih lewat saringan Sumber. Di layar selebar 1280 px kolom Sumber pindah ke baris yang dibuka.",
    ],
  },
  {
    rute: "/backoffice/inventory/grn/[id]",
    bagian: "inventory",
    judul: "Rincian penerimaan barang (GRN)",
    isi: [
      "Satu GRN: pemasok, PO asalnya, siapa yang menerima, nilai, barang yang diterima beserta qty dan harga satuannya, foto, roll kain, serta retur pemasok yang berasal dari GRN ini.",
      "Bila penerimaan melebihi jumlah PO lebih dari batas barangnya, kartu Terima-lebih menunggu keputusan pemilik. Menyetujui menerima kelebihannya apa adanya; menolak membalik stok dan qty diterima di PO, dan tidak bisa dilakukan lagi bila roll kainnya sudah dipakai atau stoknya sudah keluar.",
      "Jurnal GRN (persediaan dan utang) diposting saat GRN dibuat. Bila gagal, pemegang izin kelola jurnal bisa memposting ulang dari sini; GRN yang ditolak pemilik memakai jurnal pembalik.",
    ],
  },
  {
    rute: "/gudang-retur",
    bagian: "inventory",
    judul: { kunci: "navigation.navHitungRetur" },
    isi: [
      "Layar gudang untuk menghitung barang retur toko yang datang (NRT). Hitung setiap baris yang benar-benar sampai beserta kondisinya; klaim toko baru diperlihatkan sesudah hitungan disimpan, supaya hitungan tidak ikut angka klaim.",
      "Hitungan hanya bisa dicatat sekali, dan orang yang melaporkan nota tidak boleh menghitungnya sendiri. Barang layak masuk stok jual; barang rusak atau kedaluwarsa masuk Gudang barang rusak. Selisih antara klaim dan fisik diputuskan kantor.",
      "Layar ini berdiri di luar menu samping karena dibuka orang gudang yang hanya punya izin menghitung.",
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
      "Menyimpan GRN butuh sinyal. Selama diisi, isian formulir (termasuk foto) disimpan sebagai draf di perangkat ini untuk akun Anda, jadi sinyal putus atau halaman tertutup tidak menghapusnya; draf hilang setelah GRN tersimpan atau setelah Anda menekan Buang draf. Bila sambungan putus tepat saat menyimpan, tekan Simpan lagi tanpa mengubah isian: setiap isian membawa tanda kirimnya sendiri (ikut tersimpan di draf), jadi penerimaan yang sudah tercatat dikembalikan apa adanya dan barang tidak diterima dua kali. Membuang draf memulai isian baru.",
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
    isi: "Rincian satu penyesuaian stok: barang, jenis, perubahan jumlah, jumlah sebelum dan sesudah, alasan, serta siapa dan kapan. Tombol cetak menghasilkan Nota Barang Masuk untuk penambahan dan Nota Barang Keluar untuk pengurangan.",
  },
  {
    rute: "/backoffice/inventory/rejected-goods",
    bagian: "inventory",
    judul: { kunci: "inventory.rejected.title" },
    isi: [
      { kunci: "inventory.rejected.subtitle" },
      { kunci: "inventory.rejected.cardDescription" },
      "Barang rusak atau kedaluwarsa dari retur toko tidak di sini, melainkan di Gudang barang rusak (tombol di kanan atas).",
    ],
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
