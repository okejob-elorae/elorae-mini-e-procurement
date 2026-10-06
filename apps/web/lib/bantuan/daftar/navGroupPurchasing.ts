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
    ],
  },
  {
    rute: "/backoffice/purchase-orders/new",
    bagian: "navGroupPurchasing",
    judul: { kunci: "purchaseOrders.newPageTitle" },
    isi: [
      { kunci: "purchaseOrders.newPageDescription" },
      "Hanya pemasok yang sudah disetujui yang bisa dipilih. PO tersimpan sebagai draf dan baru sampai ke pemasok setelah diajukan dari halaman rinciannya.",
    ],
  },
  {
    rute: "/backoffice/purchase-orders/[id]",
    bagian: "navGroupPurchasing",
    judul: "Rincian pesanan pembelian",
    isi: [
      "Satu PO: pemasok, tanggal tiba, jatuh tempo pembayaran, baris barang, dan riwayat statusnya. Dari sini PO dicetak, diubah, diajukan, atau dibatalkan.",
      "PO draf bisa diubah dan diajukan langsung. Mengubah PO yang sudah diajukan atau sudah ada penerimaannya butuh PIN; membatalkan PO selalu butuh PIN dan alasan.",
    ],
  },
  {
    rute: "/backoffice/supplier-payments",
    bagian: "navGroupPurchasing",
    judul: { kunci: "supplierPayments.pageTitle" },
    isi: [
      { kunci: "supplierPayments.pageDescription" },
      "Menandai PO lunas memposting jurnal pembayaran untuk hutang yang sudah dibukukan dari penerimaan barangnya; membatalkan tanda lunas memposting jurnal kebalikannya. Bila jurnalnya tidak bisa diposting, Anda diberi tahu alasannya.",
    ],
  },
  {
    rute: "/backoffice/vendor-returns",
    bagian: "navGroupPurchasing",
    judul: { kunci: "vendorReturnsList.pageTitle" },
    isi: { kunci: "vendorReturnsList.pageDescription" },
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
