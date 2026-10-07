import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/sales-lapangan",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "salesLapangan.pageTitle" },
    isi: [
      { kunci: "salesLapangan.pageDescription" },
      "Kartu angka dan angka di tabel membuka sumbernya: kunjungan dan check-in janggal ke rincian sales itu, pelunasan ke daftar BKM yang dicari dengan nama sales (hanya bila Anda boleh membuka daftar pelunasan), pesanan ke daftar pesanan lapangan. Admin kantor yang mencatat BKM dari kantor tidak dihitung sebagai sales.",
    ],
    kartu: [
      { judul: { kunci: "salesLapangan.table.title" }, isi: { kunci: "salesLapangan.table.hint" } },
      { judul: { kunci: "salesLapangan.outcomes.title" }, isi: { kunci: "salesLapangan.outcomes.hint" } },
      { judul: { kunci: "salesLapangan.flags.title" }, isi: { kunci: "salesLapangan.flags.hint" } },
    ],
  },
  {
    rute: "/backoffice/sales-lapangan/[salesmanId]",
    bagian: "navGroupFieldTeam",
    judul: "Rincian sales lapangan",
    isi: { kunci: "salesLapangan.detail.description" },
    kartu: [
      { judul: { kunci: "salesLapangan.schedule.title" }, isi: "Toko yang dijadwalkan kantor untuk sales ini di rentang yang dipilih, beserta statusnya. Tombol di kartu membuka Jadwal Kunjungan untuk sales ini." },
      { judul: { kunci: "salesLapangan.plan.title" }, isi: { kunci: "salesLapangan.plan.hint" } },
      { judul: { kunci: "salesLapangan.visits.title" }, isi: { kunci: "salesLapangan.visits.hint" } },
      { judul: { kunci: "salesLapangan.outcomes.title" }, isi: { kunci: "salesLapangan.outcomes.hint" } },
      { judul: { kunci: "salesLapangan.flags.title" }, isi: { kunci: "salesLapangan.flags.hint" } },
    ],
  },
  {
    rute: "/backoffice/jadwal-kunjungan",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "jadwalKunjungan.judul" },
    isi: [
      { kunci: "jadwalKunjungan.deskripsi" },
      "Satu minggu (Senin–Minggu) tampil sekaligus untuk satu sales. Jadwal ini melengkapi rencana kunjungan otomatis di HP, tidak menggantikannya. Tombol Salin minggu lalu menyalin jadwal minggu sebelumnya ke minggu yang dibuka.",
      "Sebuah toko terjadwal dihitung dikunjungi bila ada check-in sales itu di toko tersebut pada hari yang sama (WIB). Hari yang sudah lewat tanpa kunjungan tercatat terlewat dan hanya bisa dibaca. Hari ketika sales sedang izin, sakit, atau cuti yang disetujui tidak dihitung terlewat.",
      "Melihat jadwal cukup dengan izin melihat pesanan lapangan; mengatur jadwal butuh izin menyetujui pesanan lapangan.",
    ],
  },
  {
    rute: "/backoffice/pengumuman",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "pengumuman.judul" },
    isi: [
      { kunci: "pengumuman.deskripsi" },
      "Membuat, mengubah, mengarsipkan, dan menghapus pengumuman butuh izin menyetujui pesanan lapangan; melihat cukup dengan izin melihat pesanan lapangan.",
    ],
  },
  {
    rute: "/backoffice/pengumuman/baru",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "pengumuman.form.judulBuat" },
    isi: [
      { kunci: "pengumuman.form.deskripsi" },
      "Pengumuman bisa terbit langsung saat disimpan atau dijadwalkan untuk waktu tertentu, dan bisa diberi batas akhir. Sasarannya salesman, SPG, atau keduanya.",
    ],
    kartu: [
      { judul: { kunci: "pengumuman.form.sasaranJudul" }, isi: { kunci: "pengumuman.form.sasaranHint" } },
      { judul: { kunci: "pengumuman.form.waktuJudul" }, isi: { kunci: "pengumuman.form.waktuHint" } },
    ],
  },
  {
    rute: "/backoffice/pengumuman/[id]",
    bagian: "navGroupFieldTeam",
    judul: "Rincian pengumuman",
    isi: [
      "Satu pengumuman: isinya, waktu terbit dan berakhir, pembuatnya, dan laporan baca.",
      "Pengumuman yang diarsipkan tidak tampil di HP dan bisa dipulihkan. Pengumuman hanya bisa dihapus selama belum ada yang membacanya; sesudah itu arsipkan saja.",
    ],
    kartu: [{ judul: { kunci: "pengumuman.laporan.judul" }, isi: { kunci: "pengumuman.laporan.hint" } }],
  },
  {
    rute: "/backoffice/pengumuman/[id]/ubah",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "pengumuman.form.judulUbah" },
    isi: [
      { kunci: "pengumuman.form.deskripsi" },
      "Waktu terbit pengumuman yang sudah terbit tidak bisa diubah lagi.",
    ],
    kartu: [
      { judul: { kunci: "pengumuman.form.sasaranJudul" }, isi: { kunci: "pengumuman.form.sasaranHint" } },
      { judul: { kunci: "pengumuman.form.waktuJudul" }, isi: { kunci: "pengumuman.form.waktuHint" } },
    ],
  },
  {
    rute: "/backoffice/absensi",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "absensi.judul" },
    isi: [
      "Absen masuk dan pulang salesman dengan swafoto dan lokasi. Batas jam masuk, dan menyalakan atau mematikan absensi, diatur di Pengaturan → Salesman.",
      "Tampilan per hari menunjukkan siapa yang sudah dan belum absen, jam masuk dan pulang, keterlambatan, swafoto, dan tautan peta. Tampilan per bulan merekap setiap orang dan bisa diunduh sebagai Excel.",
      "SPG tidak menekan tombol absen: check-in dan check-out di tokonya tercatat sebagai absen masuk dan pulang. Hari izin, sakit, atau cuti yang disetujui tampil sebagai izin, bukan tidak absen.",
      "Selama absensi dimatikan, tidak ada yang bisa absen — orang yang tidak tercatat masuk ditulis \"—\", bukan \"Belum absen\", dan hitungan \"sudah absen\" tidak ditampilkan.",
    ],
  },
  {
    rute: "/backoffice/izin",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "izin.judul" },
    isi: [
      { kunci: "izin.deskripsi" },
      "Yang dihitung adalah hari kerja orang yang izin. Salesman bekerja Senin–Sabtu; hari kerja SPG diatur di Pengaturan → Salesman. Kuota cuti dihitung per tahun dan ajuan yang masih menunggu ikut memakai kuota.",
      "Memutuskan ajuan butuh izin menyetujui pesanan lapangan, dan tidak ada yang memutuskan ajuannya sendiri.",
    ],
  },
  {
    rute: "/backoffice/target-sales",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "targetSales.judul" },
    isi: { kunci: "targetSales.deskripsi" },
    kartu: [
      { judul: "Ringkasan bulan", isi: { kunci: "targetSales.ringkasanIsi" } },
      {
        judul: "Target per sales",
        isi: [
          { kunci: "targetSales.editorIsi" },
          { kunci: "targetSales.catatanCapaian" },
          "Target total bulanan (rupiah) per salesman diatur di Pengaturan → Salesman; halaman ini untuk target per kategori dan per barang.",
        ],
      },
      { judul: "Penjualan per kategori", isi: { kunci: "targetSales.penjualanIsi" } },
    ],
  },
  {
    rute: "/backoffice/biaya-perjalanan",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "biayaPerjalanan.judul" },
    isi: [
      { kunci: "biayaPerjalanan.deskripsi" },
      "Menyetujui atau menolak butuh izin menyetujui pesanan lapangan; menandai dibayar butuh izin mengelola jurnal. Daftar disaring per bulan menurut tanggal struk.",
    ],
  },
  {
    rute: "/backoffice/biaya-perjalanan/[id]",
    bagian: "navGroupFieldTeam",
    judul: "Rincian biaya perjalanan",
    isi: "Satu klaim biaya perjalanan: rinciannya, foto struk, dan jejak keputusannya. Atasan menyetujui atau menolak, lalu keuangan menandai dibayar. Klaim Anda sendiri harus diputuskan orang lain.",
  },
  {
    rute: "/backoffice/tukar-barang",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "tukarBarang.judul" },
    isi: [
      { kunci: "tukarBarang.deskripsi" },
      "Hanya untuk toko putus: barang di toko konsinyasi masih milik kita, jadi tidak bisa ditukar lewat sini.",
    ],
  },
  {
    rute: "/backoffice/tukar-barang/[id]",
    bagian: "navGroupFieldTeam",
    judul: "Rincian tukar barang",
    isi: [
      "Satu pengajuan tukar barang: barang yang dikembalikan toko, barang yang diberikan ke toko, nilai kedua sisi, dan jejak keputusannya.",
      "Nilai kedua sisi harus setara menurut harga toko saat ini; kalau tidak, persetujuan ditolak. Penjualan menyetujui, gudang menyelesaikan, dan stok baru bergerak saat penukaran diselesaikan. Pengajuan Anda sendiri diputuskan orang lain.",
    ],
    kartu: [{ judul: { kunci: "tukarBarang.nilaiJudul" }, isi: { kunci: "tukarBarang.bukanRetur" } }],
  },
  {
    rute: "/backoffice/laporan/komisi-salesman",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "komisiSalesman.laporan.title" },
    isi: { kunci: "komisiSalesman.laporan.description" },
    kartu: [
      {
        judul: "Komisi per salesman",
        isi: [
          { kunci: "komisiSalesman.laporan.footnote" },
          "Omzet konsinyasi = barang yang LAKU di toko konsinyasi yang dipegang salesman itu saat barangnya laku (buku stok SPG: terjual dikurangi retur pembeli; toko tanpa buku: laporan laku siklus yang sudah dikunci, di akhir bulannya), dinilai dengan harga yang Elorae terima — harga di toko dikurangi margin toko. Transfer konsinyasi yang disetujui bukan omzet. Memindah toko ke salesman lain tidak memindah omzet bulan-bulan sebelumnya. Saat toko tanpa pemegang, lakunya dihitung ke salesman yang terakhir mengirim konsinyasi ke sana.",
          "Bila ada beban barang hilang yang ditanggung salesman, kolomnya tampil di tabel ini dan kantor menandai jumlah yang sudah dipotong per bulan. Bebannya ditetapkan keuangan di SPG → Barang hilang; batas potongan per pembayaran diatur di Pengaturan → SPG.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/checklist-toko",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "checklistToko.judul" },
    isi: [
      { kunci: "checklistToko.deskripsi" },
      "Template bawaan untuk toko pakaian bisa disalin sebagai titik awal. Melihat cukup dengan izin melihat toko; menyusun, mengaktifkan, dan menghapus template butuh izin mengelola toko.",
    ],
  },
  {
    rute: "/backoffice/checklist-toko/baru",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "checklistToko.judulBaru" },
    isi: [
      { kunci: "checklistToko.editorDeskripsi" },
      "Template baru bisa dimulai kosong atau dari salinan template bawaan.",
    ],
  },
  {
    rute: "/backoffice/checklist-toko/[id]",
    bagian: "navGroupFieldTeam",
    judul: "Ubah template daftar periksa",
    isi: [{ kunci: "checklistToko.editorDeskripsi" }, { kunci: "checklistToko.catatanUbah" }],
  },
  {
    rute: "/backoffice/checklist-toko/laporan",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "checklistToko.laporan.judul" },
    isi: { kunci: "checklistToko.laporan.deskripsi" },
    kartu: [
      { judul: { kunci: "checklistToko.laporan.perTokoJudul" }, isi: { kunci: "checklistToko.laporan.perTokoIsi" } },
      { judul: { kunci: "checklistToko.laporan.lemahJudul" }, isi: { kunci: "checklistToko.laporan.lemahIsi" } },
    ],
  },
  {
    rute: "/backoffice/checklist-toko/laporan/[id]",
    bagian: "navGroupFieldTeam",
    judul: "Hasil daftar periksa",
    isi: "Satu hasil daftar periksa dari satu kunjungan: skornya, riwayat skor toko itu, jawaban per pertanyaan beserta poinnya, dan foto-fotonya.",
  },
  {
    rute: "/backoffice/panduan-display",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "panduanDisplay.judul" },
    isi: [
      { kunci: "panduanDisplay.deskripsi" },
      "Melihat cukup dengan izin melihat toko; menulis panduan butuh izin mengelola toko.",
    ],
  },
  {
    rute: "/backoffice/panduan-display/baru",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "panduanDisplay.baru" },
    isi: { kunci: "panduanDisplay.formDeskripsi" },
  },
  {
    rute: "/backoffice/panduan-display/[id]",
    bagian: "navGroupFieldTeam",
    judul: "Ubah panduan display",
    isi: { kunci: "panduanDisplay.formDeskripsi" },
    kartu: [{ judul: { kunci: "panduanDisplay.fotoHasilJudul" }, isi: { kunci: "panduanDisplay.fotoHasilIsi" } }],
  },
  {
    rute: "/backoffice/harga-pesaing",
    bagian: "navGroupFieldTeam",
    judul: { kunci: "hargaPesaing.judul" },
    isi: { kunci: "hargaPesaing.deskripsi" },
    kartu: [{ judul: { kunci: "hargaPesaing.ringkasJudul" }, isi: { kunci: "hargaPesaing.ringkasIsi" } }],
  },
];
