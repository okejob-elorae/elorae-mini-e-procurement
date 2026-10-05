import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/pwa/spg/sale",
    bagian: "pwaSpg",
    judul: { kunci: "pwa.spgJual.title" },
    isi: [
      "Layar untuk mencatat barang yang terjual di toko tetap Anda. Pindai barcode atau cari nama/SKU barang, pilih ukurannya bila barang bervarian, lalu simpan penjualan dari keranjang. Mencatat penjualan butuh check-in di toko itu; check-in yang tersimpan di HP tanpa sinyal juga berlaku.",
      "Promo konter yang berlaku dipotong otomatis, dan harga serta promo dihitung ulang server saat nota disimpan — bila berbeda dari layar, yang tercatat adalah angka server. Diskon SPG hanya muncul bila kantor mengaktifkannya, dengan batas dan aturan alasan dari kantor. Pembeli boleh dicatat; nomor HP-nya hanya disimpan bila pembeli setuju dihubungi lewat WhatsApp.",
      "Penjualan tetap dicatat walau stok toko tercatat kurang; selisihnya dibereskan saat opname. Tanpa sinyal, nota disimpan di HP dan terkirim sendiri begitu ada sinyal (Lainnya → Belum terkirim).",
    ],
    kartu: [
      {
        judul: "Promo berlaku",
        isi: "Promo konter yang sedang berlaku di toko ini, supaya bisa Anda tawarkan ke pembeli sebelum keranjang terisi. Daftar lengkapnya dibuka lewat Lihat semua promo.",
      },
      {
        judul: { kunci: "pwa.spgJual.cart.title" },
        isi: [
          { kunci: "pwa.spgJual.cart.cashierNote" },
          "Isi keranjang tetap tersimpan bila Anda meninggalkan layar ini sebentar, dan menyimpan ulang nota yang sama tidak membuatnya tercatat dua kali.",
        ],
      },
    ],
  },
  {
    rute: "/pwa/spg/[saleId]/nota",
    bagian: "pwaSpg",
    judul: { kunci: "pwa.spgNota.detail.title" },
    isi: [
      "Nota satu penjualan yang Anda catat. Dari sini nota bisa dicetak atau dibagikan ke pembeli, Anda bisa kembali menjual, atau mencatat barang yang dikembalikan pembeli lewat tombol Pembeli mengembalikan barang.",
      "Di atas kertas nota (tidak ikut tercetak) tampil keterangan bila ada: nota yang dicatat tanpa sinyal dan kapan terkirim, data pembeli, diskon SPG beserta alasannya, dan selisih bila total tercatat berbeda dari layar saat dijual karena harga atau promo dihitung ulang server. Total nota adalah yang dibayar pembeli di kasir toko, sesudah semua potongan.",
    ],
  },
  {
    rute: "/pwa/spg/[saleId]/kembali",
    bagian: "pwaSpg",
    judul: { kunci: "spgRetur.pembeli.judul" },
    isi: [
      { kunci: "spgRetur.pembeli.penjelasan" },
      "Dibuka dari nota penjualan. Jumlah yang dikembalikan tidak bisa melebihi yang terjual di nota itu dikurangi yang sudah kembali, dan alasan pembeli wajib diisi. Barang layak jual masuk lagi ke stok rak toko; barang rusak dicatat tetapi tidak kembali ke rak — kirim balik ke gudang lewat nota retur dari layar Terima kiriman.",
      "Target, komisi, dan laporan memakai penjualan bersih sesudah barang kembali. Tanpa sinyal, catatan ini disimpan di HP dan terkirim sendiri.",
    ],
  },
  {
    rute: "/pwa/spg/dicari",
    bagian: "pwaSpg",
    judul: { kunci: "pwa.spgDicari.title" },
    isi: [
      { kunci: "pwa.spgDicari.subtitle" },
      "Tidak butuh check-in: catatan bisa dibuat kapan saja pembeli bertanya. Barang boleh dipilih dari katalog (pindai atau cari) atau cukup ditulis keterangannya. Bila pembeli ingin dikabari saat barangnya datang, centang pilihannya — catatan itu sekaligus menjadi titip pesan untuk pembeli tersebut.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.spgDicari.whyTitle" },
        isi: { kunci: "pwa.spgDicari.whyBody" },
      },
    ],
  },
  {
    rute: "/pwa/spg/produk",
    bagian: "pwaSpg",
    judul: { kunci: "pwaSpgProduk.title" },
    isi: "Daftar barang jadi untuk menjawab pertanyaan pembeli di toko Anda: bahan, ukuran, harga, dan stok. Barang yang sudah tidak dijual tetapi masih ada di buku stok toko ikut tampil. Cari nama/SKU atau pindai barcode; memindai kode ukuran langsung membuka barang itu dengan ukurannya terpilih.",
  },
  {
    rute: "/pwa/spg/produk/[itemId]",
    bagian: "pwaSpg",
    judul: "Rincian info produk",
    isi: "Rincian satu barang untuk menjawab pembeli: foto, harga eceran, promo konter yang berlaku atau akan datang, bahan dan cara rawat, tabel ukuran, stok per ukuran di toko ini, dan keadaan stok di gudang.",
    kartu: [
      {
        judul: { kunci: "pwaSpgProduk.stockTitle" },
        isi: [
          { kunci: "pwaSpgProduk.stockPickHint" },
          "Angka di toko diambil dari buku stok toko; tanda gudang menunjukkan apakah barang masih ada, tinggal sedikit, atau kosong di gudang.",
        ],
      },
      {
        judul: { kunci: "pwaSpgProduk.actionsTitle" },
        isi: "Setelah ukuran dipilih, tampil toko SPG lain yang punya ukuran itu. Titip pesan: pembeli dikabari saat barangnya ada di toko Anda. Minta kiriman: permintaan sampai ke salesman pemegang toko dan kantor. Ukuran yang dipilih ikut terisi di kedua formulir.",
      },
    ],
  },
  {
    rute: "/pwa/spg/antrean",
    bagian: "pwaSpg",
    judul: { kunci: "pwa.spgAntrean.title" },
    isi: [
      { kunci: "pwaLuring.antrean.subjudul" },
      "Antrean dikirim sendiri saat sinyal kembali, atau tekan Kirim sekarang. Urutannya dijaga: check-in lebih dulu, check-out paling akhir. Nota tanpa sinyal yang lebih tua dari 14 hari ditolak server. Bila sesuatu ditolak, alasannya tampil di kartunya; nota yang ditolak karena diskon SPG atau data pembeli bisa dikirim tanpa bagian itu. Menghapus dari HP berarti pekerjaan itu tidak pernah tercatat.",
    ],
  },
  {
    rute: "/pwa/spg/promo",
    bagian: "pwaSpg",
    judul: { kunci: "pwaSpgPromo.judul" },
    isi: [
      "Promo konter yang dibuat kantor untuk toko Anda — yang berlaku hari ini dan yang akan datang — supaya bisa Anda tawarkan ke pembeli. Setiap promo menunjukkan masa berlaku dan barang atau kategori yang dikenai.",
      { kunci: "pwaSpgPromo.pengantar" },
    ],
  },
  {
    rute: "/pwa/spg/stok",
    bagian: "pwaSpg",
    judul: { kunci: "pwa.spgStok.title" },
    isi: [
      "Saldo setiap barang di toko Anda menurut buku stok toko. Saldo bertambah saat Anda menerima kiriman atau barang layak jual kembali dari pembeli, berkurang saat barang terjual, dikirim ke toko lain, atau diretur ke gudang, dan disesuaikan oleh opname. Saringan Hampir habis menampilkan barang dengan saldo 2 potong atau kurang.",
      "Saldo boleh minus: penjualan tidak pernah ditolak karena saldo kosong, dan opname yang membetulkannya. Ubin di atas membuka Terima kiriman, Opname, Minta kiriman, dan Kirim ke toko lain.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.spgStok.requests.title" },
        isi: "Permintaan kiriman dari toko ini beserta statusnya (Baru, Diproses, Selesai, Ditolak) dan catatan dari kantor atau salesman pemegang toko. Bila salesman sudah membuatkan pesanan, nomornya tampil di sini.",
      },
    ],
  },
  {
    rute: "/pwa/spg/stok/minta",
    bagian: "pwaSpg",
    judul: { kunci: "pwa.spgStok.request.title" },
    isi: [
      "Formulir untuk meminta barang dikirim ke toko Anda. Pilih barang dari daftar yang paling menipis, dari saran, atau lewat pencarian, isi jumlahnya, lalu kirim. Permintaan sampai ke salesman pemegang toko (bila ada) dan kantor; statusnya bisa diikuti di tab Stok bagian Permintaan kiriman.",
      "Tidak butuh check-in, dan permintaan tidak menggerakkan stok — barangnya baru masuk stok toko saat kirimannya Anda terima.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.spgStok.saran.title" },
        isi: "Saran dalam tiga tab: Laku di toko lain (laku di toko lain tetapi belum ada atau tinggal sedikit di sini), Sering dikirim (sering dikirim ke toko ini dan kini menipis), dan Barang baru (baru dibuat dan belum pernah ada di toko ini). Hanya ukuran yang masih ada di gudang yang ditawarkan.",
      },
    ],
  },
  {
    rute: "/pwa/spg/terima",
    bagian: "pwaSpg",
    judul: { kunci: "pwa.spgTerima.title" },
    isi: "Kiriman ke toko Anda yang belum dihitung dan diterima: pengiriman pesanan, pesanan dan kiriman konsinyasi, serta mutasi dari toko lain. Buka satu kiriman untuk menghitung dan menerimanya. Menerima butuh check-in di toko; tanpa sinyal, penerimaan disimpan di HP dan kirimannya ditandai sudah diterima di HP sampai terkirim.",
    kartu: [
      {
        judul: "Menunggu diterima",
        isi: { kunci: "pwa.spgTerima.hint" },
      },
      {
        judul: "Barang rusak",
        isi: [
          { kunci: "spgRusak.hp.petunjuk" },
          "Barang yang diputuskan dikirim balik bisa langsung dibuatkan nota retur dari kartu ini.",
        ],
      },
      {
        judul: "Barang rusak dari pembeli",
        isi: { kunci: "gudangRusak.hp.petunjuk" },
      },
    ],
  },
  {
    rute: "/pwa/spg/terima/[jenis]/[id]",
    bagian: "pwaSpg",
    judul: "Terima satu kiriman",
    isi: [
      "Formulir untuk menghitung dan menerima satu kiriman. Isi jumlah yang benar-benar diterima di setiap baris (Semua sesuai mengisi semuanya sama dengan yang dikirim); jumlah itulah yang masuk stok toko. Baris yang bukan barang katalog dicatat tetapi tidak masuk stok, dan mutasi dari toko lain tidak bisa diterima lebih dari yang dikirim. Bila yang diterima kurang dari yang dikirim, kekurangannya diteruskan ke kantor untuk diputuskan.",
      "Barang rusak dicatat lewat Ada yang rusak? dengan keterangan dan foto; barang itu dihitung diterima tetapi tidak masuk stok toko sampai gudang memutuskan. Bila toko sudah opname sesudah kiriman berangkat, barang yang sudah ikut terhitung di opname itu diisi 0 supaya tidak terhitung dua kali.",
      "Setelah disimpan, penerimaan tidak bisa diubah. Butuh check-in; tanpa sinyal, penerimaan disimpan di HP dan terkirim sendiri.",
    ],
  },
  {
    rute: "/pwa/spg/opname",
    bagian: "pwaSpg",
    judul: { kunci: "pwa.spgOpname.title" },
    isi: [
      { kunci: "pwa.spgOpname.intro.partial" },
      { kunci: "pwa.spgOpname.intro.adjust" },
      "Di toko yang belum punya stok tercatat, hasil opname pertama menjadi stok awal toko.",
      { kunci: "pwa.spgOpname.draft.autosave" },
      "Opname butuh check-in di toko. Tambahkan barang dengan memindai label (tiap pindai menambah 1), mencari, atau memuat semua barang di toko. Tanpa sinyal, hitungan disimpan di HP dan selisihnya dihitung server saat terkirim, menurut waktu Anda menghitung. Di toko konsinyasi, barang yang terhitung kurang dari saldo buku dapat dicatat kantor sebagai barang hilang.",
    ],
  },
  {
    rute: "/pwa/spg/mutasi",
    bagian: "pwaSpg",
    judul: { kunci: "spgMutasi.judul" },
    isi: [
      "Pemindahan barang antara toko Anda dan toko lain, dalam tiga tab: Keluar (dari toko ini), Masuk (dari toko lain), dan Di jalan (sudah dikirim, belum diterima). Alurnya: ajukan lewat Kirim barang ke toko lain, tunggu persetujuan kantor bila arah itu memerlukannya, tandai dikirim, lalu toko tujuan menghitung dan menerimanya lewat Terima kiriman.",
      "Arah mutasi yang boleh diatur kantor. Bawaannya hanya antar toko konsinyasi, dengan persetujuan kantor; arah yang melibatkan toko putus tidak pernah bisa langsung dikirim karena barangnya milik toko itu. Stok toko berkurang saat Anda menandai dikirim, dan bertambah di toko tujuan saat diterima.",
      "Bila yang diterima kurang dari yang dikirim, kantor memutuskan selisihnya hilang atau kembali ke toko asal. Kantor juga dapat mematikan mutasi.",
    ],
  },
  {
    rute: "/pwa/spg/mutasi/kirim",
    bagian: "pwaSpg",
    judul: { kunci: "spgMutasi.kirim.judul" },
    isi: [
      "Formulir untuk mengajukan pemindahan barang dari toko Anda ke toko lain. Barang dipilih dari buku stok toko ini saja, dan jumlah yang sudah dijanjikan ke mutasi lain ikut diperhitungkan. Toko tujuan yang muncul hanya yang diizinkan aturan kantor — sebagian arah bisa langsung dikirim, yang lain perlu persetujuan kantor lebih dulu — dan alasan wajib diisi.",
      "Mengajukan butuh check-in di toko, dan buku stok toko harus sudah dimulai lewat opname. Jumlah di atas saldo buku diperingatkan atau ditolak, sesuai pengaturan kantor. Tanpa sinyal, ajuan disimpan di HP dan aturan serta saldonya dinilai kantor saat ajuan sampai.",
    ],
  },
  {
    rute: "/pwa/spg/mutasi/[id]",
    bagian: "pwaSpg",
    judul: "Rincian mutasi",
    isi: [
      "Rincian satu mutasi: kapan diajukan dan dikirim, alasan, catatan kantor, keadaan selisih, dan barang per baris (dikirim dan diterima). Mutasi hanya terbuka untuk SPG toko asal dan toko tujuan; toko tujuan baru melihatnya sesudah barang dikirim.",
      "Toko asal menandai barang sudah dikirim setelah mutasi disetujui (butuh check-in); stok toko asal berkurang saat itu. Toko tujuan memakai Hitung dan terima. Mutasi keluar yang belum dikirim masih bisa dibatalkan, dan stok tidak berubah.",
    ],
    kartu: [
      {
        judul: { kunci: "suratJalanMutasi.judul" },
        isi: [
          { kunci: "suratJalanMutasi.petunjuk" },
          "Surat jalan tidak memuat harga. Sebelum barang ditandai dikirim, surat jalan tercetak dengan cap DRAF dan belum berlaku.",
        ],
      },
    ],
  },
  {
    rute: "/pwa/spg/nota",
    bagian: "pwaSpg",
    judul: { kunci: "pwa.spgNota.title" },
    isi: [
      { kunci: "pwa.spgNota.subtitle" },
      "Nota dikelompokkan per hari, dan di atasnya tampil jumlah serta total penjualan hari ini. Ketuk sebuah nota untuk mencetak, membagikan, atau mencatat barang yang dikembalikan pembeli. Nota yang dicatat tanpa sinyal baru muncul di sini setelah terkirim; sebelum itu ada di Belum terkirim.",
    ],
  },
  {
    rute: "/pwa/spg/lainnya",
    bagian: "pwaSpg",
    judul: { kunci: "pwa.spgLainnya.title" },
    isi: [
      "Tab Lainnya berisi pekerjaan SPG yang tidak dikerjakan setiap saat, dikelompokkan menjadi Di konter, Stok toko, Hari kerja, dan Saya. Angka kecil pada ikon Belum terkirim menunjukkan catatan yang masih tersimpan di HP dan belum sampai ke server.",
      "Tombol keluar ada di bagian bawah. Kalau masih ada catatan yang belum terkirim, Anda diberi tahu jumlahnya lebih dulu dan memilih sendiri: menunggu sinyal, atau keluar dan menghapusnya dari HP.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.spgLainnya.grupKonter" },
        isi: "Pekerjaan dengan pembeli: Pelanggan, Titip pesan, Info produk, Hitung pengunjung, Barang dicari, dan Belum terkirim.",
      },
      {
        judul: { kunci: "pwa.spgLainnya.grupStok" },
        isi: "Barang di toko Anda: Terima kiriman, Opname, Minta kiriman, Kirim ke toko lain, Retur ke gudang, Analisa penjualan, dan Rekomendasi dari sales.",
      },
      {
        judul: { kunci: "pwa.spgLainnya.grupHariKerja" },
        isi: "Tutup hari, Jadwal kerja, Absen & izin, Pengumuman, dan Toko saya.",
      },
      {
        judul: { kunci: "pwa.spgLainnya.grupSaya" },
        isi: "Target saya, Peringkat, Gaji & komisi, Beban saya, Tampilan, dan Bantuan.",
      },
    ],
  },
  {
    rute: "/pwa/spg/pelanggan",
    bagian: "pwaSpg",
    judul: { kunci: "spgPelanggan.judul" },
    isi: [
      "Daftar pembeli toko Anda yang setuju dihubungi lewat WhatsApp, misalnya untuk mengabari barang baru, titip pesan, atau promo. Cari dengan nama atau nomor HP. Pembeli juga tercatat sebagai pelanggan saat Anda mengisi pembeli di nota.",
      { kunci: "spgPelanggan.petunjuk" },
    ],
  },
  {
    rute: "/pwa/spg/pelanggan/baru",
    bagian: "pwaSpg",
    judul: { kunci: "spgPelanggan.form.judulBaru" },
    isi: "Mencatat pembeli sebagai pelanggan toko. Nomor HP harus nomor yang bisa menerima WhatsApp, dan pembeli harus setuju dihubungi — tanyakan langsung kepadanya. Kalau nomornya sudah terdaftar di toko ini, tidak dibuat pelanggan kedua; layar membuka pelanggan yang sudah ada.",
  },
  {
    rute: "/pwa/spg/pelanggan/[id]",
    bagian: "pwaSpg",
    judul: "Rincian pelanggan",
    isi: "Satu pelanggan toko: tombol Chat WhatsApp, catatan, tanggal setuju dihubungi, titip pesannya, dan riwayat belanjanya di toko ini. Hanya pelanggan toko Anda yang bisa dibuka.",
    kartu: [
      {
        judul: { kunci: "spgPelanggan.rincian.titipJudul" },
        isi: "Permintaan pembeli ini untuk dikabari saat barang datang. Titip pesan baru membuka formulir dengan pembeli ini sudah terpilih.",
      },
      {
        judul: { kunci: "spgPelanggan.rincian.riwayatJudul" },
        isi: "Nota atas nama pembeli ini di toko Anda. Totalnya sudah dikurangi potongan dan barang yang dikembalikan pembeli.",
      },
    ],
  },
  {
    rute: "/pwa/spg/pelanggan/[id]/ubah",
    bagian: "pwaSpg",
    judul: { kunci: "spgPelanggan.form.judulUbah" },
    isi: "Mengubah nama, nomor HP, atau catatan pelanggan. Kalau nomor HP diganti, persetujuan dihubungi lewat WhatsApp harus ditanyakan lagi kepada pemilik nomor yang baru. Nomor yang sudah dipakai pelanggan lain di toko ini ditolak, dengan tautan ke pelanggan itu.",
  },
  {
    rute: "/pwa/spg/titip",
    bagian: "pwaSpg",
    judul: { kunci: "spgTitip.judul" },
    isi: [
      "Pembeli yang minta dikabari saat barang yang dicarinya datang ke toko Anda, dalam tiga tab: Sudah datang, Sudah dikabari, dan Menunggu. Ketersediaan dihitung dari stok toko saat layar dibuka, dan pesan ke pembeli tidak pernah menyebut harga.",
      "Tanpa pilihan tab, layar membuka tab yang paling perlu ditindaklanjuti lebih dulu: Sudah datang, lalu Sudah dikabari, lalu Menunggu.",
    ],
    kartu: [
      {
        judul: { kunci: "spgTitip.kelompok.datang" },
        isi: { kunci: "spgTitip.petunjuk.datang" },
      },
      {
        judul: { kunci: "spgTitip.kelompok.dikabari" },
        isi: { kunci: "spgTitip.petunjuk.dikabari" },
      },
      {
        judul: { kunci: "spgTitip.kelompok.menunggu" },
        isi: { kunci: "spgTitip.petunjuk.menunggu" },
      },
    ],
  },
  {
    rute: "/pwa/spg/titip/baru",
    bagian: "pwaSpg",
    judul: { kunci: "spgTitip.form.judul" },
    isi: [
      { kunci: "spgTitip.form.penjelasan" },
      "Pilih barang dari katalog (pindai barcode, ketik SKU, atau cari nama), atau tulis keterangannya kalau barang tidak ada di katalog. Pembeli dipilih dari pelanggan toko, atau ditambahkan sebagai pembeli baru dengan persetujuan dihubungi lewat WhatsApp.",
    ],
  },
  {
    rute: "/pwa/spg/titip/[id]",
    bagian: "pwaSpg",
    judul: "Rincian titip pesan",
    isi: [
      "Satu titip pesan: pembeli, barang, jumlah, stok toko, dan tanggal-tanggalnya. Kabari lewat WhatsApp aktif setelah barangnya ada di toko; tombol itu membuka WhatsApp dengan pesan siap kirim lalu menandai pembeli sudah dikabari, dan barang disimpankan sampai tanggal yang tertulis di pesan. Mengirim ulang pesan tidak memperpanjang masa simpan.",
      "Tandai Sudah diambil saat pembeli datang, atau Batalkan dengan alasan.",
      { kunci: "spgTitip.rincian.petunjukSelesai" },
    ],
  },
  {
    rute: "/pwa/spg/pengunjung",
    bagian: "pwaSpg",
    judul: { kunci: "pwaSpgPengunjung.judul" },
    isi: [
      "Menghitung pengunjung konter: ketuk +1 pengunjung setiap ada pengunjung, dan Batalkan 1 kalau salah ketuk.",
      { kunci: "pwaSpgPengunjung.penjelasan" },
      "Hitungan yang sama tampil di kartu Pengunjung hari ini di beranda SPG, dan total toko hari itu mengisi jumlah pengunjung di laporan Tutup hari.",
    ],
    kartu: [
      {
        judul: { kunci: "pwaSpgPengunjung.riwayat.judul" },
        isi: "Hitungan Anda dan total toko beberapa hari terakhir yang sudah sampai di server.",
      },
    ],
  },
  {
    rute: "/pwa/spg/analisa",
    bagian: "pwaSpg",
    judul: { kunci: "pwaSpgAnalisa.title" },
    isi: [
      "Analisa penjualan toko Anda dari nota semua SPG di toko ini, untuk periode 7 hari, 30 hari, Bulan ini, atau Bulan lalu.",
      { kunci: "pwaSpgAnalisa.netNote" },
    ],
    kartu: [
      {
        judul: { kunci: "pwaSpgAnalisa.totalTitle" },
        isi: "Potong laku bersih pada periode yang dipilih, rata-rata per hari, dan pembandingnya: 7 hari dan 30 hari dibandingkan dengan jumlah hari yang sama tepat sebelumnya, Bulan ini dengan tanggal yang sama bulan lalu, Bulan lalu dengan bulan sebelumnya.",
      },
      {
        judul: { kunci: "pwaSpgAnalisa.topTitle" },
        isi: "Artikel paling laku pada periode ini, dengan porsi ukuran dan warnanya serta jumlah laku periode sebelumnya.",
      },
      {
        judul: { kunci: "pwaSpgAnalisa.coverTitle" },
        isi: "Sisa di rak dibagi laku rata-rata per hari selama 30 hari terakhir, tidak ikut periode yang dipilih; barang yang tidak laku tidak muncul. Sisa yang cukup untuk 7 hari atau kurang ditandai Hampir habis, dan tombol Minta mengisi formulir Minta kiriman dengan jumlah agar stok cukup sekitar 14 hari. Sisa di rak baru diketahui setelah stok toko dihitung lewat Opname.",
      },
      {
        judul: { kunci: "pwaSpgAnalisa.slowTitle" },
        isi: "Barang yang masih ada di rak, sudah lebih dari 30 hari di toko, dan tidak laku satu pun dalam 30 hari terakhir.",
      },
      {
        judul: { kunci: "pwaSpgAnalisa.shareTitle" },
        isi: "Bagian kategori, ukuran, dan warna dari seluruh potong laku bersih pada periode ini.",
      },
      {
        judul: { kunci: "pwaSpgAnalisa.wantedTitle" },
        isi: [
          { kunci: "pwaSpgAnalisa.wantedHint" },
          "Tombol Minta mengisi formulir Minta kiriman; catatan baru dibuat lewat Catat barang dicari.",
        ],
      },
    ],
  },
  {
    rute: "/pwa/spg/rekomendasi",
    bagian: "pwaSpg",
    judul: { kunci: "spgRekomendasi.judul" },
    isi: [
      "Rekomendasi barang yang dikirim salesman untuk toko Anda, yang menunggu jawaban di urutan atas. Isinya barang dan jumlah potong, tanpa harga.",
      { kunci: "spgRekomendasi.petunjuk" },
    ],
  },
  {
    rute: "/pwa/spg/rekomendasi/[id]",
    bagian: "pwaSpg",
    judul: { kunci: "pwaRekomendasi.rincian.judulSpg" },
    isi: [
      { kunci: "spgRekomendasi.rincian.penjelasan" },
      "Rekomendasi hanya bisa dijawab selama masih menunggu jawaban. Menolak wajib disertai alasan supaya sales tahu sebabnya; menerima boleh disertai catatan untuk sales.",
    ],
    kartu: [
      {
        judul: "Barang yang disarankan",
        isi: "Setiap baris menyebut barang, jumlah potong, dan alasan sales menyarankannya, misalnya laku di toko ini, laris di toko lain, atau barang baru.",
      },
    ],
  },
  {
    rute: "/pwa/spg/tutup",
    bagian: "pwaSpg",
    judul: { kunci: "spgTutupHari.hp.judul" },
    isi: [
      "Laporan penutupan hari toko Anda, dikirim sebelum pulang. Angka penjualan dihitung sistem; Anda menambahkan jumlah pengunjung, total kasir toko untuk merek kita, kendala hari itu, dan foto, sesuai yang diatur kantor.",
      "Satu laporan per toko per hari: kalau Anda atau rekan mengirim lagi, laporan hari itu diperbarui. Laporan kemarin masih bisa dikirim lewat tombol Kemarin. Pukul 21.30 WIB, SPG yang check-in hari itu menerima pengingat kalau tokonya sudah punya nota tetapi belum punya laporan. Laporan yang terkirim bisa dibagikan lewat WhatsApp.",
    ],
    kartu: [
      {
        judul: { kunci: "spgTutupHari.hp.bersihJudul" },
        isi: { kunci: "spgTutupHari.hp.sistemCatatan" },
      },
      {
        judul: { kunci: "spgTutupHari.hp.perSpgJudul" },
        isi: "Jumlah nota dan potong tiap SPG toko ini hari itu. Nilai rupiah hanya tampil untuk penjualan Anda sendiri.",
      },
      {
        judul: { kunci: "spgTutupHari.hp.isianJudul" },
        isi: "Jumlah pengunjung terisi dari penghitung pengunjung bila sudah ada hitungan, dan boleh diubah. Total kasir toko dibandingkan dengan penjualan bersih sistem, dan selisihnya ditampilkan.",
      },
    ],
  },
  {
    rute: "/pwa/spg/jadwal",
    bagian: "pwaSpg",
    judul: { kunci: "jadwalSpg.hp.judul" },
    isi: [
      "Jadwal kerja yang disusun kantor untuk 14 hari mulai hari ini: shift Anda dan shift rekan SPG setoko. Dari sini Anda mengajukan tukar shift, menjawab ajuan rekan, dan membatalkan ajuan sendiri.",
      "Tukar shift berjalan dua tahap: rekan menjawab lebih dulu, lalu kantor menyetujui. Yang ditukar adalah shift kedua orang pada hari yang dipilih, juga hari rekan yang Anda gantikan bila diisi; hari yang belum dijadwalkan menjadi libur.",
    ],
    kartu: [
      {
        judul: "Permintaan tukar shift",
        isi: [
          "Ajuan rekan yang menunggu jawaban Anda: setujui, atau tolak dengan alasan yang tidak wajib.",
          { kunci: "jadwalSpg.hp.setujuCatatan" },
        ],
      },
      {
        judul: { kunci: "jadwalSpg.hp.keluarJudul" },
        isi: "Ajuan tukar Anda yang masih berjalan. Ajuan bisa dibatalkan selama kantor belum memutuskannya.",
      },
      {
        judul: { kunci: "jadwalSpg.hp.duaMinggu" },
        isi: "Shift Anda per hari, dengan hari ini disorot, beserta shift rekan setoko; hari izin ditandai.",
      },
    ],
  },
  {
    rute: "/pwa/spg/gaji",
    bagian: "pwaSpg",
    judul: { kunci: "pwa.spgGaji.title" },
    isi: { kunci: "pwa.spgGaji.subtitle" },
    kartu: [
      {
        judul: "Perkiraan komisi bulan ini",
        isi: [
          "Perkiraan dihitung dari tarif komisi tiap barang dan potong terjual bersih bulan berjalan, sesudah dikurangi barang yang dikembalikan pembeli. Di toko konsinyasi komisi seluruh toko dibagi rata antar SPG yang bertugas; di toko putus kantor memilih dasarnya, dari penjualan Anda sendiri atau dibagi rata.",
          "Yang dibayar hanya angka resmi: di toko konsinyasi setelah kantor mengunci bulan itu, di toko putus setelah kantor menetapkannya sesudah bulan selesai.",
        ],
      },
      {
        judul: { kunci: "pwa.spgGaji.lossOpenTitle" },
        isi: "Beban barang hilang yang ditetapkan kantor kepada Anda dan belum lunas. Beban ini dipotong dari gaji atau komisi resmi saat kantor mengunci atau menetapkannya, paling banyak sebagian dari setiap pembayaran menurut aturan kantor; sisanya dipotong pada pembayaran berikutnya. Rinciannya di menu Lainnya → Beban saya.",
      },
      {
        judul: { kunci: "pwa.spgGaji.officialTitle" },
        isi: "Gaji dan komisi yang sudah dicatat kantor per bulan: gaji & komisi konsinyasi dari bulan yang dikunci, atau komisi toko putus yang ditetapkan kantor. Bila ada potongan beban barang hilang, barisnya menyebut potongan dan jumlah yang diterima; lencananya menunjukkan sudah dibayar atau belum.",
      },
    ],
  },
];
