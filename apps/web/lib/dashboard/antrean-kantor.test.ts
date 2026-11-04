import { describe, expect, it } from "vitest";
import { getRequiredPermission, hasPermission } from "@/lib/rbac";
import { buildActionItems, type BuildActionItemsInput } from "./action-items";
import { ANTREAN_KANTOR, bolehLihatAntrean, jalurTautan, KUNCI_ANTREAN, type KunciAntrean } from "./antrean-kantor";

/*
 * Antrean kantor di daftar "perlu ditindaklanjuti" Beranda. Setiap baris:
 * tautannya membawa saringan halaman tujuan, dan barisnya hanya tampil untuk
 * yang bisa MEMBUKA halamannya sekaligus MEMUTUSKAN isinya.
 *
 * Himpunan izin terkecil di bawah ini ditulis dari penjaga `page.tsx` dan aksi
 * server masing-masing halaman — bukan disalin dari `ANTREAN_KANTOR`, supaya
 * tes ini gagal bila salah satunya bergeser.
 */
const IZIN_TERKECIL: Record<KunciAntrean, string[]> = {
  // /backoffice/izin: ROUTE_PERMISSIONS field_sales_orders:view; memutuskan = approve.
  leavePending: ["field_sales_orders:view", "field_sales_orders:approve"],
  // Biaya: halaman = field_sales_orders:view ATAU journals:manage.
  expensesPendingApproval: ["field_sales_orders:view", "field_sales_orders:approve"],
  expensesPendingPayment: ["journals:manage"],
  // Tukar: halaman terbuka untuk penyetuju dan gudang.
  exchangesPendingApproval: ["field_sales_orders:approve"],
  exchangesPendingCompletion: ["inventory:manage"],
  // /backoffice/spg-transfers: ROUTE_PERMISSIONS + penjaga halaman spg_sales:view; menyetujui =
  // store_transfers:approve, memutuskan selisih = store_transfers:decide_shortfall (spg-mutasi.ts).
  transfersPendingApproval: ["spg_sales:view", "store_transfers:approve"],
  transferShortfallsOpen: ["spg_sales:view", "store_transfers:decide_shortfall"],
  // /backoffice/barang-hilang: halaman = receivables:manage ATAU receivables:decide_bearer ATAU
  // spg_sales:view; menetapkan penanggung = receivables:decide_bearer (barang-hilang.ts) — jadi
  // izin keputusan saja sudah membuka dan memutuskan.
  stockLossOpen: ["receivables:decide_bearer"],
  // Klaim ekspedisi: halaman barang hilang yang sama; mencatat jawaban ekspedisi = receivables:manage,
  // memeriksa uangnya = payments:verify, menetapkan penanggung lain = receivables:decide_bearer
  // (barang-hilang.ts). payments:verify saja tidak membuka halamannya (P28).
  klaimEkspedisiMenunggu: ["receivables:manage"],
  klaimEkspedisiCek: ["spg_sales:view", "payments:verify"],
  klaimEkspedisiDitolak: ["receivables:decide_bearer"],
  // /backoffice/retur-spg: ROUTE_PERMISSIONS + penjaga halaman spg_sales:view; menyetujui dan
  // menolak = spg_returns:approve (spg-retur.ts).
  spgReturnsPending: ["spg_sales:view", "spg_returns:approve"],
  // Sama halamannya; memutuskan barangnya = spg_returns:approve (retur-spg.ts).
  spgReturnGoodsPending: ["spg_sales:view", "spg_returns:approve"],
  storeProposalsPending: ["stores:view", "stores:manage"],
  fieldPromisesUnconfirmed: ["receivables:manage"],
  damagedDeliveriesOpen: ["inventory:manage"],
  damagedWarehouseOpen: ["inventory:view", "inventory:manage"],
  // /backoffice/pelunasan: penjaga halaman bolehMembacaPelunasan; memutuskan = payments:verify.
  claimCorrectionsPending: ["payments:verify"],
  returnCorrectionsPending: ["receivables:manage"],
  // /backoffice/retur-toko: penjaga halaman bolehMembacaRetur; memutuskan penanggung selisih retur =
  // store_returns:decide_shortfall (store-returns.ts, registri izin 2026-11-02).
  returnShortfallsUndecided: ["receivables:view", "store_returns:decide_shortfall"],
  shiftSwapsPending: ["spg_sales:view", "stores:manage"],
  // /backoffice/jadwal-spg: ROUTE_PERMISSIONS + penjaga spg_sales:view; menyetujui = spg_schedules:approve.
  spgSchedulesPending: ["spg_sales:view", "spg_schedules:approve"],
  // /backoffice/komisi-spg/catatan-hadir memagari dirinya (record ATAU verify ATAU spg_sales:view).
  spgAttendanceToEnter: ["spg_attendance:record"],
  spgAttendanceToCheck: ["spg_attendance:verify"],
  stockRequestsUnheld: ["spg_sales:view", "stores:manage"],
  // /backoffice/komisi-spg: penjaga halaman spg_sales:view ATAU spg_commission:pay (P28/Q9, tidak di
  // ROUTE_PERMISSIONS); menetapkan = receivables:manage.
  spgCommissionsUnset: ["spg_sales:view", "receivables:manage"],
  // Sama halamannya; menandai dibayar = spg_commission:pay (spg-komisi.ts, konsinyasi.ts bayarKomisiAction),
  // yang sendirian sudah membuka halamannya.
  spgCommissionsUnpaidPast: ["spg_commission:pay"],
  // Sama halamannya (kartu #tunggakan, bagian ditahan); mengatur gaji pokok = spg_commission:manage
  // (settings/spg-commission.ts), yang tidak membuka halamannya sendiri — butuh spg_sales:view.
  spgSalariesUnset: ["spg_sales:view", "spg_commission:manage"],
  // Kartu #utang: mencatat = spg_commission:pay; memeriksa pembayaran utang = payments:verify, yang
  // membuka halaman ini untuk kartu #utang saja.
  spgDebtsOpen: ["spg_commission:pay"],
  spgDebtPaymentsToCheck: ["payments:verify"],
  // Vendor Billing: ROUTE_PERMISSIONS vendor_bills:view; meminta invoice = vendor_bills:manage,
  // memutuskan selisih harga = vendor_bills:decide_price.
  receiptsWithoutInvoice: ["vendor_bills:view", "vendor_bills:manage"],
  invoiceRequestsOverdue: ["vendor_bills:view", "vendor_bills:manage"],
  vendorBillPriceDifferences: ["vendor_bills:view", "vendor_bills:decide_price"],
  // Inventori: ROUTE_PERMISSIONS inventory:view; mengonfirmasi GRN tanpa PO = goods_receipts:confirm_no_po.
  grnNoPoPending: ["inventory:view", "goods_receipts:confirm_no_po"],
  // /backoffice/production/follow-up: penjaga halaman production_planning:view; tindak lanjutnya
  // menanyai pemasok, jadi izin lihat juga izin bertindak.
  productionStepsOverdue: ["production_planning:view"],
  productionStepsDueToday: ["production_planning:view"],
  // /backoffice/finance/integritas: ROUTE_PERMISSIONS journals:view; memposting (Sapu sekarang) = journals:manage.
  ledgerDocsWithoutJournal: ["journals:view", "journals:manage"],
  // /backoffice/finance/pajak: ROUTE_PERMISSIONS + penjaga halaman journals:view; mencatat setoran = journals:manage.
  taxDueSoon: ["journals:view", "journals:manage"],
  taxOverdue: ["journals:view", "journals:manage"],
  // /backoffice/finance/journals: penjaga halaman journals:view; menyetujui draf = journals:manage.
  manualJournalsPendingApproval: ["journals:view", "journals:manage"],
  // /backoffice/jubelio/harga: ROUTE_PERMISSIONS + penjaga halaman jubelio_prices:confirm, dan aksinya
  // (jubelio-harga.ts) memeriksa izin yang sama.
  jubelioPricesPending: ["jubelio_prices:confirm"],
  jubelioPricesDiffer: ["jubelio_prices:confirm"],
};

/** Saringan yang WAJIB ada di tautan tiap baris — angka Beranda dihitung dengan saringan ini. */
const SARINGAN: Record<KunciAntrean, Record<string, string>> = {
  leavePending: { status: "DIAJUKAN" },
  expensesPendingApproval: { status: "DIAJUKAN", bulan: "semua" },
  expensesPendingPayment: { status: "DISETUJUI", bulan: "semua" },
  exchangesPendingApproval: { status: "DIAJUKAN" },
  exchangesPendingCompletion: { status: "DISETUJUI" },
  transfersPendingApproval: { status: "DIAJUKAN" },
  transferShortfallsOpen: { selisih: "1" },
  stockLossOpen: { status: "TERBUKA" },
  klaimEkspedisiMenunggu: { status: "DITETAPKAN", klaim: "DIAJUKAN" },
  klaimEkspedisiCek: { status: "DITETAPKAN", klaim: "MENUNGGU_CEK" },
  klaimEkspedisiDitolak: { status: "DITETAPKAN", klaim: "DITOLAK" },
  spgReturnsPending: { status: "MENUNGGU" },
  spgReturnGoodsPending: { status: "KEPUTUSAN_BARANG" },
  storeProposalsPending: { status: "PENDING" },
  fieldPromisesUnconfirmed: { saring: "belum" },
  damagedDeliveriesOpen: { tab: "terbuka" },
  damagedWarehouseOpen: { tab: "saldo" },
  claimCorrectionsPending: { koreksi: "1" },
  returnCorrectionsPending: { koreksi: "1" },
  returnShortfallsUndecided: { langkah: "keputusan" },
  shiftSwapsPending: { tab: "tukar" },
  spgSchedulesPending: { tab: "bulanan" },
  spgAttendanceToEnter: { perlu: "masukkan" },
  spgAttendanceToCheck: { perlu: "periksa" },
  stockRequestsUnheld: { status: "BARU", pemegang: "tanpa" },
  spgCommissionsUnset: { bulan: "lalu" },
  // Jangkar #tunggakan, bukan saringan: kartunya tidak bergantung pada bulan yang dibuka.
  spgCommissionsUnpaidPast: {},
  // Jangkar #tunggakan juga: bagian ditahan kartu yang sama.
  spgSalariesUnset: {},
  // Jangkar #utang: kartu utang SPG tidak bergantung pada bulan yang dibuka.
  spgDebtsOpen: {},
  spgDebtPaymentsToCheck: {},
  receiptsWithoutInvoice: { status: "belum" },
  invoiceRequestsOverdue: { tab: "permintaan", status: "terlambat" },
  vendorBillPriceDifferences: { status: "MENUNGGU" },
  grnNoPoPending: { tab: "grn", konfirmasi: "menunggu" },
  productionStepsOverdue: { saring: "terlambat" },
  productionStepsDueToday: { saring: "hari-ini" },
  ledgerDocsWithoutJournal: { tanpaJurnal: "diam" },
  taxDueSoon: { saring: "segera" },
  taxOverdue: { saring: "lewat" },
  manualJournalsPendingApproval: { status: "draf" },
  // Daftar tanpa saringan = semua yang menunggu konfirmasi, persis hitungannya.
  jubelioPricesPending: {},
  jubelioPricesDiffer: { jenis: "BEDA" },
};

const nol: BuildActionItemsInput = {
  fieldSalesPendingApproval: 0,
  storeChangesPending: 0,
  taxInvoicePending: 0,
  salesReturnPending: 0,
  journalPending: 0,
  overduePOs: 0,
  draftPOs: 0,
  oversoldSkus: 0,
  unshippedOrders: 0,
};

describe("ANTREAN_KANTOR — tautan membawa saringannya", () => {
  for (const kunci of KUNCI_ANTREAN) {
    it(`${kunci}`, () => {
      const url = new URL(ANTREAN_KANTOR[kunci].href, "http://x");
      expect(url.pathname.startsWith("/backoffice/")).toBe(true);
      expect(Object.fromEntries(url.searchParams)).toEqual(SARINGAN[kunci]);
    });
  }
});

describe("ANTREAN_KANTOR — pagar: membuka halaman DAN bisa memutuskan", () => {
  for (const kunci of KUNCI_ANTREAN) {
    const terkecil = IZIN_TERKECIL[kunci];

    it(`${kunci}: tampil untuk himpunan izin terkecilnya dan untuk admin`, () => {
      expect(bolehLihatAntrean(kunci, ["dashboard:view", ...terkecil])).toBe(true);
      expect(bolehLihatAntrean(kunci, ["*"])).toBe(true);
    });

    it(`${kunci}: hilang begitu satu izin dari himpunan terkecilnya dicabut`, () => {
      for (const cabut of terkecil) {
        expect(bolehLihatAntrean(kunci, ["dashboard:view", ...terkecil.filter((p) => p !== cabut)])).toBe(false);
      }
      expect(bolehLihatAntrean(kunci, ["dashboard:view"])).toBe(false);
    });

    it(`${kunci}: yang lolos pagar selalu lolos ROUTE_PERMISSIONS halamannya`, () => {
      const rute = getRequiredPermission(jalurTautan(ANTREAN_KANTOR[kunci].href));
      if (rute) expect(hasPermission(terkecil, rute)).toBe(true);
    });
  }
});

/*
 * Keputusan manager yang dipisah dari izin lama (pemilik 2026-11-01): izin lama
 * itu sendiri tidak lagi bisa memutuskan, jadi barisnya tidak boleh tampil
 * untuknya — baris yang tidak bisa ditindaklanjuti hanya bising.
 */
describe("ANTREAN_KANTOR — izin lama tidak lagi cukup untuk keputusan manager", () => {
  it("mutasi antar toko: field_sales_orders:approve tidak lagi menyetujui atau memutuskan selisih", () => {
    const lama = ["dashboard:view", "spg_sales:view", "field_sales_orders:approve"];
    expect(bolehLihatAntrean("transfersPendingApproval", lama)).toBe(false);
    expect(bolehLihatAntrean("transferShortfallsOpen", lama)).toBe(false);
  });

  it("menyetujui mutasi dan memutuskan selisihnya dua izin terpisah", () => {
    const setuju = ["dashboard:view", "spg_sales:view", "store_transfers:approve"];
    const selisih = ["dashboard:view", "spg_sales:view", "store_transfers:decide_shortfall"];
    expect(bolehLihatAntrean("transfersPendingApproval", setuju)).toBe(true);
    expect(bolehLihatAntrean("transferShortfallsOpen", setuju)).toBe(false);
    expect(bolehLihatAntrean("transferShortfallsOpen", selisih)).toBe(true);
    expect(bolehLihatAntrean("transfersPendingApproval", selisih)).toBe(false);
  });

  it("barang hilang: receivables:manage membuka halamannya tetapi tidak lagi menetapkan penanggung", () => {
    expect(bolehLihatAntrean("stockLossOpen", ["dashboard:view", "receivables:manage"])).toBe(false);
    expect(bolehLihatAntrean("stockLossOpen", ["dashboard:view", "receivables:manage", "receivables:decide_bearer"])).toBe(true);
    // Pengawas SPG membuka halamannya, tetapi tidak menetapkan penanggung.
    expect(bolehLihatAntrean("stockLossOpen", ["dashboard:view", "spg_sales:view"])).toBe(false);
  });

  it("koreksi BKM: journals:manage tidak lagi memeriksa pembayaran", () => {
    expect(bolehLihatAntrean("claimCorrectionsPending", ["dashboard:view", "journals:manage"])).toBe(false);
  });
});

/*
 * Tiga baris keputusan pemilik 2026-11-02. Masing-masing memakai kode yang SAMA dengan tombol dan
 * aksi servernya — membuka halamannya saja tidak cukup.
 */
describe("ANTREAN_KANTOR — baris keputusan pemilik 2026-11-02", () => {
  it("retur pembeli SPG: pengawas SPG membuka daftarnya, tetapi barisnya hanya untuk yang bisa menyetujui", () => {
    expect(bolehLihatAntrean("spgReturnsPending", ["dashboard:view", "spg_sales:view"])).toBe(false);
    expect(bolehLihatAntrean("spgReturnsPending", ["dashboard:view", "spg_returns:approve"])).toBe(false);
    expect(bolehLihatAntrean("spgReturnsPending", ["dashboard:view", "spg_sales:view", "spg_returns:approve"])).toBe(true);
    // Mencatat penjualan SPG (izin HP SPG) bukan izin memutuskan retur.
    expect(bolehLihatAntrean("spgReturnsPending", ["dashboard:view", "spg_sales:view", "spg_sales:record"])).toBe(false);
  });

  it("komisi SPG tertunggak: mengelola piutang (cek & tetapkan) tidak membayar", () => {
    expect(bolehLihatAntrean("spgCommissionsUnpaidPast", ["dashboard:view", "spg_sales:view", "receivables:manage"])).toBe(false);
    expect(bolehLihatAntrean("spgCommissionsUnpaidPast", ["dashboard:view", "spg_sales:view", "spg_commission:pay"])).toBe(true);
  });

  it("harga Jubelio: izin Pengaturan Jubelio (lihat maupun kelola) tidak mengonfirmasi harga", () => {
    const pengaturan = ["dashboard:view", "settings_security:view", "settings_security:manage", "jubelio_admin:view"];
    expect(bolehLihatAntrean("jubelioPricesPending", pengaturan)).toBe(false);
    expect(bolehLihatAntrean("jubelioPricesPending", ["dashboard:view", "jubelio_prices:confirm"])).toBe(true);
  });

  it("jangkar di tautan tidak ikut jalur halaman", () => {
    expect(jalurTautan(ANTREAN_KANTOR.spgCommissionsUnpaidPast.href)).toBe("/backoffice/komisi-spg");
    expect(jalurTautan("/backoffice/retur-spg?status=MENUNGGU#atas")).toBe("/backoffice/retur-spg");
  });
});

/*
 * Baris jawaban pemilik 2026-11-02 (putaran kedua). Kode yang memutuskan baris = kode tombol dan
 * aksinya; membuka halamannya saja tidak cukup, dan kode yang dipisah tidak lagi saling mewakili.
 */
describe("ANTREAN_KANTOR — baris jawaban pemilik 2026-11-02 (putaran kedua)", () => {
  it("klaim ekspedisi: KEUANGAN (payments:verify saja) tidak mendapat baris yang memantul (P28)", () => {
    expect(bolehLihatAntrean("klaimEkspedisiCek", ["dashboard:view", "payments:verify"])).toBe(false);
    expect(bolehLihatAntrean("klaimEkspedisiCek", ["dashboard:view", "receivables:manage", "payments:verify"])).toBe(true);
    // Mencatat jawaban ekspedisi bukan memeriksa uangnya, dan sebaliknya.
    expect(bolehLihatAntrean("klaimEkspedisiCek", ["dashboard:view", "receivables:manage"])).toBe(false);
    expect(bolehLihatAntrean("klaimEkspedisiMenunggu", ["dashboard:view", "receivables:decide_bearer"])).toBe(false);
    expect(bolehLihatAntrean("klaimEkspedisiDitolak", ["dashboard:view", "receivables:manage"])).toBe(false);
  });

  it("selisih retur: receivables:decide_bearer (barang hilang) tidak memutuskan selisih retur (P22)", () => {
    const bacaPiutang = ["dashboard:view", "receivables:view"];
    expect(bolehLihatAntrean("returnShortfallsUndecided", [...bacaPiutang, "receivables:decide_bearer"])).toBe(false);
    expect(bolehLihatAntrean("returnShortfallsUndecided", [...bacaPiutang, "receivables:manage"])).toBe(false);
    expect(bolehLihatAntrean("returnShortfallsUndecided", [...bacaPiutang, "store_returns:decide_shortfall"])).toBe(true);
    expect(bolehLihatAntrean("stockLossOpen", ["dashboard:view", "store_returns:decide_shortfall"])).toBe(false);
  });

  it("komisi SPG: KEUANGAN (spg_commission:pay) membuka halamannya tanpa spg_sales:view (P28)", () => {
    const keuangan = ["dashboard:view", "spg_commission:pay", "payments:verify"];
    expect(bolehLihatAntrean("spgCommissionsUnpaidPast", keuangan)).toBe(true);
    expect(bolehLihatAntrean("spgDebtsOpen", keuangan)).toBe(true);
    expect(bolehLihatAntrean("spgDebtPaymentsToCheck", keuangan)).toBe(true);
    // Menetapkan komisi tetap receivables:manage.
    expect(bolehLihatAntrean("spgCommissionsUnset", keuangan)).toBe(false);
    // Mengatur gaji pokok bukan izin membayar.
    expect(bolehLihatAntrean("spgSalariesUnset", keuangan)).toBe(false);
  });

  it("gaji pokok SPG belum diatur: membayar tidak mengatur gaji, mengatur gaji tidak membuka halamannya sendiri", () => {
    expect(bolehLihatAntrean("spgSalariesUnset", ["dashboard:view", "spg_sales:view", "spg_commission:pay"])).toBe(false);
    expect(bolehLihatAntrean("spgSalariesUnset", ["dashboard:view", "spg_commission:manage"])).toBe(false);
    expect(bolehLihatAntrean("spgSalariesUnset", ["dashboard:view", "spg_commission:pay", "spg_commission:manage"])).toBe(true);
    expect(jalurTautan(ANTREAN_KANTOR.spgSalariesUnset.href)).toBe("/backoffice/komisi-spg");
  });

  it("pemeriksa pembayaran saja melihat kartu #utang, tetapi tidak mencatat utangnya", () => {
    expect(bolehLihatAntrean("spgDebtPaymentsToCheck", ["dashboard:view", "payments:verify"])).toBe(true);
    expect(bolehLihatAntrean("spgDebtsOpen", ["dashboard:view", "payments:verify"])).toBe(false);
  });

  it("catatan check-in toko: mencatat dan memeriksa dua izin; pengawas SPG hanya membaca", () => {
    expect(bolehLihatAntrean("spgAttendanceToEnter", ["dashboard:view", "spg_attendance:verify"])).toBe(false);
    expect(bolehLihatAntrean("spgAttendanceToCheck", ["dashboard:view", "spg_attendance:record"])).toBe(false);
    expect(bolehLihatAntrean("spgAttendanceToEnter", ["dashboard:view", "spg_sales:view"])).toBe(false);
  });

  it("jadwal bulanan SPG: mengubah jadwal (stores:manage) tidak menyetujui", () => {
    expect(bolehLihatAntrean("spgSchedulesPending", ["dashboard:view", "spg_sales:view", "stores:manage"])).toBe(false);
  });

  it("pembelian: melihat Vendor Billing tidak memutuskan selisih harga; inventory:manage tidak mengonfirmasi GRN tanpa PO", () => {
    expect(bolehLihatAntrean("vendorBillPriceDifferences", ["dashboard:view", "vendor_bills:view", "vendor_bills:manage"])).toBe(false);
    expect(bolehLihatAntrean("grnNoPoPending", ["dashboard:view", "inventory:view", "inventory:manage"])).toBe(false);
  });

  it("barang retur pembeli SPG: pengawas SPG saja tidak memutuskan barangnya", () => {
    expect(bolehLihatAntrean("spgReturnGoodsPending", ["dashboard:view", "spg_sales:view"])).toBe(false);
  });

  it("harga beda di Jubelio: izin Pengaturan Jubelio tidak mengirim ulang harga", () => {
    expect(bolehLihatAntrean("jubelioPricesDiffer", ["dashboard:view", "settings_security:manage", "jubelio_admin:view"])).toBe(false);
  });
});

describe("buildActionItems — baris antrean kantor", () => {
  const semua = Object.fromEntries(KUNCI_ANTREAN.map((k, i) => [k, i + 1]));

  it("dengan izin admin: setiap antrean bernilai jadi satu baris, membawa tautan dan angkanya", () => {
    const items = buildActionItems({ ...nol, antrean: semua }, ["*"]);
    for (const [i, kunci] of KUNCI_ANTREAN.entries()) {
      expect(items.find((x) => x.key === kunci)).toMatchObject({
        count: i + 1,
        href: ANTREAN_KANTOR[kunci].href,
        labelKey: kunci,
        tone: "waiting",
      });
    }
  });

  it("baris nol dibuang", () => {
    const items = buildActionItems({ ...nol, antrean: { leavePending: 0, stockLossOpen: 2 } }, ["*"]);
    expect(items.map((x) => x.key)).toEqual(["stockLossOpen"]);
  });

  it("disaring per izin: gudang hanya melihat antrean gudang", () => {
    const gudang = ["dashboard:view", "inventory:view", "inventory:manage"];
    const items = buildActionItems({ ...nol, antrean: semua }, gudang);
    expect(items.map((x) => x.key).sort()).toEqual([
      "damagedDeliveriesOpen",
      "damagedWarehouseOpen",
      "exchangesPendingCompletion",
    ]);
  });

  it("tanpa izin penonton baris antrean tidak pernah ikut, walau datanya dioper", () => {
    const items = buildActionItems({ ...nol, antrean: semua });
    expect(items.some((x) => (KUNCI_ANTREAN as readonly string[]).includes(x.key))).toBe(false);
  });
});

/*
 * Baris lama juga: angka Beranda = baris yang tampil saat tautannya dibuka.
 * Dua baris belum bisa memenuhinya tanpa mengubah berkas di luar Beranda —
 * dicatat dengan alasannya, supaya baris baru tanpa saringan tidak lolos diam-diam.
 */
const TANPA_SARINGAN: Record<string, string> = {
  // Belum ada halaman yang mendaftar jurnal yang GAGAL diposting.
  journalPending: "daftar jurnal tertunda belum ada",
  // Antrean pemenuhan menyaring fulfillmentStatus, bukan status pesanan.
  unshippedOrders: "antrean pemenuhan belum bisa disaring per status pesanan",
  // Bukan baris tanpa saringan: daftarnya TANPA saringan sudah tepat yang dihitung
  // (`hitungHargaMenungguKonfirmasi` = `daftarHargaMenunggu` tanpa `jenis`/`cari`).
  jubelioPricesPending: "daftar konfirmasi harga tanpa saringan = seluruh hitungannya",
  // Kartu #tunggakan dihitung dari hari ini, bukan dari bulan yang dibuka; tautannya membawa jangkar.
  spgCommissionsUnpaidPast: "kartu tunggakan tidak bergantung pada saringan bulan; tautannya berjangkar #tunggakan",
  spgSalariesUnset: "bagian ditahan kartu tunggakan tidak bergantung pada saringan bulan; tautannya berjangkar #tunggakan",
  // Kartu #utang dihitung dari hari ini, bukan dari bulan yang dibuka.
  spgDebtsOpen: "kartu utang SPG tidak bergantung pada saringan bulan; tautannya berjangkar #utang",
  spgDebtPaymentsToCheck: "kartu utang SPG tidak bergantung pada saringan bulan; tautannya berjangkar #utang",
};

describe("buildActionItems — setiap baris membawa saringan halaman tujuannya", () => {
  it("semua baris (lama dan baru) memakai saringan URL, kecuali yang tercatat", () => {
    const satu = Object.fromEntries(KUNCI_ANTREAN.map((k) => [k, 1]));
    const items = buildActionItems(
      {
        fieldSalesPendingApproval: 1,
        storeChangesPending: 1,
        taxInvoicePending: 1,
        salesReturnPending: 1,
        journalPending: 1,
        overduePOs: 1,
        draftPOs: 1,
        oversoldSkus: 1,
        unshippedOrders: 1,
        overduePromises: { count: 1, amount: 1 },
        claimsAwaitingVerification: { count: 1, amount: 1 },
        antrean: satu,
      },
      ["*"],
    );
    expect(items.length).toBe(11 + KUNCI_ANTREAN.length);
    for (const item of items) {
      if (item.key in TANPA_SARINGAN) continue;
      expect(item.href, item.key).toContain("?");
    }
    const href = (k: string) => items.find((i) => i.key === k)?.href;
    expect(href("claimsAwaitingVerification")).toBe("/backoffice/pelunasan?status=DIKIRIM");
    expect(href("storeChangesPending")).toBe("/backoffice/stores?perubahan=menunggu");
  });
});
