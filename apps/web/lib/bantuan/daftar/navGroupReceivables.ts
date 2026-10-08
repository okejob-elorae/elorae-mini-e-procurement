import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/pelunasan-dasbor",
    bagian: "navGroupReceivables",
    judul: { kunci: "dasborPelunasan.judulHalaman" },
    isi: [
      { kunci: "dasborPelunasan.pageDescription" },
      "Kotak angka di atas menunjukkan total piutang (hanya faktur yang belum lunas), faktur yang lewat janji bayar, faktur yang lewat jatuh tempo, BKM yang menunggu verifikasi, nilai faktur yang tertahan retur, nota retur yang masih perlu dikerjakan (cek fisik, jodohkan, atau putuskan), dan beban selisih yang belum ditanggung; setiap kotak membuka daftar yang sudah tersaring pada angka itu.",
      "Lewat janji bayar dan lewat jatuh tempo adalah dua hal berbeda. Lewat janji bayar dihitung dari tanggal janji di kontrabon. Lewat jatuh tempo dihitung dari tanggal jatuh tempo faktur, untuk faktur yang belum dikontrabon, belum dilaporkan bayar, dan tidak tertahan retur.",
      "BKM yang Anda laporkan atau catat sendiri berlabel \"Menunggu rekan Anda\" dan berada di bawah daftar tindakan: admin keuangan lain yang mencocokkannya dengan mutasi rekening.",
      "Klaim pembayaran tidak mengurangi piutang sebelum diverifikasi keuangan, dan potongan retur ditahan sampai gudang selesai menghitung barangnya.",
    ],
    kartu: [{ judul: { kunci: "dasborPelunasan.todoTitle" }, isi: { kunci: "dasborPelunasan.todoHint" } }],
  },
  {
    rute: "/backoffice/piutang",
    bagian: "navGroupReceivables",
    judul: { kunci: "receivables.judulHalaman" },
    isi: [
      { kunci: "receivables.pageDescription" },
      "Sisa piutang tidak pernah diketik: setiap kali ada klaim, retur, atau keputusan baru, sisanya dihitung ulang dari seluruh klaim yang menyentuh faktur itu. Toko konsinyasi tidak pernah muncul di sini.",
      "Setiap nota tagihan pengiriman putus otomatis menjadi faktur di sini. Faktur lain masuk lewat Impor faktur atau Faktur manual.",
      "Faktur lunas disembunyikan dari daftar bawaan; buka lewat saringan Lunas, atau cari nomor fakturnya. Kotak cari mencocokkan nomor faktur, nama toko, dan nama salesman.",
    ],
    kartu: [
      {
        judul: "Nama keadaan faktur",
        isi: [
          "Lewat janji bayar: kontrabon berjalan dan tanggal janjinya sudah lewat. Tagih ulang dan minta tanggal baru.",
          "Lewat jatuh tempo: belum dikontrabon dan tanggal jatuh tempo fakturnya sudah lewat. Tagih ke toko atau buat kontrabon.",
          "Tertahan retur: potongan retur pada BKM yang sudah terverifikasi belum cocok dengan hitungan gudang.",
          "Menunggu verifikasi: ada BKM yang sudah dilaporkan tetapi belum dicocokkan admin keuangan dengan mutasi rekening.",
          "Sudah dikontrabon: faktur dipegang toko dan janji bayarnya belum lewat.",
          "Belum dikontrabon: belum jatuh tempo, belum ditagih.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/piutang/impor",
    bagian: "navGroupReceivables",
    judul: { kunci: "imporPiutang.pageTitle" },
    isi: [
      { kunci: "imporPiutang.pageDescription" },
      "Judul kolom dikenali otomatis, dan berkasnya diurai di browser tanpa dikirim ke mana pun. Kolom nomor faktur dan nilai wajib ada. Bila kolom sisa berisi nol, fakturnya dianggap sudah lunas dan dilewati; bila berkas tidak punya kolom sisa sama sekali, setiap faktur dianggap belum dibayar. Faktur toko konsinyasi dan nomor faktur yang sudah ada juga dilewati.",
      "Mengimpor butuh izin mengelola piutang.",
      "Contoh berkas bisa diunduh dari tombol di kepala halaman. Judul kolom yang dikenali, selain bentuk persisnya: nomor faktur (No Faktur, No Invoice, No Nota, No Bukti), kode toko (Kode Customer, Kode Pelanggan), nama toko (Customer, Pelanggan), tanggal faktur (Tanggal, Tgl Nota), jatuh tempo (Due Date, Tempo), nilai (Total, Grand Total, Jumlah, Netto), sisa (Sisa Piutang, Outstanding, Saldo), sales (Salesman).",
    ],
    kartu: [
      { judul: { kunci: "imporPiutang.previewTitle" }, isi: { kunci: "imporPiutang.previewHint" } },
      {
        judul: { kunci: "imporPiutang.historyTitle" },
        isi: "Impor yang salah bisa dibatalkan dengan alasan. Pembatalan ditolak seluruhnya bila satu saja fakturnya sudah masuk kontrabon atau dilunasi klaim.",
      },
    ],
  },
  {
    rute: "/backoffice/kontrabon",
    bagian: "navGroupReceivables",
    judul: { kunci: "collections.judulHalaman" },
    isi: [
      { kunci: "collections.pageDescription" },
      "Kontrabon tidak mengurangi piutang; ia hanya mencatat bahwa fakturnya sudah dipegang toko. Kontrabon bisa disusun kantor atau dicatat salesman di lapangan. Yang dari lapangan langsung berlaku untuk penagihan, tetapi perlu dikonfirmasi kantor dengan mencocokkan foto lembar tanda terima dengan faktur dan tanggal janjinya.",
      "Kontrabon baru bisa ditandai selesai bila semua fakturnya sudah lunas.",
      "Daftar bawaan hanya menampilkan kontrabon yang masih berjalan; yang selesai atau batal ada di saringan Semua.",
    ],
  },
  {
    rute: "/backoffice/kontrabon/[id]",
    bagian: "navGroupReceivables",
    judul: "Rincian kontrabon",
    isi: [
      "Satu kontrabon: faktur yang diserahkan, foto lembar yang ditandatangani toko, dan pelunasan atas faktur-fakturnya.",
      "Kartu pelunasan memuat BKM yang menunjuk kontrabon ini dan BKM yang melunasi fakturnya tanpa menunjuk kontrabon ini (diberi keterangan). BKM yang dibatalkan tidak ditampilkan.",
      "Foto lembar yang sudah tersimpan tidak terhapus dengan tombol ×; tombol itu membuka pemilih untuk foto pengganti.",
    ],
    kartu: [{ judul: { kunci: "collections.invoicesTitle" }, isi: { kunci: "collections.invoicesHint" } }],
  },
  {
    rute: "/backoffice/pelunasan",
    bagian: "navGroupReceivables",
    judul: { kunci: "payments.judulHalaman" },
    isi: [
      { kunci: "payments.pageDescription" },
      "Admin keuangan (izin mengelola jurnal) memverifikasi atau menolak setiap klaim setelah mencocokkannya dengan mutasi rekening. Klaim dengan bilyet giro baru mengurangi piutang setelah gironya cair; giro dikelola di Daftar giro.",
      "Klaim yang salah catat tidak dihapus: dibatalkan dengan alasan, lalu dilaporkan ulang. Menolak berbeda dari membatalkan — menolak berarti uangnya memang tidak ada di rekening.",
      "Kotak cari mencocokkan nomor BKM, toko, salesman, dan nomor giro. Setiap daftar di modul ini menampilkan 25 baris per halaman.",
      "Angka di tab mengikuti kotak cari. Tautan dari layar lain bisa membawa periode tanggal (keping di samping kotak cari, hapus dengan ×): di tab Terverifikasi periodenya atas tanggal verifikasi, di tab lain atas tanggal transfer di BKM.",
    ],
  },
  {
    rute: "/backoffice/pelunasan/giro",
    bagian: "navGroupReceivables",
    judul: { kunci: "giro.pageTitle" },
    isi: [
      { kunci: "giro.pageDescription" },
      "Giro dikelompokkan menurut kapan harus disetor ke bank, bukan menurut toko. Setorkan ke bank; setelah cair di rekening, tandai cair di sini.",
      "Masa berlaku bilyet giro 70 hari sejak tanggal terbit; bilyet yang lewat masa berlakunya tidak bisa lagi diunjukkan, jadi minta toko menggantinya. Setiap hari pukul 07.00 WIB pemegang izin verifikasi klaim mendapat pengingat giro yang jatuh tempo.",
    ],
  },
  {
    rute: "/backoffice/pelunasan/baru",
    bagian: "navGroupReceivables",
    judul: { kunci: "payments.newTitle" },
    isi: [
      { kunci: "payments.newBody" },
      { kunci: "pesanToko.tandaTerimaPetunjuk" },
      "Faktur yang sudah ada di BKM lain yang masih menunggu verifikasi diberi keterangan, dan mencentangnya meminta konfirmasi. Laporkan lagi hanya kalau itu pembayaran yang berbeda.",
    ],
    kartu: [
      { judul: { kunci: "payments.sectionGiro" }, isi: { kunci: "payments.sectionGiroHint" } },
      { judul: { kunci: "payments.sectionDeductions" }, isi: [{ kunci: "payments.sectionDeductionsHint" }, { kunci: "payments.deductionReturnHint" }] },
    ],
  },
  {
    rute: "/backoffice/pelunasan/[id]",
    bagian: "navGroupReceivables",
    judul: "Rincian BKM",
    isi: [
      "Satu laporan pelunasan (BKM): faktur yang dilunasi, potongan, bukti transfer, dan keputusan keuangan.",
      "Selama statusnya Dikirim, piutangnya belum berkurang sama sekali; piutang berkurang setelah klaim diverifikasi. Potongan yang tertaut nota retur ditahan sampai gudang menghitung barangnya.",
      "Bagian faktur yang sedang ditahan potongan retur BKM lain tidak boleh dilunasi BKM baru: bagian itu lepas sendiri begitu returnya dihitung atau bebannya diputuskan, jadi melunasinya membuat toko membayar dua kali. BKM seperti itu ditolak saat dibuat maupun saat diverifikasi. Pengecualiannya potongan yang nota returnya dibatalkan: bagian itu tidak lepas sendiri, toko memang berutang sebesar potongannya, jadi BKM berikutnya boleh melunasinya.",
      "Tombol WhatsApp hanya membuka pesan yang sudah terisi untuk toko; Anda sendiri yang menekan kirim.",
    ],
    kartu: [
      { judul: { kunci: "giro.cardTitle" }, isi: { kunci: "giro.cardHint" } },
      { judul: { kunci: "payments.sectionProof" }, isi: { kunci: "payments.proofHint" } },
    ],
  },
  {
    rute: "/backoffice/tugas-tagih",
    bagian: "navGroupReceivables",
    judul: { kunci: "tugasTagih.judulHalaman" },
    isi: [
      { kunci: "tugasTagih.pageDescription" },
      "Orang yang ditugaskan ikut melihat faktur itu di daftar tagihan HP-nya; pemegang toko tetap bisa menagihnya juga. Membuat tugas butuh izin mengelola piutang.",
    ],
  },
  {
    rute: "/backoffice/tugas-tagih/baru",
    bagian: "navGroupReceivables",
    judul: { kunci: "tugasTagih.newTitle" },
    isi: [
      { kunci: "tugasTagih.newBody" },
      "Tenggat bawaannya tujuh hari.",
      "Keadaan tiap faktur memakai nama yang sama dengan daftar Faktur & Piutang, termasuk Lewat jatuh tempo.",
    ],
    kartu: [{ judul: { kunci: "tugasTagih.sectionInvoices" }, isi: { kunci: "tugasTagih.sectionInvoicesHint" } }],
  },
  {
    rute: "/backoffice/retur-toko",
    bagian: "navGroupReceivables",
    judul: { kunci: "storeReturns.judulHalaman" },
    isi: [
      { kunci: "storeReturns.pageDescription" },
      "Setiap retur adalah dua dokumen: nota retur toko (NRT) yang nomornya milik toko, dan hitungan gudang (NRI) yang nomornya milik kita. Barang bisa tiba lewat ekspedisi mendahului notanya; hitungan gudang seperti itu dijodohkan ke notanya belakangan.",
      "Mencatat nota retur butuh izin mengelola piutang; menghitung barang yang datang butuh izin menghitung opname.",
      "Nota retur yang dilaporkan SPG di toko yang belum punya salesman pemegang membunyikan lonceng pengelola piutang, karena tidak ada orang lapangan yang menindaklanjutinya.",
      "Hitungan gudang buta: bagi orang yang boleh menghitung, klaim toko pada nota yang belum dihitung tidak ditampilkan — tidak di daftar, rincian, maupun dialog Jodohkan, dan nilai tertahan di kepala halaman tidak ikut menjumlahkannya — sampai hitungannya tersimpan. Pelapor nota tetap melihat klaimnya, tetapi tidak boleh menghitung notanya sendiri; tombol Cek fisiknya mati dengan alasan.",
      "Daftar bawaan berisi retur yang masih perlu dikerjakan. Kartu angka di atas sekaligus saringan per langkah; Semua menampilkan yang sudah selesai dan batal.",
    ],
    kartu: [
      {
        judul: "Alur retur",
        isi: [
          "1. Nota retur toko dicatat — nomor dan isinya disalin dari nota asli toko. Nomornya nomor toko, bukan nomor kita.",
          "2. Gudang menghitung fisik — menghitung barang yang benar-benar sampai. Selama belum dihitung, potongan returnya tidak diakui sama sekali.",
          "3. Selisihnya diputuskan — kalau fisik kurang dari klaim toko, tentukan siapa menanggung. Sebelum itu, faktur tetap terbuka.",
        ],
      },
      {
        judul: "Jumlah per langkah",
        isi: [
          "Menunggu keputusan: selisihnya menahan faktur tetap terbuka.",
          "Belum dicek gudang: potongan retur belum diakui.",
          "Belum dijodohkan: barang datang tanpa nota toko.",
          "Selesai: tersimpan dan bisa dicetak.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/retur-toko/[id]",
    bagian: "navGroupReceivables",
    judul: "Rincian retur toko",
    isi: [
      "Satu retur: nota retur toko dibanding hitungan fisik gudang, rincian per barang, beban selisihnya, dan BKM yang memakainya sebagai potongan.",
      "Selama gudang belum menghitung, potongan retur ditahan penuh; sesudahnya yang ditahan tinggal selisihnya sampai ada yang ditetapkan menanggung. Penanggungnya bisa toko, sales, gudang, atau perusahaan.",
      "Bila toko yang menanggung, toko ditagih lewat faktur BEBAN sebesar yang sudah ia potong melebihi barang yang sampai — bukan seluruh selisih. Contoh: nota 300.000, gudang menghitung 100.000; toko yang sudah memotong 300.000 ditagih 200.000, yang memotong 150.000 ditagih 50.000, dan yang belum memotong tidak ditagih apa pun. Sesudah keputusan itu, nota hanya boleh dipotong sebesar barang yang sampai ditambah yang ditagih.",
      "Nota yang tercatat di toko yang salah dipindah ke toko yang benar, bukan dihapus. Nota yang sudah mengurangi buku stok toko tidak bisa dipindah: batalkan (bukunya dibalik), lalu catat ulang di toko yang benar.",
    ],
    kartu: [
      { judul: { kunci: "storeReturns.compareTitle" }, isi: { kunci: "storeReturns.compareHint" } },
      { judul: { kunci: "storeReturns.perItemTitle" }, isi: [{ kunci: "storeReturns.perVariantHint" }, { kunci: "storeReturns.perItemHint" }] },
    ],
  },
  {
    rute: "/backoffice/beban-selisih",
    bagian: "navGroupReceivables",
    judul: { kunci: "bebanSelisih.judulHalaman" },
    isi: [{ kunci: "bebanSelisih.pageDescription" }, { kunci: "bebanSelisih.explain" }],
  },
  {
    rute: "/backoffice/arsip-retur",
    bagian: "navGroupReceivables",
    judul: { kunci: "arsipRetur.judulHalaman" },
    isi: [
      { kunci: "arsipRetur.pageDescription" },
      "Penerimaan gudang yang belum punya nota toko dikumpulkan di folder Tanpa Nota Toko. Isi folder bisa ditampilkan sebagai ikon atau daftar.",
    ],
  },
];
