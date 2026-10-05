import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/settings",
    bagian: "settings",
    judul: { kunci: "settings.title" },
    isi: [
      { kunci: "settings.subtitle" },
      "Bagian atas mengatur tampilan akun Anda sendiri (huruf dan warna). Kartu di bawahnya membuka setiap halaman pengaturan.",
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
      { judul: { kunci: "settings.tax.title" }, isi: { kunci: "settings.tax.description" } },
      { judul: { kunci: "settings.uom.title" }, isi: { kunci: "settings.uom.description" } },
      { judul: { kunci: "settings.users.title" }, isi: { kunci: "settings.users.description" } },
      { judul: { kunci: "settings.rbac.title" }, isi: { kunci: "settings.rbac.description" } },
      { judul: { kunci: "settings.packRatio.title" }, isi: { kunci: "settings.packRatio.description" } },
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
      { judul: { kunci: "security.setPin" }, isi: { kunci: "security.pinCardDescription" } },
      { judul: { kunci: "security.lastAccessTitle" }, isi: { kunci: "security.lastAccessDescription" } },
      { judul: { kunci: "security.attemptsTitle" }, isi: { kunci: "security.attemptsDescription" } },
      { judul: { kunci: "security.forceResetTitle" }, isi: { kunci: "security.resetPinDescription" } },
    ],
  },
  {
    rute: "/backoffice/settings/documents",
    bagian: "settings",
    judul: { kunci: "documents.pageTitle" },
    isi: { kunci: "documents.pageDescription" },
    kartu: [{ judul: { kunci: "documents.configTitle" }, isi: { kunci: "documents.tableDescription" } }],
  },
  {
    rute: "/backoffice/settings/item-codes",
    bagian: "settings",
    judul: { kunci: "itemCodes.title" },
    isi: { kunci: "itemCodes.description" },
    kartu: [{ judul: { kunci: "itemCodes.barcodeFormatTitle" }, isi: { kunci: "itemCodes.barcodeFormatDescription" } }],
  },
  {
    rute: "/backoffice/settings/tax",
    bagian: "settings",
    judul: { kunci: "tax.pageTitle" },
    isi: { kunci: "tax.pageDescription" },
    kartu: [{ judul: { kunci: "tax.cardTitle" }, isi: { kunci: "tax.cardDescription" } }],
  },
  {
    rute: "/backoffice/settings/uom",
    bagian: "settings",
    judul: { kunci: "uom.pageTitle" },
    isi: { kunci: "uom.pageDescription" },
    kartu: [
      { judul: { kunci: "uom.unitsTitle" }, isi: { kunci: "uom.unitsDescription" } },
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
      "Setiap penambahan dan perubahan tercatat di jejak audit, tanpa sandinya. Halaman ini butuh izin mengelola keamanan.",
    ],
  },
  {
    rute: "/backoffice/settings/rbac",
    bagian: "settings",
    judul: { kunci: "settings.rbac.pageTitle" },
    isi: [
      { kunci: "settings.rbac.pageSubtitle" },
      "Peran bertanda Sistem tidak bisa diubah dan mendapat akses penuh. Membuat dan mengubah peran butuh izin mengelola peran.",
    ],
  },
  {
    rute: "/backoffice/settings/pack-ratio",
    bagian: "settings",
    judul: { kunci: "settings.packRatio.title" },
    isi: { kunci: "settings.packRatio.description" },
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
    ],
  },
  {
    rute: "/backoffice/settings/salesman",
    bagian: "settings",
    judul: { kunci: "settings.salesman.title" },
    isi: [
      { kunci: "settings.salesman.subtitle" },
      "Setiap kartu adalah satu aturan kerja tim lapangan dengan nilai bawaan yang berlaku sampai diubah di sini.",
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
        isi: [{ kunci: "portalToko.pengaturan.penjelasan" }, { kunci: "portalToko.pengaturan.aturanSama" }],
      },
      {
        judul: { kunci: "spgMutasi.pengaturan.judul" },
        isi: [{ kunci: "spgMutasi.pengaturan.penjelasan" }, { kunci: "spgMutasi.pengaturan.arahCatatan" }],
      },
      { judul: { kunci: "biayaPerjalanan.pengaturan.judul" }, isi: { kunci: "biayaPerjalanan.pengaturan.penjelasan" } },
      { judul: { kunci: "absensi.pengaturan.judul" }, isi: { kunci: "absensi.pengaturan.penjelasan" } },
      { judul: { kunci: "pengaturanHariKerjaSpg.judul" }, isi: { kunci: "pengaturanHariKerjaSpg.penjelasan" } },
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
    ],
  },
];
