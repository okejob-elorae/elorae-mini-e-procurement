import type { EntriBantuan } from "../jenis";
import { KELIPATAN_STOK_PORTAL } from "@/lib/field-sales/portal-toko-aturan";
import { MAKS_PERIKSA_PORTAL_PER_MENIT } from "@/lib/field-sales/portal-toko-batas";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/settings",
    bagian: "settings",
    judul: { kunci: "settings.title" },
    isi: [
      { kunci: "settings.subtitle" },
      "Bagian atas berisi pengaturan usaha, dikelompokkan menjadi Tim lapangan & penjualan, Data & dokumen, serta Akses & keamanan; setiap kartu membuka halaman pengaturannya. Bagian bawah, Tampilan saya, mengatur huruf dan warna akun Anda sendiri.",
      "Warna perusahaan (hanya untuk pengelola keamanan) berlaku untuk semua orang yang belum memilih warnanya sendiri, termasuk aplikasi HP. Menghapusnya meminta konfirmasi lebih dulu.",
    ],
    kartu: [
      { judul: { kunci: "settings.font.title" }, isi: { kunci: "settings.font.description" } },
      {
        judul: { kunci: "settings.theme.title" },
        isi: [
          { kunci: "settings.theme.description" },
          { kunci: "settings.theme.hint" },
          { kunci: "settings.developerThemes.pantoneHint" },
          { kunci: "settings.developerThemes.popularHint" },
        ],
      },
      { judul: { kunci: "settings.theme.companyTitle" }, isi: { kunci: "settings.theme.companyDescription" } },
      { judul: { kunci: "settings.security.title" }, isi: { kunci: "settings.security.description" } },
      { judul: { kunci: "settings.documents.title" }, isi: { kunci: "settings.documents.description" } },
      { judul: { kunci: "settings.itemCodes.title" }, isi: { kunci: "settings.itemCodes.description" } },
      { judul: { kunci: "settings.hub.taxTitle" }, isi: { kunci: "settings.hub.taxDescription" } },
      { judul: { kunci: "settings.uom.title" }, isi: { kunci: "settings.uom.description" } },
      { judul: { kunci: "settings.users.title" }, isi: { kunci: "settings.users.description" } },
      { judul: { kunci: "settings.rbac.title" }, isi: { kunci: "settings.rbac.description" } },
      { judul: { kunci: "settings.packRatio.title" }, isi: { kunci: "settings.hub.packRatioDescription" } },
      { judul: { kunci: "settings.jenisPotongan.title" }, isi: { kunci: "settings.jenisPotongan.description" } },
      { judul: { kunci: "settings.salesman.title" }, isi: { kunci: "settings.salesman.description" } },
      { judul: { kunci: "settings.spg.title" }, isi: { kunci: "settings.spg.description" } },
    ],
  },
  {
    rute: "/backoffice/settings/security",
    bagian: "settings",
    judul: { kunci: "security.title" },
    isi: { kunci: "security.subtitle" },
    kartu: [
      { judul: { kunci: "security.changePassword" }, isi: { kunci: "security.changePasswordDescription" } },
      { judul: { kunci: "security.setPinV2" }, isi: { kunci: "security.pinCardDescription" } },
      { judul: { kunci: "security.lastAccessTitle" }, isi: { kunci: "security.lastAccessDescription" } },
      { judul: { kunci: "security.attemptsTitle" }, isi: { kunci: "security.attemptsDescription" } },
      { judul: { kunci: "security.forceResetTitleV2" }, isi: { kunci: "security.resetPinDescription" } },
    ],
  },
  {
    rute: "/backoffice/settings/documents",
    bagian: "settings",
    judul: { kunci: "documents.pageTitle" },
    isi: { kunci: "documents.pageDescription" },
    kartu: [
      {
        judul: { kunci: "documents.configTitle" },
        isi: [
          "Semua jenis dokumen yang dinomori sistem ada di sini, dikelompokkan: pembelian & gudang (PO, penerimaan barang, penyesuaian stok, retur pemasok, stok opname), produksi (perintah kerja, pengeluaran bahan, penerimaan barang jadi), penjualan lapangan (pesanan putus, pesanan konsinyasi, pengiriman/nota tagihan, nota penjualan SPG), dan kanvas (muat mobil, penjualan, rekonsiliasi).",
          "Awalan ditulis di depan nomor (mis. PO/). Mulai ulang menentukan kapan urutan kembali ke 1: tiap tahun, tiap bulan (nomornya juga memuat bulan), atau tidak pernah. Jumlah digit 4 berarti 0001. Kolom Nomor berikutnya menunjukkan nomor yang akan dibagikan bila pengaturan baris itu disimpan.",
          "Jenis yang belum pernah dipakai menampilkan pengaturan bawaan dan tertulis Belum dipakai. Ubah beberapa baris sekaligus, lalu tekan Simpan sekali; bila satu baris salah, tidak ada yang disimpan dan alasannya tertulis di bawah tombol. Nomor terakhir tidak pernah diubah dari halaman ini, dan nomor yang sudah dipakai dokumen lama tetap dilompati.",
          "Dokumen dengan penomoran sendiri (BKM, tanda terima, nota retur gudang, mutasi antar toko, tukar barang) tidak diatur di sini.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/settings/item-codes",
    bagian: "settings",
    judul: { kunci: "itemCodes.title" },
    isi: { kunci: "itemCodes.description" },
    kartu: [
      {
        judul: { kunci: "itemCodes.barcodeFormatTitle" },
        isi: [
          { kunci: "itemCodes.barcodeFormatDescription" },
          "Kotak di bawah template menunjukkan hasilnya langsung untuk satu contoh barang (artikel 27000038P, kategori 01, warna Navy, ukuran S), jadi Anda bisa melihat bentuknya sebelum menyimpan.",
          "Siap pakai 01 + artikel + ukuran mengikuti label Eloraé yang sudah ada (mis. 0127000038PS: 01 pengisi, artikel 27000038P, ukuran S). Bagian {attr:Size} membaca atribut varian bernama Size; bila atribut ukuran Anda bernama lain, misalnya Ukuran, ubah menjadi {attr:Ukuran}.",
          "Format ini hanya dipakai saat tombol Buat kode di formulir barang ditekan. Barcode yang sudah tersimpan di varian, termasuk yang datang dari Jubelio, tidak berubah.",
        ],
      },
    ],
  },
  {
    rute: "/backoffice/settings/tax",
    bagian: "settings",
    judul: { kunci: "tax.pageTitle" },
    isi: { kunci: "tax.pageDescription" },
    kartu: [
      {
        judul: { kunci: "tax.perusahaan.ppnJudul" },
        isi: [
          "Status PKP perusahaan menentukan apakah jurnal memisahkan PPN. Belum ditetapkan (bawaan) diperlakukan seperti bukan PKP: tidak ada PPN di jurnal mana pun, dan halaman pajak serta laporan keuangan menampilkan spanduk sampai status dipilih.",
          "PKP: penjualan (marketplace, kanvas, nota tagihan) mencatat pendapatan sebesar DPP dan PPN keluaran sendiri; retur membalik PPN penjualan asalnya; biaya marketplace dan penerimaan barang dari baris PO \"Tidak termasuk PPN\" mencatat PPN masukan; sampel KOL mencatat PPN pemberian cuma-cuma. Bukan PKP: PPN tidak dipisah (PPN pembelian tetap ikut biaya).",
          "Tarif undang-undang 12% dengan DPP nilai lain 11/12 = tarif efektif 11% (PMK 131/2024). \"PPN dipungut sejak\" membatasi PPN untuk transaksi mulai tanggal itu. Jurnal yang sudah diposting tidak berubah ketika pengaturan diubah.",
        ],
      },
      {
        judul: { kunci: "tax.perusahaan.profilJudul" },
        isi: [
          "Bentuk usaha dan rezim PPh menentukan PPh final UMKM 0,5% (PP 20/2026: orang pribadi, PT perorangan, koperasi; CV dan PT hanya selama jendela PP 55/2022-nya) atau PPh badan 22% (dengan atau tanpa fasilitas Pasal 31E, angsuran PPh 25). Kalender pajak dan halaman PPh final mengikuti pilihan ini.",
          "NPWP dan NITKU perusahaan dipakai berkas ekspor faktur keluaran Coretax. NITKU kosong berarti kantor pusat (NPWP + 000000). Setiap perubahan tercatat di jejak audit; mengubahnya butuh izin mengelola pengaturan pajak.",
        ],
      },
      { judul: { kunci: "tax.tarifPo.judul" }, isi: { kunci: "tax.cardDescription" } },
      {
        judul: { kunci: "tax.suratPo.judul" },
        isi: "Paragraf pembuka dan penutup yang tercetak di setiap PO, di atas tabel barang dan di bawah total. Saat mencetak, teksnya masih bisa diubah untuk PO itu saja. Paragraf yang dikosongkan tidak dicetak. Mengubahnya butuh izin yang sama dengan tarif PPN, dan setiap perubahan tercatat di jejak audit.",
      },
    ],
  },
  {
    rute: "/backoffice/settings/uom",
    bagian: "settings",
    judul: { kunci: "uom.pageTitle" },
    isi: { kunci: "uom.pageDescription" },
    kartu: [
      { judul: { kunci: "uom.unitsTitleV2" }, isi: { kunci: "uom.unitsDescription" } },
      { judul: { kunci: "uom.conversionsTitle" }, isi: { kunci: "uom.conversionsDescription" } },
    ],
  },
  {
    rute: "/backoffice/settings/users",
    bagian: "settings",
    judul: { kunci: "settings.users.title" },
    isi: [
      { kunci: "settings.users.subtitle" },
      "Pengguna dengan peran SPG wajib diberi satu toko tetap; untuk peran lain toko tetapnya dikosongkan. Anda tidak bisa mengganti peran akun Anda sendiri, dan hanya admin sistem yang boleh memberi atau mengubah peran berakses penuh.",
      "Peran menentukan menu dan tombol yang bisa dipakai seseorang. Bila belum ada peran yang pas, buat peran sendiri lewat tombol Kelola peran di kepala halaman (Pengaturan → Peran & izin), lalu pilih peran itu di sini.",
      "Setiap penambahan dan perubahan tercatat di jejak audit, tanpa sandinya. Halaman ini butuh izin mengelola keamanan.",
    ],
  },
  {
    rute: "/backoffice/settings/rbac",
    bagian: "settings",
    judul: { kunci: "settings.rbac.pageTitle" },
    isi: [
      { kunci: "settings.rbac.pageSubtitle" },
      "Peran adalah sekumpulan izin yang diberikan kepada pengguna. Setiap pengguna punya satu peran, dipilih di Pengaturan → Pengguna. Kartu setiap peran menyebut pekerjaan yang dicakupnya dan jumlah pengguna yang memakainya.",
      "Membuat peran sendiri: tekan Buat peran, beri nama (mis. ADMIN_GUDANG) dan keterangan, lalu centang izinnya. Bila peran baru mirip peran yang sudah ada, pakai Mulai dari peran yang ada untuk menyalin izinnya sebagai titik awal, lalu tambah atau kurangi. Kotak cari menyaring izin menurut nama, keterangan, atau nama menu.",
      "Izin dikelompokkan menurut bidang kerja: Beranda & laporan, Penjualan marketplace, Pesanan lapangan & toko, Tim lapangan (HP), SPG, Piutang & pelunasan, Konsinyasi, Keuangan & pajak, Pembelian & pemasok, Gudang & stok, Produksi, Kreatif, Data master, Pengaturan & keamanan, dan Sistem. Setiap izin punya satu kalimat keterangan dan baris Membuka yang menyebut menu yang muncul karenanya. Izin Lihat membuka halamannya; izin seperti Buat, Ubah, atau Setujui hanya menambah tombol di halaman itu, jadi editor mengingatkan Perlu juga bila izin Lihat-nya belum dicentang.",
      "Izin Masuk aplikasi HP membuka aplikasi salesman dan SPG; peran SPG juga butuh Jual di konter toko, dan penggunanya wajib diberi satu toko tetap.",
      "Peran ADMIN bertanda Sistem memegang semua izin, termasuk izin yang ditambahkan kemudian, dan tidak bisa diubah atau dihapus. Peran yang masih dipakai pengguna tidak bisa dihapus; pindahkan penggunanya ke peran lain dulu. Membuat dan mengubah peran butuh izin Buat & ubah peran.",
      "Perubahan izin berlaku untuk pengguna peran itu saat sesinya disegarkan — otomatis dalam sekitar satu menit, ketika ia membuka halaman berikutnya; tidak perlu keluar lalu masuk lagi. Setiap pembuatan, perubahan izin, dan penghapusan peran tercatat di jejak audit beserta daftar izin sebelum dan sesudahnya.",
    ],
  },
  {
    rute: "/backoffice/settings/pack-ratio",
    bagian: "settings",
    judul: { kunci: "settings.packRatio.title" },
    isi: { kunci: "settings.hub.packRatioDescription" },
    kartu: [{ judul: { kunci: "settings.packRatio.heading" }, isi: { kunci: "settings.packRatio.subtitle" } }],
  },
  {
    rute: "/backoffice/settings/jenis-potongan",
    bagian: "settings",
    judul: { kunci: "jenisPotongan.pageTitle" },
    isi: [
      { kunci: "jenisPotongan.pageDescription" },
      { kunci: "jenisPotongan.explain" },
      "Jenis dengan cara Dari retur wajib ditautkan ke nota retur, sehingga nilainya ditahan sampai gudang selesai menghitung. Halaman ini butuh izin mengelola piutang.",
      "Akun jurnal menentukan peran akun yang didebit saat BKM dengan potongan ini diverifikasi keuangan: potongan penjualan, PPh 23 atau PPh 22 dibayar dimuka (pajak yang dipotong toko), biaya bank, atau kerugian. Otomatis berarti potongan penjualan, atau PPh 23 dibayar dimuka untuk jenis yang khusus toko PKP. Potongan Dari retur tidak memakai pilihan ini: piutangnya sudah dikurangi jurnal retur saat gudang menghitung barangnya.",
    ],
  },
  {
    rute: "/backoffice/settings/salesman",
    bagian: "settings",
    judul: { kunci: "settings.salesman.title" },
    isi: [
      { kunci: "settings.salesman.subtitle" },
      "Setiap kartu adalah satu aturan kerja tim lapangan dengan nilai bawaan yang berlaku sampai diubah di sini.",
      "Daftar isi di atas mengelompokkan kartu menjadi Kunjungan & toko, Target & komisi, Pesanan & kredit, serta Biaya & absensi; klik namanya untuk melompat ke kartunya. Setiap kartu punya tombol Simpan sendiri. Aturan mutasi antar toko dan hari kerja SPG ada di Pengaturan → SPG.",
      { kunci: "settings.salesman.readOnly" },
    ],
    kartu: [
      { judul: { kunci: "settings.salesman.visitTitle" }, isi: { kunci: "settings.salesman.visitDesc" } },
      { judul: { kunci: "settings.salesman.targetTitle" }, isi: { kunci: "settings.salesman.targetDesc" } },
      { judul: { kunci: "settings.salesman.shareTitle" }, isi: { kunci: "settings.salesman.shareDesc" } },
      { judul: { kunci: "settings.salesman.kredit.judul" }, isi: { kunci: "settings.salesman.kredit.penjelasan" } },
      {
        judul: { kunci: "settings.salesman.kunjungan.hasil.judul" },
        isi: [{ kunci: "settings.salesman.kunjungan.hasil.penjelasan" }, { kunci: "settings.salesman.kunjungan.hasil.spgCatatan" }],
      },
      { judul: { kunci: "settings.salesman.kunjungan.checkin.judul" }, isi: { kunci: "settings.salesman.kunjungan.checkin.penjelasan" } },
      { judul: { kunci: "kelasToko.pengaturan.judul" }, isi: { kunci: "kelasToko.pengaturan.penjelasan" } },
      { judul: { kunci: "komisiSalesman.kartu.judul" }, isi: { kunci: "komisiSalesman.kartu.penjelasan" } },
      {
        judul: { kunci: "minimumPesanan.judul" },
        isi: [{ kunci: "minimumPesanan.penjelasan" }, { kunci: "minimumPesanan.barangSendiri" }],
      },
      {
        judul: { kunci: "pwa.jarakJauh.pengaturan.judul" },
        isi: [{ kunci: "pwa.jarakJauh.pengaturan.penjelasan" }, { kunci: "pwa.jarakJauh.pengaturan.aturanSama" }],
      },
      {
        judul: { kunci: "portalToko.pengaturan.judul" },
        isi: [
          { kunci: "portalToko.pengaturan.penjelasan" },
          { kunci: "portalToko.pengaturan.aturanSama" },
          `Portal menawarkan stok per ${KELIPATAN_STOK_PORTAL} pcs, dibulatkan ke bawah: sisa di bawah ${KELIPATAN_STOK_PORTAL} pcs tampil Habis di portal dan hanya bisa dipesan lewat salesman. Bila jumlah yang dipesan melebihi yang ditawarkan, toko hanya diberi tahu Terbatas atau Habis, tanpa angka.`,
          `Pratinjau harga dan pengiriman pesanan dibatasi ${MAKS_PERIKSA_PORTAL_PER_MENIT} kali per menit untuk setiap tautan, supaya stok tidak bisa ditebak dengan mencoba-coba jumlah. Batas pesanan per hari dihitung saat pesanan dicatat, jadi pesanan yang dikirim bersamaan tidak bisa melewatinya.`,
          "Bonus promo di pratinjau portal menunjukkan hak bonus menurut promo, bukan sisa stok barang hadiah. Bila stok hadiah kurang saat pesanan dicatat, bonus diberikan sebanyak yang ada dan kekurangannya tertulis di catatan pesanan untuk kantor.",
        ],
      },
      { judul: { kunci: "biayaPerjalanan.pengaturan.judul" }, isi: { kunci: "biayaPerjalanan.pengaturan.penjelasan" } },
      { judul: { kunci: "absensi.pengaturan.judul" }, isi: { kunci: "absensi.pengaturan.penjelasan" } },
    ],
  },
  {
    rute: "/backoffice/settings/spg",
    bagian: "settings",
    judul: { kunci: "settings.spg.title" },
    isi: { kunci: "settings.spg.subtitle" },
    kartu: [
      { judul: { kunci: "pengaturanDiskonManualSpg.judul" }, isi: { kunci: "pengaturanDiskonManualSpg.penjelasan" } },
      { judul: { kunci: "spgTutupHari.pengaturan.judul" }, isi: { kunci: "spgTutupHari.pengaturan.penjelasan" } },
      { judul: { kunci: "spgTitip.pengaturan.judul" }, isi: { kunci: "spgTitip.pengaturan.penjelasan" } },
      { judul: { kunci: "jadwalSpg.pengaturan.judul" }, isi: { kunci: "jadwalSpg.pengaturan.penjelasan" } },
      {
        judul: { kunci: "pengaturanKomisiPutusSpg.judul" },
        isi: [{ kunci: "pengaturanKomisiPutusSpg.penjelasan" }, { kunci: "pengaturanKomisiPutusSpg.catatan" }],
      },
      {
        judul: { kunci: "pengaturanBarangHilang.judul" },
        isi: [{ kunci: "pengaturanBarangHilang.penjelasan" }, { kunci: "pengaturanBarangHilang.dasarCatatan" }],
      },
      {
        judul: { kunci: "spgMutasi.pengaturan.judul" },
        isi: [
          { kunci: "spgMutasi.pengaturan.penjelasan" },
          { kunci: "spgMutasi.pengaturan.arahCatatan" },
          "Kartu ini diubah oleh penyetuju pesanan lapangan.",
        ],
      },
      {
        judul: { kunci: "pengaturanHariKerjaSpg.judul" },
        isi: [{ kunci: "pengaturanHariKerjaSpg.penjelasan" }, "Kartu ini diubah oleh penyetuju pesanan lapangan."],
      },
    ],
  },
];
