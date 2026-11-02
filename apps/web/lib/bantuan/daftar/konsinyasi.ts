import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/konsinyasi",
    bagian: "konsinyasi",
    judul: { kunci: "konsinyasi.pageTitle" },
    isi: [
      { kunci: "konsinyasi.pageDescription" },
      "Tahapnya berurutan: menunggu laporan SPG dan laporan toko, mencocokkan dan mengunci angka resmi, membayar gaji dan komisi SPG (dilewati bila toko tidak punya SPG), nota dari admin penjualan, lalu nomor faktur pajak dari admin pajak (dilewati bila tagihan konsinyasi toko itu tanpa PPN).",
      { kunci: "konsinyasi.matchHint" },
      "Melihat butuh izin melihat konsinyasi; membuka siklus dan mencatat kiriman butuh izin mengelola konsinyasi.",
      "Daftar bawaan menampilkan siklus yang belum selesai; saringan tahap dan Semua ada di atas tabel, kotak cari mencocokkan nomor konsi, toko, periode, dan nomor nota. Tombol Isi ulang toko membuka ringkasan stok toko konsinyasi (butuh izin melihat toko).",
      "Harga di dialog Kirim barang titipan adalah harga DI TOKO per potong. Penilaian barang hilang mengubahnya menjadi harga yang diterima Elorae memakai margin toko saat itu. Barang di luar katalog cukup diketik namanya; barang seperti itu tidak menggerakkan stok gudang.",
    ],
  },
  {
    rute: "/backoffice/konsinyasi/isi-ulang",
    bagian: "konsinyasi",
    judul: { kunci: "konsiIsiUlang.title" },
    isi: [{ kunci: "konsiIsiUlang.subtitle" }, "Layar ini hanya untuk dibaca."],
    kartu: [
      { judul: { kunci: "konsiIsiUlang.refillTitle" }, isi: [{ kunci: "konsiIsiUlang.refillHint" }, { kunci: "konsiIsiUlang.warehouseNote" }] },
      { judul: { kunci: "konsiIsiUlang.slowTitle" }, isi: [{ kunci: "konsiIsiUlang.slowHint" }, { kunci: "konsiIsiUlang.approxNote" }] },
    ],
  },
  {
    rute: "/backoffice/konsinyasi/[id]",
    bagian: "konsinyasi",
    judul: "Rincian siklus konsinyasi",
    isi: [
      "Satu siklus konsinyasi (satu toko × satu bulan): tiga nomornya, laporan SPG dan laporan toko yang disandingkan, angka resmi setelah dikunci, gaji dan komisi SPG, stok titipan, pencocokan buku stok toko, dan tagihan ke toko.",
      "Mengunci butuh kedua laporan. Mengunci juga berarti laporan penjualan SPG siklus ini sudah dicek: komisi SPG = tarif per kategori barang bulan penjualannya (Pengaturan → Komisi SPG) × potong yang dijual masing-masing SPG di kasir, per barang paling banyak sebesar jumlah laku resmi. Komisinya dibayar di bulan siklus dikunci, dengan catatan bulan penjualannya (mis. Komisi penjualan Oktober 2026). Tarif bulan yang sudah lewat tidak bisa diubah, jadi tanggal mengunci tidak mengubah besarnya.",
      "Setiap pekerjaan punya izinnya sendiri: mengunci dan membuka kunci angka resmi (keputusan manager, bawaannya hanya admin), mencatat nomor nota (admin penjualan), mencatat nomor faktur pajak (admin pajak), menandai gaji dan komisi SPG dibayar (bawaannya hanya admin), dan mencatat pembayaran toko (Periksa pembayaran). Membuka siklus serta mencatat kiriman dan kedua laporan tetap butuh izin mengelola konsinyasi.",
      "Membuka kunci ditolak begitu ada gaji SPG yang sudah dibayar, nomor nota atau nomor faktur pajak sudah dicatat, atau toko sudah membayar (pembayaran yang dibatalkan tidak dihitung); tombolnya mati dan alasannya tertulis di bawah judul. Bila masih boleh, pembukaan meminta konfirmasi: angka resmi bisa diubah lagi, potongan promo dan beban barang hilang yang dibekukan dilepas, dan potongan barang hilang dari gaji SPG dikembalikan sampai siklus dikunci ulang.",
      "Di kartu dua laporan, tanda — berarti laporannya belum masuk. Barang yang tidak tercantum di laporan yang sudah masuk ditulis 0, sama seperti di kartu pencocokan buku stok.",
      "Saat dikunci ulang, komisi tetap milik yang menjual (tarif kategori × penjualan masing-masing SPG). Gaji pokok hanya untuk SPG yang ikut di kunci pertama: SPG yang sudah pindah toko tetap memegang barisnya, SPG yang baru ditugaskan sesudahnya tidak ikut, dan penjual dari toko lain tidak pernah mendapat gaji pokok di siklus ini.",
      "PPN tagihan: mengikuti sakelar \"Tagihan konsinyasi memakai PPN\" di data toko (bawaan mati) dan DIBEKUKAN saat angkanya dikunci. Kartu tagihan menulis dengan PPN atau tanpa PPN. Dengan PPN: jurnal kunci siklus memisahkan PPN keluaran dari tagihan (hanya bila Elorae PKP pada tanggal jurnal) dan siklus menunggu nomor faktur pajak. Tanpa PPN: seluruh tagihan menjadi pendapatan, tahap faktur pajak dilewati, dan nomor faktur pajak tidak bisa dicatat. Sakelar toko yang diubah sesudah dikunci tidak mengubah siklus ini; buka kunci lalu kunci ulang bila harus ikut berubah — jurnalnya menyesuaikan dengan generasi baru, tidak pernah diubah.",
    ],
    kartu: [
      { judul: { kunci: "konsinyasi.threeNumbers" }, isi: { kunci: "konsinyasi.threeNumbersHint" } },
      {
        judul: { kunci: "konsinyasi.laporanJudul" },
        isi: "SPG melapor lewat surel, toko lewat ekspedisi. Kartu ini menyebut laporan mana yang sudah masuk (berapa barang dan pcs) dan tempat mencatat atau mengubahnya. Angka per barang dari kedua laporan disandingkan di kartu Pencocokan buku stok: \"—\" berarti laporannya belum masuk, \"0\" berarti laporannya masuk tetapi tidak mencantumkan barang itu.",
      },
      { judul: { kunci: "konsinyasi.stockTitle" }, isi: { kunci: "konsinyasi.stockHint" } },
      {
        judul: { kunci: "konsinyasi.cocokBuku.title" },
        isi: [
          { kunci: "konsinyasi.cocokBuku.hint" },
          { kunci: "konsinyasi.cocokBuku.notaHint" },
          { kunci: "konsinyasi.cocokBuku.stockHint" },
          { kunci: "konsinyasi.cocokBuku.recordedLostHint" },
        ],
      },
      {
        judul: { kunci: "konsinyasi.tagihan.title" },
        isi: [
          { kunci: "konsinyasi.tagihan.hint" },
          { kunci: "konsinyasi.tagihan.storeShare" },
          "Bila sambungan putus saat menyimpan pembayaran toko, simpan lagi pembayaran itu, boleh sesudah dialognya ditutup dan dibuka lagi: pembayaran yang sudah tercatat dikembalikan apa adanya, jadi uang yang sama tidak tercatat dua kali. Selama simpanan terakhir belum berhasil, Simpan berikutnya dianggap pembayaran yang sama — periksa daftar pembayaran sebelum mencatat cicilan lain.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/store-stocktakes",
    bagian: "konsinyasi",
    judul: { kunci: "storeStocktakes.pageTitle" },
    isi: [
      { kunci: "storeStocktakes.subtitle" },
      "Satu dokumen menghitung stok satu toko konsinyasi. Kantor membukanya dari halaman toko (Mulai perhitungan), sistem membukanya otomatis untuk perhitungan bulanan, atau SPG toko itu membukanya saat mengirim Laporan Stok Toko dari HP. Satu toko hanya punya satu perhitungan terbuka.",
      "Alurnya Draf → Menunggu Verifikasi → Disetujui, atau Dibatalkan. Kolom Cakupan: Penuh berarti setiap baris sudah dihitung saat disetujui; Sebagian berarti ada baris yang tidak dihitung, dan stok baris itu dibiarkan.",
      "Melihat butuh izin melihat toko; membuka, menyimpan hitungan, dan membatalkan draf butuh izin mengelola toko. Menyetujui hasil hitungan, dan membatalkan perhitungan yang sudah menunggu verifikasi, adalah keputusan manager: butuh izin menyetujui hitungan stok toko, yang bawaannya hanya dipegang admin.",
    ],
  },
  {
    rute: "/backoffice/store-stocktakes/[id]",
    bagian: "konsinyasi",
    judul: "Rincian perhitungan stok toko",
    isi: [
      "Setiap baris menyandingkan stok seharusnya menurut buku stok toko dengan hasil hitung, beserta selisihnya (Lebih atau Kurang). Selama perhitungan masih berjalan, kantor bisa mengubah hitungan dan menambah barang yang ditemukan di rak tetapi belum tercatat.",
      "Sebelum disetujui, setiap baris yang berselisih wajib diberi alasan, dan setiap baris yang kurang wajib diberi sebab: Susut atau Penjualan Tidak Tercatat. SPG hanya mengirim angka hitungan; sebab dan alasannya diisi kantor.",
      "Menyetujui menulis stok toko sesuai hasil hitung tiap baris, ditambah gerakan stok toko yang tercatat sesudah baris itu dihitung, sehingga penjualan atau pengiriman selama perhitungan menunggu tidak terhapus. Bila stok sudah berubah sejak dihitung, dialog persetujuan menyebut barisnya sebagai informasi saja. Persetujuan ditolak selama masih ada retur atau transfer toko yang mengambil barang terhitung sebelum perhitungan dan belum selesai; nama dokumennya disebut.",
      "Kartu Penjualan dalam Periode menunjukkan barang yang terjual di toko sejak perhitungan yang disetujui sebelumnya. Retur yang masih berjalan saat perhitungan ditandai pada barisnya, karena kekurangannya bisa jadi barang retur, bukan susut.",
      "Perhitungan penuh yang disetujui di toko konsinyasi juga membuat laporan sell-through toko itu bila bisa. Halaman ini lalu menautkannya, atau menawarkan Buat laporan sell-through bila laporannya belum terbentuk. Menyetujui laporan sell-through (yang menagih toko) dan membatalkannya sesudah disetujui adalah keputusan manager (izin mengunci angka konsinyasi, bawaannya hanya admin); membuat laporan, mengisi penyelesaian baris, membatalkan draf, mencetak, dan mengulang jurnalnya cukup dengan izin mengelola toko.",
      { kunci: "storeStocktakes.cancel.confirmDescription" },
    ],
  },
];
