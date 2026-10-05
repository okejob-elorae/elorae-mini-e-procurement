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
      "Catatan bisa disaring menurut pengguna, jenis aksi, entitas, dan rentang tanggal.",
    ],
  },
];
