import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/pwa/stores/[id]/catalog",
    bagian: "pwaSalesman",
    judul: "Katalog toko",
    isi: [
      "Katalog barang untuk membuat pesanan toko. Isi jumlah di kartu barang (barang bervarian lewat Pilih varian), tekan Tinjau untuk memeriksa keranjang, lalu Kirim; pesanan menunggu persetujuan kantor. Pesanan hanya bisa dibuat saat Anda check-in di toko ini, kecuali pesanan jarak jauh (WhatsApp atau telepon) bila kantor mengizinkannya.",
      "Di toko putus harga dihitung server dari harga toko, lalu promo, minimum pesan, dan batas kredit toko diterapkan. Bila toko meminta harga lain, tekan Ajukan Harga di layar tinjau dan tulis alasannya — kantor menetapkan harga akhirnya saat menyetujui. Di toko konsinyasi katalog tidak menampilkan harga; tombol Sarankan produk baru menambahkan barang tanpa varian yang belum pernah dikirim ke toko itu dan masih ada stoknya.",
      "Keranjang bisa terisi otomatis dari pesanan terakhir, permintaan SPG, rekomendasi yang diterima toko, atau pesanan yang sedang Anda ubah — periksa dulu sebelum mengirim. Tanpa sinyal, pesanan disimpan di HP dan dikirim otomatis saat online.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.inden.entryJudul" },
        isi: [
          { kunci: "pwa.inden.entryIsi" },
          "Bagian ini muncul di toko putus selama ada pre-order yang dibuka kantor. Katalog pre-order hanya memuat barang pre-order itu, tanpa batas stok; toko konsinyasi tidak memakai pre-order.",
        ],
      },
    ],
  },
  {
    rute: "/pwa/stores/[id]/smart-request",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.rencanaKirim.judul" },
    isi: [
      { kunci: "pwa.rencanaKirim.pengantar" },
      { kunci: "pwa.rencanaKirim.konsiCatatan" },
      "Rencana bisa disusun tanpa check-in, tetapi drafnya hanya bisa dikirim saat kunjungan berjalan di toko ini. Pesanan yang terkirim menunggu persetujuan kantor, sama seperti pesanan dari katalog.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.rencanaKirim.sumberJudul" },
        isi: "Urutan sumber adalah urutan prioritas: barang yang belum pernah dikirim ke toko ini, yang laku di toko ini, yang laku di toko sejenis, lalu barang baru. Laku di toko ini dihitung dari buku stok SPG atau laporan laku konsinyasi bila ada; bila sisa di toko tidak tercatat, dipakai barang yang paling sering dipesan toko ini.",
      },
      {
        judul: { kunci: "pwa.rencanaKirim.drafJudul" },
        isi: [
          { kunci: "pwa.rencanaKirim.drafBantu" },
          "Artikel yang tidak masuk draf tercantum di bagian Dilewati beserta sebabnya, misalnya stok gudang kurang, sisa di toko sudah cukup, atau harga belum diatur kantor.",
        ],
      },
      {
        judul: { kunci: "pwa.rencanaKirim.estimasi" },
        isi: [
          { kunci: "pwa.rencanaKirim.estimasiBantu" },
          "Hanya untuk toko putus; draf toko konsinyasi tidak memuat harga.",
        ],
      },
    ],
  },
  {
    rute: "/pwa/stores/[id]/analisa",
    bagian: "pwaSalesman",
    judul: { kunci: "pwaAnalisaToko.title" },
    isi: [
      "Barang apa yang laku di toko ini: ringkasan, total pcs dibanding periode sebelumnya yang sama panjang, porsi per kategori, artikel teratas dengan ukuran dan warnanya, serta tren bulanan. Pilih periode 3, 6, atau 12 bulan. Dibuka dari halaman toko.",
      "Untuk toko putus angkanya dihitung dari barang yang dibeli toko (kiriman putus dan penjualan van, tanpa barang bonus). Untuk toko konsinyasi dihitung dari barang yang benar-benar laku ke pembeli, atau dari barang yang dikirim bila belum ada data laku. Toko konsinyasi tidak menampilkan rupiah.",
    ],
    kartu: [
      {
        judul: { kunci: "pwaPenyerapan.judul" },
        isi: [
          { kunci: "pwaPenyerapan.penjelasan" },
          { kunci: "pwaPenyerapan.catatanPerkiraan" },
          "Artikel yang laku cepat dan hampir habis diberi saran isi ulang; yang lambat diberi saran jangan kirim dulu (toko putus: tawarkan tukar barang; toko konsinyasi: pertimbangkan ditarik). Toko putus tanpa SPG tidak melaporkan penjualan, jadi penyerapannya tidak bisa dihitung.",
        ],
      },
      {
        judul: { kunci: "pwaAnalisaToko.categoryTitle" },
        isi: "Porsi tiap kategori dari semua pcs di periode yang dipilih. Tanda Naik, Turun, Tetap, atau Baru membandingkan porsinya dengan periode sebelumnya.",
      },
      {
        judul: { kunci: "pwaPenyerapan.dariSpg.judul" },
        isi: "Barang yang dicari pembeli tetapi tidak ada, menurut laporan SPG toko ini, dan jumlah permintaan barang SPG yang masih terbuka. Tombol Lihat permintaan SPG membuka daftar permintaannya.",
      },
      {
        judul: { kunci: "pwaPenyerapan.rekomendasi.judul" },
        isi: [
          { kunci: "pwaPenyerapan.rekomendasi.isi" },
          "Rekomendasi dikirim oleh sales pemegang toko ini; Rekomendasi saya membuka daftar rekomendasi yang pernah Anda kirim.",
        ],
      },
    ],
  },
  {
    rute: "/pwa/stores/[id]/analisa/rekomendasi",
    bagian: "pwaSalesman",
    judul: { kunci: "pwaRekomendasi.baru.judul" },
    isi: [
      "Menyusun rekomendasi barang untuk toko ini dari analisa tokonya. Rekomendasi dikirim ke SPG toko itu (bila ada) dan bisa diteruskan ke manager toko lewat WhatsApp dari rinciannya; pesannya tidak memuat harga. Hanya sales pemegang toko yang bisa mengirimnya — bila toko belum punya pemegang, sales lain juga bisa selama kantor tidak mengunci toko per sales.",
      { kunci: "pwaRekomendasi.baru.penjelasan" },
    ],
    kartu: [
      {
        judul: { kunci: "pwaRekomendasi.baru.kelompok.ISI_ULANG" },
        isi: { kunci: "pwaRekomendasi.baru.kelompokPenjelasan.ISI_ULANG" },
      },
      {
        judul: { kunci: "pwaRekomendasi.baru.kelompok.ANDALAN_TOKO" },
        isi: { kunci: "pwaRekomendasi.baru.kelompokPenjelasan.ANDALAN_TOKO" },
      },
      {
        judul: { kunci: "pwaRekomendasi.baru.kelompok.LARIS_DI_AREA" },
        isi: { kunci: "pwaRekomendasi.baru.kelompokPenjelasan.LARIS_DI_AREA" },
      },
      {
        judul: { kunci: "pwaRekomendasi.baru.kelompok.BARU" },
        isi: { kunci: "pwaRekomendasi.baru.kelompokPenjelasan.BARU" },
      },
      {
        judul: { kunci: "pwaRekomendasi.baru.kelompok.DI_TOKO" },
        isi: { kunci: "pwaRekomendasi.baru.kelompokPenjelasan.DI_TOKO" },
      },
    ],
  },
  {
    rute: "/pwa/stores/[id]/kirim-katalog",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.kirimKatalog.title" },
    isi: [
      "Membuat gambar kartu produk untuk dikirim ke toko lewat WhatsApp, bersama pesan pembuka. Hanya barang yang ada stoknya yang bisa dipilih. Pilihan awal berisi barang yang disarankan untuk toko ini lalu barang baru; produk lain bisa dicari dan ditambahkan sampai batas per kiriman.",
      "Di toko putus harga toko ini ikut tercetak di gambar dan pesan selama Tampilkan harga menyala. Di toko konsinyasi harga tidak pernah dicetak.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.kirimKatalog.previewTitle" },
        isi: "Kirim lewat WhatsApp membagikan gambar dan pesan sekaligus. Bila HP tidak bisa membagikan langsung, gambar disimpan ke HP lalu WhatsApp dibuka — lampirkan gambarnya dari galeri. Simpan gambar dan Salin pesan dipakai untuk mengirim manual.",
      },
    ],
  },
  {
    rute: "/pwa/stores/[id]/tukar",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.tukar.judul" },
    isi: [
      "Mengajukan tukar barang di toko putus yang sedang Anda kunjungi: toko mengembalikan barang dan menerima barang lain senilai yang sama, dihitung dengan harga toko putus. Ajukan saat check-in di toko itu; toko konsinyasi tidak memakai tukar barang.",
      "Pengajuan menunggu persetujuan kantor, lalu gudang menyiapkan barangnya; stok baru bergerak ketika penukaran diselesaikan. Keadaannya bisa dilihat di Tukar barang saya.",
      { kunci: "pwa.tukar.bukanRetur" },
    ],
    kartu: [
      {
        judul: { kunci: "pwa.tukar.masukJudul" },
        isi: { kunci: "pwa.tukar.masukPetunjuk" },
      },
      {
        judul: { kunci: "pwa.tukar.keluarJudul" },
        isi: { kunci: "pwa.tukar.keluarPetunjuk" },
      },
    ],
  },
  {
    rute: "/pwa/stores/baru",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.usulanToko.newTitle" },
    isi: [
      { kunci: "pwa.usulanToko.newBody" },
      "Dipakai salesman, dan SPG juga bisa. Sebelum dikirim, toko terdaftar dan usulan lain yang namanya mirip atau lokasinya berdekatan ditampilkan supaya Anda memastikan tokonya belum ada. Usulan hanya bisa dikirim saat online; riwayatnya ada di Usulan toko saya.",
    ],
  },
  {
    rute: "/pwa/piutang",
    bagian: "pwaSalesman",
    judul: { kunci: "pwaPiutang.pageTitle" },
    isi: [
      "Toko yang tagihannya Anda pegang, dengan sisa piutang dan kalimat yang menyebut sebab faktur belum lunas serta langkah berikutnya. Buka toko untuk melihat fakturnya dan mencatat janji bayar; pembayaran yang diterima dilaporkan lewat BKM.",
      "Yang tampil: faktur di toko yang Anda pegang (termasuk penjualan sales lain di toko itu), faktur penjualan Anda di toko yang belum punya pemegang, dan faktur dalam tugas tagih dari kantor. Faktur baru lunas setelah admin keuangan mencocokkan pembayarannya dengan mutasi rekening.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.tugasTagih.judul" },
        isi: "Faktur yang kantor minta Anda tagih, dengan tenggat dan catatan kantor. Sesudah menagih, tekan Tandai sudah ditagih dan tulis hasilnya; kantor membaca catatan itu.",
      },
    ],
  },
  {
    rute: "/pwa/piutang/[storeId]",
    bagian: "pwaSalesman",
    judul: "Tagihan toko",
    isi: [
      "Faktur toko ini yang ada di daftar Tagihan Anda: sisa, jatuh tempo, dan kalimat yang menjelaskan keadaan tiap faktur — sudah dilaporkan bayar, tertahan retur, janji bayar lewat, atau siap dikontrabon. Faktur yang sudah lunas tetap tercantum.",
      "Tombol Catat janji bayar muncul selama masih ada faktur bersisa yang belum masuk kontrabon berjalan.",
    ],
    kartu: [
      {
        judul: { kunci: "pwaPiutang.promisesTitle" },
        isi: "Janji bayar dan tukar faktur yang masih berjalan di toko ini, dengan tanggal janji dan jumlah fakturnya. Janji yang dicatat dari HP bertanda Belum dikonfirmasi kantor sampai kantor mengonfirmasinya.",
      },
    ],
  },
  {
    rute: "/pwa/piutang/[storeId]/janji",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.janjiBayar.title" },
    isi: [
      { kunci: "pwa.janjiBayar.body" },
      { kunci: "pwa.janjiBayar.notSettled" },
      "Yang bisa dipilih hanya faktur yang Anda tagih, masih bersisa, dan belum masuk kontrabon lain. Tanpa sinyal, janji bayar beserta fotonya disimpan di HP dan terkirim sendiri begitu ada sinyal.",
    ],
  },
  {
    rute: "/pwa/bkm",
    bagian: "pwaSalesman",
    judul: { kunci: "pwaBkm.pageTitle" },
    isi: [
      "Laporan pembayaran (BKM) yang Anda kirim, dengan keadaan masing-masing. Tekan Lapor untuk melaporkan pembayaran baru.",
      "Piutang baru berkurang setelah admin keuangan mencocokkan laporan dengan mutasi rekening; pembayaran giro baru dihitung setelah giro cair. Selama laporan belum diperiksa, Anda bisa menariknya bila salah toko atau salah faktur; laporan yang sudah diverifikasi hanya bisa dimintakan koreksi ke kantor.",
      "Laporan yang ditolak atau dibatalkan bisa dilaporkan ulang sekali dari salinannya. Tombol WhatsApp mengirim tanda terima ke toko selama laporan menunggu verifikasi, konfirmasi sesudah terverifikasi, dan kabar pembatalan bila laporan dibatalkan.",
    ],
  },
  {
    rute: "/pwa/bkm/baru",
    bagian: "pwaSalesman",
    judul: { kunci: "payments.newTitle" },
    isi: [
      { kunci: "payments.newBody" },
      { kunci: "payments.claimNotSettled" },
      "Yang bisa dipilih hanya piutang yang Anda tagih, sama dengan daftar Tagihan. Tanpa sinyal, laporan dan fotonya disimpan di HP dan terkirim sendiri begitu sinyal kembali. Sesudah terkirim, Anda bisa mengirim tanda terima ke toko lewat WhatsApp.",
      { kunci: "pesanToko.tandaTerimaPetunjuk" },
    ],
    kartu: [
      {
        judul: { kunci: "payments.sectionGiro" },
        isi: { kunci: "payments.sectionGiroHint" },
      },
      {
        judul: { kunci: "payments.sectionDeductions" },
        isi: [
          { kunci: "payments.sectionDeductionsHint" },
          { kunci: "payments.deductionReturnHint" },
        ],
      },
    ],
  },
  {
    rute: "/pwa/lainnya",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.lainnya.title" },
    isi: [
      "Menu Lainnya berisi layar yang jarang dibuka, dikelompokkan menurut pekerjaan: Hari ini, Jualan & toko, Kinerja & uang, dan Aplikasi. Angka pada \"Belum terkirim\" adalah jumlah kiriman yang masih tersimpan di HP.",
      "Tombol Keluar ada di paling bawah. Bila masih ada kiriman yang belum terkirim, Anda diberi tahu jumlahnya lebih dulu dan memilih sendiri: menunggu sinyal, atau keluar dan menghapusnya dari HP.",
    ],
  },
  {
    rute: "/pwa/hari-ini",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.hariIni.titleToday" },
    isi: [
      "Ringkasan kerja Anda untuk satu hari: kunjungan, pesanan, pelunasan, retur, jual van dan toko baru, lalu daftar kunjungan beserta hasilnya. Bawaannya hari ini; pilih tanggal di bagian atas untuk melihat enam hari sebelumnya.",
      "Kabar \"Ringkasan kerja\" pukul 18.30 WIB membuka layar ini. Layar ini hanya untuk salesman.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.hariIni.visitsTitle" },
        isi: [
          { kunci: "pwa.hariIni.effectiveHint" },
          { kunci: "pwa.hariIni.planHintToday" },
          { kunci: "pwa.hariIni.planHintPast" },
          { kunci: "pwa.hariIni.scheduleHint" },
        ],
      },
      {
        judul: { kunci: "pwa.hariIni.salesTitle" },
        isi: [
          "Jumlah pesanan dipisah antara putus dan konsinyasi; nilai rupiah hanya dihitung dari pesanan putus.",
          { kunci: "pwa.hariIni.claimsVerifiedHint" },
        ],
      },
      {
        judul: { kunci: "pwa.hariIni.outcomesTitle" },
        isi: "Banyaknya kunjungan menurut hasilnya: ada transaksi, transaksi yang belum terkirim, alasan yang Anda pilih saat check-out tanpa transaksi, atau tanpa keterangan.",
      },
      {
        judul: "Check-in ditandai",
        isi: { kunci: "pwa.hariIni.flagsHint" },
      },
      {
        judul: "Jadwal dari kantor",
        isi: "Toko yang dijadwalkan kantor untuk hari itu, yang belum didatangi di atas. \"Lihat jadwal\" membuka jadwal mingguannya.",
      },
      {
        judul: "Belum didatangi dari rencana",
        isi: "Toko dari rencana kunjungan yang belum Anda datangi, beserta alasannya: tagihan lewat janji, mulai jarang pesan, atau lama tidak dikunjungi. Toko yang sudah ada di jadwal kantor tidak diulang di sini.",
      },
    ],
  },
  {
    rute: "/pwa/jadwal",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.jadwal.title" },
    isi: [
      { kunci: "pwa.jadwal.subtitle" },
      "Hari yang dipilih tampil paling atas, lalu hari sesudahnya, lalu yang sudah lewat. Tiap toko membawa catatan kantor dan statusnya: sudah dikunjungi, belum dikunjungi, terlewat, atau izin/cuti. Toko dihitung sudah dikunjungi bila Anda check-in di sana pada hari itu.",
      "Panah di atas memindah minggu. Tekan toko untuk membuka halamannya; pada hari ini, \"Buka rute hari ini\" menyusun urutan kunjungannya.",
    ],
  },
  {
    rute: "/pwa/rute",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.rute.title" },
    isi: [
      { kunci: "pwa.rute.subtitle" },
      "Rute disusun dari toko di rencana kunjungan beranda ditambah toko yang dijadwalkan kantor hari ini (bertanda \"Dari kantor\"). Urutan dihitung di HP dari posisi Anda, jadi lokasi perlu dinyalakan; toko yang sudah Anda datangi hari ini keluar dari urutan dan pindah ke kartu \"Sudah dikunjungi hari ini\".",
      { kunci: "pwa.rute.savedNote" },
    ],
    kartu: [
      {
        judul: { kunci: "pwa.rute.summaryTitle" },
        isi: "Jarak dan waktu dihitung kasar dari jarak garis lurus, kecepatan rata-rata dalam kota, dan waktu singgah tetap di setiap toko. \"Buka di Google Maps\" membuka rutenya; karena Google Maps membatasi jumlah persinggahan, rute yang panjang dibagi beberapa bagian.",
      },
      {
        judul: "Urutan kunjungan",
        isi: "Tekan \"Atur\" untuk menaikkan, menurunkan, atau menghapus toko dan menambah toko lain dari toko Anda. Urutan yang Anda atur sendiri bisa dikembalikan dengan \"Susun otomatis\". Di bawah nama toko tertulis alasan toko itu ada di rute.",
      },
      {
        judul: "Tanpa titik lokasi",
        isi: { kunci: "pwa.rute.noLocationNote" },
      },
    ],
  },
  {
    rute: "/pwa/orders",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.pesananSaya.title" },
    isi: [
      { kunci: "pwa.pesananSaya.subtitle" },
      "Tab Menunggu berisi pesanan yang belum diputuskan kantor; Disetujui berisi pesanan yang sudah disetujui tetapi barangnya belum semua dikirim; Dikirim berisi pesanan yang sudah terkirim, yang sisanya ditutup, atau konsinyasi yang disetujui; Ditolak/batal berisi pesanan yang ditolak kantor atau Anda batalkan, dengan alasannya di tiap pesanan.",
      "Pesanan konsinyasi tidak menampilkan nilai rupiah di aplikasi ini. Lencana \"Ditahan: cek tagihan\" berarti kantor memeriksa tagihan toko dulu sebelum menyetujui.",
    ],
  },
  {
    rute: "/pwa/orders/[id]",
    bagian: "pwaSalesman",
    judul: "Rincian pesanan",
    isi: [
      "Rincian satu pesanan Anda: barang dan jumlahnya, keadaan pengiriman tiap barang, ajuan harga bila ada, nilai pesanan putus, dan perjalanan pesanan dari dibuat sampai dikirim.",
      "Selama pesanan masih menunggu persetujuan, Anda bisa mengubahnya — pesanan baru dibuat menggantikan yang lama, dengan harga, promo, dan minimum dihitung ulang — atau membatalkannya dengan alasan, sehingga stok yang dipegangnya dilepas. \"Kirim salinan ke toko (WA)\" mengirim ringkasan pesanan ke toko lewat WhatsApp; tidak tersedia untuk pesanan yang ditolak atau dibatalkan.",
    ],
    kartu: [
      {
        judul: { kunci: "pwa.pesananSaya.detail.creditTitle" },
        isi: "Hasil pemeriksaan tagihan toko saat pesanan dibuat: faktur yang lewat janji bayar, sisa tagihan yang melebihi batas nilai, atau jumlah faktur terbuka yang melebihi batas.",
      },
      {
        judul: { kunci: "pwa.pesananSaya.detail.timelineTitle" },
        isi: "Urutan kejadian pesanan: dibuat, disetujui atau ditolak kantor, setiap pengiriman dari gudang, dan penutupan sisa pesanan.",
      },
      {
        judul: { kunci: "buktiTerima.hp.judulBagian" },
        isi: "Hanya untuk pesanan putus. Setiap pengiriman dari gudang tampil di sini; tekan \"Konfirmasi diterima toko\" untuk mencatat nama penerima dan waktu diterima, beserta foto nota yang sudah ditandatangani atau tanda tangan penerima di layar. Tanpa sinyal, bukti disimpan di HP dan terkirim sendiri; bukti yang sudah tersimpan hanya bisa dikoreksi kantor.",
      },
    ],
  },
  {
    rute: "/pwa/tukar",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.tukar.saya.judul" },
    isi: [
      { kunci: "pwa.tukar.saya.subjudul" },
      "Tukar barang dipakai untuk menukar barang di toko putus, misalnya salah ukuran atau warna tidak sesuai pesanan. Nilai barang yang masuk dan keluar harus sama menurut harga putus, sehingga tagihan toko tidak berubah; toko konsinyasi tidak bisa memakai tukar barang.",
      "Pengajuan disetujui kantor, lalu gudang menyiapkan barangnya; stok baru bergerak saat penukaran diselesaikan. Selama masih Diajukan atau Disetujui, Anda bisa membatalkannya.",
    ],
  },
  {
    rute: "/pwa/van",
    bagian: "pwaSalesman",
    judul: { kunci: "vanSale.title" },
    isi: [
      { kunci: "vanSale.subtitle" },
      "Penjualan tunai di tempat dari stok mobil Anda, tanpa persetujuan kantor. Pembeli bisa toko terdaftar atau pembeli langsung yang nama dan teleponnya boleh dikosongkan. Harga memakai harga jual putus barang, jumlah tidak bisa melebihi stok di mobil, dan uang diterima harus menutup total.",
      "Stok mobil diisi kantor lewat muat van. Bila kantor menyalakan aturan toko sendiri, pilihan toko hanya toko yang Anda pegang. Sesudah dicatat, nota penjualan langsung terbuka untuk dicetak atau dibagikan.",
    ],
  },
  {
    rute: "/pwa/van/[saleId]/nota",
    bagian: "pwaSalesman",
    judul: "Nota penjualan van",
    isi: "Nota penjualan van yang baru dicatat, berukuran struk kertas thermal 80 mm. Cetak untuk mencetaknya, Bagikan (bila HP mendukung) untuk mengirimnya, dan \"Jual Lagi\" kembali ke layar Jual dari van.",
  },
  {
    rute: "/pwa/stores/usulan",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.usulanToko.pageTitle" },
    isi: [
      "Toko baru yang Anda usulkan dari HP beserta keadaannya: Menunggu (admin belum memeriksa), Disetujui (toko sudah terdaftar dengan kodenya dan bisa dibuka dari sini), atau Ditolak beserta alasan dari admin.",
      "Usulan baru dibuat lewat tombol Daftarkan toko baru. Sesudah disetujui, tokonya muncul di daftar toko Anda.",
    ],
  },
  {
    rute: "/pwa/permintaan",
    bagian: "pwaSalesman",
    judul: { kunci: "pwaPermintaanSpg.title" },
    isi: [
      { kunci: "pwaPermintaanSpg.subtitle" },
      "Anda dikabari setiap ada permintaan baru. Bawaannya tab yang masih menunggu tindakan; buka sebuah permintaan untuk membuatkan pesanan, menandainya selesai, atau menolaknya dengan alasan.",
      { kunci: "pwaPermintaanSpg.footnote" },
    ],
  },
  {
    rute: "/pwa/permintaan/[id]",
    bagian: "pwaSalesman",
    judul: "Rincian permintaan SPG",
    isi: [
      "Satu permintaan barang dari SPG di toko yang Anda pegang: daftar barang dengan alasan tiap baris (misalnya sering dikirim, laku di toko lain, atau barang baru) dan catatan SPG.",
      "Selama permintaan masih Baru atau Diproses, Anda bisa membuatkan pesanan, menandainya selesai, atau menolaknya dengan alasan. SPG dikabari setiap keputusan.",
    ],
    kartu: [
      {
        judul: { kunci: "pwaPermintaanSpg.detail.orderAction" },
        isi: [
          { kunci: "pwaPermintaanSpg.detail.orderHint" },
          "Pesanan baru bisa dikirim sesudah Anda check-in di toko itu, atau dicatat sebagai pesanan jarak jauh bila kantor mengizinkannya.",
        ],
      },
    ],
  },
  {
    rute: "/pwa/rekomendasi",
    bagian: "pwaSalesman",
    judul: { kunci: "pwaRekomendasi.saya.judul" },
    isi: [
      { kunci: "pwaRekomendasi.saya.subjudul" },
      "Statusnya: Menunggu jawaban (SPG atau toko belum menjawab), Diterima (siap dibuatkan pesanan), Ditolak, Sudah dipesan, atau Dibatalkan. Saring daftar dengan tombol status di atas.",
      { kunci: "pwaRekomendasi.saya.petunjuk" },
    ],
  },
  {
    rute: "/pwa/rekomendasi/[id]",
    bagian: "pwaSalesman",
    judul: "Rincian rekomendasi",
    isi: [
      "Satu rekomendasi barang yang Anda kirim ke toko: barang, ukuran, dan jumlahnya beserta alasannya, dan jawaban toko.",
      "Di toko yang punya SPG, SPG yang menerima atau menolaknya. Di toko tanpa SPG, kirim lewat WhatsApp ke manager toko — pesannya tanpa harga — lalu tekan \"Toko setuju\" sesudah toko menyetujuinya.",
      "Setelah diterima, \"Buat pesanan\" membuka katalog toko dengan keranjang terisi; pesanan bisa dikirim sesudah check-in di toko itu, atau sebagai pesanan jarak jauh. Selama belum dipesan, rekomendasi bisa Anda batalkan.",
    ],
  },
  {
    rute: "/pwa/penjualan",
    bagian: "pwaSalesman",
    judul: { kunci: "pwaPenjualan.title" },
    isi: [
      { kunci: "pwaPenjualan.subtitle" },
      "Angka bulan berjalan sama dengan kartu \"Bulan ini\" di beranda. Pilih bulan dengan panah atau daftar bulan di atas.",
    ],
    kartu: [
      {
        judul: { kunci: "pwaPenjualan.targetTitle" },
        isi: "Capaian penjualan bulan itu dibanding target yang diatur kantor.",
      },
      {
        judul: { kunci: "pwaPenjualan.compareTitle" },
        isi: "Penjualan bulan yang dipilih dibandingkan dengan bulan sebelumnya dan bulan yang sama tahun lalu. Bulan berjalan hanya dibandingkan pada tanggal yang sama, dari tanggal 1 sampai hari ini.",
      },
      {
        judul: { kunci: "pwaPenjualan.chartTitle" },
        isi: { kunci: "pwaPenjualan.chartHint" },
      },
      {
        judul: { kunci: "pwaPenjualan.storesTitle" },
        isi: [
          { kunci: "pwaPenjualan.storesHint" },
          "Nilai rupiah di sini tidak termasuk konsinyasi; konsinyasi hanya tampil sebagai pcs.",
        ],
      },
      {
        judul: { kunci: "pwaPenjualan.productsTitle" },
        isi: { kunci: "pwaPenjualan.productsHint" },
      },
    ],
  },
  {
    rute: "/pwa/insentif",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.insentif.title" },
    isi: [
      { kunci: "pwa.insentif.subtitle" },
      { kunci: "pwa.insentif.footer" },
    ],
    kartu: [
      {
        judul: { kunci: "pwa.insentif.collectedTitle" },
        isi: [
          { kunci: "pwa.insentif.collectedHint" },
          "Faktur penjualan rekan yang Anda tagih dibagi antara Anda dan penjualnya menurut bagian yang diatur kantor; faktur tanpa penjual seluruhnya milik penagih.",
        ],
      },
      {
        judul: { kunci: "pwa.insentif.salesTitle" },
        isi: { kunci: "pwa.insentif.salesHint" },
      },
    ],
  },
  {
    rute: "/pwa/biaya",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.biaya.judul" },
    isi: [
      { kunci: "pwa.biaya.subjudul" },
      "Klaim dikelompokkan per bulan menurut tanggal struk. Ringkasan bulan menunjukkan jumlah dan nilai klaim per status: Diajukan, Disetujui, Ditolak, dan Dibayar; klaim yang ditolak membawa alasannya.",
      "Tekan Ajukan untuk mengajukan biaya baru. Kantor bisa menutup pengajuan untuk sementara; klaim yang sudah diajukan tetap diproses.",
    ],
  },
  {
    rute: "/pwa/biaya/baru",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.biaya.baruJudul" },
    isi: [
      { kunci: "pwa.biaya.baruSubjudul" },
      "Batas jumlah per pengajuan dan umur struk mengikuti pengaturan kantor; jenis Lainnya wajib diberi catatan. Biaya yang diajukan saat Anda sedang check-in ikut tercatat pada kunjungan itu.",
      "Pengajuan butuh sinyal: tanpa sinyal, isian dan foto tetap di layar sampai Anda menekan Kirim lagi.",
    ],
  },
  {
    rute: "/pwa/orders/pending",
    bagian: "pwaSalesman",
    judul: { kunci: "pwa.offline.pendingTitle" },
    isi: [
      { kunci: "pwa.offline.pendingBody" },
      "Semua yang dicatat tanpa sinyal dan belum sampai ke kantor dikumpulkan di sini: check-in dan check-out, pesanan, foto kunjungan, laporan pelunasan, nota retur, janji bayar, dan bukti terima. Tombol Coba lagi hanya mempercepat pengiriman.",
      "Kiriman yang gagal karena isinya ditolak menunjukkan alasannya dan bisa dihapus dari HP.",
    ],
  },
];
