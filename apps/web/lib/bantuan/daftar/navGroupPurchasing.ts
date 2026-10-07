import type { EntriBantuan } from "../jenis";

/** Grup menu Pembelian: pesanan pembelian, pembayaran pemasok, retur ke pemasok. */
export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/purchase-orders",
    bagian: "navGroupPurchasing",
    judul: { kunci: "purchaseOrders.pageTitle" },
    isi: [
      { kunci: "purchaseOrders.pageDescription" },
      "PO dibuat sebagai draf, lalu diajukan ke pemasok. PO yang tanggal tibanya sudah lewat sementara barangnya belum lengkap dihitung terlambat.",
      "Nomor PO membuka rinciannya. Membatalkan dari daftar meminta alasan lalu PIN, dan hanya tersedia untuk PO yang belum menerima barang apa pun. PO draf dan PO yang dibatalkan tidak punya tagihan, jadi tanpa lencana status bayar.",
    ],
  },
  {
    rute: "/backoffice/purchase-orders/new",
    bagian: "navGroupPurchasing",
    judul: { kunci: "purchaseOrders.newPageTitle" },
    isi: [
      { kunci: "purchaseOrders.newPageDescription" },
      "Hanya pemasok yang sudah disetujui yang bisa dipilih. Tombol Simpan draf menyimpan PO sebagai draf; PO baru sampai ke pemasok setelah diajukan dari halaman rinciannya. Tanpa sinyal, tombolnya menjadi Simpan di perangkat dan PO dikirim saat sinyal kembali.",
    ],
  },
  {
    rute: "/backoffice/purchase-orders/[id]",
    bagian: "navGroupPurchasing",
    judul: "Rincian pesanan pembelian",
    isi: [
      "Satu PO: pemasok, tanggal tiba, jatuh tempo pembayaran, baris barang, penerimaan barang (GRN), dan riwayat statusnya. Dari sini PO dicetak, diubah, diajukan, dibatalkan, atau barangnya diterima.",
      "Terima barang (untuk PO yang sudah dikirim ke pemasok atau baru diterima sebagian) membuka formulir GRN dengan PO dan pemasok sudah terisi. Setiap GRN milik PO ini tampil di kartu Penerimaan barang dan nomornya membuka rinciannya (bila Anda boleh membuka inventori). GRN terima-lebih yang masih menunggu pemilik diberi tanda, dan yang ditolak pemilik dicoret nilainya karena penerimaannya sudah dibalik.",
      "PO draf bisa diubah dan diajukan langsung. Mengubah PO yang sudah diajukan atau sudah ada penerimaannya butuh PIN; membatalkan PO selalu butuh alasan dan PIN. Begitu ada barang diterima, PO tidak bisa dibatalkan lagi — gunakan Tutup PO bila sisanya tidak akan datang.",
      "Tandai lunas meminta konfirmasi tanggal bayar (tidak boleh sesudah hari ini) dan memperlihatkan utang barang yang sudah diterima, sisa komitmen, serta peringatan bila barangnya belum diterima.",
    ],
  },
  {
    rute: "/backoffice/supplier-payments",
    bagian: "navGroupPurchasing",
    judul: { kunci: "supplierPayments.pageTitle" },
    isi: [
      { kunci: "supplierPayments.pageDescription" },
      "Menandai PO lunas memposting jurnal pembayaran untuk hutang yang sudah dibukukan dari penerimaan barangnya; membatalkan tanda lunas memposting jurnal kebalikannya. Bila jurnalnya tidak bisa diposting, Anda diberi tahu alasannya.",
      "Kartu Utang (barang sudah diterima) menjumlah nilai barang yang sudah diterima dari PO yang belum dibayar, dengan harga PO dan PPN-nya, dikurangi retur ke pemasok. Kartu Komitmen PO (belum diterima) adalah sisa nilai PO yang barangnya belum datang — belum menjadi utang. Keduanya dihitung dari PO di halaman daftar yang sedang tampil.",
      "Tandai lunas dan Batalkan tanda lunas selalu meminta konfirmasi. Tanggal bayar menjadi tanggal jurnal, jadi tidak boleh sesudah hari ini. Bila belum ada barang diterima, tanda lunas tidak memposting jurnal karena belum ada utang — pakai hanya untuk uang muka yang sudah ditransfer.",
      "Saringan pemasok memuat pemasok yang disetujui dan pemasok yang punya dokumen walau belum disetujui (ditandai). Bukti bayar mencetak utang PO sesudah sisa yang tidak datang dan retur pemasok.",
    ],
  },
  {
    rute: "/backoffice/vendor-returns",
    bagian: "navGroupPurchasing",
    judul: { kunci: "vendorReturnsList.pageTitle" },
    isi: [
      { kunci: "vendorReturnsList.pageDescription" },
      "Kolom Dokumen terkait menampilkan perintah kerja asal retur dan PO yang utangnya dikurangi retur itu. Memproses retur mengeluarkan stok dan tidak bisa dibatalkan, jadi selalu dikonfirmasi; hanya retur draf yang bisa dihapus.",
    ],
  },
  {
    rute: "/backoffice/vendor-returns/new",
    bagian: "navGroupPurchasing",
    judul: { kunci: "vendorReturn.form.newTitle" },
    isi: [{ kunci: "vendorReturn.createReturnSubtitle" }, "Retur tersimpan sebagai draf; stok belum bergerak sampai retur diproses dari halaman rinciannya."],
    kartu: [{ judul: { kunci: "vendorReturn.form.cardTitle" }, isi: { kunci: "vendorReturn.form.cardDescription" } }],
  },
  {
    rute: "/backoffice/vendor-returns/[id]",
    bagian: "navGroupPurchasing",
    judul: "Rincian retur ke pemasok",
    isi: [
      "Satu retur ke pemasok beserta nota returnya yang bisa dicetak.",
      "Memproses retur draf mengurangi stok kain atau aksesoris yang dikembalikan (roll kainnya ditutup) atau stok reject barang jadi. Retur yang sudah diproses diselesaikan dengan nomor resi dan bukti terima.",
    ],
    kartu: [
      { judul: { kunci: "vendorReturn.summaryTitle" }, isi: { kunci: "vendorReturn.totalValueAndWO" } },
      { judul: { kunci: "vendorReturn.linesTitle" }, isi: { kunci: "vendorReturn.itemsReturned" } },
    ],
  },
  {
    rute: "/backoffice/vendor-returns/[id]/edit",
    bagian: "navGroupPurchasing",
    judul: { kunci: "vendorReturn.form.editTitle" },
    isi: { kunci: "vendorReturn.form.editSubtitle" },
    kartu: [{ judul: { kunci: "vendorReturn.form.cardTitle" }, isi: { kunci: "vendorReturn.form.cardDescription" } }],
  },
];
