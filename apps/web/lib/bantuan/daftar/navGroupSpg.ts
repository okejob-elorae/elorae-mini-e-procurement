import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/spg-sales",
    bagian: "navGroupSpg",
    judul: { kunci: "spgSale.backoffice.list.pageTitle" },
    isi: [
      { kunci: "spgSale.backoffice.list.subtitle" },
      "Setiap nota dibuat SPG dari HP di tokonya. Pembeli membayar di kasir toko; nota mencatat barang, promo konter, diskon manual, dan nilai bersihnya. Nota yang dicatat tanpa sinyal ditandai dan terkirim belakangan.",
    ],
  },
  {
    rute: "/backoffice/spg-sales/[id]",
    bagian: "navGroupSpg",
    judul: "Rincian nota SPG",
    isi: "Satu nota penjualan SPG: toko, waktu, lokasi saat dicatat, barang per baris dengan promo dan potongannya, serta total bersih sesudah promo konter dan diskon manual. Nota lama yang mencatat uang tunai masih menampilkan uang diterima dan kembaliannya.",
    kartu: [
      {
        judul: { kunci: "spgRetur.kantor.judul" },
        isi: [
          { kunci: "spgRetur.kantor.penjelasan" },
          "Bagian ini menampilkan setiap laporan retur pembeli atas nota ini beserta statusnya (menunggu, disetujui, ditolak, ditarik SPG); hanya yang disetujui mengurangi jumlah bersih. Kolom Menunggu menyebut potong yang masih menunggu keputusan kantor — belum mengurangi penjualan bersih, stok toko, maupun komisi. Setiap laporan bisa dibuka untuk diputuskan di SPG → Retur pembeli.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/kinerja-spg",
    bagian: "navGroupSpg",
    judul: { kunci: "kinerjaSpg.judul" },
    isi: [
      { kunci: "kinerjaSpg.deskripsi" },
      "Satu baris per SPG per toko untuk bulan yang dipilih. Pilih nama SPG untuk rincian hariannya.",
      "Tabelnya dua tampilan supaya muat di laptop: Penjualan (nilai, capaian target, nota, potong, pengunjung, konversi) dan Kehadiran & layanan (jadwal, masuk, terlambat, tanpa izin, izin, tutup hari, titip pesan, pembeli tercatat, member baru). Potong bersih, izin, rata-rata per nota, retur pembeli, dan member baru hanya tampil di layar lebar; angkanya juga ada di rincian SPG. Tab yang dibuka tercatat di alamat, jadi tautannya bisa dibagikan.",
    ],
    kartu: [
      {
        judul: { kunci: "kinerjaSpg.keterangan.judul" },
        isi: [
          { kunci: "kinerjaSpg.keterangan.jadwal" },
          "Terlambat: check-in pertama lebih dari jam mulai shift ditambah toleransi keterlambatan yang diatur di Pengaturan → SPG; menitnya dihitung dari jam mulai.",
          { kunci: "kinerjaSpg.keterangan.izin" },
          { kunci: "kinerjaSpg.keterangan.nilai" },
          { kunci: "kinerjaSpg.keterangan.pengunjung" },
          { kunci: "kinerjaSpg.keterangan.konversi" },
          { kunci: "kinerjaSpg.keterangan.target" },
          { kunci: "kinerjaSpg.keterangan.tutup" },
          { kunci: "kinerjaSpg.keterangan.titip" },
          { kunci: "kinerjaSpg.keterangan.retur" },
          "Pembeli tercatat = nota SPG itu di toko itu dalam bulan itu yang mencatat pembelinya ÷ semua notanya di toko itu dalam bulan itu × 100%. Tanpa nota tampil “—”.",
          "Member baru: member yang didaftarkan SPG itu di toko itu dalam bulan itu (hari kalender WIB), dari nota maupun dari rincian pelanggan.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/kinerja-spg/[userId]",
    bagian: "navGroupSpg",
    judul: "Rincian kinerja SPG",
    isi: [
      { kunci: "kinerjaSpg.rincian.deskripsi" },
      "Satu bagian per toko tempat SPG itu bekerja di bulan yang dipilih.",
    ],
    kartu: [{ judul: "Rincian harian per toko", isi: { kunci: "kinerjaSpg.rincian.catatanBintang" } }],
  },
  {
    rute: "/backoffice/spg-tutup-hari",
    bagian: "navGroupSpg",
    judul: { kunci: "spgTutupHari.kantor.judul" },
    isi: [
      { kunci: "spgTutupHari.kantor.deskripsi" },
      "Tampilan per hari menunjukkan setiap toko yang punya SPG: sudah atau belum tutup, angka laporannya, pengunjung, konversi, total kasir, dan selisihnya. Tampilan rentang merekap beberapa hari per toko.",
      "Setiap hari pukul 21.30 WIB, SPG di toko yang hari itu sudah punya nota tetapi belum mengirim laporan tutup hari mendapat pengingat.",
      "Retur pembeli dihitung pada hari dilaporkan dan hanya bila sudah disetujui kantor.",
      "Angka pengunjung, seperti di Kinerja SPG, dari penghitung +1 di HP SPG; hari yang tidak dihitung memakai angka yang diketik di laporan tutup hari (ditandai \"dari laporan tutup hari\"). Bila SPG mengetik angka lain di laporannya, angka itu tampil di bawahnya sebagai \"Laporan\". Kinerja SPG membagi kelebihan angka laporan ke SPG yang hadir tetapi tidak menghitung, jadi totalnya bisa lebih besar daripada angka penghitung di sini. Konversi = nota ÷ pengunjung; di tampilan rentang konversinya dari laporan tutup hari.",
    ],
  },
  {
    rute: "/backoffice/spg-tutup-hari/[id]",
    bagian: "navGroupSpg",
    judul: "Rincian tutup hari",
    isi: [
      "Satu laporan tutup hari: isi laporan (angka sistem saat dikirim dan isian SPG), angka per SPG saat ini, barang terlaris, kiriman yang diterima, barang yang dicari pembeli, dan riwayat setiap kiriman laporan (sebelum → sesudah).",
      "Bila angka sistem berubah sesudah laporan dikirim, misalnya karena nota dari HP tanpa sinyal baru terkirim, layar menandainya.",
    ],
  },
  {
    rute: "/backoffice/promo-konter",
    bagian: "navGroupSpg",
    judul: { kunci: "promoKonter.judul" },
    isi: [
      { kunci: "promoKonter.deskripsi" },
      "Empat tab: daftar promo, pemakaian per promo, efektivitas per promo, dan nota dengan diskon manual SPG. Rentang tanggal bawaannya bulan berjalan (Efektivitas: 90 hari terakhir). Melihat butuh izin melihat promo; mengubah butuh izin mengelola promo.",
      "Promo jenis Paket (bundling) menjual sekumpulan barang dengan satu harga: isinya boleh barang tertentu atau barang dari kategori, masing-masing dengan jumlahnya (2–50 potong per paket, paling banyak 10 baris isi). Pada prioritas yang sama paket dihitung paling dulu, sebelum promo per potong dan beli X gratis Y. Konter mengambil potong yang termahal di antara yang cocok (barang tertentu diisi lebih dulu dari kategori), dan paket hanya terbentuk kalau harganya di bawah harga normal potong-potong itu. Potongannya dibagi ke setiap potong menurut harganya; di toko konsinyasi bagian toko berlaku seperti promo lain.",
      "Promo bertanda Khusus member hanya dipakai bila nota punya member. Spanduk di layar jual SPG tetap menampilkannya, supaya SPG bisa menawarkan pendaftaran member. Daftar promo menandai promo khusus member dan menyebut isi setiap paket.",
      "Tab Efektivitas menampilkan setiap promo yang berjalan di rentang tanggal pilihan (bawaannya 90 hari terakhir): nota yang memakai promo, potong yang kena promo, potongannya, perubahan nilai bersih penjualan barang sasaran di toko sasaran dibandingkan periode sebelumnya yang sama panjang, dan potongan per Rp1 kenaikan. Rentang memotong masa promo; pembandingnya tetap periode tepat sebelum promo mulai. Ini perbandingan, bukan bukti sebab-akibat. Klik nama promo untuk melihat hasil lengkapnya dengan rentang yang sama.",
    ],
    kartu: [
      {
        judul: { kunci: "promoKonter.aturan.judul" },
        isi: [
          { kunci: "promoKonter.aturan.pengantar" },
          { kunci: "promoKonter.aturan.satu" },
          { kunci: "promoKonter.aturan.prioritas" },
          { kunci: "promoKonter.aturan.paket" },
          { kunci: "promoKonter.aturan.belanja" },
          { kunci: "promoKonter.aturan.manual" },
          { kunci: "promoKonter.aturan.waktu" },
        ],
      },
      { judul: { kunci: "promoKonter.pemakaian.tanggunganJudul" }, isi: { kunci: "promoKonter.pemakaian.tanggunganIsi" } },
      { judul: { kunci: "promoKonter.pemakaian.judul" }, isi: { kunci: "promoKonter.pemakaian.catatan" } },
      { judul: { kunci: "efektivitasPromo.daftarJudul" }, isi: { kunci: "efektivitasPromo.pengakuan" } },
    ],
  },
  {
    rute: "/backoffice/promo-konter/[id]/hasil",
    bagian: "navGroupSpg",
    judul: "Hasil promo konter",
    isi: [
      "Halaman ini menilai satu promo konter dari data nota SPG: berapa kali promo dipakai, berapa potongannya, dan bagaimana penjualan barang sasarannya di toko sasaran selama promo dibandingkan dengan periode sebelumnya yang sama panjang. Ini perbandingan, bukan bukti bahwa promo penyebab perubahannya — musim, stok, dan promo lain juga bisa mengubah penjualan.",
      "Masa promo dihitung dari tanggal mulai promo (atau saat promo dibuat bila tanpa tanggal mulai) sampai tanggal akhirnya, saat promo dimatikan, atau sekarang — mana yang paling awal. Pembanding adalah periode sepanjang itu tepat sebelum promo mulai. Kalau Anda membuka halaman ini dari tab Efektivitas, masa promo dipotong rentang tanggal tab itu; pembandingnya tetap periode tepat sebelum promo mulai. Kalau promo pernah dimatikan lalu dinyalakan lagi, hari-hari saat mati ikut terhitung.",
      "Rincian potongan per promo baru dicatat sejak 20 Okt 2026. Nota lama yang memakai promo ini tetapi tidak punya rincian disebut jumlahnya dan tidak dihitung di pemakaian, nilai nota, dan pembeli. Penjualan barang sasarannya tetap dihitung, karena itu hanya membaca baris nota.",
    ],
    kartu: [
      { judul: "Pemakaian promo", isi: "Nota = nota yang punya rincian promo ini di masa promo. Potong = jumlah potong yang kena promo (untuk promo belanja yang dihitung notanya). Potongan = jumlah potongan promo ini di rincian nota." },
      { judul: "Penjualan barang sasaran", isi: "Barang sasaran = barang yang dipilih di promo ditambah barang yang KINI berada di kategori sasaran (kategori dibaca seperti hari ini). Potong bersih = jumlah terjual dikurangi yang dikembalikan pembeli. Nilai bersih = nilai bersih baris nota × (jumlah − kembali) ÷ jumlah — harga yang dibayar pembeli sesudah semua potongan; di toko konsinyasi itu harga di toko. Per hari = jumlah ÷ panjang periode dalam hari. Perubahan = (masa promo − pembanding) ÷ pembanding × 100; kalau pembandingnya nol tertulis 'belum ada pembanding'." },
      { judul: "Potongan per Rp1 kenaikan", isi: "Total potongan promo ÷ (nilai bersih masa promo − nilai bersih pembanding). Hanya dihitung kalau penjualan naik; kalau tidak naik tertulis 'tidak naik'. Contoh: Rp 0,28 berarti setiap Rp1 kenaikan penjualan dibayar dengan Rp0,28 potongan." },
      { judul: "Siapa menanggung potongan", isi: "Di toko konsinyasi: ditanggung toko = bagian toko yang dibekukan di rincian nota; ditanggung Elorae = potongan − bagian toko. Di toko putus barangnya milik toko, jadi potongannya hanya dicatat." },
      { judul: "Nilai nota", isi: "Rata-rata nilai nota (total sesudah potongan, dikurangi barang yang dikembalikan) di toko sasaran selama promo: nota yang memakai promo ini dibandingkan dengan nota yang tidak memakainya — termasuk nota dengan promo lain. Nota lama tanpa rincian tidak dimasukkan ke keduanya." },
      { judul: "Pembeli", isi: "Hanya pembeli yang dicatat SPG di nota. Cakupan = nota promo dengan pembeli tercatat ÷ seluruh nota promo. Pembeli dikenali dari nomor WhatsApp-nya di toko mana pun. Baru = nomor itu belum punya nota di toko mana pun sebelum masa promo. Member = setidaknya satu nota promonya tercatat dengan member. Belanja lagi = punya nota di toko mana pun dalam 30 hari sesudah masa promo berakhir; baru dinilai sesudah promo berakhir dan 30 hari itu lewat." },
      { judul: "Potong terjual per hari", isi: "Potong bersih barang sasaran per hari: hari ke-1 masa promo dijajarkan dengan hari ke-1 pembanding, dan seterusnya. Satu 'hari' = 24 jam sejak awal periodenya. Pada promo yang masih berjalan, hari terakhir belum penuh, dan hari terakhir pembandingnya sama panjang." },
      { judul: "Per toko", isi: "Angka yang sama, per toko. Promo untuk toko tertentu menampilkan toko sasarannya; promo semua toko menampilkan setiap toko yang punya nota SPG di masa promo atau pembanding." },
    ],
  },
  {
    rute: "/backoffice/promo-konter/baru",
    bagian: "navGroupSpg",
    judul: { kunci: "promoKonter.judulBaru" },
    isi: [
      { kunci: "promoKonter.deskripsiBaru" },
      "Pilih jenis Paket (bundling) untuk menjual beberapa barang dengan satu harga. Di bagian Isi satu paket, setiap baris memilih Barang tertentu atau Barang dari kategori beserta jumlahnya; total isi paket tampil di bawahnya. Isi Harga satu paket — contoh di bawahnya memakai harga contoh per potong dan menunjukkan apakah paket terbentuk. Bagian Barang yang ikut tidak dipakai untuk paket: barangnya ditentukan isi paket.",
      "Pada prioritas yang sama paket dihitung paling dulu; konter mengambil potong yang termahal di antara yang cocok, dan paket hanya terbentuk kalau harganya di bawah harga normal potong-potong itu. Potongannya dibagi ke setiap potong menurut harganya, dan bagian toko di toko konsinyasi berlaku seperti promo lain.",
      "Sakelar Khusus member berlaku untuk semua jenis promo: promonya hanya dipakai bila nota punya member, tetapi spanduk di layar jual tetap menampilkannya.",
    ],
    kartu: [
      {
        judul: { kunci: "promoKonter.aturan.judul" },
        isi: [
          { kunci: "promoKonter.aturan.pengantar" },
          { kunci: "promoKonter.aturan.satu" },
          { kunci: "promoKonter.aturan.prioritas" },
          { kunci: "promoKonter.aturan.paket" },
          { kunci: "promoKonter.aturan.belanja" },
          { kunci: "promoKonter.aturan.manual" },
          { kunci: "promoKonter.aturan.waktu" },
        ],
      },
      { judul: { kunci: "promoKonter.form.diskonManualJudul" }, isi: { kunci: "promoKonter.form.diskonManualIsi" } },
    ],
  },
  {
    rute: "/backoffice/promo-konter/[id]",
    bagian: "navGroupSpg",
    judul: { kunci: "promoKonter.judulUbah" },
    isi: [
      { kunci: "promoKonter.deskripsiUbah" },
      "Pilih jenis Paket (bundling) untuk menjual beberapa barang dengan satu harga. Di bagian Isi satu paket, setiap baris memilih Barang tertentu atau Barang dari kategori beserta jumlahnya; total isi paket tampil di bawahnya. Isi Harga satu paket — contoh di bawahnya memakai harga contoh per potong dan menunjukkan apakah paket terbentuk. Bagian Barang yang ikut tidak dipakai untuk paket: barangnya ditentukan isi paket.",
      "Pada prioritas yang sama paket dihitung paling dulu; konter mengambil potong yang termahal di antara yang cocok, dan paket hanya terbentuk kalau harganya di bawah harga normal potong-potong itu. Potongannya dibagi ke setiap potong menurut harganya, dan bagian toko di toko konsinyasi berlaku seperti promo lain.",
      "Sakelar Khusus member berlaku untuk semua jenis promo: promonya hanya dipakai bila nota punya member, tetapi spanduk di layar jual tetap menampilkannya.",
      "Mengubah isi paket atau sakelar khusus member hanya berlaku untuk nota berikutnya; jejak perubahan mencatat isi paket dan sakelar itu sebelum dan sesudah.",
    ],
    kartu: [
      {
        judul: { kunci: "promoKonter.aturan.judul" },
        isi: [
          { kunci: "promoKonter.aturan.pengantar" },
          { kunci: "promoKonter.aturan.satu" },
          { kunci: "promoKonter.aturan.prioritas" },
          { kunci: "promoKonter.aturan.paket" },
          { kunci: "promoKonter.aturan.belanja" },
          { kunci: "promoKonter.aturan.manual" },
          { kunci: "promoKonter.aturan.waktu" },
        ],
      },
      { judul: { kunci: "promoKonter.form.diskonManualJudul" }, isi: { kunci: "promoKonter.form.diskonManualIsi" } },
    ],
  },
  {
    rute: "/backoffice/spg-pelanggan",
    bagian: "navGroupSpg",
    judul: { kunci: "spgPelanggan.kantor.judul" },
    isi: [
      { kunci: "spgPelanggan.kantor.deskripsi" },
      "Tiga tab. Pelanggan: ringkasan pencatatan pembeli per toko dan semua toko dalam periode yang dipilih (30, 90, 180, atau 365 hari terakhir, hari kalender WIB; bawaan 90); pilih toko untuk melihat daftar pelanggannya. Member: member Elorae di semua toko. Titip pesan: per toko berapa permintaan di tiap status dan barang yang paling sering dititip.",
      "Tiga layar ini saling terkait dan saling ditautkan di kepala halaman: titip pesan (pembeli menunggu barang tertentu), barang dicari pembeli (yang ditanyakan tetapi tidak ada di rak), dan permintaan kiriman SPG. Permintaan pembeli yang sering muncul sebaiknya diteruskan SPG menjadi permintaan kiriman ke salesman pemegang toko.",
    ],
    kartu: [
      {
        judul: "Ringkasan pelacakan",
        isi: [
          "Pelanggan tercatat: pembeli yang dicatat SPG di toko itu. Orang yang sama di dua toko dihitung dua kali — pelanggan milik toko.",
          "Member aktif: per toko, pelanggan toko itu yang nomornya member aktif. Di ringkasan semua toko, jumlah member aktif Elorae; satu member yang belanja di dua toko dihitung sekali, jadi angkanya tidak sama dengan jumlah per toko.",
          "Nota dengan pembeli tercatat = nota SPG dalam periode yang mencatat pembelinya ÷ semua nota SPG dalam periode × 100%. Toko yang menjual tanpa mencatat pembeli tampil 0%.",
          "Pelanggan kembali = pembeli yang belanja dalam periode dan sudah punya dua nota atau lebih di toko itu ÷ semua pembeli yang belanja dalam periode × 100%.",
          "Belanja pertama: pelanggan yang nota pertamanya di toko itu jatuh dalam periode.",
          "Pelanggan tidur: belanja terakhirnya di toko itu sudah sekian hari atau lebih yang lalu (Pengaturan → SPG → Member & pelanggan, bawaan 90 hari). Tidak tergantung periode.",
          "Belanja tercatat: nilai nota berpembeli dalam periode sesudah potongan, dikurangi barang yang sudah dikembalikan pembeli. Persen tampil “—” bila penyebutnya nol.",
        ],
      },
      {
        judul: "Pelanggan satu toko",
        isi: [
          { kunci: "spgPelanggan.kantor.samarPetunjuk" },
          "Status diperiksa berurutan: Belum belanja (dicatat tanpa nota, misalnya dari titip pesan); Tidur (belanja terakhir sekian hari atau lebih yang lalu); Baru (belanja pertama dalam periode dan baru satu nota); selain itu Aktif. Tidur didahulukan dari Baru.",
          "Nota, belanja, rata-rata per nota, belanja pertama, dan belanja terakhir dihitung sepanjang waktu di toko itu. Belanja = nilai nota sesudah potongan dikurangi barang yang dikembalikan; rata-rata = belanja ÷ jumlah nota.",
          "Kategori favorit: kategori barang dengan potong bersih (dibeli dikurangi dikembalikan) terbanyak. Barang tanpa kategori tidak dihitung.",
          "Tanda member menunjukkan tingkatnya sekarang. Member yang dinonaktifkan kantor tampil sebagai member nonaktif dan masuk saringan “bukan member”.",
          "Kotak cari mencocokkan nama dan nomor yang tampil disamarkan (empat angka depan dan empat angka belakang), jadi nomor lengkap tidak bisa ditebak lewat pencarian. Angka pada tombol saring mengikuti kotak cari. Daftar diurutkan dari belanja terakhir yang terbaru.",
        ],
      },
      {
        judul: "Member",
        isi: [
          "Member dikenali dari nomor WhatsApp dan berlaku di semua toko. Tingkat = tingkat tertinggi yang belanja minimalnya tercapai oleh belanja bersih nomor itu di semua toko dalam periode penentu tingkat (Pengaturan → SPG, bawaan 12 bulan) — angka yang sama dengan yang dipakai di nota.",
          "Belanja di: toko tempat nomor ini punya nota. Bergabung: tanggal dan toko tempat ia didaftarkan.",
          "Menonaktifkan member butuh alasan dan izin mengelola promo. Member nonaktif tidak mendapat diskon member dan SPG tidak bisa mendaftarkannya ulang sampai kantor mengaktifkannya kembali; riwayat belanjanya tetap. Setiap perubahan tercatat di jejak audit beserta alasannya.",
        ],
      },
      { judul: { kunci: "spgPelanggan.kantor.titipJudul" }, isi: { kunci: "spgPelanggan.kantor.titipPetunjuk" } },
    ],
  },
  {
    rute: "/backoffice/jadwal-spg",
    bagian: "navGroupSpg",
    judul: { kunci: "jadwalSpg.judul" },
    isi: [
      { kunci: "jadwalSpg.deskripsi" },
      "Satu minggu (Senin–Minggu) per toko. Tab Jadwal disunting sebagai draf lalu disimpan sekali; tab Tukar shift berisi ajuan tukar shift. Melihat cukup dengan izin melihat penjualan SPG; menyusun jadwal dan memutuskan tukar shift butuh izin mengelola toko.",
    ],
    kartu: [
      {
        judul: { kunci: "jadwalSpg.kisiJudul" },
        isi: "Hari yang sudah lewat hanya bisa dibaca, beserta kenyataannya. Terlambat berarti check-in lebih dari toleransi keterlambatan (diatur di Pengaturan → SPG) sesudah shift mulai; menitnya dihitung dari jam mulai. Tidak masuk berarti shift kerja tanpa check-in di toko ini.",
      },
      {
        judul: { kunci: "jadwalSpg.tab.tukar" },
        isi: "SPG mengajukan tukar shift dari HP, dan rekannya harus menyetujui lebih dulu sebelum ajuan sampai ke kantor. Kantor menyetujui atau menolak; sesudah disetujui, jadwal kedua SPG bertukar.",
      },
      {
        judul: "Jadwal bulanan",
        isi: [
          "Jadwal sebulan yang diisi dan diajukan SPG dari HP — dasar gaji pokoknya. Kantor menyetujui, menolak dengan alasan, atau membukanya lagi selama bulan itu belum dibayar. Perubahan sesudah disetujui kembali menunggu persetujuan.",
          "Hari yang sudah lewat terkunci; hari lewat yang dibiarkan kosong ditutup oleh catatan check-in toko (Komisi SPG → Catatan check-in toko). Menyetujui, menolak, dan membuka lagi butuh izin Setujui jadwal SPG.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/komisi-spg",
    bagian: "navGroupSpg",
    judul: { kunci: "komisiSpg.judul" },
    isi: [
      { kunci: "komisiSpg.deskripsi" },
      "Satu pembayaran per SPG per bulan: gaji pokok ditambah komisi. Komisi = tarif kategori barang bulan PENJUALANNYA (Pengaturan → Komisi SPG) × potong yang dijual masing-masing SPG sendiri, untuk toko putus dan konsinyasi. Tidak ada bagi rata. Kategorinya adalah kategori yang tercatat saat barang dijual; barang yang terjual tanpa kategori ikut kategori yang diberikan kemudian.",
      "Retur pembeli yang disetujui kantor mengurangi komisi bulan nota ASLINYA, bukan bulan returnya.",
      "Toko putus: Tandai laporan dicek (hanya untuk bulan yang sudah selesai), Tetapkan, lalu Tandai dibayar. Bulan dengan SPG terjadwal tanpa penjualan juga dicek. Mengecek, membatalkan tanda dicek, dan menetapkan butuh izin mengelola piutang; menandai dibayar butuh izin membayar gaji & komisi SPG (bawaannya admin dan Keuangan).",
      "Yang belum dibayar selalu dibayar dengan angka SAAT ditandai dibayar, bukan angka yang tersimpan: angka lama yang berbeda dicoret di layar dan tercatat di jejak audit, dan dialog bayarnya menyebut jumlah persis yang dibayarkan. Bila angkanya berubah sejak halaman dibuka, pembayaran ditolak dan halaman dimuat ulang. Bulan yang sudah dibayar dikoreksi di pembayaran berikutnya, sampai 12 bulan ke belakang.",
      "Barang hilang dan beban retur pembeli yang ditolak dipotong PENUH saat pembayaran: dari komisi dulu, lalu dari gaji pokok. Sisa yang belum tertutup dibawa ke pembayaran berikutnya.",
      "Sebuah baris ditahan — gaji pokok DAN komisinya — selama gaji pokoknya belum diatur, jadwal bulanannya belum disetujui, atau catatan check-in tokonya belum dimasukkan atau belum diperiksa. Setiap sebab menaut ke tempat membereskannya, bila Anda boleh membukanya. Check-in di luar radius tetap dihitung hadir dan didaftar untuk diperiksa.",
      "Toko konsinyasi: laporannya dicek saat kantor mengunci angka resmi siklusnya (Konsinyasi). Gaji & komisinya bisa ditandai dibayar di sini atau di siklus konsinyasinya, dengan izin membayar gaji & komisi SPG, tanpa membuka kunci.",
      "Halaman ini terbuka untuk pengawas SPG dan untuk yang membayar gaji & komisi SPG — Keuangan membukanya tanpa halaman SPG lain. Pemegang izin Periksa pembayaran saja hanya melihat kartu utang SPG.",
      "Beranda mengingatkan pemegang izin mengelola piutang dengan laporan toko putus bulan lalu yang belum dicek atau belum ditetapkan, dan pemegang izin membayar gaji & komisi SPG dengan baris yang tertunggak dari bulan pembayaran sebelumnya.",
    ],
    kartu: [
      {
        judul: "Belum dibayar dari bulan pembayaran sebelumnya",
        isi: [
          "Komisi yang laporannya sudah dicek, atau siklusnya sudah dikunci, di bulan pembayaran sebelumnya tetapi belum ditandai dibayar. Yang bisa dibayar sekarang dihitung di Beranda; yang ditahan menunggu dasar gajinya (gaji pokok, jadwal, atau catatan check-in) tampil dengan sebabnya dan dihitung di baris tahannya sendiri.",
        ],
      },
      {
        judul: "Koreksi komisi",
        isi: "Koreksi yang menunggu, per SPG, beserta pembayaran yang akan membawanya. SPG yang belum punya pembayaran berikutnya ditulis menunggu — koreksinya diterapkan begitu ada.",
      },
      {
        judul: "Utang SPG",
        isi: [
          "SPG yang sudah berhenti menerima pembayaran terakhirnya dengan semua koreksi dan potongannya. Yang tidak tertutup menjadi utang SPG; tambahan yang muncul kemudian lebih dulu mengurangi utangnya, sisanya dibayar terpisah.",
          "Pembayaran utang yang dicatat menunggu cek mutasi bank oleh orang lain selain yang mencatatnya (izin Periksa pembayaran). Mencatat utang dan pembayarannya butuh izin membayar gaji & komisi SPG.",
        ],
      },
      { judul: { kunci: "komisiSpg.konsi.judul" }, isi: { kunci: "komisiSpg.konsi.isi" } },
    ],
  },
  {
    rute: "/backoffice/komisi-spg/catatan-hadir",
    bagian: "navGroupSpg",
    judul: { kunci: "navigation.navCatatanHadirSpg" },
    isi: [
      "Bila SPG tidak mengisi jadwalnya, kantor memasukkan catatan check-in dari toko — diketik per hari atau diunggah dari Excel (templatnya: Tanggal, Jadwal KERJA/LIBUR, Hadir YA/TIDAK, Catatan).",
      "Admin Keuangan memeriksanya dengan kertas atau berkas aslinya, dan tidak boleh memeriksa catatan yang ia masukkan sendiri. Hanya catatan yang sudah diperiksa yang dipakai, dan untuk hari yang dicakupnya ia menggantikan check-in sistem. Catatan yang dikembalikan diperbaiki lalu diajukan lagi.",
      "Catatan bulan yang sudah dibayar tidak bisa diubah.",
      "Dari Beranda, baris \"belum dimasukkan\" membuka SPG × bulan yang pembayarannya tertahan karena catatannya belum ada (atau masih menyisakan hari tanpa dasar gaji), dan baris \"menunggu diperiksa\" membuka catatan yang sudah diajukan.",
      "Memasukkan dan mengunggah butuh izin mencatat catatan check-in toko; memeriksa dan mengembalikan butuh izin memeriksanya. Pengawas SPG hanya membaca.",
    ],
  },
  {
    rute: "/backoffice/spg-commission",
    bagian: "navGroupSpg",
    judul: { kunci: "spgCommission.pageTitle" },
    isi: [
      { kunci: "spgCommission.subtitle" },
      "Halaman ini hanya membaca, dari hitungan yang sama dengan Komisi SPG: siklus konsinyasi yang dikunci dan laporan toko putus yang dicek di bulan pembayaran yang dipilih. Angka resmi, penetapan, dan pembayaran tetap di SPG → Komisi SPG dan di siklus konsinyasi.",
      "Satu baris per SPG: potong, komisi per SPG (tarif kategori bulan penjualan × potong bersih yang dijual SPG itu sendiri), dibayar, koreksi diterapkan (selisih bulan sebelumnya yang ikut dibayar bulan ini), belum dibayar, dan selisih ke pembayaran berikutnya (komisi per SPG dikurangi yang sudah dibayar). Membuka baris menampilkan setiap laporannya dengan bulan penjualan, status (ditetapkan, belum ditetapkan, atau tanpa baris — lewat koreksi), angka yang ditetapkan, dan koreksi yang berasal darinya. Laporan toko putus yang sudah dicek tetapi belum ditetapkan tidak dihitung dibayar.",
      "Rincian per kategori barang menyebut tarifnya. Potong dari barang yang kategorinya belum bertarif di bulan penjualannya disebut terpisah dan tidak menghasilkan komisi; tarifnya diatur di Pengaturan → Komisi SPG oleh pemegang izin mengatur tarif. Daftar koreksi yang dibayar di bulan ini ada di bawahnya.",
      "Ekspor mengikuti bulan pembayaran yang sama, dengan empat lembar: Ringkasan (per SPG), Per laporan (bulan pembayaran dan bulan penjualan), Koreksi, dan Per kategori.",
    ],
  },
  {
    rute: "/backoffice/spg-requests",
    bagian: "navGroupSpg",
    judul: { kunci: "spgRequests.pageTitle" },
    isi: [
      { kunci: "spgRequests.pageDescription" },
      "Bawaannya hanya permintaan yang perlu ditangani (baru dan diproses); yang sudah selesai atau ditolak dibuka lewat tabnya sendiri. Mengubah status butuh izin mengelola toko.",
      "Penanda Toko tanpa pemegang: toko itu belum punya salesman pemegang, jadi permintaannya tidak sampai ke HP salesman mana pun dan kantor yang menanganinya. Setiap permintaan baru dari toko seperti itu membunyikan lonceng pengelola toko; saringan Hanya toko tanpa pemegang menampilkan permintaan itu saja.",
      "Tiga layar ini saling terkait dan saling ditautkan di kepala halaman: titip pesan (pembeli menunggu barang tertentu), barang dicari pembeli (yang ditanyakan tetapi tidak ada di rak), dan permintaan kiriman SPG. Permintaan pembeli yang sering muncul sebaiknya diteruskan SPG menjadi permintaan kiriman ke salesman pemegang toko.",
    ],
  },
  {
    rute: "/backoffice/spg-lost-sales",
    bagian: "navGroupSpg",
    judul: { kunci: "spgLostSales.pageTitle" },
    isi: [
      { kunci: "spgLostSales.pageDescription" },
      "Periode dipilih dengan pemilih rentang yang sama dengan Penjualan SPG (ada pilihan cepat 7, 30, dan 90 hari); bawaannya 30 hari terakhir termasuk hari ini, dalam hari kalender WIB.",
      "Tiga layar ini saling terkait dan saling ditautkan di kepala halaman: titip pesan (pembeli menunggu barang tertentu), barang dicari pembeli (yang ditanyakan tetapi tidak ada di rak), dan permintaan kiriman SPG. Permintaan pembeli yang sering muncul sebaiknya diteruskan SPG menjadi permintaan kiriman ke salesman pemegang toko.",
    ],
    kartu: [{ judul: { kunci: "spgLostSales.summaryTitle" }, isi: { kunci: "spgLostSales.summaryHint" } }],
  },
  {
    rute: "/backoffice/spg-transfers",
    bagian: "navGroupSpg",
    judul: { kunci: "spgMutasi.kantor.judul" },
    isi: [
      { kunci: "spgMutasi.kantor.deskripsi" },
      "Alurnya: SPG toko asal mengajukan, kantor menyetujui bila arah itu butuh persetujuan, SPG toko asal mengirim, lalu SPG toko tujuan menerima. Arah mana yang boleh, yang butuh persetujuan, dan yang ditolak diatur di Pengaturan → SPG. Stok gudang utama tidak bergerak; yang berpindah adalah buku stok kedua toko.",
      "Menyetujui, menolak, mengalihkan, dan membatalkan butuh izin menyetujui transfer antar toko; memutuskan selisih butuh izin memutuskan selisih transfer. Keduanya keputusan manager — bawaannya hanya admin, dan bisa diberikan ke peran lain di Peran & izin. Menerima atas nama toko butuh izin mengelola toko, untuk toko tujuan tanpa SPG atau kiriman yang sudah melewati batas hari pengingat.",
    ],
  },
  {
    rute: "/backoffice/spg-transfers/[id]",
    bagian: "navGroupSpg",
    judul: "Rincian mutasi antar toko",
    isi: [
      "Satu mutasi: toko asal dan tujuan, barang dan jumlahnya, dan riwayat setiap langkahnya. Surat jalan bisa dicetak atau disimpan sebagai PDF dari sini; sebelum barang dikirim, surat jalan tercetak dengan cap DRAF.",
      "Bila barang diterima kurang dari yang dikirim, kantor memutuskan selisihnya: hilang (hanya dicatat, stok tidak berubah, dan catatan barang hilang dibuka untuk toko asal di SPG → Barang hilang) atau kembali (stok toko asal ditambah sebesar kekurangannya). Memutuskannya butuh izin memutuskan selisih transfer.",
    ],
  },
  {
    rute: "/backoffice/retur-spg",
    bagian: "navGroupSpg",
    judul: { kunci: "spgReturPembeli.kantor.judul" },
    isi: [
      { kunci: "spgReturPembeli.kantor.deskripsi" },
      "Laporan datang dari HP SPG, lewat tombol Laporkan retur pembeli di nota penjualan. Selama Menunggu, laporan itu tidak mengubah apa pun: stok rak toko, penjualan bersih, komisi SPG, laporan konsinyasi, dan riwayat penjualan tetap seperti sebelum retur. Barang yang masih menunggu tetap mengurangi jumlah yang bisa dilaporkan dari baris nota itu, jadi potong yang sama tidak bisa dilaporkan dua kali.",
      "Pengawas SPG bisa melihat daftar ini. Menyetujui dan menolak butuh izin Setujui retur pembeli SPG — bawaannya admin dan Admin Penjualan (keputusan pemilik 2026-11-02), dan bisa diberikan ke peran lain di Peran & izin. Tidak ada yang bisa memutuskan laporan yang ia buat sendiri.",
      "Setiap laporan membawa foto barangnya dan keadaan uangnya: belum dikembalikan, sudah dikembalikan kasir (dengan foto struk), atau ditandai kantor sudah dikembalikan. Uang pembeli baru dikembalikan sesudah kantor menyetujui; tidak ada kredit toko.",
      "Tab memilih status (bawaannya Menunggu); tab Perlu keputusan barang berisi laporan yang ditolak sesudah uangnya dikembalikan dan beban SPG-nya sudah lunas, menunggu keputusan barangnya. Saringan toko dan nomor nota tersimpan di alamat halaman. Beranda menghitung laporan yang menunggu dan barang yang menunggu keputusan untuk pemegang izin menyetujui.",
    ],
  },
  {
    rute: "/backoffice/retur-spg/[id]",
    bagian: "navGroupSpg",
    judul: { kunci: "spgReturPembeli.rincian.judul" },
    isi: [
      "Satu laporan: SPG pelapor, toko, nota asal, barang per baris dengan kondisinya, alasan pembeli, dan riwayat keputusannya.",
      "Menyetujui menerapkan retur sekaligus: jumlah kembali di nota bertambah, barang layak masuk lagi ke stok rak toko (barang rusak tidak), dan penjualan bersih, komisi SPG, laporan konsinyasi, serta riwayat penjualan berkurang. Penjualan bersih dan laporan konsinyasi dihitung pada tanggal retur DILAPORKAN; komisi SPG berkurang di bulan nota ASLINYA. Menyetujui membukukan setiap potong layak jual ke stok rak.",
      "Bila komisi bulan itu sudah dicek, atau angka konsinyasinya sudah dikunci, angka yang tersimpan tidak berubah; selisih komisinya dikoreksi di pembayaran berikutnya. Menolak wajib disertai alasan, yang dikirim ke HP SPG. Bila uangnya ternyata sudah dikembalikan, tandai \"Uang ternyata sudah dikembalikan\" dengan alasan: uang itu menjadi beban SPG — sebesar harga bersih di notanya, atau angka struk yang Anda tetapkan dengan alasan bila berbeda — dipotong dari komisi lalu gaji, tidak pernah dihapuskan.",
      "Batalkan penolakan hanya bisa selama belum ada yang dipotong dari bebannya dan bebannya belum menjadi utang SPG. Putuskan barangnya baru bisa sesudah bebannya lunas: barang kembali ke stok (uang SPG dikembalikan di pembayaran berikutnya) atau barang dibeli SPG.",
    ],
  },
  {
    rute: "/backoffice/spg-kiriman-rusak",
    bagian: "navGroupSpg",
    judul: { kunci: "spgRusak.kantor.judul" },
    isi: [
      { kunci: "spgRusak.kantor.deskripsi" },
      "Barang rusak tetap dihitung diterima, tetapi tidak masuk stok toko sampai gudang memutuskan. Layak jual menambah stok toko; kembali ke gudang berarti SPG mengirimnya balik lewat nota retur, dan barang itu tidak pernah masuk stok toko.",
      "Pengawas SPG bisa melihat daftar ini; yang memutuskan adalah gudang (izin mengelola persediaan).",
    ],
  },
  {
    rute: "/backoffice/barang-hilang",
    bagian: "navGroupSpg",
    judul: { kunci: "barangHilang.kantor.judul" },
    isi: [
      { kunci: "barangHilang.kantor.deskripsi" },
      "Pengawas SPG bisa melihat. Mencatat barang hilang secara manual, menandai pelunasan, dan membatalkan catatan yang belum diputuskan butuh izin mengelola piutang. Menetapkan penanggung, mengubah keputusan, dan membatalkan catatan yang sudah diputuskan adalah keputusan manager: butuh izin memutuskan penanggung, yang bawaannya hanya dipegang admin.",
      "Barang hilang yang dicatat manual untuk toko yang sudah punya buku stok langsung mengurangi buku toko itu (gerakan Barang hilang di kartu stok toko), jadi opname berikutnya atas potong yang sama tidak membuka catatan kedua. Membatalkan catatannya mengembalikan potong itu ke buku, kecuali barangnya sudah dihitung opname sesudah catatan dibuat — opname itu yang berlaku. Toko tanpa buku stok tidak dibukakan buku; stok titipannya dikurangi catatan yang sudah ditetapkan.",
      "Barang yang tidak sampai di toko saat kiriman diterima (tidak tiba dan tidak ditolak) langsung tercatat di sini sebagai barang hilang di perjalanan. Saringan klaim (Diajukan, Menunggu cek, Ditolak) menampilkan catatan yang klaimnya ke ekspedisi ada di giliran itu — tujuan tiga baris klaim ekspedisi di Beranda.",
    ],
  },
  {
    rute: "/backoffice/barang-hilang/[id]",
    bagian: "navGroupSpg",
    judul: "Rincian barang hilang",
    isi: [
      "Satu catatan barang hilang: asalnya, barang dan nilainya, penanggung beserta pelunasan bagiannya, dan riwayat keputusannya.",
      { kunci: "barangHilang.keputusan.akibat" },
      "Penanggung bisa dibagi ke beberapa pihak, dan jumlah semua bagian harus sama dengan total. Keringanan diskon pegawai, bila dipakai, persennya diketik setiap kali memutuskan dan selisihnya ditanggung Elorae. Keputusan bisa diubah atau dibatalkan selama belum ada potongan atau tagihan atas catatan ini; keduanya butuh izin memutuskan penanggung, sama dengan memutuskannya.",
      "Penanggung Ekspedisi hanya untuk barang hilang dari pengiriman lewat ekspedisi, dan menanggung seluruhnya. Buktinya ditampilkan di sini: resi, berat, foto serah ke kurir, dan foto terima di toko. Nilai klaimnya bawaan nilai jual di nota atau surat jalan, dan bisa diubah oleh pemegang izin memutuskan penanggung.",
      "Klaim ekspedisi berjalan Diajukan → Menunggu cek → Dibayar (transfer, tunai, atau potong ongkos) atau Ditolak. Mencatat bayar atau tolak dari ekspedisi butuh izin mengelola piutang; memeriksa uangnya sah atau mengembalikannya butuh izin Periksa pembayaran, dan yang mencatat tidak boleh memeriksanya sendiri. Klaim yang ditolak membuka lagi keputusan penanggungnya — tetapkan penanggung lain.",
    ],
    kartu: [{ judul: { kunci: "barangHilang.rincian.rincianJudul" }, isi: { kunci: "barangHilang.rincian.dasarTerimaIsi" } }],
  },
];
