import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * `jurnal-tertunda.ts` dan `admin-fanout.ts` menarik Prisma/Firebase — di sini
 * hanya fungsi murninya yang dipakai, jadi modul basis datanya ditiru.
 */
vi.mock("@elorae/db", () => ({ prisma: {} }));
vi.mock("./recipients", () => ({ getUsersWithPermission: vi.fn(), sendNotificationToUsers: vi.fn() }));

import { getNotificationHref } from "./navigation";
import { toFcmData } from "./admin-fanout";
import { sumberNotifikasiJurnal } from "@/lib/finance/jurnal-tertunda";

describe("getNotificationHref — field sales order rejection", () => {
  it("opens the store the rejected order was for, in the PWA", () => {
    expect(getNotificationHref("FIELD_SALES_ORDER_REJECTED", { orderId: "o1", storeId: "s1" }, "pwa")).toBe("/pwa/stores/s1");
    expect(getNotificationHref("FIELD_SALES_ORDER_REJECTED", {}, "pwa")).toBe("/pwa/stores");
  });

  it("opens the store an admin pushed konsi stock to, in the PWA", () => {
    expect(getNotificationHref("KONSI_ORDER_PUSHED", { orderId: "o1", storeId: "s1" }, "pwa")).toBe("/pwa/stores/s1");
    expect(getNotificationHref("KONSI_ORDER_PUSHED", {}, "pwa")).toBe("/pwa/stores");
  });
});

describe("getNotificationHref — collector assignment and settlement approval", () => {
  it("opens the assigned receivable, else the queue, in the PWA", () => {
    expect(getNotificationHref("COLLECTOR_ASSIGNED", { receivableId: "r1", count: "1" }, "pwa")).toBe("/pwa/collections/r1");
    expect(getNotificationHref("COLLECTOR_ASSIGNED", { count: "3" }, "pwa")).toBe("/pwa/collections");
    expect(getNotificationHref("COLLECTOR_ASSIGNED", { receivableId: "", count: "3" }, "pwa")).toBe("/pwa/collections");
  });

  it("opens the store's settlements for an approval, like a rejection", () => {
    expect(getNotificationHref("SETTLEMENT_APPROVED", { settlementId: "s1", storeId: "st1" }, "pwa")).toBe("/pwa/pelunasan/st1");
    expect(getNotificationHref("SETTLEMENT_APPROVED", {}, "pwa")).toBe("/pwa/pelunasan");
  });
});

describe("getNotificationHref — types without a destination", () => {
  it("returns null for a known type that has no screen and for an unrecognised type", () => {
    expect(getNotificationHref("CREDIT_LIMIT_HOLD", { orderId: "o1" })).toBeNull();
    expect(getNotificationHref("SOMETHING_NEW", { id: "x" })).toBeNull();
  });
});

describe("getNotificationHref — field retur count mismatch", () => {
  it("opens the store in the PWA, for the salesman who raised the retur", () => {
    expect(getNotificationHref("FIELD_RETURN_MISMATCH", { storeId: "s1", returnId: "r1" }, "pwa")).toBe("/pwa/stores/s1");
    expect(getNotificationHref("FIELD_RETURN_MISMATCH", { returnId: "r1" }, "pwa")).toBe("/pwa/notifications");
    expect(getNotificationHref("FIELD_RETURN_MISMATCH", { storeId: "", returnId: "r1" }, "pwa")).toBe("/pwa/notifications");
  });

  it("keeps opening the retur in the backoffice", () => {
    expect(getNotificationHref("FIELD_RETURN_MISMATCH", { storeId: "s1", returnId: "r1" })).toBe("/backoffice/field-returns/r1");
    expect(getNotificationHref("FIELD_RETURN_MISMATCH", { storeId: "s1" }, "backoffice")).toBe("/backoffice/field-returns");
  });
});

describe("getNotificationHref — konsi count schedule and report categories", () => {
  it("opens the stocktake a count notification names, in the backoffice", () => {
    expect(getNotificationHref("KONSI_COUNT_DUE", { storeId: "s1", stocktakeId: "st1" })).toBe("/backoffice/store-stocktakes/st1");
    expect(getNotificationHref("KONSI_COUNT_OVERDUE", { storeId: "s1", stocktakeId: "st1" })).toBe("/backoffice/store-stocktakes/st1");
  });

  it("falls back to the store when an overdue alert names no open stocktake, and to the register when it names nothing", () => {
    expect(getNotificationHref("KONSI_COUNT_OVERDUE", { storeId: "s1", stocktakeId: "" })).toBe("/backoffice/stores/s1");
    expect(getNotificationHref("KONSI_COUNT_OVERDUE", {})).toBe("/backoffice/store-stocktakes");
  });

  it("sends the SPG to the PWA count screen", () => {
    expect(getNotificationHref("KONSI_COUNT_DUE", { storeId: "s1", stocktakeId: "st1" }, "pwa")).toBe("/pwa/spg/stocktake");
  });

  it("opens the auto-created report for READY and HELD", () => {
    expect(getNotificationHref("KONSI_REPORT_READY", { sellThroughId: "slt1" })).toBe("/backoffice/konsi-sell-through/slt1");
    expect(getNotificationHref("KONSI_REPORT_HELD", { sellThroughId: "slt1" })).toBe("/backoffice/konsi-sell-through/slt1");
    expect(getNotificationHref("KONSI_REPORT_READY", {})).toBe("/backoffice/konsi-sell-through");
  });

  it("opens the closing stocktake for BLOCKED, where the refusal and the create button live", () => {
    expect(getNotificationHref("KONSI_REPORT_BLOCKED", { stocktakeId: "st1", code: "DRAFT_EXISTS" })).toBe("/backoffice/store-stocktakes/st1");
    expect(getNotificationHref("KONSI_REPORT_BLOCKED", {})).toBe("/backoffice/store-stocktakes");
  });
});

describe("getNotificationHref — order approval and store change", () => {
  it("opens the order awaiting approval, else the register", () => {
    expect(getNotificationHref("PENDING_ORDER_APPROVAL", { orderId: "o1" })).toBe("/backoffice/field-sales-orders/o1");
    expect(getNotificationHref("PENDING_ORDER_APPROVAL", {})).toBe("/backoffice/field-sales-orders");
    expect(getNotificationHref("PENDING_ORDER_APPROVAL", { orderId: "" })).toBe("/backoffice/field-sales-orders");
  });

  it("opens the store a change request names, else the store list", () => {
    expect(getNotificationHref("STORE_CHANGE_REQUEST", { storeId: "s1" })).toBe("/backoffice/stores/s1");
    expect(getNotificationHref("STORE_CHANGE_REQUEST", {})).toBe("/backoffice/stores");
    expect(getNotificationHref("STORE_CHANGE_REQUEST", { storeId: "" })).toBe("/backoffice/stores");
  });
});

describe("getNotificationHref — JOURNAL_PENDING", () => {
  const fallback = "/backoffice/finance/journals?status=tertunda";
  const href = (data: Record<string, unknown>) => getNotificationHref("JOURNAL_PENDING", data);

  it("opens the sales order for a sales sweep failure", () => {
    expect(href({ orderId: "o1", kind: "revenue" })).toBe("/backoffice/sales-orders/o1");
    expect(href({ orderId: "o1", kind: "cogs" })).toBe("/backoffice/sales-orders/o1");
  });

  it("opens the sales return, not an order, when the metadata carries salesReturnId", () => {
    expect(href({ salesReturnId: "r1", kind: "revenue" })).toBe("/backoffice/returns/r1");
    expect(href({ salesReturnId: "r1", kind: "cogs" })).toBe("/backoffice/returns/r1");
  });

  it("opens the opname, which carries no kind", () => {
    expect(href({ opnameId: "op1" })).toBe("/backoffice/inventory/stock-opname/op1");
  });

  it("opens the work order for an fg_receipt", () => {
    expect(href({ woId: "w1", receiptId: "rc1", kind: "fg_receipt" })).toBe("/backoffice/work-orders/w1");
  });

  it("opens the GRN tab for receipt and reversal", () => {
    expect(href({ grnId: "g1", kind: "receipt" })).toBe("/backoffice/inventory?tab=grn");
    expect(href({ grnId: "g1", kind: "reversal" })).toBe("/backoffice/inventory?tab=grn");
  });

  it("opens the purchase order for supplier payment kinds", () => {
    expect(href({ docId: "po1", kind: "supplier_payment" })).toBe("/backoffice/purchase-orders/po1");
    expect(href({ docId: "po1", kind: "supplier_payment_reversal" })).toBe("/backoffice/purchase-orders/po1");
  });

  it("opens the payment for ar_payment kinds", () => {
    expect(href({ docId: "p1", kind: "ar_payment" })).toBe("/backoffice/finance/payments/p1");
    expect(href({ docId: "p1", kind: "ar_payment_void" })).toBe("/backoffice/finance/payments/p1");
  });

  it("opens the sell-through report for every konsi kind", () => {
    expect(href({ docId: "slt1", kind: "konsi_sell_through_revenue" })).toBe("/backoffice/konsi-sell-through/slt1");
    expect(href({ docId: "slt1", kind: "konsi_sell_through_shrinkage_void" })).toBe("/backoffice/konsi-sell-through/slt1");
  });

  it("opens the receivable for a field delivery when it is known, else the register", () => {
    expect(href({ docId: "d1", kind: "field_delivery_revenue", receivableId: "rv1" })).toBe("/backoffice/finance/piutang/rv1");
    expect(href({ docId: "d1", kind: "field_delivery_cogs", receivableId: "rv1" })).toBe("/backoffice/finance/piutang/rv1");
    expect(href({ docId: "d1", kind: "field_delivery_revenue" })).toBe("/backoffice/finance/piutang");
    expect(href({ docId: "d1", kind: "field_delivery_revenue", receivableId: "" })).toBe("/backoffice/finance/piutang");
  });

  it("opens the van sale and the van reconcile", () => {
    expect(href({ docId: "vs1", kind: "van_sale" })).toBe("/backoffice/van-sales/vs1");
    expect(href({ docId: "vr1", kind: "van_reconcile" })).toBe("/backoffice/canvassing/reconcile/vr1");
  });

  it("opens the canvasser for a van_load when known, else the canvassing list", () => {
    expect(href({ docId: "vl1", kind: "van_load", canvasserId: "c1" })).toBe("/backoffice/canvassing/c1");
    expect(href({ docId: "vl1", kind: "van_load" })).toBe("/backoffice/canvassing");
  });

  it("falls back to the journal register for an unknown kind or a missing id", () => {
    expect(href({ docId: "x1", kind: "something_new" })).toBe(fallback);
    expect(href({})).toBe(fallback);
    expect(href({ kind: "van_sale" })).toBe(fallback);
    expect(href({ docId: "", kind: "ar_payment" })).toBe(fallback);
    expect(href({ orderId: "", kind: "revenue" })).toBe(fallback);
    expect(href({ grnId: "", kind: "receipt" })).toBe(fallback);
  });
});

describe("getNotificationHref — PO payment reminder", () => {
  it("opens the PO, and falls back to the PO list when the id is missing", () => {
    expect(getNotificationHref("PO_PAYMENT_DUE", { poId: "po1" })).toBe("/backoffice/purchase-orders/po1");
    expect(getNotificationHref("PO_PAYMENT_DUE", {})).toBe("/backoffice/purchase-orders");
    expect(getNotificationHref("PO_PAYMENT_DUE", { poId: "" })).toBe("/backoffice/purchase-orders");
  });
});

describe("getNotificationHref — new sales return", () => {
  it("opens the return, and falls back to the returns list when the id is missing", () => {
    expect(getNotificationHref("SALES_RETURN_RECEIVED", { salesReturnId: "sr1" })).toBe("/backoffice/returns/sr1");
    expect(getNotificationHref("SALES_RETURN_RECEIVED", {})).toBe("/backoffice/returns");
    expect(getNotificationHref("SALES_RETURN_RECEIVED", { salesReturnId: "" })).toBe("/backoffice/returns");
  });
});

/**
 * Isi `data` baris lonceng persis seperti yang ditulis `fanOutAdminNotification`:
 * metadata `AdminNotification` diratakan oleh `toFcmData` (null dibuang, angka
 * jadi teks) ditambah `adminNotificationId`.
 */
function dataLonceng(metadata: Record<string, unknown>): Record<string, unknown> {
  return { adminNotificationId: "notif-1", ...toFcmData(metadata) };
}

// Jurnal yang gagal diposting tidak ada di daftar terposting — cadangannya tab Tertunda.
const FALLBACK_JURNAL = "/backoffice/finance/journals?status=tertunda";

/*
 * Bentuk metadata nyata dari setiap penulis JOURNAL_PENDING (dibaca dari
 * penulisnya: post-van-journal-safely, post-supplier-payment-journal-safely,
 * actions/grn, actions/production, actions/stock-opname,
 * actions/sales-return-decision, finance/sales/sweep).
 */
const KASUS_JURNAL: { nama: string; metadata: Record<string, unknown>; href: string }[] = [
  {
    nama: "penjualan van",
    metadata: { docId: "sale-1", kind: "van_sale", reason: "UNMAPPED_ROLE", role: "CASH" },
    href: "/backoffice/van-sales/sale-1",
  },
  {
    nama: "rekonsiliasi van",
    metadata: { docId: "rec-1", kind: "van_reconcile", reason: "ERROR", role: null },
    href: "/backoffice/canvassing/reconcile/rec-1",
  },
  {
    nama: "muat van (kanvaser dilengkapi route)",
    metadata: { docId: "load-1", kind: "van_load", reason: "UNMAPPED_ROLE", role: "INVENTORY_VAN", canvasserId: "user-9" },
    href: "/backoffice/canvassing/user-9",
  },
  {
    nama: "pembayaran pemasok",
    metadata: { docId: "po-1", kind: "supplier_payment", reason: "GRN_JOURNALS_INCOMPLETE", role: null },
    href: "/backoffice/purchase-orders/po-1",
  },
  {
    nama: "pembalikan pembayaran pemasok",
    metadata: { docId: "po-2", kind: "supplier_payment_reversal", reason: "UNMAPPED_ROLE", role: "AP" },
    href: "/backoffice/purchase-orders/po-2",
  },
  {
    nama: "GRN",
    metadata: { grnId: "grn-1", kind: "receipt", reason: "UNMAPPED_ROLE", role: "AP" },
    href: "/backoffice/inventory?tab=grn",
  },
  {
    nama: "pembalikan GRN",
    metadata: { grnId: "grn-2", kind: "reversal", reason: "ERROR", role: null },
    href: "/backoffice/inventory?tab=grn",
  },
  {
    nama: "penerimaan barang jadi",
    metadata: { receiptId: "fg-1", woId: "wo-1", kind: "fg_receipt", reason: "UNMAPPED_ROLE", role: "INVENTORY_FG" },
    href: "/backoffice/work-orders/wo-1",
  },
  {
    nama: "opname",
    metadata: { opnameId: "op-1", reason: "UNMAPPED_ROLE", role: "INVENTORY" },
    href: "/backoffice/inventory/stock-opname/op-1",
  },
  {
    nama: "retur penjualan (pendapatan)",
    metadata: { salesReturnId: "sr-1", kind: "revenue", reason: "UNMAPPED_ROLE", role: "AR" },
    href: "/backoffice/returns/sr-1",
  },
  {
    nama: "retur penjualan (HPP)",
    metadata: { salesReturnId: "sr-2", kind: "cogs", reason: "ERROR", role: null },
    href: "/backoffice/returns/sr-2",
  },
  {
    nama: "pesanan marketplace (pendapatan)",
    metadata: { orderId: "so-1", kind: "revenue", reason: "UNMAPPED_ROLE", role: "SALES_REVENUE" },
    href: "/backoffice/sales-orders/so-1",
  },
  {
    nama: "pesanan marketplace (HPP)",
    metadata: { orderId: "so-2", kind: "cogs", reason: "UNMAPPED_ROLE", role: "COGS" },
    href: "/backoffice/sales-orders/so-2",
  },
  {
    nama: "fee/pembayaran KOL (jurnal-kol)",
    metadata: { docId: "kolab-1", kind: "kol_kolaborasi", reason: "UNMAPPED_ROLE", role: "KOL_EXPENSE", docNo: "BRIEF/2026/0001" },
    href: "/backoffice/kreatif/kolaborasi/kolab-1?tab=pembayaran",
  },
  {
    nama: "sampel KOL (jurnal-kol)",
    metadata: { docId: "kirim-1", kind: "kol_sampel", reason: "UNMAPPED_ROLE", role: "KOL_EXPENSE", collabId: "kolab-1" },
    href: "/backoffice/kreatif/kolaborasi/kolab-1?tab=pembayaran",
  },
  // Jurnal lapangan (lib/finance/lapangan/tertunda.ts): posting ulang di layar rekonsiliasi piutang.
  ...(["nota_putus", "bkm_lapangan", "retur_toko", "tukar_barang"] as const).map((kind) => ({
    nama: `jurnal lapangan ${kind}`,
    metadata: { docId: `${kind}-1`, kind, reason: "UNMAPPED_ROLE", role: "AR_STORE", docNo: "X/1" },
    href: "/backoffice/finance/rekonsiliasi-piutang#tertunda",
  })),
  // Jurnal operasional (lib/finance/operasional/tertunda.ts): posting ulang di layar rekonsiliasi persediaan.
  ...(
    [
      "konsi_kirim",
      "konsi_pesanan",
      "konsi_retur",
      "konsi_siklus",
      "konsi_komisi",
      "konsi_gaji_bayar",
      "konsi_bayar_toko",
      "komisi_spg",
      "komisi_spg_bayar",
      "barang_hilang",
      "potong_sales",
      "gudang_rusak",
      "stok_manual",
      "retur_pemasok",
      "biaya_perjalanan",
      "biaya_perjalanan_bayar",
    ] as const
  ).map((kind) => ({
    nama: `jurnal operasional ${kind}`,
    metadata: { docId: `${kind}-1`, kind, reason: "UNMAPPED_ROLE", role: "INVENTORY_CONSIGNMENT", docNo: "X/1" },
    href: "/backoffice/finance/rekonsiliasi-persediaan#tertunda",
  })),
];

describe("getNotificationHref — JOURNAL_PENDING menaut ke dokumennya", () => {
  for (const k of KASUS_JURNAL) {
    it(k.nama, () => {
      expect(getNotificationHref("JOURNAL_PENDING", dataLonceng(k.metadata))).toBe(k.href);
    });
  }

  it("muat van tanpa kanvaser (route belum melengkapi) → daftar kanvasing", () => {
    expect(
      getNotificationHref("JOURNAL_PENDING", dataLonceng({ docId: "load-1", kind: "van_load", reason: "ERROR" })),
    ).toBe("/backoffice/canvassing");
  });

  it("penerimaan barang jadi tanpa woId → daftar SPK", () => {
    expect(
      getNotificationHref("JOURNAL_PENDING", dataLonceng({ receiptId: "fg-1", kind: "fg_receipt", reason: "ERROR" })),
    ).toBe("/backoffice/work-orders");
  });

  it("bentuk tak dikenal (mis. baris isian ulang yang hanya membawa adminNotificationId) → buku jurnal", () => {
    expect(getNotificationHref("JOURNAL_PENDING", { adminNotificationId: "n1" })).toBe(FALLBACK_JURNAL);
    expect(getNotificationHref("JOURNAL_PENDING", dataLonceng({ docId: "x", kind: "lain" }))).toBe(FALLBACK_JURNAL);
  });

  /*
   * `sumberNotifikasiJurnal` adalah pembaca metadata yang sudah dipakai
   * Beranda. Tidak bisa diimpor ke tautan ini (menarik Prisma ke bundel
   * klien), jadi tes ini menjaga keduanya tetap sepakat: setiap bentuk yang
   * dikenali Beranda juga punya tautan ke dokumen, bukan cadangan umum.
   */
  it("setiap bentuk yang dikenali sumberNotifikasiJurnal punya tautan dokumen", () => {
    for (const k of KASUS_JURNAL) {
      const data = dataLonceng(k.metadata);
      expect(sumberNotifikasiJurnal(data), k.nama).not.toBeNull();
      expect(getNotificationHref("JOURNAL_PENDING", data), k.nama).not.toBe(FALLBACK_JURNAL);
    }
  });

  it("id di-encode, bukan ditempel mentah", () => {
    expect(getNotificationHref("JOURNAL_PENDING", dataLonceng({ opnameId: "a/b?c" }))).toBe(
      "/backoffice/inventory/stock-opname/a%2Fb%3Fc",
    );
  });
});

describe("getNotificationHref — persetujuan pesanan dan perubahan toko", () => {
  it("PENDING_ORDER_APPROVAL → rincian pesanan lapangan", () => {
    const data = dataLonceng({
      orderId: "fso-1",
      orderNo: "PUTUS/2026/00001",
      orderType: "PUTUS",
      storeId: "st-1",
      total: 125000,
      kreditDitahan: false,
      remoteChannel: null,
    });
    expect(getNotificationHref("PENDING_ORDER_APPROVAL", data)).toBe("/backoffice/field-sales-orders/fso-1");
  });

  it("PENDING_ORDER_APPROVAL tanpa orderId → daftar pesanan lapangan", () => {
    expect(getNotificationHref("PENDING_ORDER_APPROVAL", { adminNotificationId: "n1" })).toBe(
      "/backoffice/field-sales-orders",
    );
  });

  it("STORE_CHANGE_REQUEST → rincian toko (kartu tinjauan ada di sana)", () => {
    const data = dataLonceng({ storeChangeRequestId: "scr-1", storeId: "st-7" });
    expect(getNotificationHref("STORE_CHANGE_REQUEST", data)).toBe("/backoffice/stores/st-7");
  });

  it("STORE_CHANGE_REQUEST tanpa storeId → daftar toko", () => {
    expect(getNotificationHref("STORE_CHANGE_REQUEST", { adminNotificationId: "n1" })).toBe("/backoffice/stores");
  });
});

describe("getNotificationHref — jenis lain", () => {
  it("GRN_CREATED membuka tab GRN, bukan tab stok", () => {
    expect(getNotificationHref("GRN_CREATED", { grnId: "g1", docNumber: "GRN/1" })).toBe(
      "/backoffice/inventory?tab=grn",
    );
  });

  it("data kosong (null) tetap membawa ke daftar untuk jenis yang dikenal", () => {
    expect(getNotificationHref("DOC_NUMBER_ALTERED", null)).toBe("/backoffice/settings/documents");
    expect(getNotificationHref("PO_OVERDUE", null)).toBe("/backoffice/purchase-orders");
  });

  it("data berupa teks JSON dibaca seperti objek", () => {
    expect(getNotificationHref("PENDING_ORDER_APPROVAL", JSON.stringify({ orderId: "fso-9" }))).toBe(
      "/backoffice/field-sales-orders/fso-9",
    );
  });

  it("jenis tak dikenal tetap null (ketukan hanya menandai dibaca)", () => {
    expect(getNotificationHref("JENIS_ANEH", { a: "b" })).toBeNull();
  });

  it("jenis lama tidak berubah", () => {
    expect(getNotificationHref("PO_CREATED", { poId: "p1" })).toBe("/backoffice/purchase-orders/p1");
    expect(getNotificationHref("WO_OVERDUE", { woId: "w1" })).toBe("/backoffice/work-orders/w1");
    expect(getNotificationHref("TAX_INVOICE_PENDING", {})).toBe("/backoffice/finance/faktur-pajak");
  });
});

/*
 * Kabar (`kabariPengguna`) untuk orang kantor. BKM dan NRT yang dicatat dari
 * kantor membuat pencatatnya jadi "pelapor" (`buatKlaimAction`: salesmanId =
 * pengguna sesi), jadi keputusan keuangan/gudang tiba di LONCENG KANTOR-nya.
 * Tautan HP-nya (`tautanKabar`, /pwa/…) tidak berguna di sana; dokumen yang sama
 * punya halaman kantor. Kabar khusus HP (jadwal, SPG, ringkasan) tetap null.
 */
describe("getNotificationHref — kabar yang sampai ke lonceng kantor", () => {
  it.each([
    ["PELUNASAN_TERVERIFIKASI", { claimId: "pc-1" }, "/backoffice/pelunasan/pc-1"],
    ["PELUNASAN_DITOLAK", { claimId: "pc-2" }, "/backoffice/pelunasan/pc-2"],
    ["PELUNASAN_DIBATALKAN", { claimId: "pc-3" }, "/backoffice/pelunasan/pc-3"],
    ["GIRO_CAIR", { claimId: "pc-4" }, "/backoffice/pelunasan/pc-4"],
    ["GIRO_DITOLAK", { claimId: "pc-5" }, "/backoffice/pelunasan/pc-5"],
    ["RETUR_DIHITUNG", { returnId: "nrt-1" }, "/backoffice/retur-toko/nrt-1"],
    ["RETUR_DIPINDAH_TOKO", { returnId: "nrt-2" }, "/backoffice/retur-toko/nrt-2"],
    ["RETUR_DIBATALKAN", { returnId: "nrt-3" }, "/backoffice/retur-toko/nrt-3"],
    ["RETUR_DIBEBANKAN", { chargeId: "ch-1", returnId: "nrt-4" }, "/backoffice/retur-toko/nrt-4"],
    ["PESANAN_DISETUJUI", { orderId: "fso-1" }, "/backoffice/field-sales-orders/fso-1"],
    ["PESANAN_DITOLAK", { orderId: "fso-2" }, "/backoffice/field-sales-orders/fso-2"],
    ["PESANAN_DIKIRIM", { orderId: "fso-3", deliveryId: "d-1" }, "/backoffice/field-sales-orders/fso-3"],
    ["PESANAN_DITUTUP", { orderId: "fso-4" }, "/backoffice/field-sales-orders/fso-4"],
    ["PESANAN_PORTAL", { orderId: "fso-5" }, "/backoffice/field-sales-orders/fso-5"],
  ])("%s → dokumennya di kantor", (jenis, data, href) => {
    expect(getNotificationHref(jenis, data)).toBe(href);
  });

  it.each([
    ["PELUNASAN_DITOLAK", "/backoffice/pelunasan"],
    ["GIRO_CAIR", "/backoffice/pelunasan"],
    ["RETUR_DIHITUNG", "/backoffice/retur-toko"],
    ["PESANAN_DISETUJUI", "/backoffice/field-sales-orders"],
  ])("%s tanpa id → daftarnya", (jenis, href) => {
    expect(getNotificationHref(jenis, {})).toBe(href);
  });

  it("beban retur tanpa nota retur → daftar beban selisih", () => {
    expect(getNotificationHref("RETUR_DIBEBANKAN", { chargeId: "ch-1" })).toBe("/backoffice/beban-selisih");
  });

  it("id kabar di-encode", () => {
    expect(getNotificationHref("PELUNASAN_DITOLAK", { claimId: "a/b" })).toBe("/backoffice/pelunasan/a%2Fb");
  });

  it.each(["RINGKASAN_HARIAN", "JADWAL_KUNJUNGAN", "KIRIMAN_MENUNGGU", "TUKAR_SHIFT_DIMINTA", "KOMISI_SPG"])(
    "kabar khusus HP %s tetap tanpa tautan kantor",
    (jenis) => {
      expect(getNotificationHref(jenis, { tanggal: "2026-10-06", storeId: "st-1" })).toBeNull();
    },
  );
});

/*
 * Setiap kategori yang dikirim `fanOutAdminNotification` ke lonceng wajib
 * punya tautan — CLAUDE.md mewajibkannya, dan tiga kategori sempat lolos.
 * `CATEGORY_PERMISSION` tidak diekspor, jadi kuncinya dibaca dari sumbernya.
 */
describe("sapuan: setiap kategori lonceng kantor punya tautan", () => {
  const sumber = readFileSync(path.join(__dirname, "admin-fanout.ts"), "utf8");
  const awal = sumber.indexOf("const CATEGORY_PERMISSION");
  const akhir = sumber.indexOf("\n};", awal);
  const blok = sumber.slice(awal, akhir);
  const kategori = [...blok.matchAll(/^\s*([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);

  it("kategorinya terbaca", () => {
    expect(kategori.length).toBeGreaterThan(20);
    expect(kategori).toContain("JOURNAL_PENDING");
    expect(kategori).toContain("PENDING_ORDER_APPROVAL");
    expect(kategori).toContain("STORE_CHANGE_REQUEST");
  });

  // Kategori yang memang tidak punya layar tujuan (lihat "types without a destination").
  const TANPA_LAYAR = ["CREDIT_LIMIT_HOLD", "COLLECTION_PENDING_VERIFICATION", "DELIVERY_COMPLETION_STUCK"];
  const bertautan = kategori.filter((k) => !TANPA_LAYAR.includes(k));

  it("tidak satu pun kategori menaut null", () => {
    const tanpaTautan = bertautan.filter(
      (k) => getNotificationHref(k, { adminNotificationId: "n1" }) == null,
    );
    expect(tanpaTautan).toEqual([]);
  });

  it("setiap tautan kategori menuju backoffice", () => {
    for (const k of bertautan) {
      expect(getNotificationHref(k, { adminNotificationId: "n1" }), k).toMatch(/^\/backoffice\//);
    }
  });
});
