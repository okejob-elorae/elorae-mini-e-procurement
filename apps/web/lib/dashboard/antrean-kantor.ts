import { prisma } from "@elorae/db";
import { getRequiredPermission, hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  bolehMelihatIzin,
  bolehMemutuskanIzin,
} from "@/lib/salesman/izin";
import { bolehMelihatBiaya, bolehMembayarBiaya, bolehMenyetujuiBiaya } from "@/lib/salesman/biaya";
import { bolehMelihatTukar, bolehMenyelesaikanTukar, bolehMenyetujuiTukar } from "@/lib/salesman/tukar-barang";
import {
  bolehMembacaPelunasan,
  bolehMembacaPiutang,
  bolehMembacaRetur,
  bolehMembukaKomisiSpg,
  bolehMengelola,
  bolehMemutuskanBeban,
  bolehMemutuskanSelisihRetur,
  bolehMemverifikasi,
} from "@/lib/receivables/izin";
import { bolehMembukaCatatanHadir } from "@/lib/spg/absen-catatan-hadir";
import { JEJAK } from "@/lib/receivables/jejak";
import { koreksiTertunda } from "@/lib/receivables/koreksi";

/*
 * Antrean kantor di daftar "perlu ditindaklanjuti" Beranda: pekerjaan yang
 * menunggu keputusan kantor di modul lapangan, SPG, dan piutang.
 *
 * Setiap baris memegang tiga hal yang harus SAMA dengan halaman tujuannya:
 *  - tautan yang membawa saringannya, sehingga angka di Beranda = jumlah baris
 *    yang tampil begitu tautannya dibuka;
 *  - pagar halaman tujuan (penjaga `page.tsx`-nya, ditambah `ROUTE_PERMISSIONS`
 *    lewat `getRequiredPermission`);
 *  - izin yang memutuskan antreannya (aksi servernya) — baris yang tidak bisa
 *    ditindaklanjuti penontonnya hanya bising.
 *
 * Hitungannya hanya dijalankan untuk baris yang lolos pagar (`getAntreanKantor`).
 */

export const KUNCI_ANTREAN = [
  "leavePending",
  "expensesPendingApproval",
  "expensesPendingPayment",
  "exchangesPendingApproval",
  "exchangesPendingCompletion",
  "transfersPendingApproval",
  "transferShortfallsOpen",
  "stockLossOpen",
  "klaimEkspedisiMenunggu",
  "klaimEkspedisiCek",
  "klaimEkspedisiDitolak",
  "spgReturnsPending",
  "spgReturnGoodsPending",
  "storeProposalsPending",
  "fieldPromisesUnconfirmed",
  "damagedDeliveriesOpen",
  "damagedWarehouseOpen",
  "claimCorrectionsPending",
  "returnCorrectionsPending",
  "returnShortfallsUndecided",
  "shiftSwapsPending",
  "spgSchedulesPending",
  "spgAttendanceToEnter",
  "spgAttendanceToCheck",
  "stockRequestsUnheld",
  "spgCommissionsUnset",
  "spgCommissionsUnpaidPast",
  "spgSalariesUnset",
  "spgDebtsOpen",
  "spgDebtPaymentsToCheck",
  "receiptsWithoutInvoice",
  "invoiceRequestsOverdue",
  "vendorBillPriceDifferences",
  "grnNoPoPending",
  "productionStepsOverdue",
  "productionStepsDueToday",
  "ledgerDocsWithoutJournal",
  "taxDueSoon",
  "taxOverdue",
  "manualJournalsPendingApproval",
  "jubelioPricesPending",
  "jubelioPricesDiffer",
] as const;

export type KunciAntrean = (typeof KUNCI_ANTREAN)[number];

type Pagar = (izin: string[]) => boolean;

export type DefinisiAntrean = {
  /** Halaman tujuan BERSAMA saringannya. */
  href: string;
  /** Penjaga halaman tujuan (selain `ROUTE_PERMISSIONS`). */
  bolehBuka: Pagar;
  /** Izin yang memutuskan/menyelesaikan antrean ini. */
  bolehBertindak: Pagar;
};

const izinTunggal = (kode: string): Pagar => (izin) => hasPermission(izin, kode);
const spgView = izinTunggal(PERMISSIONS.SPG_SALES_VIEW);
const storesManage = izinTunggal(PERMISSIONS.STORES_MANAGE);
const transfersApprove = izinTunggal(PERMISSIONS.STORE_TRANSFERS_APPROVE);
const transfersDecideShortfall = izinTunggal(PERMISSIONS.STORE_TRANSFERS_DECIDE_SHORTFALL);
const inventoryManage = izinTunggal(PERMISSIONS.INVENTORY_MANAGE);
const receivablesManage = izinTunggal(PERMISSIONS.RECEIVABLES_MANAGE);
const productionView = izinTunggal(PERMISSIONS.PRODUCTION_PLANNING_VIEW);
const vendorBillsView = izinTunggal(PERMISSIONS.VENDOR_BILLS_VIEW);
const vendorBillsManage = izinTunggal(PERMISSIONS.VENDOR_BILLS_MANAGE);
const jubelioPricesConfirm = izinTunggal(PERMISSIONS.JUBELIO_PRICES_CONFIRM);
/** Pagar `barang-hilang/page.tsx` dan `[id]/page.tsx` — juga menu "Barang hilang". */
const bukaBarangHilang: Pagar = (izin) => bolehMengelola(izin) || bolehMemutuskanBeban(izin) || spgView(izin);
/**
 * Pagar `komisi-spg/page.tsx`: halaman penuh untuk `bolehMembukaKomisiSpg`; pemegang
 * `payments:verify` saja hanya melihat kartu #utang (memeriksa penerimaan utang SPG, keputusan 11).
 */
const bukaUtangSpg: Pagar = (izin) => bolehMembukaKomisiSpg(izin) || bolehMemverifikasi(izin);

export const ANTREAN_KANTOR: Readonly<Record<KunciAntrean, DefinisiAntrean>> = {
  // Izin, sakit & cuti tim lapangan (LeaveRequest DIAJUKAN), semua bulan.
  leavePending: {
    href: "/backoffice/izin?status=DIAJUKAN",
    bolehBuka: bolehMelihatIzin,
    bolehBertindak: bolehMemutuskanIzin,
  },
  // Biaya perjalanan: atasan memutuskan, lalu keuangan membayar.
  expensesPendingApproval: {
    href: "/backoffice/biaya-perjalanan?status=DIAJUKAN&bulan=semua",
    bolehBuka: bolehMelihatBiaya,
    bolehBertindak: bolehMenyetujuiBiaya,
  },
  expensesPendingPayment: {
    href: "/backoffice/biaya-perjalanan?status=DISETUJUI&bulan=semua",
    bolehBuka: bolehMelihatBiaya,
    bolehBertindak: bolehMembayarBiaya,
  },
  // Tukar barang: penjualan menyetujui, gudang menyelesaikan (stok bergerak).
  exchangesPendingApproval: {
    href: "/backoffice/tukar-barang?status=DIAJUKAN",
    bolehBuka: bolehMelihatTukar,
    bolehBertindak: bolehMenyetujuiTukar,
  },
  exchangesPendingCompletion: {
    href: "/backoffice/tukar-barang?status=DISETUJUI",
    bolehBuka: bolehMelihatTukar,
    bolehBertindak: bolehMenyelesaikanTukar,
  },
  // Mutasi antar toko: menyetujui = store_transfers:approve, memutuskan selisih =
  // store_transfers:decide_shortfall — keputusan manager (pemilik 2026-11-01),
  // dulu menumpang field_sales_orders:approve (`app/actions/spg-mutasi.ts`).
  transfersPendingApproval: {
    href: "/backoffice/spg-transfers?status=DIAJUKAN",
    bolehBuka: spgView,
    bolehBertindak: transfersApprove,
  },
  transferShortfallsOpen: {
    href: "/backoffice/spg-transfers?selisih=1",
    bolehBuka: spgView,
    bolehBertindak: transfersDecideShortfall,
  },
  // Barang hilang yang belum ditetapkan penanggungnya. Menetapkannya =
  // receivables:decide_bearer (`bolehMemutuskanBeban`, keputusan manager);
  // receivables:manage tetap mencatat, tapi tidak lagi memutuskan bebannya.
  // Halamannya terbuka untuk receivables:manage, receivables:decide_bearer, dan
  // spg_sales:view (pagar `barang-hilang/page.tsx` dan menunya), jadi pemegang
  // izin keputusan saja — penerima kabar STOCK_LOSS_OPEN — tetap mendapat barisnya.
  stockLossOpen: {
    href: "/backoffice/barang-hilang?status=TERBUKA",
    bolehBuka: bukaBarangHilang,
    bolehBertindak: bolehMemutuskanBeban,
  },
  // Klaim ekspedisi atas barang hilang di perjalanan yang penanggungnya Ekspedisi (R31, jawaban
  // pemilik 2026-11-02). Tiga giliran, masing-masing izin aksinya sendiri (`app/actions/barang-hilang.ts`):
  //  - DIAJUKAN: mencatat bayar atau tolak dari ekspedisi = receivables:manage;
  //  - MENUNGGU_CEK: periksa sah / kembalikan = payments:verify (keputusan 11 — yang mencatat tidak
  //    memeriksa catatannya sendiri; barisnya tetap tampil untuknya, aksinya yang menolak);
  //  - DITOLAK: tetapkan penanggung lain = receivables:decide_bearer.
  // Halamannya tetap pagar barang hilang (`bukaBarangHilang`): P28 "Keuangan hanya halaman Komisi
  // SPG", jadi KEUANGAN yang hanya memegang payments:verify tidak mendapat baris yang memantul.
  // Tautan membawa `status=DITETAPKAN` juga: hitungannya (`jumlahKlaimEkspedisi`) hanya membaca
  // catatan yang sudah ditetapkan, jadi angka Beranda = baris yang tampil.
  klaimEkspedisiMenunggu: {
    href: "/backoffice/barang-hilang?status=DITETAPKAN&klaim=DIAJUKAN",
    bolehBuka: bukaBarangHilang,
    bolehBertindak: bolehMengelola,
  },
  klaimEkspedisiCek: {
    href: "/backoffice/barang-hilang?status=DITETAPKAN&klaim=MENUNGGU_CEK",
    bolehBuka: bukaBarangHilang,
    bolehBertindak: bolehMemverifikasi,
  },
  klaimEkspedisiDitolak: {
    href: "/backoffice/barang-hilang?status=DITETAPKAN&klaim=DITOLAK",
    bolehBuka: bukaBarangHilang,
    bolehBertindak: bolehMemutuskanBeban,
  },
  // Retur pembeli yang dilaporkan SPG dan menunggu keputusan kantor (keputusan pemilik
  // 2026-11-02): pengawas SPG membuka daftarnya, menyetujui dan menolak =
  // spg_returns:approve (`app/actions/spg-retur.ts`). Daftarnya membaca `?status=MENUNGGU`.
  spgReturnsPending: {
    href: "/backoffice/retur-spg?status=MENUNGGU",
    bolehBuka: spgView,
    bolehBertindak: izinTunggal(PERMISSIONS.SPG_RETURNS_APPROVE),
  },
  // Retur pembeli yang ditolak sesudah uangnya dikembalikan: beban SPG-nya sudah lunas dan barangnya
  // menunggu keputusan (kembali ke stok atau dibeli SPG). Membuka = pengawas SPG, memutuskan =
  // spg_returns:approve (`putuskanBarangReturPembeliAction`). Satu definisi dengan tab
  // `KEPUTUSAN_BARANG` (`jumlahBebanPerluKeputusanBarang`).
  spgReturnGoodsPending: {
    href: "/backoffice/retur-spg?status=KEPUTUSAN_BARANG",
    bolehBuka: spgView,
    bolehBertindak: izinTunggal(PERMISSIONS.SPG_RETURNS_APPROVE),
  },
  // Usulan toko baru dari lapangan.
  storeProposalsPending: {
    href: "/backoffice/stores/usulan?status=PENDING",
    bolehBuka: izinTunggal(PERMISSIONS.STORES_VIEW),
    bolehBertindak: storesManage,
  },
  // Janji bayar dari lapangan yang fotonya belum dicocokkan kantor.
  fieldPromisesUnconfirmed: {
    href: "/backoffice/kontrabon?saring=belum",
    bolehBuka: bolehMembacaPiutang,
    bolehBertindak: bolehMengelola,
  },
  // Barang rusak yang dicatat SPG saat menerima kiriman — gudang memutuskan.
  damagedDeliveriesOpen: {
    href: "/backoffice/spg-kiriman-rusak?tab=terbuka",
    bolehBuka: (izin) => inventoryManage(izin) || spgView(izin),
    bolehBertindak: inventoryManage,
  },
  // Gudang barang rusak: setiap barang × varian yang masih bersaldo menunggu keputusan.
  damagedWarehouseOpen: {
    href: "/backoffice/gudang-rusak?tab=saldo",
    bolehBuka: izinTunggal(PERMISSIONS.INVENTORY_VIEW),
    bolehBertindak: inventoryManage,
  },
  // Permintaan koreksi dari sales: BKM diputuskan keuangan, nota retur oleh pengelola piutang.
  claimCorrectionsPending: {
    href: "/backoffice/pelunasan?koreksi=1",
    bolehBuka: bolehMembacaPelunasan,
    bolehBertindak: bolehMemverifikasi,
  },
  returnCorrectionsPending: {
    href: "/backoffice/retur-toko?koreksi=1",
    bolehBuka: bolehMembacaRetur,
    bolehBertindak: bolehMengelola,
  },
  // Selisih retur toko yang penanggungnya belum diputuskan. Memutuskan = store_returns:decide_shortfall
  // (registri izin 2026-11-02 menjawab P22: barang hilang dan selisih retur dua keputusan terpisah),
  // izin yang sama dengan tombol, aksi, dan lonceng RETUR_SELISIH.
  returnShortfallsUndecided: {
    href: "/backoffice/retur-toko?langkah=keputusan",
    bolehBuka: bolehMembacaRetur,
    bolehBertindak: bolehMemutuskanSelisihRetur,
  },
  // Tukar shift SPG yang sudah disetujui rekannya.
  shiftSwapsPending: {
    href: "/backoffice/jadwal-spg?tab=tukar",
    bolehBuka: spgView,
    bolehBertindak: storesManage,
  },
  // Jadwal bulanan yang diajukan SPG (P7c) — dasar gaji pokoknya. Menyetujui = spg_schedules:approve.
  spgSchedulesPending: {
    href: "/backoffice/jadwal-spg?tab=bulanan",
    bolehBuka: spgView,
    bolehBertindak: izinTunggal(PERMISSIONS.SPG_SCHEDULES_APPROVE),
  },
  // Catatan check-in toko (P7d/P7e/P61a): kantor diingatkan memasukkannya bila SPG tidak mengisi
  // jadwalnya (mencatat = spg_attendance:record), lalu Admin Keuangan memeriksanya
  // (spg_attendance:verify). Halamannya memagari dirinya sendiri (`bolehMembukaCatatanHadir`).
  spgAttendanceToEnter: {
    href: "/backoffice/komisi-spg/catatan-hadir?perlu=masukkan",
    bolehBuka: bolehMembukaCatatanHadir,
    bolehBertindak: izinTunggal(PERMISSIONS.SPG_ATTENDANCE_RECORD),
  },
  spgAttendanceToCheck: {
    href: "/backoffice/komisi-spg/catatan-hadir?perlu=periksa",
    bolehBuka: bolehMembukaCatatanHadir,
    bolehBertindak: izinTunggal(PERMISSIONS.SPG_ATTENDANCE_VERIFY),
  },
  // Permintaan stok SPG untuk toko yang tidak punya pemegang: tidak ada salesman
  // yang menerimanya di HP, jadi kantor yang menanganinya.
  stockRequestsUnheld: {
    href: "/backoffice/spg-requests?status=BARU&pemegang=tanpa",
    bolehBuka: spgView,
    bolehBertindak: storesManage,
  },
  // Komisi SPG toko putus bulan lalu yang belum ditetapkan — baris resminya
  // hanya terbentuk saat keuangan menekan "Tetapkan" per toko. `bulan=lalu`
  // tetap berarti bulan sebelum bulan berjalan, jadi tautannya tidak basi.
  // Halaman Komisi SPG memagari dirinya sendiri (`bolehMembukaKomisiSpg`, P28/Q9), bukan lewat
  // ROUTE_PERMISSIONS.
  spgCommissionsUnset: {
    href: "/backoffice/komisi-spg?bulan=lalu",
    bolehBuka: bolehMembukaKomisiSpg,
    bolehBertindak: receivablesManage,
  },
  // Komisi SPG yang bulan pembayarannya sudah lewat dan sudah boleh dibayar, tetapi belum ditandai
  // dibayar — satu definisi dengan bagian pertama kartu #tunggakan (`daftarTunggakanKomisi`);
  // baris yang ditahan (gaji pokok, jadwal, atau catatan check-in belum ada) tidak ikut — ia tampil
  // di baris tahannya sendiri.
  // Tanpa saringan URL: kartunya tidak bergantung pada bulan yang dibuka, jangkarnya yang membawa.
  // Membayar = spg_commission:pay (`tandaiKomisiSpgDibayarAction` di `app/actions/spg-komisi.ts`;
  // baris konsinyasi juga lewat `bayarKomisiAction` di `app/actions/konsinyasi.ts`).
  spgCommissionsUnpaidPast: {
    href: "/backoffice/komisi-spg#tunggakan",
    bolehBuka: bolehMembukaKomisiSpg,
    bolehBertindak: izinTunggal(PERMISSIONS.SPG_COMMISSION_PAY),
  },
  // Pembayaran yang DITAHAN karena gaji pokok bulanan SPG-nya belum diatur — satu definisi dengan
  // baris tahan `GAJI_POKOK_BELUM_DIATUR` di kartu #tunggakan (`daftarTunggakanKomisi`). Mengatur gaji
  // pokok = spg_commission:manage (`app/actions/settings/spg-commission.ts`). Tautannya ke kartu
  // #tunggakan, bukan ke Pengaturan: halaman gaji pokok di Pengaturan bukan anak menu (menu.test),
  // dan kartu itu menyebut SPG × bulan yang tertahan.
  spgSalariesUnset: {
    href: "/backoffice/komisi-spg#tunggakan",
    bolehBuka: bolehMembukaKomisiSpg,
    bolehBertindak: izinTunggal(PERMISSIONS.SPG_COMMISSION_MANAGE),
  },
  // Utang SPG yang sudah berhenti (pembayaran terakhir tidak menutup potongannya): terbuka, sisa
  // yang belum dicatat, atau tambahan sesudah pembayaran terakhir. Mencatat = spg_commission:pay.
  // Pembayaran utang yang dicatat menunggu cek mutasi bank oleh orang lain (keputusan 11) =
  // payments:verify — pemegangnya membuka kartu #utang saja (`bukaUtangSpg`).
  spgDebtsOpen: {
    href: "/backoffice/komisi-spg#utang",
    bolehBuka: bukaUtangSpg,
    bolehBertindak: izinTunggal(PERMISSIONS.SPG_COMMISSION_PAY),
  },
  spgDebtPaymentsToCheck: {
    href: "/backoffice/komisi-spg#utang",
    bolehBuka: bukaUtangSpg,
    bolehBertindak: bolehMemverifikasi,
  },
  // Pembelian (P19, P27, P51a). Halaman Vendor Billing = vendor_bills:view (ROUTE_PERMISSIONS);
  // meminta dan menindaklanjuti invoice = vendor_bills:manage; memutuskan selisih harga invoice =
  // vendor_bills:decide_price; mengonfirmasi GRN tanpa PO = goods_receipts:confirm_no_po.
  receiptsWithoutInvoice: {
    href: "/backoffice/vendor-bills/belum-ditagih?status=belum",
    bolehBuka: vendorBillsView,
    bolehBertindak: vendorBillsManage,
  },
  invoiceRequestsOverdue: {
    href: "/backoffice/vendor-bills/belum-ditagih?tab=permintaan&status=terlambat",
    bolehBuka: vendorBillsView,
    bolehBertindak: vendorBillsManage,
  },
  vendorBillPriceDifferences: {
    href: "/backoffice/vendor-bills/selisih-harga?status=MENUNGGU",
    bolehBuka: vendorBillsView,
    bolehBertindak: izinTunggal(PERMISSIONS.VENDOR_BILLS_DECIDE_PRICE),
  },
  grnNoPoPending: {
    href: "/backoffice/inventory?tab=grn&konfirmasi=menunggu",
    bolehBuka: izinTunggal(PERMISSIONS.INVENTORY_VIEW),
    bolehBertindak: izinTunggal(PERMISSIONS.GOODS_RECEIPTS_CONFIRM_NO_PO),
  },
  // Jadwal produksi per tahap: langkah yang belum selesai padahal targetnya
  // sudah lewat / jatuh hari ini. Tindak lanjutnya menanyai pemasok (WA dari
  // halaman follow-up), jadi izin lihat sudah cukup untuk bertindak.
  productionStepsOverdue: {
    href: "/backoffice/production/follow-up?saring=terlambat",
    bolehBuka: productionView,
    bolehBertindak: productionView,
  },
  productionStepsDueToday: {
    href: "/backoffice/production/follow-up?saring=hari-ini",
    bolehBuka: productionView,
    bolehBertindak: productionView,
  },
  // Dokumen sejak tanggal mulai buku besar yang belum berjurnal DAN tidak
  // tercatat gagal (yang tercatat gagal sudah di baris "Jurnal gagal"),
  // bertanggal sebelum hari ini — sapuan harian 02.30 belum bisa mempostingnya.
  ledgerDocsWithoutJournal: {
    href: "/backoffice/finance/integritas?tanpaJurnal=diam",
    bolehBuka: izinTunggal(PERMISSIONS.JOURNALS_VIEW),
    bolehBertindak: izinTunggal(PERMISSIONS.JOURNALS_MANAGE),
  },
  // Kalender pajak: setoran yang belum lunas dan jatuh tempo ≤ 3 hari / sudah
  // lewat. Mencatat setoran = keuangan (`journals:manage`).
  taxDueSoon: {
    href: "/backoffice/finance/pajak?saring=segera",
    bolehBuka: izinTunggal(PERMISSIONS.JOURNALS_VIEW),
    bolehBertindak: izinTunggal(PERMISSIONS.JOURNALS_MANAGE),
  },
  taxOverdue: {
    href: "/backoffice/finance/pajak?saring=lewat",
    bolehBuka: izinTunggal(PERMISSIONS.JOURNALS_VIEW),
    bolehBertindak: izinTunggal(PERMISSIONS.JOURNALS_MANAGE),
  },
  // Jurnal manual (dan pembalik) yang menunggu persetujuan orang lain —
  // menyetujui = `journals:manage` (lib/finance/jurnal-manual, maker-checker).
  manualJournalsPendingApproval: {
    href: "/backoffice/finance/journals?status=draf",
    bolehBuka: izinTunggal(PERMISSIONS.JOURNALS_VIEW),
    bolehBertindak: izinTunggal(PERMISSIONS.JOURNALS_MANAGE),
  },
  // Harga jual dan produk baru yang menunggu dikonfirmasi sebelum sampai ke Jubelio (keputusan
  // pemilik 2026-11-02). Satu definisi dengan daftar halamannya tanpa saringan
  // (`hitungHargaMenungguKonfirmasi` dan `daftarHargaMenunggu` berbagi satu fragmen SQL). Halaman,
  // tombol, dan aksinya memakai satu izin: jubelio_prices:confirm.
  jubelioPricesPending: {
    href: "/backoffice/jubelio/harga",
    bolehBuka: jubelioPricesConfirm,
    bolehBertindak: jubelioPricesConfirm,
  },
  // Harga di Jubelio yang berbeda dengan harga ERP terkonfirmasi (R27d, P1/P75): satu definisi
  // dengan daftar `?jenis=BEDA` (fragmen `sumberBeda` yang sama). Kirim ulang memakai izin yang sama.
  jubelioPricesDiffer: {
    href: "/backoffice/jubelio/harga?jenis=BEDA",
    bolehBuka: jubelioPricesConfirm,
    bolehBertindak: jubelioPricesConfirm,
  },
};

/** Jalur halaman tanpa saringan dan tanpa jangkar (`#…`) — kunci `ROUTE_PERMISSIONS`. */
export function jalurTautan(href: string): string {
  return href.split(/[?#]/)[0] ?? href;
}

/**
 * Pagar satu baris antrean: bisa membuka halamannya (proxy + penjaga halaman)
 * DAN bisa memutuskan isinya. Murni.
 */
export function bolehLihatAntrean(kunci: KunciAntrean, izin: string[]): boolean {
  const d = ANTREAN_KANTOR[kunci];
  const rute = getRequiredPermission(jalurTautan(d.href));
  return (!rute || hasPermission(izin, rute)) && d.bolehBuka(izin) && d.bolehBertindak(izin);
}

// ─── Saringan yang dipakai bersama hitungan dan halaman tujuan ────────────────

const ENTITAS_KOREKSI = { bkm: "PaymentClaim", retur: "StoreReturn" } as const;

/**
 * BKM / nota retur yang permintaan koreksinya belum ditangani kantor — satu
 * definisi (`koreksiTertunda`) untuk angka Beranda dan saringan `?koreksi=1`
 * di halaman Pelunasan dan Retur toko.
 */
export async function dokumenKoreksiTertunda(jenis: "bkm" | "retur"): Promise<Set<string>> {
  const permintaan = await prisma.auditLog.findMany({
    where: { action: JEJAK.KOREKSI_DIMINTA, entityType: ENTITAS_KOREKSI[jenis] },
    select: { entityId: true },
    distinct: ["entityId"],
  });
  const tertunda = await koreksiTertunda(
    jenis,
    permintaan.map((p) => p.entityId),
  );
  return new Set(tertunda.keys());
}

/** Toko yang belum punya pemegang — saringan `?pemegang=tanpa` di permintaan stok SPG. */
export async function idTokoTanpaPemegang(): Promise<Set<string>> {
  const rows = await prisma.store.findMany({ where: { salesmanId: null }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/** Toko yang perubahan datanya menunggu ditinjau — saringan `?perubahan=menunggu`. */
export async function idTokoPerubahanMenunggu(): Promise<string[]> {
  const rows = await prisma.storeChangeRequest.findMany({ where: { status: "PENDING" }, select: { storeId: true } });
  return [...new Set(rows.map((r) => r.storeId))];
}

/**
 * Saldo gudang barang rusak per barang × varian yang bukan nol — sama dengan
 * baris tab "Saldo" (`saldoGudangRusak`).
 */
export async function hitungGudangRusakBersaldo(): Promise<number> {
  const grup = await prisma.damagedStockMovement.groupBy({ by: ["itemId", "variantSku"], _sum: { qty: true } });
  return grup.filter((g) => (g._sum.qty ?? 0) !== 0).length;
}

/**
 * Barang yang tersedianya minus (Σ di tangan − Σ dipesan < 0, semua varian
 * dijumlah per barang) — persis baris yang tampil di Inventori dengan
 * `?oversold=1` (saringan NEGATIF `getInventorySnapshot`).
 */
export async function hitungBarangStokMinus(): Promise<number> {
  const grup = await prisma.inventoryValue.groupBy({
    by: ["itemId"],
    _sum: { qtyOnHand: true, reservedQty: true },
  });
  return grup.filter((g) => Number(g._sum.qtyOnHand ?? 0) - Number(g._sum.reservedQty ?? 0) < 0).length;
}

/**
 * Nota retur toko di langkah "keputusan" — persis baris `?langkah=keputusan` di Retur & pencocokan
 * (`daftarKerjaRetur` + `saringKerjaRetur`): gudang menghitung kurang dari klaim dan belum ada beban
 * yang diputuskan. Dihitung dari daftar kerjanya sendiri, bukan dari `ReturnCharge.status`, supaya
 * nota yang sebagian bebannya sudah diputuskan atau yang selisihnya tertutup barang susulan tidak
 * terhitung di Beranda padahal tidak tampil di daftarnya. Penerimaan gudang tanpa nota (yatim)
 * tidak pernah di langkah ini, jadi tidak dimuat.
 */
export async function hitungSelisihReturBelumDiputuskan(): Promise<number> {
  const { daftarKerjaRetur } = await import("@/lib/receivables/return-queries");
  const baris = await daftarKerjaRetur({ tanpaYatim: true });
  return baris.filter((b) => b.jenis === "NRT" && b.langkah === "keputusan").length;
}

const HITUNG_ANTREAN: Readonly<Record<KunciAntrean, () => Promise<number>>> = {
  leavePending: () => prisma.leaveRequest.count({ where: { status: "DIAJUKAN" } }),
  expensesPendingApproval: () => prisma.expenseClaim.count({ where: { status: "DIAJUKAN" } }),
  expensesPendingPayment: () => prisma.expenseClaim.count({ where: { status: "DISETUJUI" } }),
  exchangesPendingApproval: () => prisma.storeExchange.count({ where: { status: "DIAJUKAN" } }),
  exchangesPendingCompletion: () => prisma.storeExchange.count({ where: { status: "DISETUJUI" } }),
  transfersPendingApproval: () => prisma.storeTransfer.count({ where: { status: "DIAJUKAN" } }),
  transferShortfallsOpen: () => prisma.storeTransfer.count({ where: { selisihStatus: "TERBUKA" } }),
  stockLossOpen: () => prisma.stockLoss.count({ where: { status: "TERBUKA" } }),
  // Satu kueri klaim ekspedisi per baris — sama dengan saringan `?klaim=` daftar barang hilang.
  klaimEkspedisiMenunggu: async () => (await (await import("@/lib/spg/hilang-queries")).jumlahKlaimEkspedisi()).diajukan,
  klaimEkspedisiCek: async () => (await (await import("@/lib/spg/hilang-queries")).jumlahKlaimEkspedisi()).menungguCek,
  klaimEkspedisiDitolak: async () => (await (await import("@/lib/spg/hilang-queries")).jumlahKlaimEkspedisi()).ditolak,
  // Satu definisi dengan tab "Menunggu" retur pembeli SPG (`RETUR_PEMBELI_MENUNGGU`).
  spgReturnsPending: async () => (await import("@/lib/spg/retur-pembeli-queries")).jumlahReturPembeliMenunggu(),
  spgReturnGoodsPending: async () => (await import("@/lib/spg/beban-spg-queries")).jumlahBebanPerluKeputusanBarang(),
  // Hitungan milik modulnya sendiri, dimuat saat dipakai (rantai impornya berat).
  storeProposalsPending: async () => (await import("@/lib/stores/usulan-queries")).jumlahUsulanMenunggu(),
  // Sama dengan saringan "Belum dikonfirmasi" di Kontrabon: janji lapangan yang
  // masih berjalan dan belum dicocokkan.
  fieldPromisesUnconfirmed: () =>
    prisma.collectionNote.count({ where: { source: "FIELD", confirmedAt: null, status: "BERJALAN" } }),
  damagedDeliveriesOpen: () =>
    prisma.storeReceiptLine.count({ where: { qtyDamaged: { gt: 0 }, damageStatus: "TERBUKA" } }),
  damagedWarehouseOpen: hitungGudangRusakBersaldo,
  claimCorrectionsPending: async () => (await dokumenKoreksiTertunda("bkm")).size,
  returnCorrectionsPending: async () => (await dokumenKoreksiTertunda("retur")).size,
  returnShortfallsUndecided: hitungSelisihReturBelumDiputuskan,
  shiftSwapsPending: async () => (await import("@/lib/spg/shift-queries")).jumlahTukarMenungguKantor(),
  spgSchedulesPending: async () => (await import("@/lib/spg/jadwal-bulan-queries")).jumlahJadwalBulanMenunggu(),
  // Diturunkan dari tahan bayar yang berlaku sekarang (`pasanganPerluCatatan`), bukan dari lonceng.
  spgAttendanceToEnter: async () => (await import("@/lib/spg/absen-catatan-hadir-queries")).jumlahCatatanHadirPerluDimasukkan(),
  spgAttendanceToCheck: async () => (await import("@/lib/spg/absen-catatan-hadir-queries")).jumlahCatatanHadirMenungguPeriksa(),
  stockRequestsUnheld: () => prisma.stockRequest.count({ where: { status: "BARU", store: { salesmanId: null } } }),
  // Definisi yang sama dengan "belum ditetapkan" di halaman Komisi SPG.
  spgCommissionsUnset: async () => (await import("@/lib/spg/komisi-queries")).jumlahKomisiPutusBelumDitetapkan(),
  // Bagian pertama kartu #tunggakan Komisi SPG: baris yang boleh dibayar sekarang, di jendela koreksi.
  spgCommissionsUnpaidPast: async () => (await import("@/lib/spg/koreksi-queries")).jumlahKomisiSpgTertunggak(),
  // Bagian ditahan kartu #tunggakan yang alasannya gaji pokok belum diatur.
  spgSalariesUnset: async () => (await import("@/lib/spg/koreksi-queries")).jumlahGajiSpgBelumDiatur(),
  spgDebtsOpen: async () => (await import("@/lib/spg/utang-queries")).jumlahUtangSpgTerbuka(),
  spgDebtPaymentsToCheck: async () => (await import("@/lib/spg/utang-queries")).jumlahBayarUtangSpgMenungguCek(),
  // Satu definisi dengan saringan halaman tujuannya (`belum-ditagih`, `selisih-harga`).
  receiptsWithoutInvoice: async () => (await import("@/lib/vendor-billing/belum-ditagih-queries")).hitungPenerimaanBelumDiminta(),
  invoiceRequestsOverdue: async () => (await import("@/lib/vendor-billing/permintaan-invoice-queries")).hitungPermintaanInvoiceTerlambat(),
  vendorBillPriceDifferences: async () => (await import("@/lib/vendor-billing/koreksi-utang-queries")).hitungSelisihHargaMenunggu(),
  grnNoPoPending: async () => (await import("@/lib/grn/grn-tanpa-po-writer")).hitungGrnTanpaPoMenunggu(),
  // Satu definisi dengan tab "Terlambat"/"Hari ini" follow-up produksi (`whereFollowUp`).
  productionStepsOverdue: async () => (await import("@/lib/production/jadwal-queries")).hitungLangkahTelat(),
  productionStepsDueToday: async () => (await import("@/lib/production/jadwal-queries")).hitungLangkahHariIni(),
  // Satu definisi dengan saringan `?tanpaJurnal=diam` di Integritas buku besar.
  ledgerDocsWithoutJournal: async () => (await import("@/lib/finance/integritas/queries")).hitungDokumenTanpaJurnalDiam(),
  // Satu definisi dengan saringan `?saring=segera|lewat` kalender pajak (`cocokSaring`).
  taxDueSoon: async () => (await import("@/lib/finance/pajak/kalender-queries")).hitungKalenderPajak("segera"),
  taxOverdue: async () => (await import("@/lib/finance/pajak/kalender-queries")).hitungKalenderPajak("lewat"),
  // Satu definisi dengan tab "Menunggu persetujuan" halaman Jurnal (`?status=draf`).
  manualJournalsPendingApproval: async () => (await import("@/lib/finance/jurnal-manual/queries")).hitungDrafJurnal(),
  // Satu definisi dengan daftar Jubelio → Konfirmasi harga tanpa saringan.
  jubelioPricesPending: async () => (await import("@/lib/jubelio/harga/queries")).hitungHargaMenungguKonfirmasi(),
  // Satu definisi dengan daftar `?jenis=BEDA`.
  jubelioPricesDiffer: async () => (await import("@/lib/jubelio/harga/queries")).hitungHargaBedaDiJubelio(),
};

export type AngkaAntrean = Partial<Record<KunciAntrean, number>>;

/**
 * Hitungan antrean yang BOLEH dilihat penonton ini. Baris yang tersembunyi
 * tidak dihitung sama sekali — kuerinya tidak dijalankan.
 *
 * Satu hitungan yang gagal tidak menjatuhkan Beranda: kuncinya dibuang (baris
 * tanpa angka tidak tampil) dan galatnya dicatat. Beranda halaman pertama
 * semua orang; dua puluhan kueri lintas modul tidak boleh jadi dua puluhan
 * cara untuk membuatnya kosong.
 */
export async function getAntreanKantor(izin: string[]): Promise<AngkaAntrean> {
  const terlihat = KUNCI_ANTREAN.filter((k) => bolehLihatAntrean(k, izin));
  const angka = await Promise.all(
    terlihat.map((k) =>
      // `then`, bukan panggilan langsung: galat sinkron juga tertangkap.
      Promise.resolve().then(HITUNG_ANTREAN[k]).catch((err: unknown) => {
        console.error(`antrean kantor ${k} gagal dihitung:`, err);
        return null;
      }),
    ),
  );
  return Object.fromEntries(
    terlihat.flatMap((k, i) => (angka[i] === null ? [] : [[k, angka[i]]])),
  ) as AngkaAntrean;
}
