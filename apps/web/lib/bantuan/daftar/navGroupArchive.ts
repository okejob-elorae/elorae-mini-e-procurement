import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/archive",
    bagian: "navGroupArchive",
    judul: { kunci: "archive.pageTitle" },
    isi: [
      { kunci: "archive.pageDescription" },
      { kunci: "archive.hintDot" },
      "Tab Nota Toko terbuka untuk tim pembelian dan pembaca piutang; tab Retur Pemasok dan Perintah Kerja hanya untuk tim pembelian.",
      "Di bawah folder setiap tab ada tautan ke tempat dokumen yang menggantung dikerjakan — mengisi nomor faktur pajak, menyelesaikan retur pemasok, atau melihat perintah kerja yang masih berjalan — beserta jumlahnya. Tautan itu hanya muncul bila memang ada yang menggantung.",
      "Tab yang sedang dibuka ikut tersimpan di alamat halaman, jadi tombol Kembali dan tautan yang dibagikan membuka tab yang sama.",
    ],
    kartu: [
      { judul: { kunci: "archive.tabNotaToko" }, isi: { kunci: "archive.hintNota" } },
      { judul: { kunci: "archive.tabReturPemasok" }, isi: { kunci: "archive.hintRetur" } },
      { judul: { kunci: "archive.tabWorkOrder" }, isi: { kunci: "archive.hintWo" } },
    ],
  },
  {
    rute: "/backoffice/archive/toko/[storeId]",
    bagian: "navGroupArchive",
    judul: "Arsip dokumen toko",
    isi: { kunci: "archive.storeFolderDescription" },
  },
  {
    rute: "/backoffice/audit-trail",
    bagian: "navGroupArchive",
    judul: { kunci: "audit.trail.pageTitle" },
    isi: [
      { kunci: "audit.trail.subtitle" },
      "Catatan bisa disaring menurut pengguna, aksi (dipilih dari daftar berlabel), ID atau nomor dokumen datanya, dan rentang tanggal. Saringannya tersimpan di alamat halaman, jadi bisa dibagikan dan tidak hilang saat kembali ke halaman ini.",
      "Buka sebuah baris untuk melihat rinciannya: setiap kolom ditampilkan dengan nilai sebelum dan sesudahnya, dan kolom yang berubah ditebalkan. ID internal ditampilkan pendek; arahkan kursor untuk melihat lengkapnya.",
      "Baris merah adalah upaya yang gagal atau tidak berizin; baris kuning berarti ada data sensitif (misalnya rekening bank) yang dibuka.",
      "Ekspor CSV mengunduh hingga 2.000 catatan sesuai saringan yang sedang dipakai.",
    ],
  },
];
