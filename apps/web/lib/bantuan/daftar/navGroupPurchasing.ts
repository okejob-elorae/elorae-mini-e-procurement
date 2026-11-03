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
    rute: "/backoffice/supplier-payments",
    bagian: "navGroupPurchasing",
    judul: { kunci: "supplierPayments.judulHalaman" },
    isi: [
      "Dua tab. Utang per PO: setiap PO yang sudah dikirim ke pemasok, utangnya, dan status bayarnya. Dokumen pembayaran: setiap pembayaran ke pemasok (BYR/…) — sebagian atau penuh, ke satu atau banyak dokumen utang sekaligus, dengan uang muka dan potongan PPh.",
      "Ini satu-satunya tempat membayar pemasok, termasuk tagihan vendor dan ongkos jahit (CMT) lama: sejak 1 November 2026 Vendor Billing tidak menerima pembayaran baru dan hanya dipakai mencatat serta mencocokkan invoice. Pembayaran lama lewat Vendor Billing tetap dihitung sudah dibayar, jadi bagian itu tidak ditagih lagi di sini.",
      "Bayar pemasok membuka formulir pembayaran: pilih pemasok, lalu isi jumlah yang dibayar untuk setiap dokumen utangnya — penerimaan barang (GRN), jasa produksi/CMT per langkah WO, dan utang saldo awal. Sisanya boleh dibayar lain kali. Jumlah di luar dokumen menjadi uang muka, yang kelak diterapkan ke dokumen utang dari rincian pembayarannya.",
      "Jurnal pembayaran: utang usaha didebit sebesar bruto, rekening kas/bank dikredit sebesar yang benar-benar keluar, dan PPh yang dipotong menjadi utang PPh (PPh 23 jasa badan 2%, PPh 21 penjahit perorangan, PPh 4(2) sewa 10%). Potongan bawaan mengikuti jenis potongan di data pemasok; dasar potongan jasa CMT adalah nilai jasa tanpa PPN — barang tidak dipotong.",
      "Utang setiap dokumen dibaca dari buku besar: baris utang usaha jurnal GRN-nya (sudah termasuk PPN bila PKP), dikurangi jurnal retur ke pemasok dan pembayaran sebelumnya. GRN tanpa jurnal belum muncul sebagai utang — posting jurnalnya dulu.",
      "Kartu ringkasan dihitung di server atas SELURUH PO yang tersaring, bukan hanya halaman yang tampil. Saringan, pencarian, dan halaman tersimpan di alamat, jadi tautannya bisa dibagikan. Kartu Utang (barang sudah diterima) = nilai barang yang sudah diterima dari PO yang belum dibayar (harga PO dan PPN-nya, dikurangi retur); Komitmen PO = sisa nilai PO yang barangnya belum datang — belum menjadi utang.",
      "Tombol lama Tandai lunas (menu Aksi) tetap bekerja: membayar seluruh utang PO yang sudah dibukukan dalam satu pembayaran, yang juga tampil di tab Dokumen pembayaran. Tombol itu ditolak untuk PO yang sudah punya pembayaran dokumen — lunasi sisanya atau batalkan pembayarannya dari tab Dokumen pembayaran. PO yang utangnya habis lewat pembayaran dokumen dan tidak menunggu barang lagi ditandai lunas otomatis; membatalkan pembayarannya membuka tanda itu lagi.",
      "Saringan pemasok memuat pemasok yang disetujui dan pemasok yang punya dokumen walau belum disetujui (ditandai). Bukti bayar mencetak utang PO sesudah sisa yang tidak datang dan retur pemasok.",
    ],
  },
  {
    rute: "/backoffice/supplier-payments/baru",
    bagian: "navGroupPurchasing",
    judul: { kunci: "supplierPayments.dokumen.judulBaru" },
    isi: [
      "Satu pembayaran ke satu pemasok. Setelah pemasok dipilih, semua dokumen utangnya yang belum lunas tampil dengan sisanya; isi kolom Bayar sekarang (sebagian atau penuh) atau centang untuk melunasi. Jumlah tidak boleh melebihi sisa — diperiksa lagi di server saat menyimpan, jadi pembayaran ganda dari dua layar ditolak.",
      "Bayar per invoice: mencentang sebuah invoice pemasok mengisi setiap penerimaan yang ditagihnya dengan utang tercatatnya (bukan nilai invoice) sebesar yang perlu supaya invoice itu terbaca lunas, invoice yang tanggalnya lebih awal lebih dulu. Barang yang belum ada invoicenya tidak pernah ikut terisi, dan ditandai \"Invoice belum diterima\". Baris yang menunggu keputusan selisih harga invoice, dan baris PO yang ditandai lunas lewat tombol lama, dikunci. Membayar per penerimaan tanpa invoice tetap bisa.",
      "Uang muka = bagian yang tidak dipasangkan ke dokumen. Uang muka ikut mendebit utang usaha pemasok itu (saldonya menjadi debit sampai barangnya datang) dan diterapkan ke dokumen utang kemudian dari rincian pembayarannya — tanpa jurnal baru.",
      "Potongan PPh mengikuti data pemasok dan bisa diubah. Dasar potongan bawaan: untuk PPh 23/21, bagian jasa tanpa PPN dari dokumen jasa produksi yang dibayar (barang dan saldo awal tidak dipotong); untuk PPh 4(2) sewa, seluruh bruto. Ketik dasar lain bila perlu. Yang keluar dari rekening = bruto − potongan.",
      "PPh atas uang muka: uang muka PPh 23/21 tidak dipotong saat dibayar (dokumennya belum diketahui), kecuali dasar potongannya diketik. Bila uang muka itu kemudian diterapkan ke dokumen jasa yang belum lunas, nilainya ditandai \"belum dipotong PPh\" di dokumen itu dan ikut dasar potongan pembayaran berikutnya ke dokumen itu — jadi pelunasan memotong PPh atas seluruh tagihan (contoh: jasa 1.225.000, uang muka 500.000, pelunasan 725.000 → PPh 23 24.500, keluar 700.500). Dasar yang diketik boleh sampai bruto ditambah uang muka yang belum dipotong. Uang muka PPh 4(2) sudah dipotong saat dibayar dan tidak dipotong lagi.",
      "Tanggal bayar menjadi tanggal jurnal dan tidak boleh sesudah hari ini. Pembayaran yang dikirim dua kali (klik ganda, sinyal putus) hanya tercatat sekali.",
      "SKB pemasok: bila pemasok punya SKB yang masih berlaku pada tanggal bayar (tanggal terakhirnya ikut), pembayaran ini tidak dipotong PPh apa pun — juga bila jenis potongan dipilih — dan formulir menulis \"Dibebaskan SKB\" dengan nomor dan masa berlakunya. Pembebasannya tercatat di jejak pembayaran dan tampil di rincian pembayaran serta di Keuangan → PPh dipotong sebagai baris bernilai 0. Bila SKB sudah habis sebelum tanggal bayar, formulir memperingatkan dan potongannya normal. Uang muka yang dibayar selagi SKB berlaku tidak dipotong lagi saat diterapkan kemudian. SKB diisi di data pemasok.",
    ],
  },
  {
    rute: "/backoffice/supplier-payments/[id]",
    bagian: "navGroupPurchasing",
    judul: "Rincian pembayaran pemasok",
    isi: [
      "Dokumen utang yang dibayar, bruto, potongan PPh, yang keluar dari rekening, uang muka yang belum terpakai, dan tautan ke jurnalnya. Pembayaran yang dibebaskan SKB pemasok menulis jenis potongan yang dibebaskan, nomor SKB, dan masa berlakunya di baris potongan (Rp 0).",
      "Terapkan uang muka memasangkan sisa uang muka ke dokumen utang pemasok yang sama; uang mukanya sendiri tidak dijurnal lagi. Bila dokumen jasa itu belum lunas, PPh atas uang muka dipotong saat dokumen itu dibayar berikutnya. Bila uang muka itulah yang melunasi dokumen jasa, PPh atas uang muka yang belum dipotong dipotong saat itu juga: tercatat sebagai pembayaran potongan tersendiri (BYR/…, neto 0, jurnal utang usaha ke utang PPh) bertanggal hari penerapan, dan uang muka yang terpakai berkurang sebesar PPh itu — sisanya tetap uang muka, karena uang muka dulu dibayar tanpa potongan.",
      "Batalkan pembayaran memposting jurnal pembalik bertanggal sama dengan jurnal aslinya dan membuka lagi utang yang dibayar; mutasi bank yang sudah dicocokkan dengan pembayaran ini dilepas. Membatalkan uang muka ikut membatalkan pembayaran potongan PPh atas uang muka itu. Pembayaran dari tombol lama Tandai lunas dibatalkan lewat tombol itu di PO-nya.",
    ],
  },
  {
    rute: "/backoffice/supplier-payments/umur-hutang",
    bagian: "navGroupPurchasing",
    judul: { kunci: "supplierPayments.umur.judul" },
    isi: [
      "Sisa utang setiap pemasok dikelompokkan menurut umur dokumennya: 0–30, 31–60, 61–90, dan lebih dari 90 hari, dihitung dari tanggal GRN, tanggal penerimaan barang jadi pertama (untuk jasa produksi), atau tanggal saldo awal. Uang muka dan lebih bayar tampil sebagai kredit. Klik nama pemasok untuk melihat dokumennya.",
      "Utang jasa CMT lama yang dicatat lewat tagihan vendor dihitung umurnya dari tagihan hidup tertua yang mencatatnya, bila tagihan itu lebih awal dari penerimaan barang jadi pertama.",
      "Saldonya adalah saldo SAAT INI; mengganti tanggal hanya menggeser cara umur dihitung. Total dibandingkan dengan saldo akun utang usaha di buku besar — selisih biasanya berasal dari jurnal manual ke akun utang usaha, retur atau GRN yang belum berjurnal.",
    ],
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
      "Terima: utangnya dikoreksi, begitu pula HPP penerimaan itu. Barangnya yang masih ada di Gudang Utama, di gudang toko konsinyasi, atau di van ikut bernilai baru; barang yang sudah terjual, terpakai, atau keluar tidak dihitung ulang, dan bagiannya dicatat sebagai HPP periode itu (Selisih harga pembelian & jasa).",
      "Koreksi invoice (hanya bila invoicenya lebih tinggi): invoice diterima dengan harga penerimaannya. Invoice tidak pernah dikoreksi naik.",
      "Selisihnya termasuk PPN persis seperti yang dicatat penerimaannya.",
      "Kalau sebagian barang yang ditagih invoice sudah diretur ke pemasok, selisihnya tidak bisa diterima; batalkan tagihan lalu catat ulang tanpa barang yang diretur.",
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
