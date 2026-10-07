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

  it("tidak satu pun kategori menaut null", () => {
    const tanpaTautan = kategori.filter(
      (k) => getNotificationHref(k, { adminNotificationId: "n1" }) == null,
    );
    expect(tanpaTautan).toEqual([]);
  });

  it("setiap tautan kategori menuju backoffice", () => {
    for (const k of kategori) {
      expect(getNotificationHref(k, { adminNotificationId: "n1" }), k).toMatch(/^\/backoffice\//);
    }
  });
});
