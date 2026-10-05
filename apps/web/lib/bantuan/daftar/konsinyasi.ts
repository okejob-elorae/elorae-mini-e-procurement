import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/konsinyasi",
    bagian: "konsinyasi",
    judul: { kunci: "konsinyasi.pageTitle" },
    isi: [
      { kunci: "konsinyasi.pageDescription" },
      "Tahapnya berurutan: menunggu laporan SPG dan laporan toko, mencocokkan dan mengunci angka resmi, membayar gaji dan komisi SPG (dilewati bila toko tidak punya SPG), nota dari admin penjualan, lalu nomor faktur pajak dari admin pajak.",
      { kunci: "konsinyasi.matchHint" },
      "Melihat butuh izin melihat konsinyasi; membuka siklus dan mencatat kiriman butuh izin mengelola konsinyasi.",
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
      "Mengunci butuh kedua laporan. Tarif komisi per potong disalin dari master barang saat mengunci, jadi mengubah tarifnya sesudah itu tidak mengubah komisi bulan tersebut. Membuka kunci ditolak begitu ada gaji SPG yang sudah dibayar.",
    ],
    kartu: [
      { judul: { kunci: "konsinyasi.threeNumbers" }, isi: { kunci: "konsinyasi.threeNumbersHint" } },
      { judul: { kunci: "konsinyasi.compareTitle" }, isi: { kunci: "konsinyasi.compareHint" } },
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
        isi: [{ kunci: "konsinyasi.tagihan.hint" }, { kunci: "konsinyasi.tagihan.storeShare" }],
      },
    ],
  },
];
