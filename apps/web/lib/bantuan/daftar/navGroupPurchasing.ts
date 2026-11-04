import type { EntriBantuan } from "../jenis";

/** Grup menu Pembelian: pesanan pembelian, request item, pembayaran pemasok, tagihan vendor, retur ke pemasok. */
export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/purchase-orders",
    bagian: "navGroupPurchasing",
    judul: { kunci: "purchaseOrders.pageTitle" },
    isi: [
      { kunci: "purchaseOrders.pageDescription" },
      "PO dibuat sebagai draf, lalu diajukan ke pemasok. PO yang tanggal tibanya sudah lewat sementara barangnya belum lengkap dihitung terlambat.",
      "Nomor PO membuka rinciannya. Membatalkan dari daftar meminta alasan lalu PIN, dan hanya tersedia untuk PO yang belum menerima barang apa pun. PO draf dan PO yang dibatalkan tidak punya tagihan, jadi tanpa lencana status bayar.",
    ],
  },
  {
    rute: "/backoffice/purchase-orders/new",
    bagian: "navGroupPurchasing",
    judul: { kunci: "purchaseOrders.newPageTitle" },
    isi: [
      { kunci: "purchaseOrders.newPageDescription" },
      "Hanya pemasok yang sudah disetujui yang bisa dipilih. Tombol Simpan draf menyimpan PO sebagai draf; PO baru sampai ke pemasok setelah diajukan dari halaman rinciannya. Tanpa sinyal, tombolnya menjadi Simpan di perangkat dan PO dikirim saat sinyal kembali.",
      "Dari ruang kerja tahap produksi, tombol Buat PO di kartu Kebutuhan bahan membuka formulir ini sudah terisi: satu baris per bahan yang masih kurang (kebutuhan tahap dikurangi PO tahap yang tidak batal), satuannya, dan catatan \"Produksi <tahap> · <jenis>\". Varian dan harga diisi sendiri. Chip Untuk tahap bisa dilepas; PO lalu disimpan tanpa tahap.",
    ],
    kartu: [
      {
        judul: { kunci: "purchaseOrders.kebutuhan.judul" },
        isi: [
          "Hanya untuk PO yang dibuat dari tahap produksi. Per bahan: konsumsi per pcs (dari aturan pemakaian barang jadi, ditambah susut), qty yang dipesan di PO ini, dan hasilnya dalam pcs. Ubah salah satu, yang lain ikut terhitung: hasil = qty ÷ (konsumsi × (1 + susut)). Mengubah konsumsi di sini hanya untuk menghitung — aturan pemakaian barang jadi tidak berubah.",
          "Qty dipesan adalah jumlah baris PO bahan itu. Mengubahnya menulis ulang baris tersebut; bila bahannya sudah dirinci per warna, qty dibagi rata ke semua baris warnanya.",
          "Kolom Terhadap tahap membandingkan PO ini ditambah PO tahap lain dengan kebutuhan qty tahap: ✓ pas, ▲ lebih sekian pcs, atau ▼ kurang sekian pcs. Lebih kurang dari satu pcs dihitung pas; kurang sedikit pun dihitung kurang, karena pcs terakhirnya tidak jadi.",
        ],
      },
      {
        judul: { kunci: "purchaseOrders.form.kartuBarang" },
        isi: [
          "Hitung warna (ikon palet di baris bahan): total ÷ minimum per warna menjadi sekian baris bahan yang sama, qty rata dua desimal, dan baris terakhir menyerap sisa pembulatan sehingga jumlahnya tetap sama dengan total. Warnanya dipilih sesudahnya di kolom Varian.",
          "Warna kain adalah varian bahan. Pilih varian yang sudah ada, atau + Warna baru untuk menambah varian ke bahan itu (SKU varian = SKU bahan-WARNA), dengan kode Pantone TCX opsional dari katalog Pantone. Barang jadi tidak bisa diberi warna dari sini karena variannya datang dari Jubelio; bahan yang variannya punya atribut lain (mis. ukuran) juga ditolak.",
          "Kolom Roll terisi otomatis untuk bahan bersatuan kg yang kg per roll-nya diisi di Master Barang: qty ÷ kg per roll, dibulatkan ke atas.",
          "Isi massal: Qty semua baris dan Harga semua baris mengisi semua baris yang sudah berisi barang. Bagi rata kebutuhan (PO tahap) mengisi kekurangan tiap bahan tahap ke baris bahan itu yang sudah ada, dibagi rata.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/purchase-orders/[id]",
    bagian: "navGroupPurchasing",
    judul: "Rincian pesanan pembelian",
    isi: [
      "Satu PO: pemasok, tanggal tiba, jatuh tempo pembayaran, baris barang, penerimaan barang (GRN), dan riwayat statusnya. Dari sini PO dicetak, diubah, diajukan, dibatalkan, atau barangnya diterima.",
      "Terima barang (untuk PO yang sudah dikirim ke pemasok atau baru diterima sebagian) membuka formulir GRN dengan PO dan pemasok sudah terisi. Setiap GRN milik PO ini tampil di kartu Penerimaan barang dan nomornya membuka rinciannya (bila Anda boleh membuka inventori). GRN terima-lebih yang masih menunggu pemilik diberi tanda, dan yang ditolak pemilik dicoret nilainya karena penerimaannya sudah dibalik.",
      "PO draf bisa diubah dan diajukan langsung. Mengubah PO yang sudah diajukan atau sudah ada penerimaannya butuh PIN; membatalkan PO selalu butuh alasan dan PIN. Begitu ada barang diterima, PO tidak bisa dibatalkan lagi — gunakan Tutup PO bila sisanya tidak akan datang.",
      "Tandai lunas meminta konfirmasi tanggal bayar (tidak boleh sesudah hari ini) dan memperlihatkan utang barang yang sudah diterima, sisa komitmen, serta peringatan bila barangnya belum diterima.",
      "Cetak PO membuka dialog berisi paragraf pembuka dan penutup surat dari Pengaturan → Pajak → Surat PO. Teksnya boleh diubah untuk cetakan itu saja; bawaannya tidak berubah. Baris bahan berwarna tercetak dengan kolom Warna (nama warna dan kode Pantone), dan bahan bersatuan kg dengan kolom Roll serta total roll.",
    ],
  },
  {
    rute: "/backoffice/item-requests",
    bagian: "navGroupPurchasing",
    judul: { kunci: "itemRequests.title" },
    isi: [
      { kunci: "itemRequests.subtitle" },
      "Request dibuat dari perintah kerja yang bahannya kurang untuk resep bahannya (tombol Buat Request Item di WO itu); WO-nya tetap draf dan belum bisa di-Issue sampai stoknya cukup. Setiap baris adalah satu bahan beserta qty yang kurang, berstatus Terbuka, Sudah jadi PO, atau Dibatalkan.",
      "Centang baris terbuka untuk satu pemasok lalu tekan Buat PO: terbentuk satu PO draf berisi baris yang dipilih, dengan harga terakhir dari pemasok itu sebagai isian awal. Periksa PO-nya sebelum diajukan. Baris yang tidak lagi dibutuhkan bisa dibatalkan.",
      "Melihat butuh izin melihat request item; membatalkan baris butuh izin mengelolanya, dan membuat PO butuh izin mengelola request item sekaligus izin membuat PO.",
    ],
  },
  {
    rute: "/backoffice/item-requests/[id]",
    bagian: "navGroupPurchasing",
    judul: "Rincian request item",
    isi: "Satu request: WO sumbernya, tanggalnya, kapan bahannya dibutuhkan, siapa yang membuatnya, dan barisnya beserta statusnya. Baris yang sudah jadi PO menautkan ke PO-nya. Halaman ini hanya untuk dibaca; membuat PO dan membatalkan baris dilakukan dari daftar Request Item.",
  },
  {
    rute: "/backoffice/vendor-bills",
    bagian: "navGroupPurchasing",
    judul: { kunci: "vendorBills.title" },
    isi: [
      { kunci: "vendorBills.subtitle" },
      "Tagihan vendor adalah catatan invoice pemasok: nomor invoice, tanggal, jatuh tempo, dan barang atau jasa yang ditagihnya, dicocokkan dengan penerimaan barang (GRN, per barang) dan step proses WO. Utang pemasok sudah tercatat saat barangnya diterima, jadi tagihan tidak membuat utang kedua. Harga invoice yang berbeda dengan harga yang dicatat penerimaannya tidak dibayar begitu saja: bedanya menunggu keputusan di Selisih harga invoice.",
      "Dua halaman di sampingnya: Invoice belum ditagih (penerimaan yang belum ada invoice pemasoknya, untuk meminta invoicenya) dan Selisih harga invoice (beda harga yang menunggu keputusan).",
      "Daftar bisa disaring per pemasok, status (Belum dibayar, Dibayar sebagian, Lunas, Batal), dan tanggal tagihan, atau dicari dengan nomor tagihan maupun nomor invoice vendor.",
      "Tagihan dibayar lewat Pembelian → Pembayaran pemasok, bukan di sini. Status Lunas dan Dibayar sebagian ikut menghitung pembayaran itu menurut nilainya, per penerimaan barang dan per barang: penerimaan yang baru dibayar DPP-nya (PPN-nya belum) belum dianggap lunas. Bila beberapa tagihan memuat barang atau langkah WO yang sama, pembayarannya diberikan lebih dulu ke tagihan yang tanggal invoicenya lebih awal. Pembayaran lama lewat Vendor Billing juga dihitung.",
      "Melihat butuh izin melihat tagihan vendor; membuat dan membatalkan tagihan butuh izin mengelolanya.",
    ],
  },
  {
    rute: "/backoffice/vendor-bills/new",
    bagian: "navGroupPurchasing",
    judul: { kunci: "vendorBills.newTitle" },
    isi: [
      { kunci: "vendorBills.newSubtitle" },
      "Pilih penerimaan (baris GRN per barang) atau step WO yang ditagih invoice ini. Hanya yang belum habis ditagih yang muncul, dengan qty diterima, qty yang sudah ditagih, dan sisanya; barang yang sudah diretur ke pemasok tidak ikut. Qty dan harga yang ditagih boleh diubah. Untuk baris \"Exclude PPN\" ketik harga sebelum PPN.",
      "Harga yang berbeda dari harga yang dicatat penerimaannya tidak langsung menjadi utang: selisihnya menunggu keputusan di Selisih harga invoice, dan selama menunggu seluruh penerimaan itu belum bisa dibayar. GRN tanpa PO baru bisa ditagih setelah dikonfirmasi admin.",
      "PO yang sudah ditandai lunas lewat Pembayaran pemasok tetap bisa ditagih: tagihan hanya mencatat dan mencocokkan invoice, tidak membayar.",
      { kunci: "vendorBills.dueDateHint" },
      "Tagihan tidak memposting jurnal untuk barang dan jasa yang utangnya sudah tercatat saat diterima. Satu-satunya pengecualian adalah jasa step WO dari penerimaan barang jadi lama yang belum mencatat ongkos jasanya: untuk bagian itu saja, tagihan memposting biaya jasa produksi dan utangnya.",
    ],
  },
  {
    rute: "/backoffice/vendor-bills/[id]",
    bagian: "navGroupPurchasing",
    judul: "Rincian tagihan vendor",
    isi: [
      "Satu tagihan: pemasok, nomor invoice vendor, tanggal dan jatuh tempo, total invoice yang dicatat (sebelum PPN untuk baris tanpa PPN), yang sudah dibayar, dan sisanya, beserta barisnya dan sumber setiap baris (nomor GRN — atau \"Tanpa PO\" — atau step WO). Baris lama yang ditagih per item PO, bukan per penerimaan, diberi peringatan.",
      "Kartu Selisih harga invoice menampilkan beda harga baris tagihan ini dengan harga penerimaannya dan keputusannya; memutuskan butuh izin Putuskan selisih harga invoice. Tombol Bayar membuka formulir Pembayaran pemasok dengan invoice ini sudah tercentang.",
      "Ada dua kartu pembayaran. Pembayaran pemasok: pembayaran lewat Pembelian → Pembayaran pemasok atas penerimaan barang dan langkah WO yang ditagih tagihan ini. Pembayaran Vendor Billing: pembayaran lama yang dibuat di Vendor Billing sebelum 1 November 2026. Angka Dibayar dan statusnya menghitung keduanya. Tombol Bayar lewat Pembayaran pemasok membuka formulir pembayaran untuk pemasok ini.",
      "Kartu Jurnal menampilkan jurnal yang diposting tagihan ini — biasanya kosong, karena utangnya sudah tercatat saat barang diterima.",
      "Membatalkan tagihan mengembalikan barisnya supaya bisa ditagih lagi dan membalik jurnalnya. Tagihan PO yang sudah dibayar boleh dibatalkan, lalu invoicenya dicatat ulang. Pembatalan hanya ditolak selama masih ada pembayaran Vendor Billing lama yang belum dibatalkan, atau bila tagihan ini mencatat utang jasa CMT lama dan Pembayaran pemasok sudah membayar langkah itu melebihi utangnya tanpa tagihan ini — catatan di halaman menyebut langkahnya.",
    ],
  },
  {
    rute: "/backoffice/vendor-bills/belum-ditagih",
    bagian: "navGroupPurchasing",
    judul: { kunci: "navigation.navInvoiceBelumDitagih" },
    isi: [
      "Setiap penerimaan yang masih punya barang yang belum disebut invoice pemasok mana pun: penerimaan pembelian (GRN per barang, sesudah dikurangi retur ke pemasok yang sudah selesai, termasuk GRN tanpa PO yang sudah dikonfirmasi) dan step jasa WO (jahit/CMT, sablon, dan lainnya) yang barang jadinya sudah diterima, termasuk step yang ongkosnya Rp 0 di WO. Potongan dari penerimaan barang jadi lama yang ongkos jahitnya belum pernah dicatat ditandai \"utang belum tercatat\". Tidak ada batas tanggal.",
      "Kolomnya menyebut umur dalam hari (WIB) dan tandanya. Penerimaan yang masih menunggu keputusan pemilik atas kelebihan terima, atau konfirmasi admin atas GRN tanpa PO, belum bisa dimintakan invoicenya.",
      "Minta invoice: pilih dokumen satu pemasok, salurannya, dan catatan. Pesan siapnya bisa disalin atau dibuka di WhatsApp. Siapa yang meminta dan kapan tercatat. Dokumen yang sudah diminta ditindaklanjuti dengan Minta ulang.",
      "Mencatat invoicenya di Vendor Billing menutup permintaan dengan sendirinya; membatalkan invoice itu membukanya lagi. Bila 7 hari sesudah permintaan terakhir invoicenya belum datang, kantor diingatkan sekali (lonceng) dan Beranda menampilkannya. Minta ulang memulai 7 hari itu lagi.",
      "\"Tidak perlu invoice\" (alasan wajib) untuk penerimaan yang memang tidak akan pernah ber-invoice, misalnya pekerjaan sendiri senilai Rp 0. Penerimaan itu keluar dari daftar ini tanpa mengubah utangnya, dan bisa dibatalkan. Barang yang diterima kemudian muncul lagi.",
      "Melihat butuh izin melihat Vendor Billing. Meminta, menindaklanjuti, membatalkan, dan \"tidak perlu invoice\" butuh izin mengelola Vendor Billing.",
    ],
  },
  {
    rute: "/backoffice/vendor-bills/selisih-harga",
    bagian: "navGroupPurchasing",
    judul: { kunci: "navigation.navSelisihHargaInvoice" },
    isi: [
      "Harga invoice yang berbeda dengan harga yang dicatat penerimaannya — lebih tinggi (Rp 8.500 dibanding Rp 8.000 per pcs) atau lebih rendah — tidak dibayar begitu saja. Ia menunggu keputusan admin/pemilik di sini, dan selama menunggu SELURUH penerimaan itu (satu GRN atau satu step WO) tidak bisa dibayar di Bayar pemasok.",
      "Terima: utangnya dikoreksi, begitu pula HPP penerimaan itu. Barangnya yang masih ada di Gudang Utama atau di van ikut bernilai baru; barang yang sudah terjual, terpakai, atau keluar tidak dihitung ulang, dan bagiannya dicatat sebagai HPP periode itu (Selisih harga pembelian & jasa). Untuk sementara, barang yang sudah dikirim ke toko konsinyasi (di jalan maupun di gudang tokonya) juga belum ikut bernilai baru; bagiannya ikut dicatat sebagai HPP periode itu.",
      "Koreksi invoice (hanya bila invoicenya lebih tinggi): invoice diterima dengan harga penerimaannya. Invoice tidak pernah dikoreksi naik.",
      "Selisihnya termasuk PPN persis seperti yang dicatat penerimaannya.",
      "Kalau sebagian barang yang ditagih invoice sudah diretur ke pemasok, selisihnya tetap boleh diterima, dengan peringatan: utangnya ikut menghitung selisih atas barang yang diretur. Untuk angka yang tepat, batalkan tagihan lalu catat ulang tanpa barang yang diretur.",
      "Memutuskan butuh izin Putuskan selisih harga invoice (bawaannya admin). Akun Selisih harga pembelian & jasa harus sudah dipetakan di Keuangan → Pemetaan akun; sebelum itu, Terima untuk barang yang sebagian sudah terjual ditolak dan penerimaannya tetap belum bisa dibayar.",
    ],
  },
  {
    rute: "/backoffice/vendor-payments",
    bagian: "navGroupPurchasing",
    judul: "Riwayat pembayaran Vendor Billing",
    isi: [
      "Pembayaran yang dulu dicatat lewat Vendor Billing, untuk dicari dan dilihat. Sejak 1 November 2026 Vendor Billing tidak menerima pembayaran baru: semua tagihan vendor, termasuk ongkos jahit (CMT) lama, dibayar lewat Pembelian → Pembayaran pemasok, yang memotong PPh, menerima giro, memilih rekening, dan menyimpan foto bukti. Tombol di pemberitahuan atas membuka halaman itu.",
      "Pembayaran lama tetap dihitung sudah dibayar di utang pemasok, jadi Pembayaran pemasok tidak membayar bagian itu lagi. Daftar bisa disaring per pemasok dan tanggal, atau dicari; klik nomor pembayaran untuk rinciannya. Melihat butuh izin melihat pembayaran pemasok.",
    ],
  },
  {
    rute: "/backoffice/vendor-payments/[id]",
    bagian: "navGroupPurchasing",
    judul: "Rincian pembayaran Vendor Billing",
    isi: [
      "Satu pembayaran lama lewat Vendor Billing: tanggal, cara bayar, referensi, jumlah, pembuatnya, tagihan yang dilunasinya, dan jurnalnya.",
      "Pembayaran lama masih bisa dibatalkan dengan alasan (butuh izin mencatat pembayaran pemasok): alokasinya dikembalikan ke tiap tagihan dan jurnalnya dibalik. Sisa tagihannya kemudian dibayar lewat Pembayaran pemasok.",
    ],
  },
  {
    rute: "/backoffice/vendor-returns",
    bagian: "navGroupPurchasing",
    judul: { kunci: "vendorReturnsList.pageTitle" },
    isi: [
      { kunci: "vendorReturnsList.pageDescription" },
      "Kolom Dokumen terkait menampilkan perintah kerja asal retur dan PO yang utangnya dikurangi retur itu. Memproses retur mengeluarkan stok dan tidak bisa dibatalkan, jadi selalu dikonfirmasi; hanya retur draf yang bisa dihapus.",
    ],
  },
  {
    rute: "/backoffice/vendor-returns/new",
    bagian: "navGroupPurchasing",
    judul: { kunci: "vendorReturn.form.newTitle" },
    isi: [{ kunci: "vendorReturn.createReturnSubtitle" }, "Retur tersimpan sebagai draf; stok belum bergerak sampai retur diproses dari halaman rinciannya."],
    kartu: [{ judul: { kunci: "vendorReturn.form.cardTitle" }, isi: { kunci: "vendorReturn.form.cardDescription" } }],
  },
  {
    rute: "/backoffice/vendor-returns/[id]",
    bagian: "navGroupPurchasing",
    judul: "Rincian retur ke pemasok",
    isi: [
      "Satu retur ke pemasok beserta nota returnya yang bisa dicetak.",
      "Memproses retur draf mengurangi stok kain atau aksesoris yang dikembalikan (roll kainnya ditutup) atau stok reject barang jadi. Retur yang sudah diproses diselesaikan dengan nomor resi dan bukti terima.",
    ],
    kartu: [
      { judul: { kunci: "vendorReturn.summaryTitle" }, isi: { kunci: "vendorReturn.totalValueAndWO" } },
      { judul: { kunci: "vendorReturn.linesTitle" }, isi: { kunci: "vendorReturn.itemsReturned" } },
    ],
  },
  {
    rute: "/backoffice/vendor-returns/[id]/edit",
    bagian: "navGroupPurchasing",
    judul: { kunci: "vendorReturn.form.editTitle" },
    isi: { kunci: "vendorReturn.form.editSubtitle" },
    kartu: [{ judul: { kunci: "vendorReturn.form.cardTitle" }, isi: { kunci: "vendorReturn.form.cardDescription" } }],
  },
];
