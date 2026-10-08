import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/archive",
    bagian: "navGroupArchive",
    judul: { kunci: "archive.judulHalaman" },
    isi: [
      { kunci: "archive.pageDescription" },
      { kunci: "archive.hintDot" },
      "Tab Nota toko terbuka untuk tim pembelian dan pembaca piutang; tab Retur pemasok dan Perintah kerja hanya untuk tim pembelian.",
      "Di bawah folder setiap tab ada tautan ke tempat dokumen yang menggantung dikerjakan — mengisi nomor faktur pajak (membuka daftar \"Belum ada faktur\"), menyelesaikan retur pemasok, atau melihat perintah kerja yang masih berjalan — beserta jumlahnya. Tautan itu hanya muncul bila memang ada yang menggantung.",
      "Tab Perintah kerja hanya menampilkan pemasok jahit (CMT) dan pemasok lain yang pernah mendapat perintah kerja; pemasok kain dan aksesori tanpa perintah kerja tidak dijadikan folder kosong. Folder yang punya pekerjaan menggantung tampil lebih dulu, lalu yang isinya paling banyak. Jumlah di ringkasan selalu sama dengan jumlah angka di folder-foldernya.",
      "Tab yang sedang dibuka ikut tersimpan di alamat halaman, jadi tombol Kembali dan tautan yang dibagikan membuka tab yang sama.",
    ],
    kartu: [
      { judul: { kunci: "archive.tab.nota" }, isi: { kunci: "archive.hintNota" } },
      { judul: { kunci: "archive.tab.retur" }, isi: { kunci: "archive.hintRetur" } },
      { judul: { kunci: "archive.tab.wo" }, isi: { kunci: "archive.hintWo" } },
    ],
  },
  {
    rute: "/backoffice/archive/toko/[storeId]",
    bagian: "navGroupArchive",
    judul: "Arsip dokumen toko",
    isi: [
      { kunci: "archive.storeFolderDescription" },
      "Kolom Tanggal nota adalah tanggal nota tagihan — tanggal yang sama dengan kolom Tanggal nota di Faktur pajak.",
    ],
  },
  {
    rute: "/backoffice/audit-trail",
    bagian: "navGroupArchive",
    judul: { kunci: "audit.trail.judulHalaman" },
    isi: [
      { kunci: "audit.trail.subtitle" },
      "Catatan bisa disaring menurut pengguna, aksi (dipilih dari daftar berlabel), ID atau nomor dokumen datanya, dan rentang tanggal. Saringannya tersimpan di alamat halaman, jadi bisa dibagikan dan tidak hilang saat kembali ke halaman ini.",
      "Buka sebuah baris untuk melihat rinciannya: setiap kolom ditampilkan dengan nilai sebelum dan sesudahnya, dan kolom yang berubah ditebalkan. Kode status ditulis dengan labelnya (misalnya \"Belum dibayar → Dibayar\"), kolom uang dalam rupiah (angka persisnya di keterangan saat kursor diarahkan), dan singkatan pajak ditulis baku (DPP, PPh, PPN). ID data, alamat IP, dan perangkat ada di balik tombol Rincian teknis.",
      "Baris merah adalah upaya yang gagal atau tidak berizin; baris kuning berarti ada data sensitif (misalnya rekening bank) yang dibuka.",
      "Ekspor CSV mengunduh hingga 2.000 catatan sesuai saringan yang sedang dipakai.",
    ],
  },
];
