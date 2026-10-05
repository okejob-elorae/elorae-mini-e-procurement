import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/pwa",
    bagian: "pwaBersama",
    judul: { kunci: "pwaMenu.beranda" },
    isi: [
      "Layar pertama setelah masuk. Salesman dan SPG melihat beranda yang berbeda: akun yang ditetapkan ke satu toko tetap (SPG) mendapat beranda tokonya, akun lain mendapat beranda salesman.",
      "Beranda salesman adalah rencana kerja hari ini: ke toko mana, toko mana yang perlu ditagih, dan seberapa jauh Anda dari target bulan ini. Semua angkanya milik Anda sendiri.",
      "Beranda SPG disusun menurut hari kerja di toko tetap: penjualan bulan ini, check-in di toko, hal yang perlu dikerjakan, tombol Jual, lalu barang terlaris, nota hari ini, serta gaji dan komisi. Tombol Jual baru muncul setelah Anda check-in, termasuk check-in yang dicatat tanpa sinyal.",
    ],
    kartu: [
      {
        judul: "Sedang berkunjung (salesman)",
        isi: "Tampil paling atas selama Anda check-in di sebuah toko, termasuk check-in yang masih tersimpan di HP karena tanpa sinyal. Dari sini Anda langsung membuat pesanan, membuka halaman toko, atau check-out.",
      },
      {
        judul: { kunci: "pwa.beranda.targetTitle" },
        isi: [
          "Salesman: omzet Anda bulan ini dibanding target dari kantor, kekurangan per hari sampai akhir bulan, dan grafik 30 hari terakhir. Tautan Lihat riwayat membuka penjualan bulan-bulan sebelumnya; Rincian target muncul bila kantor mengatur target per kategori atau barang.",
          "SPG: penjualan bersih Anda di toko ini bulan ini dibanding target, ditambah ringkasan nota hari ini.",
        ],
      },
      {
        judul: "Absen hari ini (salesman)",
        isi: [
          { kunci: "pwa.absen.masukPetunjuk" },
          "Kartu ini hanya tampil bila kantor menyalakan absensi. Riwayat dan ajuan izin ada di menu Lainnya → Absensi.",
        ],
      },
      {
        judul: "Kartu toko dan check-in (SPG)",
        isi: "Toko tetap Anda, tombol check-in atau check-out, shift hari ini dari jadwal kantor, dan jumlah hari masuk bulan ini. Bila kantor menyalakan absensi, check-in di toko ini tercatat sebagai absen masuk dan check-out sebagai absen pulang. Check-in butuh lokasi HP; yang tercatat jauh dari titik toko ditandai.",
      },
      {
        judul: { kunci: "pwa.pengumuman.kartuJudul" },
        isi: "Pengumuman kantor yang perlu Anda lihat; yang belum dibaca ditandai. Semua pengumuman ada di menu Lainnya → Pengumuman.",
      },
      {
        judul: "Hal perlu dikerjakan",
        isi: [
          "Pekerjaan yang menunggu Anda. Hanya baris yang ada isinya yang tampil, dan kartunya hilang bila tidak ada apa-apa.",
          "Salesman: tugas tagih dari kantor, toko dari jadwal kantor yang belum didatangi, toko yang mulai jarang pesan, toko yang perlu dikunjungi, dan kiriman yang belum terkirim karena tanpa sinyal.",
          "SPG: nota atau laporan yang belum terkirim, titip pesan yang barangnya sudah datang, kiriman yang perlu dihitung dan diterima, ajuan tukar shift dari rekan, laporan tutup hari (sesudah pukul 17.00 bila hari ini sudah ada penjualan), dan barang yang hampir habis.",
        ],
      },
      {
        judul: "Rencana kunjungan hari ini (salesman)",
        isi: "Toko Anda yang perlu didatangi: yang punya tagihan, yang mulai jarang pesan, atau yang sudah melewati jarak kunjungan kelasnya (toko tanpa kelas memakai batas hari dari kantor). Toko yang dijadwalkan kantor untuk hari ini tampil paling atas, dan catatan toko yang disematkan ikut tampil di barisnya. Nyalakan lokasi HP supaya daftarnya diurutkan dari yang terdekat.",
      },
      {
        judul: "Perlu ditagih (salesman)",
        isi: "Toko yang sudah lewat tanggal janji bayar. Tombol WhatsApp membuka pesan pengingat tagihan yang sudah tersusun, tombol Telepon langsung menelepon toko. Semua tagihan ada di menu Tagihan.",
      },
      {
        judul: "Perkiraan insentif bulan ini (salesman)",
        isi: "Perkiraan komisi Anda bulan ini menurut aturan komisi kantor; angka finalnya dari kantor. Kartu ini hanya tampil bila kantor menyalakan komisi. Ketuk untuk membuka layar Insentif.",
      },
      {
        judul: "Pesanan saya (salesman)",
        isi: "Jumlah pesanan Anda menurut keadaannya: menunggu persetujuan, siap dikirim, terkirim bulan ini, dan ditolak dalam 7 hari terakhir. Ketuk sebuah angka untuk membuka daftar pesanannya.",
      },
      {
        judul: "Pengunjung hari ini (SPG)",
        isi: [
          { kunci: "pwaSpgPengunjung.penjelasan" },
          "Hitungan lengkap per hari ada di layar penghitung pengunjung.",
        ],
      },
      {
        judul: "Mulai catat stok toko (SPG)",
        isi: [
          { kunci: "pwa.spgBeranda.startStockBody" },
          "Kartu ini hilang begitu buku stok toko sudah berjalan.",
        ],
      },
      {
        judul: "Gaji & komisi (SPG)",
        isi: "Perkiraan komisi bulan ini, atau gaji dan komisi resmi terakhir beserta keterangan sudah atau belum dibayar. Ketuk untuk rinciannya.",
      },
    ],
  },
  {
    rute: "/pwa/stores",
    bagian: "pwaBersama",
    judul: { kunci: "pwa.stores.title" },
    isi: [
      "Daftar toko untuk dikunjungi. Nyalakan lokasi HP supaya toko diurutkan dari yang terdekat; pencarian memakai nama atau kode toko.",
      "Salesman: bagian Toko saya berisi toko dari riwayat kunjungan 90 hari, toko yang masih punya tagihan, dan toko yang ditugaskan kantor kepada Anda — sama dengan rencana kunjungan di beranda. Toko lain dilipat di bawahnya tetapi tetap ikut pencarian. Bila kantor menyalakan kunci hanya toko sendiri, daftar ini hanya berisi toko yang Anda pegang.",
      "SPG hanya melihat toko tetapnya.",
      "Toko yang belum terdaftar diusulkan lewat tombol Toko baru; admin yang mendaftarkannya.",
    ],
  },
  {
    rute: "/pwa/stores/[id]",
    bagian: "pwaBersama",
    judul: "Halaman toko",
    isi: [
      "Semua tentang satu toko: alamat, kontak, tombol telepon, WhatsApp, peta, lalu check-in. Pekerjaan di toko terbuka setelah check-in, yang butuh lokasi HP; check-in tanpa sinyal dicatat di HP dan terkirim sendiri begitu ada sinyal. Check-in di toko ini menutup kunjungan yang masih terbuka di toko lain.",
      "Salesman: setelah check-in, Buat pesanan, Rencana kirim, Tukar barang (khusus toko putus), Daftar periksa, dan Harga pesaing ada di kartu Kunjungan berjalan. Tanpa check-in katalog tetap bisa dibuka untuk dilihat saja. Tombol Pesanan jarak jauh muncul bila kantor mengizinkan pesanan lewat WhatsApp atau telepon, tombol Portal pesan toko hanya untuk pemegang toko, dan tombol pre-order hanya untuk toko putus selama ada pre-order yang dibuka.",
      "SPG membuka layar ini sebagai Toko saya (menu Lainnya). SPG tidak mengambil pesanan dan tidak menagih: setelah check-in yang tersedia daftar periksa (dengan panduan display), harga pesaing, foto kunjungan, ubah data toko, dan catatan toko.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.kunjunganBerjalan.judul" },
        isi: [
          "Tampil paling atas selama Anda check-in di toko ini. Check-in yang tercatat jauh dari titik toko diberi tanda jarak, dan kantor bisa melihatnya.",
          "Check-out ada di akhir bagian kunjungan, sesudah foto dan ubah data toko. Bila kunjungan salesman tidak menghasilkan pesanan, pembayaran, atau retur, Anda diminta memilih alasannya saat check-out bila kantor mewajibkannya; kantor juga bisa mewajibkan minimal satu foto kunjungan sebelum check-out.",
        ],
      },
      {
        judul: { kunci: "pwa.ringkasanToko.title" },
        isi: "Untuk salesman: sisa tagihan toko, yang lewat janji bayar, faktur terbuka, barang yang sering dibeli 180 hari terakhir, serta pesanan dan kunjungan terakhir ke toko ini. Toko konsinyasi tidak punya tagihan.",
      },
      {
        judul: { kunci: "catatanToko.judul" },
        isi: "Catatan bebas tim untuk toko ini, misalnya jam buka, siapa yang memutuskan, atau cara bayar. Catatan yang disematkan juga tampil di rencana kunjungan dan rute. Catatan Anda sendiri bisa diubah, disematkan, dan dihapus.",
      },
      {
        judul: { kunci: "pwa.saran.title" },
        isi: "Untuk salesman: kebiasaan toko ini memesan, pesanan terakhirnya, dan promo yang berlaku di toko ini. Tanda Waktunya pesan lagi muncul bila jarak sejak pesanan terakhir sudah sepanjang kebiasaannya. Pesanan terakhir bisa diulang dengan satu ketukan setelah check-in.",
      },
      {
        judul: { kunci: "pwa.stokDiToko.title" },
        isi: [
          "Untuk salesman di toko konsinyasi, dalam pcs. Tulisan Sumber di samping judul menyebut asal angkanya: buku stok SPG bila toko punya buku stok yang dicatat SPG; hitungan titipan bila tidak, yaitu barang yang dikirim dikurangi penjualan bulan yang sudah dikunci dan retur.",
          { kunci: "pwa.stokDiToko.approxNote" },
          "Perlu dihitung berarti stok minus, Hampir habis berarti stok sudah di batas minimum (atau tinggal sedikit bila belum ada target), Tidak laku 60 hari berarti tidak ada penjualan selama 60 hari. Bila kantor mengatur stok min/maks toko ini, tombol Buat pesanan isi ulang menyusun pesanan sampai batas maksimum, dibatasi stok gudang; mengirimnya butuh check-in.",
        ],
      },
      {
        judul: { kunci: "pwa.saranTawar.title" },
        isi: "Untuk salesman: barang yang layak ditawarkan ke toko ini dari tiga sumber — yang biasa dipesan toko ini dan sudah waktunya dipesan lagi, yang laris di toko lain se-area (atau di toko sejenis bila toko ini tidak punya area), dan barang baru. Hanya barang yang ada stok gudangnya. Tombol Kirim katalog mengirim daftarnya ke toko.",
      },
      {
        judul: "Foto kunjungan",
        isi: "Foto selama kunjungan, paling banyak 20 per kunjungan. Foto yang diambil tanpa sinyal disimpan di HP dan terunggah sendiri; foto yang gagal bisa dicoba lagi dari kartunya.",
      },
      {
        judul: { kunci: "pwa.storeChanges.title" },
        isi: "Selama check-in, Anda bisa mengusulkan perubahan nama, alamat, telepon, nama kontak, dan titik lokasi toko. Perubahan baru berlaku setelah admin menyetujuinya; selama menunggu, usulannya tampil sebagai Sedang ditinjau admin dan tidak bisa diusulkan lagi.",
      },
      {
        judul: { kunci: "pwa.checkIn.history" },
        isi: "20 kunjungan terakhir ke toko ini oleh siapa pun, dengan jam check-in, check-out, dan titik lokasinya. Ditutup otomatis berarti kunjungan itu ditutup sistem karena orangnya check-in di toko lain.",
      },
      {
        judul: { kunci: "pwa.checkIn.ordersTitle" },
        isi: "Untuk salesman: 5 pesanan lapangan terbaru toko ini yang menunggu persetujuan atau sudah disetujui.",
      },
    ],
  },
  {
    rute: "/pwa/stores/[id]/checklist",
    bagian: "pwaBersama",
    judul: { kunci: "pwa.checklist.judul" },
    isi: [
      "Daftar periksa display toko, diisi selama Anda check-in di toko ini — salesman maupun SPG. Kantor yang menyiapkan pertanyaannya; jawaban Anda menghasilkan skor display yang dibandingkan dengan kunjungan sebelumnya.",
      "Isian yang belum terkirim tersimpan di HP dan dipulihkan saat layar dibuka lagi. Mengirim ulang di kunjungan yang sama menimpa hasil kunjungan itu.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.checklist.panduanJudul" },
        isi: "Contoh susunan display dari kantor yang berlaku di toko ini. Setelah menata display, kirim fotonya dari sini; foto itu juga tersimpan sebagai foto kunjungan dan terunggah begitu ada sinyal.",
      },
      {
        judul: { kunci: "pwa.checklist.hasilJudul" },
        isi: "Skor dari daftar periksa yang baru dikirim, dibanding skor kunjungan sebelumnya ke toko ini.",
      },
    ],
  },
  {
    rute: "/pwa/stores/[id]/harga-pesaing",
    bagian: "pwaBersama",
    judul: { kunci: "pwa.hargaPesaing.judul" },
    isi: "Catat harga merek lain yang dipajang di toko ini selama Anda check-in di sana — salesman maupun SPG. Tulis harga di label, bukan harga promo sesaat; foto label harga tidak wajib tetapi membantu kantor memastikan harganya. Tanpa sinyal, isian dan fotonya tetap di HP sampai Anda menekan Simpan harga lagi.",
    kartu: [
      {
        judul: { kunci: "pwa.hargaPesaing.terakhirJudul" },
        isi: "20 catatan harga pesaing terbaru di toko ini, dari siapa pun yang mencatatnya.",
      },
    ],
  },
  {
    rute: "/pwa/kabar",
    bagian: "pwaBersama",
    judul: { kunci: "pwa.kabar.title" },
    isi: [
      { kunci: "pwa.kabar.subtitle" },
      "Dibuka dari ikon lonceng di beranda. Kabar yang belum dibaca ditandai; Tandai semua dibaca menandai semuanya sekaligus. Layar ini memuat 100 kabar terbaru.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.kabar.push.title" },
        isi: [
          { kunci: "pwa.kabar.push.body" },
          "Kartu ini hanya tampil selama pemberitahuan di HP ini belum menyala. Di iPhone, pemberitahuan baru bisa diterima setelah aplikasi dipasang ke layar utama.",
        ],
      },
    ],
  },
  {
    rute: "/pwa/pengumuman",
    bagian: "pwaBersama",
    judul: { kunci: "pwa.pengumuman.judul" },
    isi: [
      { kunci: "pwa.pengumuman.subjudul" },
      "Hanya pengumuman yang masih berlaku untuk peran Anda (salesman atau SPG): yang disematkan di atas, lalu yang terbaru. Yang belum dibaca ditandai, dan pengumuman yang meminta konfirmasi diberi lencana Perlu konfirmasi.",
    ],
  },
  {
    rute: "/pwa/pengumuman/[id]",
    bagian: "pwaBersama",
    judul: "Rincian pengumuman",
    isi: "Isi lengkap satu pengumuman dari kantor. Membukanya berarti membacanya — tandanya tercatat otomatis. Bila kantor meminta konfirmasi, tekan Saya mengerti; kantor melihat siapa saja yang sudah mengonfirmasi. Pengumuman yang sudah ditarik kantor atau belum terbit tidak bisa dibuka.",
  },
  {
    rute: "/pwa/absen",
    bagian: "pwaBersama",
    judul: { kunci: "pwa.absen.judul" },
    isi: [
      "Absen hari ini, ajuan izin, sakit, atau cuti, dan rekap satu bulan. Terlambat dihitung terhadap jam masuk paling lambat yang diatur kantor. Absensi hanya berjalan bila kantor menyalakannya.",
      "Salesman absen masuk dengan tombol di kartu Absen hari ini dan absen pulang dengan tombolnya sendiri. SPG tidak menekan tombol absen: check-in di toko tetap tercatat sebagai absen masuk dan check-out sebagai absen pulang.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.absen.kartuJudul" },
        isi: [
          { kunci: "pwa.absen.masukPetunjuk" },
          "Jam pulang tercatat saat Anda menekan Absen pulang dan tidak bisa diubah dari HP. Untuk SPG, kartu ini menunjukkan jam check-in dan check-out di toko tetapnya.",
        ],
      },
      {
        judul: { kunci: "pwa.izin.judul" },
        isi: "Ajukan izin, sakit, atau cuti; kantor diberi tahu dan memutuskannya. Hanya hari kerja yang dihitung, sisa cuti tahun ini terlihat di sini, dan ajuan yang masih menunggu bisa ditarik. Ajuan butuh sinyal.",
      },
      {
        judul: { kunci: "pwa.absen.rekapJudul" },
        isi: "Rekap per bulan: hari hadir, hari terlambat, menit terlambat, hari tanpa absen pulang, serta hari izin, sakit, dan cuti yang disetujui, lalu catatan per hari. Pilih bulan lain dari pilihan bulan di kartunya.",
      },
    ],
  },
  {
    rute: "/pwa/retur",
    bagian: "pwaBersama",
    judul: { kunci: "pwaRetur.pageTitle" },
    isi: [
      "Nota retur toko yang Anda laporkan beserta keadaannya: menunggu gudang menghitung, menunggu keputusan kantor atas selisih, atau beres. Potongan retur baru diakui sebesar barang yang dihitung gudang, bukan sebesar klaim toko.",
      "Selama gudang belum menghitung, Anda bisa menarik nota sendiri lewat Tarik laporan, misalnya karena salah toko atau salah nomor. Sesudah dihitung, gunakan Minta koreksi — kantor yang membetulkannya. Nota yang dibatalkan bisa dilaporkan ulang dengan isian yang tersalin.",
      "Salesman membukanya dari menu Lainnya → Retur toko, SPG dari menu Lainnya → Retur ke gudang. Untuk toko konsinyasi yang tampil jumlah potongnya.",
    ],
  },
  {
    rute: "/pwa/retur/baru",
    bagian: "pwaBersama",
    judul: { kunci: "pwaRetur.new" },
    isi: [
      "Mencatat nota retur toko. Salesman memotret nota retur dari toko, lalu menyalin nomor, toko, nilai yang diklaim, tanggal, dan cara kirimnya; fotonya wajib karena foto itulah yang dilihat gudang saat menghitung.",
      "SPG memilih barang yang dikembalikan dari buku stok toko tetapnya, beserta kondisinya. Di toko putus foto, nomor, dan total nota retur toko wajib diisi; di toko konsinyasi nomor boleh kosong (sistem memberi nomor TRK) dan nilainya dihitung kantor. Jumlah yang melebihi stok di buku harus dijelaskan di catatan.",
      "Tanpa sinyal, nota disimpan di HP dan terkirim sendiri begitu ada sinyal.",
    ],
    kartu: [
      {
        judul: { kunci: "spgRusak.retur.judul" },
        isi: [
          "Khusus SPG, saat mengirim balik barang rusak dari kiriman.",
          { kunci: "spgRusak.retur.penjelasan" },
        ],
      },
      {
        judul: { kunci: "gudangRusak.retur.judul" },
        isi: [
          "Khusus SPG, saat mengirim balik barang rusak yang dikembalikan pembeli.",
          { kunci: "gudangRusak.retur.penjelasan" },
        ],
      },
    ],
  },
  {
    rute: "/pwa/target",
    bagian: "pwaBersama",
    judul: { kunci: "pwa.target.title" },
    isi: [
      "Target per kategori dan per barang yang ditetapkan kantor untuk bulan ini, dengan kemajuan, kekurangannya, dan laju per hari yang dibutuhkan. Target total di atas sama dengan kartu Bulan ini di beranda.",
      "Salesman: capaian dihitung dari pengiriman putus, konsinyasi yang disetujui, dan penjualan van bulan ini — sama dengan omzet di beranda. Barang bonus tidak dihitung. Target barang dalam rupiah tidak menghitung konsinyasi.",
      "SPG: capaian dihitung dari nota penjualan Anda bulan ini, dikurangi barang yang dikembalikan pembeli; retur dihitung pada bulan notanya.",
    ],
  },
  {
    rute: "/pwa/peringkat",
    bagian: "pwaBersama",
    judul: { kunci: "pwa.peringkat.title" },
    isi: [
      "Posisi Anda dibanding rekan bulan ini. Salesman diurutkan menurut capaian target. SPG punya papan sendiri, diurutkan menurut penjualan bersih (nota dikurangi barang yang dikembalikan pembeli), tidak dicampur dengan salesman.",
      "Omzet dan penjualan rekan tidak pernah ditampilkan. Nama rekan bisa disembunyikan bila kantor mengaturnya; nama Anda sendiri selalu terlihat.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.peringkat.noTargetTitle" },
        isi: [
          "Salesman yang belum punya target bulan ini.",
          { kunci: "pwa.peringkat.noTargetHint" },
        ],
      },
      {
        judul: { kunci: "pwa.peringkatSpg.daftarJudul" },
        isi: { kunci: "pwa.peringkatSpg.daftarPetunjuk" },
      },
    ],
  },
  {
    rute: "/pwa/beban",
    bagian: "pwaBersama",
    judul: { kunci: "pwaBeban.pageTitle" },
    isi: "Beban yang ditetapkan kantor kepada Anda, salesman maupun SPG — hanya bagian Anda sendiri. Keputusan bebannya dibuat di kantor; layar ini hanya menampilkannya.",
    kartu: [
      {
        judul: { kunci: "bebanHilangSaya.judul" },
        isi: "Barang hilang yang sebagian atau seluruhnya dibebankan ke Anda. Bagian Anda dipotong dari komisi atau gaji, paling banyak sebesar persen yang diatur kantor dari satu pembayaran; sisanya dicicil ke pembayaran berikutnya. Bila kantor memberi keringanan diskon pegawai, angkanya sudah termasuk keringanan itu.",
      },
      {
        judul: { kunci: "bebanHilangSaya.judulRetur" },
        isi: "Selisih antara klaim retur toko dan barang yang dihitung gudang yang diputuskan kantor menjadi tanggungan Anda, sampai selisihnya diganti.",
      },
    ],
  },
  {
    rute: "/pwa/tampilan",
    bagian: "pwaBersama",
    judul: { kunci: "pwa.tampilan.title" },
    isi: "Warna aplikasi dan mode layar untuk Anda sendiri, salesman maupun SPG. Bawaannya warna perusahaan; warna yang Anda pilih hanya berlaku untuk akun Anda dan langsung tersimpan begitu diketuk, tanpa tombol Simpan. Mode layar bisa Terang, Gelap, atau Ikuti HP.",
    kartu: [
      {
        judul: { kunci: "pwa.tampilan.colourTitle" },
        isi: "Pilih dari warna cepat atau cari warna Pantone lain. Pakai warna perusahaan mengembalikan warna bawaan perusahaan.",
      },
    ],
  },
  {
    rute: "/pwa/bantuan",
    bagian: "pwaBersama",
    judul: { kunci: "bantuan.judulHalaman" },
    isi: "Kumpulan penjelasan setiap layar aplikasi HP yang bisa dicari; penjelasan layar yang sedang dibuka juga bisa dibaca lewat ikon ⓘ di samping judulnya.",
  },
];
