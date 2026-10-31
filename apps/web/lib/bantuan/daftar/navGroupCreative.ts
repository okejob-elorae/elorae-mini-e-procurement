import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/kreatif",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.hariIni" },
    isi: [
      "Layar pertama Ruang KOL: apa yang perlu dikerjakan hari ini, dihitung otomatis dari data kolaborasi, sampel, konten, pembayaran, dan agenda Anda. Tidak ada yang perlu dicentang di sini — begitu faktanya diisi di layar kerjanya (resi, tanggal terima, link, angka, pembayaran), barisnya hilang sendiri.",
      "Baris angka di atas mengikuti periode yang dipilih (hari ini, 7 hari, 30 hari, bulan ini, bulan lalu, atau rentang) dan bisa disaring ke satu campaign. Periode dan campaign tersimpan di alamat halaman, jadi tautannya bisa dibagikan.",
      "Kapan sesuatu dianggap terlambat diatur di Kreatif → Pengaturan. Terlambat baru dihitung sesudah hari berganti (WIB): tenggat yang jatuh hari ini belum terlambat.",
      "Angka merah di tab Hari ini dan di menu Kreatif adalah jumlah semua baris tugas — angka yang sama dengan kepala kartu tugas.",
    ],
    kartu: [
      {
        judul: { kunci: "kreatifRuang.hariIni.kpi.kolBaru" },
        isi: "KOL yang ditambahkan di periode itu, dibanding seluruh KOL. Dengan saringan campaign: hanya KOL yang punya kolaborasi di campaign itu.",
      },
      {
        judul: { kunci: "kreatifRuang.hariIni.kpi.berjalan" },
        isi: "Kolaborasi di tahap mana pun dari prospek sampai dibayar — tidak mengikuti periode, karena ini keadaan sekarang. Selesai dan jalur keluar (ditolak, ghosting, batal) tidak dihitung.",
      },
      {
        judul: { kunci: "kreatifRuang.hariIni.kpi.gmv" },
        isi: "Penjualan afiliasi yang tanggalnya jatuh di periode itu, beserta jumlah ordernya.",
      },
      {
        judul: { kunci: "kreatifRuang.hariIni.kpi.views" },
        isi: "Angka terbaru setiap konten yang TAYANG di periode itu. Angka konten tidak pernah ditimpa; yang dipakai selalu pengisian terakhir.",
      },
      {
        judul: { kunci: "kreatifRuang.hariIni.kpi.biaya" },
        isi: "Fee dan boost kolaborasi yang deal di periode itu, ongkir dan modal sampel (harga pokok rata-rata) yang berangkat di periode itu, dan komisi penjualan di periode itu. \"Fee\" selalu angka yang disepakati dengan KOL: neto bila gross-up, bruto bila dipotong. Untuk gross-up, PPh yang ditanggung Elorae ikut dihitung dan baris bawah kartu menyebut biaya bruto termasuk PPh.",
      },
      {
        judul: { kunci: "kreatifRuang.hariIni.kpi.roas" },
        isi: "GMV dibagi biaya. Hijau bila 1 atau lebih (penjualan menutup biaya), merah bila kurang dari 1, dan tanda — abu-abu bila belum ada biaya untuk dibagi.",
      },
      {
        judul: "Hal yang perlu ditindaklanjuti",
        isi: [
          "Lima belas kelompok: agenda hari ini dan yang terlewat (agenda Anda sendiri, termasuk yang masuk masa ingat H-n), deal belum kirim sampel, sampel belum diterima, sampel diterima belum tayang, draf menunggu review, jadwal tayang lewat, belum dibalas (disarankan ghosting bila terlalu lama), tayang belum ada angka (H+1, H+3, H+7), tayang belum dibayar, berpotensi kirim dobel, data kirim belum lengkap, KOL diblokir dengan kolaborasi berjalan, budget campaign hampir habis, anomali akun, dan perangkat pemantau berhenti.",
          "Anomali akun (dari pemantauan ekstensi): pengikut akun TikTok naik lebih dari 30% dibanding catatan sebelumnya dalam 14 hari, atau ER akunnya turun lebih dari 40% dibanding catatan ber-ER sebelumnya. Tampil selama catatan terbarunya berumur paling lama 7 hari; ambangnya diatur di Kreatif → Pemantauan. Buka membuka profil KOL di tab Pengikut & ER.",
          "Perangkat pemantau berhenti: perangkat yang dijeda otomatis (captcha, diminta login, atau gagal berturut-turut) atau tidak melapor lebih dari 24 jam. Jeda yang Anda pasang sendiri dari Pemantauan tidak dihitung.",
          "Kelompok yang kosong tidak ditampilkan. Kelompok dengan lima baris atau kurang langsung terbuka; yang lebih banyak terbuka saat diklik. Baris diurut dari yang paling lama menunggu; 'telat N hari' dihitung dari tenggatnya, 'H-N' untuk agenda yang akan datang.",
          "Setiap baris punya tombol WhatsApp bertemplate, pintasan ke layar kerjanya (kirim sampel, tandai diterima, tempel link, review draf, isi angka, bayar, lengkapi data), dan Buka. Baris agenda membuka agendanya di Kalender dan bisa langsung ditandai selesai.",
        ],
      },
      {
        judul: { kunci: "kreatifRuang.hariIni.posisi.judul" },
        isi: "Banyaknya kolaborasi di setiap tahap berjalan sekarang. Klik satu tahap untuk membuka daftar kolaborasinya.",
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/kolaborasi",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.kolaborasi" },
    isi: [
      "Satu kolaborasi = satu KOL dalam satu campaign, dari prospek sampai selesai. Nomornya tetap BRIEF/tahun/urutan.",
      "Ada 13 tahap: prospek, dihubungi, nego, deal, brief dikirim, sampel dikirim, sampel diterima, draf masuk, draf disetujui, tayang, angka masuk, dibayar, selesai — ditambah tiga jalur keluar: ditolak, ghosting, batal.",
      "Maju boleh melompati tahap. Mundur, keluar jalur, dan membuka lagi kolaborasi yang sudah keluar wajib memakai alasan, dan alasannya tercatat di riwayat. Kolaborasi yang keluar jalur hanya bisa dibuka lagi ke prospek atau dihubungi.",
      "Beberapa tahap maju sendiri dari data: resi diisi → sampel dikirim, tanggal terima → sampel diterima, link draf → draf masuk, draf disetujui, link konten → tayang, angka konten pada hari ke-7 sesudah tayang → angka masuk, lunas → dibayar. Kerja sama tanpa fee langsung selesai begitu angkanya masuk.",
      "Fee baru dihitung sebagai biaya saat kontennya tayang. Memindah tahap tidak pernah menggerakkan stok — stok sampel keluar dari pengiriman sampel.",
      "Tampilan Papan menampilkan satu kolom per tahap yang masih berjalan, yang paling lama di tahapnya di atas. Kartu diseret dengan mouse atau jari (pegangan ⠿ di kiri kartu); maju langsung tersimpan, sedangkan seret mundur atau ke kotak Selesai & keluar membuka dialog alasan. Kolom yang tidak sah untuk kartu yang dibawa tidak menyala. Menu ⋯ di setiap kartu melakukan hal yang sama tanpa menyeret.",
      "Pilihan Tabel/Papan diingat per orang di perangkat ini; tahap, campaign, platform, PIC, kata cari, dan halaman ikut di alamat halaman, jadi tautannya bisa dibagikan dan tombol Kembali membuka daftar yang sama.",
      "Pilih beberapa baris untuk mengubah tahapnya sekaligus (alasan diminta sekali bila ada yang mundur atau keluar; yang aturannya menolak dilaporkan) atau memasukkannya ke satu campaign. Masukkan ke campaign memindah kolaborasi yang dipilih — yang KOL-nya sudah punya kolaborasi di campaign itu dilewati.",
      "Kolaborasi baru: cari KOL (minimal 2 huruf). KOL yang diblokir tidak bisa dipilih. Begitu KOL dipilih, ringkasan riwayatnya tampil: berapa kali kerja sama, views, GMV, ROAS, fee terakhir, dan berapa kali ghosting atau menolak (merah). Kotaknya biru bila ROAS-nya 1 atau lebih, kuning bila kurang. Brief yang dikosongkan memakai brief campaign. Rencana sampel dipilih per varian dengan stok tersedia (stok gudang dikurangi yang sudah dipesan) — rencana belum mengurangi stok.",
    ],
    kartu: [
      {
        judul: "Chip tahap",
        isi: "Angka di setiap chip menghitung kolaborasi yang cocok dengan saringan yang sedang dipakai (campaign, platform, PIC, cari), jadi angkanya sama dengan isi daftar saat chip itu diklik. Chip Keluar menggabungkan ditolak, ghosting, dan batal.",
      },
      {
        judul: "Umur dan tenggat berikutnya",
        isi: "Umur = hari sejak masuk tahap sekarang; merah bila lebih lama dari ambang di Kreatif → Pengaturan (bawaan 7 hari). Tenggat berikutnya adalah tenggat paling awal kolaborasi itu (follow-up, kirim sampel, resi nyangkut, batas tayang, review draf, angka H+1/H+3/H+7, jatuh tempo bayar); merah dengan tanda ⚠ bila sudah lewat (dihitung sesudah hari berganti, WIB).",
      },
      {
        judul: "Views · GMV",
        isi: "Views = angka terbaru tiap konten yang sudah tayang, dijumlah. GMV dari penjualan afiliasi yang dicatat di kolaborasi itu.",
      },
      {
        judul: "KOL diblokir",
        isi: "Kolaborasi KOL yang diblokir tidak bisa dimajukan atau dibuka lagi; mundur dan keluar jalur tetap boleh supaya kolaborasinya bisa diselesaikan.",
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/kolaborasi/[id]",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.detailKolaborasi" },
    isi: [
      "Rincian satu kolaborasi: views, order, GMV, dan ROAS-nya, tahap sekarang dan tombol untuk memajukannya, serta alamat kirim yang bisa disalin.",
      "Tab Pengiriman mencatat sampel per varian beserta kurir, resi, tanggal kirim dan terima. Tab Konten mencatat link, draf, dan angka (setiap pengisian angka disimpan sebagai baris baru, tidak menimpa yang lama). Tab Penjualan mencatat order, GMV, dan komisi afiliasi. Tab Catatan & riwayat menggabungkan catatan manual dengan riwayat otomatis.",
      "Tombol Maju memindah ke tahap berikutnya. Tahap lain… menawarkan semua tujuan yang sah; mundur, Keluar… (ditolak, ghosting, batal), dan Buka lagi… meminta alasan, yang tercatat di riwayat.",
      "Ubah membuka formulir kolaborasi: semua isian boleh diubah. Sesudah kontennya tayang, mengubah fee atau jenis kerja sama wajib beralasan, karena fee-nya sudah dihitung sebagai biaya. Mengubah fee membagi ulang sisa fee ke termin yang belum dibayar (termin yang sudah dibayar tidak berubah); fee tidak bisa diturunkan di bawah yang sudah dibayar. Fee nol berarti tidak perlu dibayar.",
      "Tab yang dibuka ikut tercatat di alamat halaman (?tab=), jadi tautannya membuka tab yang sama.",
    ],
    kartu: [
      {
        judul: "Views, order, GMV, ROAS",
        isi: "Dihitung dari konten, penjualan, dan biaya kolaborasi ini. Biaya = fee + PPh gross-up yang ditanggung Elorae + boost + ongkir + modal sampel yang sudah berangkat + komisi. ROAS = GMV ÷ biaya; hijau bila 1 atau lebih, dan — selama belum ada penjualan. Di bawah nama KOL, \"fee\" adalah angka yang disepakati (neto bila gross-up, bruto bila dipotong); bila gross-up, biaya bruto termasuk PPh disebut di sampingnya.",
      },
      {
        judul: "Tenggat",
        isi: "Semua tenggat terbuka kolaborasi ini, dari ambang di Kreatif → Pengaturan. Yang sudah lewat merah dengan tanda ⚠.",
      },
      {
        judul: "Alamat kirim",
        isi: "Salin alamat menyalin nama penerima, nomor HP, alamat, lalu kota/provinsi/kode pos — siap ditempel ke aplikasi kurir. Bila alamat atau nomor HP kosong, lengkapi dulu di profil KOL sebelum mengirim barang.",
      },
      {
        judul: { kunci: "kreatifRuang.panelBayar.judul" },
        isi: [
          "Mode pajak kolaborasi ini: Dipotong (fee = bruto, KOL menerima bruto dikurangi PPh) atau Gross-up (fee = neto yang diterima KOL, Elorae menanggung PPh). Mengganti mode menghitung ulang termin yang belum dibayar. Subjek pajak (perorangan/badan/tidak dipotong) dan NPWP diatur di profil KOL.",
          "Tabel termin: pemicu dan jatuh tempo, bruto, PPh, neto, status. Panah di kiri membuka rincian hitungan — DPP, setiap lapisan tarif, tambahan tanpa NPWP, PPh, dan neto — supaya keuangan bisa memeriksanya. \"Atur termin\" memecah atau mengubah termin yang belum dibayar, dalam persen atau nominal, dengan pratinjau angka yang akan tersimpan; jumlahnya harus persis sama dengan sisa fee.",
          "Bayar mencatat satu termin (tanggal, bukti transfer, nomor bukti potong). Termin yang menunggu tayang (mis. Pelunasan sebelum konten tayang) tetap bisa dibayar, tetapi tombolnya bukan tombol utama dan dialognya meminta centang konfirmasi. Batalkan bayar membatalkan pembayaran yang salah catat, wajib beralasan; tidak tersedia bila PPh-nya sudah disetor. Semua perubahan tercatat di riwayat di bawah tabel.",
          "Keuangan melihat peringatan bila jurnal kolaborasi ini (fee, pembayaran, atau sampel) belum terposting — biasanya karena akun belum dipetakan — dan tombol Posting ulang jurnal sesudah akunnya dipetakan. Kolaborasi yang uangnya sudah bergerak sebelum modul ini tidak dijurnal otomatis.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/kol",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.kol.judul" },
    isi: [
      "Database semua KOL yang pernah dan bisa diajak kerja sama. Tampilan Tabel atau Galeri; pilihannya diingat per orang di perangkat ini. Kata cari, platform, tier, label, status, urutan, dan halaman ikut di alamat halaman, jadi tautannya bisa dibagikan.",
      "Cari menelusuri nama, nama penerima, username (boleh dengan @ atau tempel link profil), nomor WhatsApp dalam bentuk apa pun (0812…, +62 812…, 62812…), niche, dan kota.",
      "Status menyaring menurut tahap kolaborasi TERAKHIR KOL itu, KOL yang belum pernah diajak, atau yang ditandai jangan diajak lagi.",
      "Tier dihitung dari pengikut terbanyak di antara akun-akunnya (orang yang sama di dua platform tidak dijumlahkan), dalam lima tingkat: nano, mikro, mid, makro, mega. Batasnya diatur di Kreatif → Pengaturan → Batas tier KOL; bawaannya nano di bawah 10 ribu, mikro 10 ribu sampai di bawah 100 ribu, mid 100 ribu sampai di bawah 500 ribu, makro 500 ribu sampai di bawah 1 juta, mega 1 juta ke atas. Tier tidak pernah disimpan, jadi mengubah batasnya langsung mengubah tier di daftar, saringan, dan profil. Views dan GMV per KOL adalah jumlah seluruh kolaborasinya — angka yang sama dengan di Kolaborasi, Campaign, dan Laporan.",
      "Tambah/Ubah KOL: minimal satu akun (username + platform). Pengikut, views, rate card boleh ditulis 52000, 52k, atau 1,2jt. Nama yang dikosongkan memakai username. Rate card adalah tarif umum; Rate per format diisi per format konten (Feed, Reels, Story, Video, Live, Carousel) dalam rupiah bulat — kosongkan format yang tidak ditawarkan, nol berarti gratis. Rate hanya berubah lewat formulir ini; ekstensi, tempel link, tambah massal, dan formulir data KOL tidak pernah menyentuhnya. Mengubah akun tidak menghapus lalu membuat ulang akunnya — jumlah pengikut yang berubah dicatat sebagai riwayat pengikut di profil. Menutup formulir yang belum disimpan meminta konfirmasi.",
      "Saat menyimpan, nomor WhatsApp (dinormalkan ke 62…) dan username (lintas platform) dicocokkan dengan KOL lain. Bila ada yang mirip, Anda bisa membuka yang sudah ada, atau tetap menyimpan dengan alasan — alasannya tercatat di riwayat.",
      "Tambah massal: tempel satu KOL per baris — username, nama, pengikut, WA, kota (hanya username yang wajib), dipisah koma, titik koma, atau tab. Bila pengikut memakai koma desimal (1,2jt), lebih aman memisah kolom dengan titik koma atau tab. Pratinjau menandai baris yang sudah ada di database atau muncul dua kali di tempelan; untuk KOL yang sudah ada pilih Perbarui atau Lewati. Perbarui mengganti jumlah pengikut di platform itu dan hanya mengisi data yang masih kosong — data yang sudah dirapikan tidak ditimpa. Semua baris disimpan sekaligus; bila sementara itu ada yang menambahkan KOL yang sama, barisnya dilewati. Campaign yang dipilih langsung dibuatkan kolaborasi berstatus prospek.",
      "Cek kembar menampilkan semua KOL aktif yang nomor WhatsApp-nya sama atau username-nya sama, per kelompok. Kelompok yang sudah lebih dari sekali dikirimi barang ditandai merah.",
      "Pilih beberapa KOL (pilihan tetap tersimpan saat pindah halaman), lalu Masukkan ke campaign: setiap KOL dibuatkan kolaborasi pada tahap awal yang dipilih. KOL yang sudah punya kolaborasi di campaign itu, dan yang diblokir, dilewati.",
    ],
    kartu: [
      {
        judul: { kunci: "kreatifRuang.kol.kolom.kolaborasi" },
        isi: "Tahap kolaborasi KOL yang paling baru dibuat; klik pil tahapnya untuk membuka kolaborasi itu. \"belum ada\" berarti KOL ini belum pernah diajak.",
      },
      {
        judul: { kunci: "kreatifRuang.kol.kolom.kontak" },
        isi: "Terakhir kali KOL ini dihubungi lewat tombol WhatsApp atau dicatat lewat catatan. Kolom ini disembunyikan di layar sempit.",
      },
      {
        judul: { kunci: "kreatifRuang.kol.diblokirPill" },
        isi: "KOL yang diblokir tetap bisa dicari dan dibuka, tetapi tidak bisa diajak kolaborasi baru. Blokir dan buka blokir dilakukan di profilnya, wajib beralasan.",
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/kol/[id]",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.profilKol" },
    isi: [
      "Profil satu KOL: akun dan tautan profilnya, label, angka seluruh kolaborasinya, riwayat kolaborasi, konten, ukuran badan dan alamat kirim, riwayat pengikut, serta catatan dan riwayat.",
      "Ubah membuka formulir yang sama dengan daftar KOL. Akun diubah di tempatnya, jadi riwayat pengikutnya tidak hilang.",
      "Jangan diajak lagi menandai KOL ini tidak boleh diajak kolaborasi baru; alasannya wajib dan tampil di bagian atas profil. Buka blokir juga wajib beralasan. Keduanya tercatat di riwayat.",
    ],
    kartu: [
      {
        judul: "Selesai, berjalan, ghosting, ditolak",
        isi: "Jumlah kolaborasi menurut tahapnya sekarang. Ghosting berwarna merah bila pernah terjadi.",
      },
      {
        judul: "Total views, GMV, ROAS",
        isi: "Jumlah seluruh kolaborasinya, dari angka konten terbaru dan penjualan afiliasi yang dicatat. ROAS = GMV ÷ biaya (fee + PPh gross-up yang ditanggung Elorae + boost + ongkir + modal sampel yang sudah berangkat + komisi); — selama belum ada penjualan.",
      },
      { judul: "Fee terakhir", isi: "Fee kolaborasi berbayar yang paling baru." },
      {
        judul: { kunci: "kreatifRuang.kol.profil.rateFormat" },
        isi: "Tarif yang ditawarkan KOL per format konten (Feed, Reels, Story, Video, Live, Carousel), di samping rate card umum. Hanya format yang diisi yang tampil. Diubah lewat tombol Ubah; setiap perubahan tercatat di riwayat (sebelum dan sesudah).",
      },
      {
        judul: "Tepat waktu",
        isi: "Dari kolaborasi yang punya rencana tayang dan sudah tayang: berapa yang konten pertamanya tayang pada atau sebelum hari rencana (WIB). Kolaborasi yang belum tayang belum dinilai.",
      },
      {
        judul: { kunci: "kreatifRuang.kol.profil.tab.brand" },
        isi: [
          "Brand yang pernah DITANDAI KOL ini di postingnya: satu baris per posting × brand, dengan jenisnya (Berbayar, Kolaborasi, Tag biasa), tanggal dan link posting, views posting saat terakhir terbaca, dan sumbernya. Lencana Elorae dan Kompetitor mengikuti daftar di Kreatif → Pengaturan → Brand & kompetitor. Klik nama brand untuk melihat semua KOL yang menandainya.",
          "Terisi sendiri setiap kali ekstensi membaca profil atau video KOL ini (tugas otomatis, Simpan ke Elorae, atau kiriman otomatis panel). Yang dibaca hanya akun yang DITANDAI di posting itu (data tag TikTok, bukan nama yang tertulis di caption) — merek yang hanya disebut namanya atau terlihat di video tidak tercatat. Akun KOL ini sendiri tidak pernah dihitung sebagai brand.",
          "Jenis ditebak dari posting: Berbayar bila TikTok menandainya iklan, atau tagar/caption memuat penanda iklan (ad, ads, iklan, sponsored, sponsor, endorse, endorsement, paid partnership, paid promotion, kerja sama berbayar, kemitraan berbayar); Kolaborasi bila memuat penanda kolaborasi (collab, collaboration, kolaborasi, kolab, gifted, PR package, partner); selain itu Tag biasa. Pembacaan berikutnya memperbarui jenis, views, dan caption.",
          "Tambah brand untuk kerja sama yang tidak terbaca ekstensi (Instagram, YouTube, atau posting lama). Link video TikTok membuat baris itu sama dengan yang dibaca ekstensi, jadi tidak tercatat dua kali. Hapus menghapus satu baris dan tercatat di riwayat KOL; baris dari ekstensi ditulis lagi pada pembacaan berikutnya selama postingnya masih menandai brand itu. Menambah dan menghapus butuh izin kelola Kreatif.",
        ],
      },
      {
        judul: { kunci: "kreatifRuang.kol.profil.tab.ukuran" },
        isi: "Salin alamat menyalin nama penerima, nomor WhatsApp, alamat, lalu kota, provinsi, dan kode pos — siap ditempel ke aplikasi kurir. Peringatan muncul bila alamat atau nomornya belum terisi.",
      },
      {
        judul: { kunci: "kreatifRuang.pajakKol.judul" },
        isi: [
          "Di tab Ukuran & alamat. Subjek pajak KOL: perorangan (PPh 21), berbadan — agensi, PT, CV (PPh 23), atau tidak dipotong (wajib beralasan, mis. KOL luar negeri). Centang NPWP bila NIK-nya sudah terpadan atau NPWP-nya valid; tanpa itu tarifnya lebih tinggi. Gross-up bawaan membuat kolaborasi berbayar baru KOL ini langsung memakai mode gross-up. Mengubah subjek menghitung ulang termin yang belum dibayar.",
          "Rekening (bank, nomor, atas nama), NIK, dan NPWP disimpan TERENKRIPSI. Pengelola Kreatif bisa mengisi dan mengganti, tetapi tidak pernah melihat isi lamanya — layar hanya menampilkan bank, empat digit terakhir rekening dan NIK, dan apakah NPWP tersimpan. Kosongkan isian untuk membiarkannya; centang Hapus untuk menghapusnya.",
          "Buka data lengkap hanya untuk keuangan, dengan PIN; setiap pembukaan tercatat di jejak audit atas nama pembukanya.",
        ],
      },
      {
        judul: { kunci: "kreatifRuang.kol.profil.tab.pengikut" },
        isi: [
          "Setiap kali jumlah pengikut sebuah akun berubah (lewat formulir atau tambah massal), angka barunya dicatat sebagai baris riwayat, tidak menimpa yang lama. Garis kecil di samping nama akun menunjukkan arahnya.",
          "Akun TikTok yang dipantau ekstensi menampilkan ER akun, rata-rata views, pengikut, kapan terakhir dicek, dan hasil ceknya (terbaca, tidak ditemukan, privat, tidak terbaca). Setiap cek menambah satu baris riwayat bersumber Ekstensi, lengkap dengan ER dan rata-rata views saat itu.",
          "ER akun = rata-rata ER per posting atas paling banyak 12 posting terbaru yang tidak disematkan dan berumur minimal 48 jam; ER satu posting = (like + komentar + share + save) ÷ views × 100, rumus yang sama dengan ER konten. Posting tanpa views dilewati. Kurang dari 3 posting yang memenuhi syarat: ER tidak dihitung (tanda —), dan ER terakhir yang terukur tetap tampil beserta tanggalnya.",
        ],
      },
      {
        judul: { kunci: "kreatifRuang.kol.catatan.judul" },
        isi: "Catatan manual (garis kiri berwarna) dan riwayat otomatis (garis abu, berlabel otomatis) dalam satu linimasa, terbaru di atas. Menulis catatan dihitung sebagai kontak terakhir, jadi jam follow-up mulai ulang. Catatan sebuah kolaborasi juga tampil di sini beserta nomor kolaborasinya.",
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/campaign",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.campaign" },
    isi: [
      "Daftar campaign dengan status, periode, jumlah KOL dan konten dibanding target, views, biaya terpakai, budget, GMV, dan ROAS. Campaign yang diarsipkan ada di bawah; chip Semua/Aktif/Arsip menyaringnya. Chip status (Draft, Berjalan, Selesai, Batal) menyaring menurut status campaign; angkanya mengikuti chip arsip yang sedang dipilih. Kedua saringan ikut di alamat halaman (?status= dan ?keadaan=).",
      "Status campaign dipilih di formulirnya: Draft (masih disiapkan), Berjalan (bawaan campaign baru), Selesai, atau Batal. Status terpisah dari arsip — arsip hanya menyembunyikan campaign dari daftar aktif dan menutupnya dari kolaborasi baru. Setiap perubahan status tercatat di riwayat sebagai \"Status campaign KOL diubah\" (sebelum dan sesudah).",
      "Bar budget hijau di bawah 80%, kuning mulai 80%, merah bila terpakai melebihi budget (tertulis \"lebih Rp …\").",
      "Brief induk diwariskan ke kolaborasi baru yang brief-nya dibiarkan kosong. Campaign yang sudah lewat diarsipkan lewat centang di formulirnya, bukan dihapus; campaign yang diarsipkan tidak menerima kolaborasi baru.",
      "Lihat kolaborasi membuka daftar Kolaborasi yang sudah tersaring ke campaign itu.",
    ],
    kartu: [
      {
        judul: "KOL dan konten",
        isi: "KOL = jumlah KOL berbeda yang kolaborasinya belum keluar jalur, dibanding target KOL (abu-abu). Konten = konten yang sudah tayang, dibanding target konten.",
      },
      {
        judul: "Terpakai",
        isi: "Jumlah biaya kolaborasi di campaign itu: fee + PPh gross-up yang ditanggung Elorae + boost + ongkir + modal sampel yang sudah berangkat + komisi. Fee dihitung sejak dijanjikan, karena budget adalah komitmen. Kolaborasi yang keluar jalur (ditolak, ghosting, batal) tanpa konten tayang hanya menghitung yang benar-benar keluar: ongkir, modal sampel, dan komisi.",
      },
      {
        judul: "ROAS",
        isi: "GMV ÷ terpakai. Hijau bila 1 atau lebih, merah bila kurang, — bila belum ada biaya.",
      },
      {
        judul: "Ringkasan di atas daftar",
        isi: [
          "Tidak ikut saringan. KOL aktif = KOL yang tidak dinonaktifkan dan tidak diblokir. Total pengikut = jumlah pengikut akun TERBESAR tiap KOL aktif, jadi orang yang sama di dua platform tidak dihitung dua kali.",
          "Campaign berjalan = campaign berstatus Berjalan yang tidak diarsip. Total budget, terpakai, dan views = jumlah semua campaign yang tidak diarsip (apa pun statusnya); terpakai dan views dihitung sama persis dengan baris tabelnya.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/campaign/[id]",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.detailCampaign" },
    isi: [
      "Rincian satu campaign: biaya terpakai dibanding budget, GMV, ROAS, views, kemajuan target KOL dan konten, tujuan, catatan, dan brief induk.",
      "Tabel kolaborasinya sama dengan daftar Kolaborasi (tahap bisa diubah langsung; mundur dan keluar meminta alasan). Halaman ini menampilkan 25 kolaborasi yang terakhir diubah; Buka di daftar kolaborasi menampilkan semuanya dengan saringan dan papan.",
      "Tambah kolaborasi membuka formulir kolaborasi dengan campaign ini sudah terpilih. Campaign yang diarsipkan tidak bisa ditambah kolaborasinya.",
    ],
    kartu: [
      {
        judul: "Terpakai dan bar budget",
        isi: "Sama dengan daftar campaign: hijau di bawah 80% budget, kuning mulai 80%, merah bila lewat.",
      },
      {
        judul: "CPV, CPE, ER aktual",
        isi: [
          "CPV (biaya per view) = terpakai ÷ views. CPE (biaya per interaksi) = terpakai ÷ (like + komentar + share + save). ER aktual = (like + komentar + share + save) ÷ views × 100 — rumus ER yang sama dengan ER konten dan ER akun di Elorae, jadi save ikut dihitung.",
          "Terpakai adalah angka yang sama dengan kartu Terpakai dan ROAS di halaman ini. Views dan interaksi = angka TERBARU tiap konten yang sudah tayang di campaign ini (angka lama tidak dijumlahkan). CPV dan CPE dibulatkan dua desimal. Bila pembaginya nol (belum ada views atau interaksi) tertulis —.",
        ],
      },
      {
        judul: { kunci: "kreatifRuang.campaign.detail.target" },
        isi: "KOL, konten tayang, dan views dibanding targetnya, dengan bar kemajuan. Untuk konten dan views, persen di sampingnya = capaian ÷ target × 100 (boleh lebih dari 100%). Target yang dikosongkan tidak dinilai.",
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/sampel",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.sampel" },
    isi: [
      "Antrean kirim sampel ke KOL: Perlu dikirim → isi kurir dan resi → Dalam perjalanan → isi tanggal terima → Sudah sampai → tinggal menunggu konten. Semua dikerjakan langsung di baris, tanpa membuka jendela, dan daftarnya menyusut saat dikerjakan.",
      "Stok keluar dari gudang TEPAT SEKALI, saat paketnya berangkat — resi disimpan (tanggal kirim yang dikosongkan = hari ini). Potongannya per varian, dengan stok TERSEDIA (stok gudang dikurangi yang sudah dipesan): kalau satu baris saja kurang, seluruh paket ditolak dan baris yang kurang ditandai. Harga pokok rata-rata saat itu disalin ke pengiriman sebagai modal sampel, dan stoknya dikirim ulang ke Jubelio. Menyimpan ulang, mengirim ulang resi yang sama, atau klik dua kali tidak memotong stok lagi.",
      "Kurir yang tidak memberi nomor resi (diantar sendiri, kurir toko): centang \"Tanpa resi\". Paketnya tetap berangkat dan stoknya keluar, tetapi resinya tampil \"tanpa resi\".",
      "Tahap kolaborasi maju sendiri: resi disimpan → Sampel dikirim; tanggal terima → Sampel diterima. Pesan sesudah menyimpan menyebut perpindahannya.",
      "Satu kolaborasi punya paling banyak satu pengiriman yang belum berangkat. Mengisi resi di sini mengisi pengiriman itu (yang mungkin dibuat dari halaman kolaborasi) — tidak membuat baris baru.",
      "Membatalkan kolaborasi tidak mengembalikan stok yang sudah berangkat, dan barang di pengiriman yang sudah berangkat tidak bisa diubah atau dihapus — barangnya sudah di tangan kurir. Yang masih bisa dibetulkan dari halaman kolaborasi: kurir, resi, tanggal, ongkir, dan catatan.",
      "Kata cari mencocokkan nama atau username KOL, nomor kolaborasi, nama campaign, dan nomor resi. Tab, kata cari, campaign, dan halaman ikut di alamat halaman, jadi tautan dari Hari ini membuka antrean yang sama dengan angkanya.",
    ],
    kartu: [
      {
        judul: { kunci: "kreatifRuang.sampel.tab.perlu-dikirim" },
        isi: [
          "Kolaborasi di tahap Deal atau Brief dikirim yang belum punya paket berangkat. Barangnya diambil dari rencana sampel kolaborasi, atau dari pengiriman yang sudah dibuat tapi belum berangkat. Kalau belum ada rencana atau ukurannya belum dipilih, buka \"Pilih barang\": cari barang jadi, pilih ukuran yang ada stoknya (angka di tombol = stok tersedia).",
          "Umur = hari sejak deal; merah bila melewati ambang \"deal sampai kirim sampel\" di Pengaturan Kreatif.",
          "Unduh alamat kirim membuat berkas CSV untuk gudang: satu baris per barang dengan nama penerima, HP, alamat lengkap, kota, provinsi, kode pos, barang, varian, jumlah, dan nomor kolaborasi — mengikuti saringan yang sedang dipakai.",
        ],
      },
      {
        judul: { kunci: "kreatifRuang.sampel.tab.dalam-perjalanan" },
        isi: "Satu baris per paket yang sudah berangkat dan belum diterima. Umur = hari sejak dikirim; merah bila melewati ambang \"kirim sampai terima\" (resi nyangkut). Tanggal terima bawaan hari ini; tidak boleh sebelum tanggal kirim atau sesudah hari ini.",
      },
      {
        judul: { kunci: "kreatifRuang.sampel.tab.sudah-sampai" },
        isi: "Paket yang sudah diterima dan kontennya belum tayang. Sejak terima merah bila melewati ambang \"terima sampai tayang\". Begitu kontennya tayang (atau kolaborasinya keluar jalur), barisnya hilang dari antrean.",
      },
      {
        judul: { kunci: "kreatifRuang.sampel.dobel.judul" },
        isi: "Peringatan, bukan penolakan: KOL yang sama, atau KOL lain dengan nomor WhatsApp yang sama (orang yang sama didaftarkan dua kali), sudah pernah menerima paket — di campaign yang sama atau kapan pun. Cek dulu sebelum mengirim lagi.",
      },
      {
        judul: { kunci: "kreatifRuang.sampel.kolom.alamat" },
        isi: "Alamat lengkap, bukan hanya kota. \"Salin alamat\" menyalin nama penerima, nomor HP, alamat, dan kota sekaligus untuk ditempel ke aplikasi kurir. Alamat atau nomor HP yang kosong ditandai merah — lengkapi di profil KOL.",
      },
      {
        judul: { kunci: "kreatifRuang.sampel.panel.judul" },
        isi: "Di halaman kolaborasi, tab Pengiriman mencatat setiap paket: barang per varian, kurir, resi, tanggal kirim dan terima (\"jalan\" bila belum diterima), ongkir, dan HPP yang disalin saat berangkat. Rencana yang belum berangkat bisa diubah atau dihapus; \"Tambah pengiriman\" muncul lagi begitu paket sebelumnya berangkat.",
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/konten-kol",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.kontenKol" },
    isi: [
      "Antrean konten dari KOL dalam lima chip: Menunggu konten, Draf masuk, Disetujui (belum tayang), Tayang, dan Jadwal tayang. Angka di chip mengikuti pencarian dan campaign yang dipilih, dan sama persis dengan isi daftarnya. Chip, pencarian, campaign, halaman, dan bulan tersimpan di alamat halaman, jadi tautannya bisa dibagikan. Tautan dari Hari ini membuka chip yang tepat dan hanya menampilkan kolaborasi yang dimaksud; tekan × pada penandanya untuk melihat semua kolaborasi lagi.",
      "Pekerjaan dilakukan langsung di baris: tempel link lalu tekan Tayang atau Draf, setujui atau minta revisi draf, isi angka lalu Simpan. Sesudah tersimpan barisnya pindah ke chip berikutnya, dan tahap kolaborasinya maju sendiri — toast menyebut perpindahannya (\"Konten tayang tercatat · tahap → Tayang\").",
      "Tahap yang maju sendiri dari konten: link draf → Draf masuk; draf disetujui → Draf disetujui; link tayang → Tayang; angka yang dicatat pada hari ke-7 sesudah tayang atau lebih → Angka masuk. Tahap tidak pernah mundur sendiri.",
      "Tombol Pengingat membuka pesan WhatsApp bertemplate ke KOL-nya dan mencatat kontak terakhir. Panah di ujung baris membuka rincian kolaborasi.",
    ],
    kartu: [
      {
        judul: "Menunggu konten",
        isi: "Kolaborasi yang sampelnya sudah diterima, atau yang sudah deal/brief dikirim tanpa sampel sama sekali, dan belum punya draf maupun konten tayang. Kolom Sejak menghitung hari dari tanggal terima terakhir (atau tanggal deal bila tanpa sampel) dan menjadi merah lewat ambang \"terima sampai tayang\" di Pengaturan Kreatif. Link yang ditempel tanpa https:// tetap diterima; platformnya ditebak dari situs link-nya.",
      },
      {
        judul: "Draf masuk",
        isi: "Draf berstatus menunggu review atau revisi yang belum tayang, pada kolaborasi yang masih berjalan. Lama menunggu dihitung dari waktu draf masuk; draf yang menunggu review kita disorot merah lewat ambang \"review draf\". Minta revisi wajib bercatatan — catatannya disimpan di draf, ditambahkan ke catatan kolaborasi (\"Minta revisi draf: …\"), dan dicatat di riwayat.",
      },
      {
        judul: "Disetujui, belum tayang",
        isi: "Draf yang sudah disetujui tetapi link tayangnya belum ada — di sini, bukan hilang dari kedua daftar. Rencana tayang bisa diubah di baris; tempel link tayang begitu kontennya naik.",
      },
      {
        judul: "Tayang",
        isi: [
          "Konten yang sudah punya link tayang, terbaru dulu. Isi views, likes, komentar, share, dan save lalu Simpan: setiap simpan menjadi baris angka BARU, angka lama tidak pernah ditimpa. Kotak yang dibiarkan kosong memakai angka terakhirnya (terlihat samar di kotaknya), jadi cukup ketik yang berubah. Isian seperti 52k, 1,2jt, atau 88.000 terbaca.",
          "ER = (likes + komentar + share + save) ÷ views dari angka terakhir; bila views nol, dibagi pengikut akun di platform itu. Pengingat \"H+1/H+3/H+7 kosong\" muncul bila titik angka itu sudah lewat (hari WIB) dan belum ada angka sesudahnya; kolaborasi yang selesai atau keluar jalur tidak menagih angka. Ikon jam membuka riwayat semua angka.",
        ],
      },
      {
        judul: "Jadwal tayang",
        isi: "Kalender bulan, Senin di depan, menurut hari WIB. Hijau = sudah tayang (tanggal tayang), aksen = rencana tayang (rencana per konten, atau rencana tayang kolaborasi yang belum punya konten). Hari dengan lima konten atau lebih diberi latar kuning. Klik nama untuk membuka kolaborasinya.",
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/performa",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.performa" },
    isi: [
      "Performa per video TikTok, reel/posting Instagram, dan video YouTube dari KOL dan afiliasi: views, like, komentar, share, simpan, dan ER, dibaca ekstensi pemantau di Kreatif → Pemantauan. Satu baris = satu video; angkanya bacaan TERBARU video itu, angka lama tidak pernah ditimpa (riwayatnya ada di rincian kolaborasi). Klik baris untuk membuka kolaborasinya; Buka di TikTok/Instagram/YouTube membuka videonya. Saringan Platform memilih satu platform.",
      "Tempel link: tempel link video TikTok, reel/posting Instagram, atau video YouTube — satu per baris, atau langsung dari obrolan WhatsApp (teks lain diabaikan) — lalu pilih KOL atau Afiliasi. TikTok: link lengkap (dengan atau tanpa https://, www., parameter di belakangnya) dan link pendek vt.tiktok.com, vm.tiktok.com, tiktok.com/t/ diterima; link pendek dibuka dulu oleh server. Instagram: instagram.com/reel/…, /p/… (juga yang memuat nama akun, mis. instagram.com/akun/reel/…). YouTube: youtube.com/watch?v=…, /shorts/…, youtu.be/…. Posting foto TikTok, link profil, Threads, Facebook, dan situs lain tidak ditambahkan dan disebut alasannya. Paling banyak 500 link sekali tempel.",
      "Link Instagram dan YouTube biasanya tidak memuat nama akun pemiliknya. YouTube: server membuka halaman videonya sekali untuk membaca kanal pemilik dan tanggal tayangnya. Instagram: link yang memuat nama akun (instagram.com/akun/reel/…) langsung dipakai; link dari tombol Salin link Instagram dibuka server, tetapi Instagram sering hanya menampilkan halaman masuk kepada server — bila nama akunnya tidak terbaca, link itu disebut \"akun pemiliknya tidak terbaca\". Untuk link seperti itu: buka postingnya di Chrome yang memasang ekstensi (panel Elorae menyimpannya), atau salin link dari halaman profil KOL-nya. Tanggal tayang Instagram dibaca dari kode postingnya (perkiraan dari susunan kode Instagram, belum diuji pada semua posting); bila tidak terbaca, dipakai waktu menempel.",
      "Untuk setiap video: orangnya dicari lewat akunnya di platform video itu (handle tanpa memandang huruf besar dan @); bila belum ada, dibuat KOL baru bernama @handle dengan akun platform itu. Reel Instagram dicatat berformat Reels, posting Instagram berformat Feed, video YouTube berformat Video. Video dicatat pada kolaborasi yang masih berjalan dengan jenis yang cocok — Afiliasi = kerja sama komisi, KOL = selain komisi; bila tidak ada, dibuat kolaborasi baru tanpa fee dan tanpa campaign. Tanggal tayang dibaca dari id videonya, dan tahap kolaborasinya maju ke Tayang seperti link yang ditempel di Konten KOL. Video yang sudah ada di Elorae dilewati (disebut \"sudah dipantau\"). KOL yang diblokir tidak ditambahkan.",
      "Video yang MENANDAI Elorae masuk ke sini sendiri, tanpa ditempel: setiap kali ekstensi membaca profil atau video seorang KOL (tugas otomatis, Simpan ke Elorae, atau kiriman otomatis panel), posting milik KOL itu yang menandai akun Elorae atau memakai tagar Elorae (Kreatif → Pengaturan → Brand & kompetitor) dan belum ada di Elorae langsung dicatat — dengan views, like, komentar, share, dan simpan dari pembacaan yang sama, tanpa menunggu antrean. Yang dibaca hanya akun yang DITANDAI di video (data tag TikTok), bukan nama yang ditulis di caption. Video itu dicatat pada kolaborasi berjalan KOL-nya — Afiliasi bila semua kolaborasi berjalannya kerja sama komisi, selain itu KOL — atau kolaborasi baru tanpa fee, sama dengan Tempel link; KOL yang belum ada dibuat bernama @handle. Barisnya berlencana Terdeteksi otomatis. Butuh izin kelola Kreatif milik orang yang memasang ekstensi; bisa dimatikan di Pengaturan.",
      "Video yang SUDAH ada di sini juga mendapat angka baru dari pembacaan profil KOL-nya, paling sering sekali per 12 jam per video, supaya membuka profil berkali-kali tidak menumpuk baris angka.",
      "Video baru langsung masuk antrean cek di urutan paling depan, jadi angka pertamanya masuk begitu ekstensi berjalan. Sesudah itu video dicek pada H+1, H+3, H+7, H+30, lalu setiap 7 hari sampai 90 hari sesudah tayang (selang dan batasnya diatur di Kreatif → Pemantauan).",
      "Instagram dan YouTube tidak menampilkan semua angka: share dan simpan tidak pernah terlihat di Instagram, like bisa disembunyikan, posting foto tidak punya views, dan komentar YouTube kadang tidak terbaca. Angka yang tidak terbaca tersimpan 0 dengan catatan yang menyebutnya di riwayat angka konten — jadi ER Instagram dan YouTube lebih rendah daripada ER TikTok dengan rumus yang sama; bandingkan di dalam satu platform saja. Video Instagram hanya dicek selama ada tab instagram.com yang sudah masuk terbuka di Chrome ekstensinya; video YouTube dicek tanpa tab.",
      "Angka TikTok terus bertambah sesudah dibaca, jadi angka di sini bisa sedikit di bawah angka yang tampil di TikTok saat ini. Untuk memperbaruinya kapan saja: tombol putar di kolom Status (satu video) atau Cek ulang halaman ini (semua video di halaman). Videonya ditaruh di depan antrean dan dicek ekstensi dalam sekitar satu menit, juga di luar jam kerja pemantauan; jeda otomatis karena beberapa kali gagal berturut-turut ikut dilepas. Yang tetap harus diselesaikan di Chrome: captcha atau login TikTok (lalu Lanjutkan di Pemantauan), dan Chrome profil KOL tracker dengan ekstensi Elorae harus menyala. Pesan sesudah menekan tombol menyebut bila ada yang menghalangi. Selama ada video yang Menunggu cek, halaman ini memperbarui angkanya sendiri setiap 15 detik. Setiap cek memakai kuota harian. Cara lain yang langsung: buka videonya di Chrome itu lalu tekan Simpan ke Elorae di panel Elorae.",
      "Saring KOL/Afiliasi, cari nama atau @handle, pilih rentang tanggal tayang, dan urutkan (views terbanyak, naik terbanyak, ER tertinggi, tayang terbaru, dicek terbaru). Saringan, urutan, dan halaman tersimpan di alamat halaman. Menempel link butuh izin kelola Kreatif; melihat cukup izin lihat Kreatif.",
    ],
    kartu: [
      {
        judul: { kunci: "kreatifRuang.performa.kpi.label" },
        isi: "Empat angka menurut saringan yang sedang dipakai: banyaknya video, jumlah views terbaru semua video, rata-rata ER per video (video tanpa views tidak dihitung), dan video yang bacaan terbarunya hari ini (WIB).",
      },
      {
        judul: "Kolom",
        isi: [
          "ER = (like + komentar + share + simpan) ÷ views × 100 dari bacaan terbaru — rumus yang sama dengan Konten KOL dan Laporan. Naik = views terbaru dikurangi views bacaan sebelumnya; kosong bila baru ada satu bacaan.",
          "Dicek menyebut waktu bacaan terbaru dan sumbernya: Ekstensi (pemantau) atau Diisi manual. Status: Menunggu cek (masih di antrean), Terbaca, Gagal (cek terakhir gagal dan belum disusul bacaan; alasannya di bawahnya, mis. video tidak ditemukan), atau Belum dicek.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/brand",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.brand" },
    isi: [
      "Semua brand yang pernah DITANDAI KOL di postingnya — termasuk kompetitor dan Elorae sendiri — dari riwayat brand di profil KOL: berapa KOL yang menandainya, berapa posting, dan kapan posting terakhirnya. Posting tanpa tanggal dihitung dengan tanggal dicatatnya. Klik baris untuk melihat KOL-KOL yang menandai brand itu: jumlah posting per jenis (berbayar, kolaborasi, tag biasa), jumlah views posting-posting itu saat terakhir terbaca, dan posting terakhir; klik KOL untuk membuka tab Brand profilnya.",
      "Isinya terkumpul sendiri dari setiap pembacaan ekstensi (profil dan video KOL) plus isian manual di profil KOL. Yang dibaca hanya akun yang DITANDAI di posting (data tag TikTok), bukan nama yang ditulis di caption, jadi brand yang hanya disebut atau terlihat di video tidak tercatat. Semakin sering profil KOL dibuka di Chrome yang memasang ekstensi, semakin lengkap daftarnya.",
      "Cari handle, nama yang diisi manual, atau nama kompetitor dari Pengaturan; saring Kompetitor saja atau Elorae (keduanya mengikuti daftar di Kreatif → Pengaturan → Brand & kompetitor). Saringan, pencarian, halaman, dan brand yang dibuka tersimpan di alamat halaman. Halaman ini hanya membaca (izin lihat Kreatif).",
    ],
  },
  {
    rute: "/backoffice/kreatif/pembayaran",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.pembayaran" },
    isi: [
      "Daftar termin pembayaran fee KOL, satu baris per termin. Fee sebuah kolaborasi dibayar lewat satu atau beberapa termin; bawaannya satu termin \"Pelunasan\" yang jatuh tempo sekian hari sesudah konten tayang (Kreatif → Pengaturan, bawaan 14 hari). Termin diatur dan dipecah (mis. DP 50% saat deal + pelunasan 50% sesudah tayang) di tab Pembayaran rincian kolaborasi.",
      "Setiap termin menampilkan bruto, PPh yang dipotong, dan neto — yang benar-benar ditransfer ke KOL. Mode DIPOTONG: fee yang disepakati adalah bruto, KOL menerima bruto dikurangi PPh. Mode GROSS-UP (\"KOL tidak mau dipotong\"): fee yang disepakati adalah neto yang diterima KOL, bruto dinaikkan supaya sesudah dipotong PPh tetap sebesar itu, dan PPh-nya ditanggung Elorae. Mode dipilih per kolaborasi; KOL bisa diberi gross-up bawaan di profilnya.",
      "PPh 21 untuk KOL perorangan (DPP 50% bruto, tarif progresif Pasal 17, per pembayaran, 20% lebih tinggi tanpa NPWP); PPh 23 untuk KOL berbadan (2% bruto, dua kali lipat tanpa NPWP); nol untuk KOL yang ditandai tidak dipotong. Semua tarif adalah BAWAAN di Kreatif → Pengaturan dan wajib dikonfirmasi konsultan pajak.",
      "Chip Belum dibayar, Jatuh tempo (sampai hari ini), Dibayar, dan Semua. Jatuh tempo dihitung dari pemicu terminnya: tanggal deal atau tanggal tayang ditambah harinya, atau tanggal tetap. \"Menunggu tayang\" berarti jatuh temponya belum mulai dihitung. Merah berarti sudah lewat.",
      "Bayar: isi tanggal bayar (tidak boleh sesudah hari ini), unggah bukti transfer bila ada, dan nomor bukti potong bila sudah dibuat. Termin yang sudah dibayar terkunci; membatalkan pembayarannya (salah catat) hanya dari rincian kolaborasi, wajib beralasan, dan ditolak bila PPh-nya sudah disetor. Pilih beberapa termin lalu \"Bayar yang dipilih\" untuk satu transfer sekaligus — total menjumlah SEMUA yang dipilih, dan bila satu termin ditolak tidak ada yang tersimpan.",
      "Tanda ⚠ di samping nama KOL berarti data pajaknya belum lengkap (rekening atau NIK/NPWP belum diisi di profil KOL). Pembayaran tetap bisa dicatat, tetapi bukti potong butuh identitasnya.",
      "Status bayar kolaborasi (belum, sebagian, lunas) diturunkan dari terminnya. Kolaborasi yang sudah tayang dan semua terminnya dibayar maju sendiri ke tahap Dibayar.",
      "Setiap pembayaran dijurnal ke buku besar sesudah tersimpan: sebelum tayang sebagai uang muka KOL, sesudah tayang mengurangi utang KOL; bank berkurang sebesar neto dan utang PPh bertambah sebesar PPh. Akunnya diatur keuangan di Pemetaan Akun; bila belum dipetakan pembayaran tetap tersimpan dan jurnalnya menunggu di Jurnal → Tertunda.",
      "Ekspor CSV mengunduh termin sesuai saringan yang sedang dibuka (semua halaman), dengan rekening tersamar (bank + empat digit terakhir), ditutup baris TOTAL.",
    ],
    kartu: [
      {
        judul: { kunci: "kreatifRuang.termin.kartu.fee" },
        isi: "Jumlah termin di saringan yang sedang dibuka (chip, pencarian, campaign) dalam angka yang DISEPAKATI dengan KOL: neto bila gross-up, bruto bila dipotong. Baris bawahnya menyebut biaya bruto termasuk PPh — dasar pengakuan beban KOL.",
      },
      {
        judul: { kunci: "kreatifRuang.termin.kartu.pphSemua" },
        isi: "Jumlah PPh 21 dan PPh 23 termin itu, dipisah: yang dipotong dari KOL (mode dipotong) dan yang ditanggung Elorae (gross-up — menambah biaya). Yang sudah dibayar disetor dan dilaporkan keuangan dari Keuangan → PPh dipotong.",
      },
      {
        judul: { kunci: "kreatifRuang.termin.kartu.beban" },
        isi: "Bruto termin yang kolaborasinya sudah tayang — sama dengan jurnal beban KOL. Sebelum tayang, termin yang sudah dibayar dicatat sebagai uang muka, jadi angka ini bisa nol walaupun uang sudah keluar.",
      },
      { judul: { kunci: "kreatifRuang.termin.kartu.neto" }, isi: "Jumlah yang ditransfer ke KOL. Baris bawahnya: neto termin yang belum dibayar." },
    ],
  },
  {
    rute: "/backoffice/kreatif/kalender",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.kalender" },
    isi: [
      "Kalender bulan (Senin di depan) berisi tenggat turunan (ditandai ⚠ merah), kejadian yang diringkas per jenis per hari, dan agenda Anda. Lingkaran tipis menandai hari ini; lingkaran tebal hari yang sedang dibuka.",
      "Tenggat dihitung dari tanggal-tanggal kolaborasi dan ambang di Kreatif → Pengaturan: follow-up, kirim sampel, resi nyangkut, batas tayang, review draf, jatuh tempo bayar, dan isi angka H+1/H+3/H+7. Tenggat tidak disimpan, jadi selalu mengikuti ambang terbaru; tenggat yang sudah dikerjakan hilang sendiri.",
      "Pilihan saringan (semua, hanya tenggat, logistik, konten, pembayaran, agenda saya) diingat per orang di peramban ini dan ikut di alamat halaman. Mengklik tanggal hanya mengganti panel di kanan; bulannya tidak dimuat ulang.",
      "Agenda itu pribadi: hanya Anda yang melihat dan mengubah agenda Anda. Setiap perubahan, centang, selesai, dan hapus tercatat di riwayat.",
    ],
    kartu: [
      {
        judul: "Sel tanggal",
        isi: "Paling banyak empat baris: tenggat dulu (⚠ jumlah dan jenisnya), lalu agenda (jam dan judul; dicoret bila selesai), lalu kejadian ('3 konten tayang', '2 paket sampai'). Sisanya ditulis '+N lagi'. Angka merah di pojok = agenda yang belum selesai. Di layar ponsel sel hanya menampilkan titik: merah tenggat, biru agenda, hijau kejadian.",
      },
      {
        judul: { kunci: "kreatifRuang.kalender.panel.perlu" },
        isi: "Tenggat yang jatuh di hari yang dibuka, dikelompokkan per jenis; klik baris untuk membuka kolaborasinya. Pada hari ini, panel juga menyebut kolaborasi yang sudah deal tetapi sampelnya belum berangkat.",
      },
      {
        judul: { kunci: "kreatifRuang.kalender.panel.agenda" },
        isi: "Agenda Anda di hari itu dengan daftar persiapannya. Centang butir persiapan langsung di kartu; tombol ✓ menandai agenda selesai, ↺ membukanya lagi.",
      },
      {
        judul: { kunci: "kreatifRuang.kalender.panel.terjadi" },
        isi: "Paket dikirim dan sampai, rencana tayang, konten tayang (dengan jumlah views terbaru), pembayaran fee (dengan nominalnya), serta campaign yang mulai atau selesai.",
      },
      {
        judul: { kunci: "kreatifRuang.kalender.form.judulBaru" },
        isi: "Judul wajib. Jam boleh kosong. Daftar persiapan diketik satu baris satu butir; awali dengan [x] untuk yang sudah selesai (paling banyak 50 butir). Kaitkan ke campaign, kolaborasi, atau KOL bila perlu — memilih kolaborasi otomatis mengaitkan KOL-nya. 'Ingatkan sejak H-n' (0 sampai 30) membuat agenda muncul di Hari ini sejak n hari sebelumnya.",
      },
      {
        judul: { kunci: "kreatifRuang.kalender.langganan.judul" },
        isi: [
          "Tautan rahasia untuk melihat isi kalender ini — tenggat, kejadian, dan agenda Anda — di Google Calendar, Apple Calendar, atau aplikasi kalender lain yang bisa berlangganan iCal. Isinya 30 hari ke belakang sampai 90 hari ke depan dan sama dengan halaman ini; agenda orang lain tidak ikut. Setiap tenggat, kejadian, dan agenda menjadi satu acara yang membawa tautan \"Buka di Elorae\" ke kolaborasi, campaign, atau agendanya.",
          "Buat tautan, lalu pilih Tambahkan ke Google Calendar (Google Calendar terbuka dan menanyakan apakah kalender ini ditambahkan), Apple Calendar (webcal) di Mac atau iPhone, atau Salin untuk ditempel di \"Dari URL\" aplikasi kalender lain. Tautannya hanya ditampilkan sekali; sesudah halaman dimuat ulang yang tersisa hanya \"Tautan aktif sejak …\". Lupa menyimpannya? Buat tautan baru.",
          "Tidak seketika: Google Calendar menyegarkan kalender langganan sendiri, biasanya beberapa jam sekali (bisa sampai sehari), dan Elorae tidak bisa memaksanya. Agenda yang baru dibuat atau tenggat yang baru selesai baru terlihat di Google sesudah penyegaran berikutnya. Di Apple Calendar selang penyegarannya bisa diatur di info langganan. Yang selalu terbaru adalah halaman Kalender ini.",
          "Siapa pun yang memegang tautan itu bisa membaca kalender ini sampai tautannya dicabut — jangan dibagikan. Cabut menghentikannya seketika, dan Buat tautan baru juga mencabut yang lama. Tautan juga berhenti bekerja sendiri bila akun Anda tidak lagi punya akses Kreatif. Satu orang paling banyak satu tautan aktif; setiap pembuatan dan pencabutan tercatat di jejak audit.",
          "Kalender langganan hanya untuk dibaca: agenda dibuat, diubah, dan diselesaikan di halaman ini, lalu ikut tampil di Google pada penyegaran berikutnya.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/laporan",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.laporan" },
    isi: [
      "Dua laporan dengan pilihan periode yang sama: hari ini, 7 hari, 30 hari, bulan ini, bulan lalu, semua, atau rentang tanggal. Periode dihitung dalam hari WIB.",
      "Aturan periode sama di seluruh Ruang KOL: konten dihitung menurut tanggal tayang, penjualan menurut tanggalnya, sampel menurut tanggal berangkat, dan fee serta boost menurut tanggal deal. Angka konten yang dipakai adalah pengisian terbaru tiap konten.",
    ],
    kartu: [
      {
        judul: { kunci: "kreatifRuang.laporan.tab.peringkat" },
        isi: [
          "Siapa yang layak diajak lagi. Hanya KOL yang punya aktivitas (konten, views, order, GMV, atau biaya) pada periode itu yang ikut. Bawaan: bulan ini, diurut menurut GMV; bisa diurut menurut ROAS, order, views, jumlah konten, CPM termurah, atau biaya terbesar.",
          "Nomor peringkat berlanjut lintas halaman; tiga teratas disorot. ROAS = GMV ÷ biaya — hijau bila 1 atau lebih, merah bila kurang dari 1, dan — selama belum ada penjualan. Biaya = fee + PPh gross-up yang ditanggung Elorae + boost + ongkir + modal sampel + komisi. CPM = biaya per 1.000 views.",
          "Ekspor CSV performa berisi satu baris per kolaborasi untuk periode dan pencarian yang sama, ditutup baris TOTAL. Kolom \"Fee disepakati\" adalah angka yang disepakati dengan KOL; kolom \"PPh gross-up\" adalah PPh yang ditanggung Elorae.",
        ],
      },
      {
        judul: { kunci: "kreatifRuang.laporan.tab.rekap" },
        isi: [
          "Teks rekap siap tempel ke grup WhatsApp atau email. Bawaan: hari ini. Satu hari berisi rincian per KOL (pengiriman, konten tayang, perubahan tahap); rentang yang lebih panjang berisi ringkasan, konten terbaik, dan per campaign. Blok yang kosong tidak ditulis.",
          "Posisi tahap dan \"Perlu ditindaklanjuti\" adalah keadaan SAAT INI, bukan keadaan pada periode yang dipilih. ROAS di rekap = GMV ÷ biaya (fee + PPh gross-up + kirim + boost + komisi), sama dengan Peringkat dan Hari ini. Bila ada kolaborasi gross-up, rekap menambah baris \"Fee disepakati\" dengan biaya bruto termasuk PPh.",
          "Salin menyalin teksnya; Unduh .txt menyimpannya sebagai berkas; Cetak / PDF membuka versi cetak di tab baru dan langsung membuka jendela cetak — pilih \"Simpan sebagai PDF\" untuk menyimpannya.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/konten",
    bagian: "navGroupCreative",
    judul: { kunci: "creative.contentTitle" },
    isi: [
      { kunci: "creative.contentDescription" },
      "Tampilan Grid feed meniru feed Instagram: urutannya berasal dari jadwal tayang, gambar diunggah langsung ke ubinnya, dan menyeret satu ubin ke ubin lain menukar jadwal keduanya. Tampilan Daftar memuat semua konten dengan statusnya.",
      "Tampilan dan saringan status tersimpan di alamat halaman (?tampilan=, ?status=), jadi tetap sama saat kembali ke halaman ini.",
      "Ubin yang gambarnya gagal dimuat (mis. fotonya sudah terhapus) tampil sebagai slot kosong bertuliskan judulnya dan \"Gambar hilang — unggah ulang\"; klik atau seret gambar ke ubin itu untuk menggantinya.",
      "Status konten: maju boleh melompat (ide langsung dijadwalkan, misalnya). Memundurkan status wajib memakai alasan, dan alasannya tercatat di riwayat. Konten yang sudah tayang tidak bisa dibatalkan — mundurkan dulu statusnya. Konten batal boleh dihidupkan lagi. Dialog ubah hanya menawarkan status yang sah.",
      "\"Lewat jadwal\" dihitung menurut hari WIB: konten yang dijadwalkan hari ini belum terlambat, baru terlambat sesudah harinya berganti.",
      "Unggahan yang gagal disebut sebabnya dalam bahasa Indonesia (bukan gambar, terlalu besar — maksimal 6 MB sesudah diperkecil — atau jaringan putus). \"Pilih semua\" hanya memilih ubin yang terlihat dan bergambar, karena hanya ubin itu yang punya kotak centang.",
    ],
    kartu: [
      {
        judul: "Angka fee KOL",
        isi: "Rencana konten adalah konten akun sendiri, jadi angka fee KOL tidak ada di sini. Fee yang disepakati, biaya bruto termasuk PPh, beban yang sudah diakui, dan yang sudah ditransfer ada di Kreatif → Pembayaran.",
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/pemantauan",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.pemantauan" },
    isi: [
      "Pemantauan angka KOL lewat ekstensi Chrome (uji coba): ekstensi di satu komputer membaca profil dan video TikTok (lewat tab tiktok.com yang Anda buka, atau tab latar), video YouTube (langsung dari halamannya, tanpa tab), dan reel/posting Instagram (hanya lewat tab instagram.com yang sudah masuk dan Anda buka sendiri — ekstensi tidak pernah membuka tab Instagram), lalu mengirim angkanya ke Elorae. Threads dan Facebook tidak didukung: halamannya tidak memuat angka yang stabil untuk dibaca, dan Facebook mengacak susunan halamannya.",
      "Instagram hanya memperlihatkan posting dan angkanya kepada pengguna yang sudah masuk; tanpa masuk, profil Instagram hanya memuat jumlah pengikut. Bentuk data Instagram untuk pengguna yang sudah masuk BELUM diuji — bila angka Instagram tidak terbaca, laporan masalahnya (Pemantauan → Masalah terakhir) menyebut apa yang ditemukan di halamannya. Pengikut YouTube hanya tampil dibulatkan (mis. 46,5 jt), jadi tersimpan sebagai perkiraan dan ER kanal YouTube tidak dihitung; angka per video YouTube (views persis, like, komentar) dibaca dari halaman videonya.",
      "Risikonya sudah disepakati: syarat layanan TikTok melarang pengambilan otomatis, jadi akun TikTok yang dipakai di Chrome itu bisa dibatasi — pakai profil Chrome dan akun TikTok khusus. Ekstensi perlu diperbarui bila halaman TikTok berubah, dan komputernya harus menyala.",
      "Yang dicek: setiap konten kolaborasi yang sudah tayang dengan link TikTok, reel/posting Instagram, atau video YouTube pada H+1, H+3, H+7, dan H+30 (hari WIB), lalu setiap 7 hari sampai 90 hari sesudah tayang (keduanya diatur di kartu pengaturan); akun TikTok KOL yang punya kolaborasi berjalan seminggu sekali; akun lain sebulan sekali (akun Instagram dan YouTube tidak dicek otomatis — pengikutnya diperbarui saat profilnya dibuka di Chrome yang memasang ekstensi). KOL yang diblokir tidak pernah dicek. Konten yang tertinggal hanya dicek di titik terbarunya, sekali; titik yang terlambat lebih dari 14 hari tidak diantrekan lagi — cek berkala yang mengambil alih. Bacaan pada atau sesudah hari sebuah titik menutup titik itu. Satu video punya paling banyak satu tugas terbuka.",
      "Video yang ditempel di Performa video langsung mendapat tugas cek di urutan paling depan, termasuk video yang tayangnya sudah lama.",
      "Kiriman otomatis panel: begitu panel Elorae di halaman TikTok, Instagram, atau YouTube selesai membaca sebuah profil atau video, panel mengirim bacaannya sendiri (bisa dimatikan di popup ekstensi). Elorae hanya menyimpan yang relevan — profil akun yang sudah ada di Elorae (pengikut, ER, riwayat brand, dan video yang menandai Elorae), profil baru yang salah satu postingnya menandai Elorae (KOL @handle dibuat), video yang sudah dipantau (angkanya, paling sering sekali per 12 jam), atau video baru yang menandai Elorae — selebihnya diabaikan tanpa menulis apa pun. Tidak memakan kuota harian; ekstensi mengirim satu URL paling sering sekali per 6 jam, dan Elorae menerima paling banyak 120 kiriman per jam per perangkat.",
      "Antrean disusun otomatis setiap hari pukul 06.00 WIB. Susun antrean sekarang menyusunnya saat itu juga — aman ditekan berkali-kali, tugas yang sudah ada tidak dibuat dua kali.",
      "Melihat cukup izin lihat Kreatif; menyambungkan, menjeda, mencabut, menyusun antrean, dan mengubah pengaturan butuh izin kelola Kreatif. Setiap tindakan itu tercatat di jejak audit.",
    ],
    kartu: [
      {
        judul: { kunci: "kreatifRuang.pantau.kpi.label" },
        isi: "Selesai dan percobaan gagal dihitung per hari WIB untuk semua perangkat bersama; satu tugas yang gagal lalu berhasil terhitung di keduanya. Sisa kuota = kuota harian dikurangi yang selesai, percobaan gagal, dan yang sedang dicek. Simpan ke Elorae dari panel di halaman TikTok (mode manual) tidak memakan kuota.",
      },
      {
        judul: { kunci: "kreatifRuang.pantau.antrean.judul" },
        isi: "Menunggu dan sedang dicek adalah keadaan sekarang; selesai, gagal, dan dilewati dihitung untuk hari ini saja. Satu tugas dipinjam satu perangkat selama 5 menit; bila tidak ada kabar, tugas itu kembali ke antrean. Gagal muat atau angka tidak terbaca dicoba lagi sampai tiga kali.",
      },
      {
        judul: { kunci: "kreatifRuang.pantau.perangkat.judul" },
        isi: [
          "Sambungkan perangkat membuat kode 8 tanda yang berlaku 15 menit dan sekali pakai. Ketik kode itu dan alamat Elorae di popup ekstensi. Kodenya hanya ditampilkan sekali; yang disimpan Elorae hanya sidik (hash) kode dan tokennya, jadi kode yang hilang tidak bisa dilihat lagi — buat kode baru.",
          "Perangkat berhenti sendiri pada captcha atau permintaan login pertama, atau sesudah gagal beberapa kali berturut-turut, lalu jalan lagi sendiri sesudah jeda otomatis (bawaan 60 menit). Jeda dari Elorae berlaku sampai dilanjutkan. Kode baru menyambungkan ulang perangkat yang sama (misalnya Chrome-nya dipasang ulang); sambungan lamanya berhenti begitu kode baru dipakai. Cabut menghentikan perangkat untuk selamanya.",
        ],
      },
      {
        judul: { kunci: "kreatifRuang.pantau.masalah.judul" },
        isi: "Tiga puluh laporan masalah dan jeda terakhir dari semua perangkat. Akun berbeda berarti nama akun yang terbaca di TikTok tidak sama dengan handle di Elorae — hasilnya tidak disimpan; periksa handle akun KOL itu.",
      },
      {
        judul: { kunci: "kreatifRuang.pantau.pengaturan.judul" },
        isi: [
          "Semua angka ini keputusan sementara pemilik: kuota 300 pengecekan per hari, jam kerja 08.00–17.00 WIB, jeda acak 15–40 detik antar tugas, istirahat 5–10 menit setiap 45 menit, jeda otomatis 60 menit, jeda sesudah 3 gagal berturut-turut, akun aktif setiap 7 hari, akun lain setiap 30 hari, anomali pengikut di atas 30% dalam 14 hari dan ER turun di atas 40%. Sakelar Pantau 24 jam menghapus jam berhenti: ekstensi bekerja sepanjang hari (00.00–24.00 WIB), tetap dengan jeda, istirahat dan kuota yang sama.",
          "Mematikan Pemantauan aktif menghentikan pemberian tugas ke semua perangkat. Isian di luar batas ditolak dan ditandai, tidak diganti diam-diam. Setiap simpanan tercatat di jejak audit (sebelum dan sesudah).",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/periksa",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.periksa" },
    isi: [
      "Pemeriksaan data Ruang KOL. Halaman ini hanya membaca dan tidak membetulkan apa pun: klik baris untuk membuka halamannya, lalu betulkan di sana. Setiap pemeriksaan menyebut jumlah sebenarnya dan paling banyak 50 baris; sisanya ditulis \"N lainnya tidak ditampilkan\". Periksa ulang membaca semuanya lagi.",
      "Pemeriksaan yang hasilnya nol tetap ditampilkan (\"Tidak ada\"), supaya terlihat apa saja yang sudah diperiksa. Melihat halaman ini cukup izin lihat Kreatif.",
    ],
    kartu: [
      {
        judul: { kunci: "kreatifRuang.periksa.bagian.kembar" },
        isi: "KOL aktif dengan nomor WhatsApp yang sama (sesudah dinormalkan) atau handle yang sama di platform mana pun — aturan yang sama dengan Cek kembar di daftar KOL. Rantai ikut digabung: A sama WA dengan B dan B sama handle dengan C menjadi satu kelompok. Klik nama untuk membuka profilnya.",
      },
      {
        judul: { kunci: "kreatifRuang.periksa.bagian.yatim" },
        isi: [
          "Basis data Elorae tidak memasang pengunci antartabel, jadi sebuah baris bisa menunjuk data induk yang sudah tidak ada: akun, kolaborasi, dan riwayat brand yang KOL-nya tidak ada; konten, pengiriman sampel, dan termin bayar yang kolaborasinya tidak ada; bacaan angka yang kontennya tidak ada; dan kolaborasi yang campaign-nya tidak ada. Baris seperti ini tidak tampil di daftar biasa dan tidak ikut dihitung di angka mana pun.",
          "Yang tidak punya halaman ditulis tanpa tautan, dengan id data induk yang hilang — sampaikan id itu ke pengembang untuk dibereskan. Kolaborasi yang hanya kehilangan campaign masih bisa dibuka: pilih campaign lain atau kosongkan di kepala kolaborasinya.",
        ],
      },
      {
        judul: { kunci: "kreatifRuang.periksa.bagian.tanggal" },
        isi: "Campaign yang tanggal selesainya sebelum tanggal mulai, kolaborasi yang tenggatnya sebelum tanggal mulai, dan konten yang tanggal tayangnya jatuh pada hari SESUDAH hari ini (WIB). Biasanya salah ketik tahun atau bulan.",
      },
      {
        judul: { kunci: "kreatifRuang.periksa.bagian.angka" },
        isi: "Like lebih banyak dari views pada satu bacaan (bacaan dengan views 0 tidak dihitung — bisa berarti angkanya belum terbaca), dan views yang lebih rendah dari bacaan SEBELUMNYA mana pun untuk konten yang sama — views hanya bisa naik, jadi biasanya salah ketik, atau videonya dihapus lalu diunggah ulang. Yang ditampilkan adalah bacaan janggal terakhir; \"N bacaan\" bila terjadi lebih dari sekali. Bacaan angka tidak pernah ditimpa, jadi temuan ini tetap ada sampai bacaannya dibereskan.",
      },
      {
        judul: { kunci: "kreatifRuang.periksa.bagian.kelengkapan" },
        isi: "KOL aktif yang belum punya satu akun pun (tidak bisa dipantau dan tidak ikut Cek kembar lewat handle), dan kolaborasi di tahap Tayang atau sesudahnya yang belum punya satu konten pun — views, ER, dan ROAS-nya kosong. Tambahkan link kontennya di tab Konten kolaborasi itu.",
      },
    ],
  },
  {
    rute: "/backoffice/kreatif/pengaturan",
    bagian: "navGroupCreative",
    judul: { kunci: "kreatifRuang.halaman.pengaturan" },
    isi: [
      "Pengaturan seluruh Ruang KOL, dalam beberapa bagian yang disimpan terpisah. Yang bisa mengubah hanya pemegang izin kelola Kreatif (tarif pajak juga keuangan); yang lain melihat angka yang sedang berlaku. Setiap simpanan tercatat di riwayat (sebelum dan sesudah).",
    ],
    kartu: [
      {
        judul: { kunci: "kreatifRuang.pengaturan.ambang.judul" },
        isi: [
          "Jumlah hari yang menentukan kapan sesuatu muncul di Hari ini, di kalender, dan kapan umur disorot merah. Bawaan: follow-up 3 hari, deal sampai kirim sampel 3, kirim sampai terima 7, terima sampai tayang 5, tayang sampai angka 3, review draf 2, jatuh tempo bayar 14 hari sesudah tayang, saran ghosting sesudah 14 hari, sorot merah bila lebih dari 7 hari di satu tahap.",
          "Setiap isian punya batas wajar; isian di luar batas ditolak dan ditandai, tidak diganti diam-diam. 'Kembalikan bawaan' hanya mengisi formulir — tekan Simpan untuk memakainya. Perubahan berlaku seketika untuk semua orang, karena tenggat tidak pernah disimpan.",
        ],
      },
      {
        judul: { kunci: "kreatifRuang.pengaturan.identitas.judul" },
        isi: "Nama pengirim, nama brand, dan produk utama yang mengisi {pengirim}, {brand}, dan {produk} di setiap pesan WhatsApp. Isian yang dikosongkan memakai bawaan (Tim Eloraé, Eloraé, koleksi terbaru). Paling banyak 80 huruf.",
      },
      {
        judul: { kunci: "kreatifRuang.pengaturan.template.judul" },
        isi: [
          "Template yang muncul saat tombol WhatsApp ditekan di semua layar Kreatif. Pratinjau di daftar dan di formulir memakai data contoh supaya terlihat hasil akhirnya.",
          "Variabel yang bisa dipakai: {nama}, {username}, {platform}, {campaign}, {produk}, {resi}, {ekspedisi}, {brand}, {pengirim}, {fee}. Klik variabel di formulir untuk menyisipkannya. Variabel yang salah ketik ditolak, karena akan terkirim mentah ke KOL. Variabel yang datanya belum ada (mis. resi sebelum dikirim) dibiarkan tertulis supaya terlihat sebelum pesan dikirim.",
          "Paling banyak 30 template. Bila semua template dihapus, tombol WhatsApp hanya membuka obrolan tanpa pesan; 'Pakai template bawaan' mengembalikan tujuh template awal.",
        ],
      },
      {
        judul: { kunci: "kreatifRuang.pengaturan.tier.judul" },
        isi: [
          "Batas bawah jumlah pengikut tiap tier KOL. Di bawah batas Mikro = Nano. Bawaan (konsep KOL Manager): Mikro mulai 10.000, Mid mulai 100.000, Makro mulai 500.000, Mega mulai 1.000.000. Bawaan ini mengubah arti \"makro\" dibanding sebelum 10 Okt 2026 (dulu mulai 100.000).",
          "Keempat batas harus bilangan bulat lebih dari 0 dan naik berurutan; isian yang salah ditandai, tidak diganti diam-diam. Rentang yang dihasilkan tampil di bawah isian. 'Kembalikan bawaan' hanya mengisi formulir — tekan Simpan untuk memakainya.",
          "Tier dihitung dari pengikut terbanyak setiap kali daftar atau profil dibuka, jadi batas baru langsung berlaku di daftar KOL, saringan tier, dan profil, untuk semua orang. Setiap simpanan tercatat di riwayat.",
        ],
      },
      {
        judul: { kunci: "kreatifRuang.brand.pengaturan.judul" },
        isi: [
          "Akun Elorae (bawaan elorae.official) dan tagar Elorae menentukan video mana yang \"menandai Elorae\": posting yang menandai salah satu akun ini, atau memakai salah satu tagar ini, masuk Performa video sendiri begitu ekstensi membaca profil atau videonya — lengkap dengan angkanya dari pembacaan yang sama. Yang dibaca hanya akun yang DITANDAI di video (data tag TikTok), bukan nama yang ditulis di caption. Profil akun Elorae sendiri tidak pernah dijadikan KOL.",
          "Kompetitor diberi lencana Kompetitor di riwayat brand dan halaman Brand, dan bisa disaring di sana; namanya ikut dicari. Akun yang sama tidak boleh tercatat sebagai akun Elorae sekaligus kompetitor.",
          "Sakelar \"masuk Performa video otomatis\" dimatikan: video yang menandai Elorae tidak dibuat (begitu juga KOL baru untuknya), tetapi riwayat brand tetap dicatat dan video yang sudah dipantau tetap mendapat angka barunya. Pembuatan otomatis juga butuh izin kelola Kreatif milik orang yang memasang ekstensi. Setiap simpanan tercatat di riwayat.",
        ],
      },
      {
        judul: { kunci: "kreatifRuang.pajakSetelan.judul" },
        isi: [
          "Tarif PPh fee KOL: PPh 21 bukan pegawai (porsi DPP dari bruto, lapisan tarif Pasal 17 atas DPP, tambahan tanpa NPWP) dan PPh 23 (tarif atas bruto, tambahan tanpa NPWP). Bawaan: DPP 50%; 5% sampai Rp 60 juta, 15% sampai Rp 250 juta, 25% sampai Rp 500 juta, 30% sampai Rp 5 miliar, 35% di atasnya; tanpa NPWP +20%. PPh 23 2%, tanpa NPWP +100%.",
          "PPh dihitung per pembayaran (per termin), tidak dikumulatifkan, dan dibulatkan ke bawah ke rupiah penuh. Semua ini keputusan sementara — WAJIB dikonfirmasi konsultan pajak sebelum dipakai.",
          "Menyimpan menghitung ulang semua termin yang belum dibayar dengan tarif baru; termin yang sudah dibayar tetap memakai tarif saat dibayar (tercatat di rinciannya). Lapisan terakhir selalu \"di atasnya\"; batas lapisan harus naik berurutan.",
        ],
      },
    ],
  },
];
