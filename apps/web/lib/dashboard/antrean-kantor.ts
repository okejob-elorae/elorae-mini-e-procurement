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
  bolehMengelola,
  bolehMemverifikasi,
} from "@/lib/receivables/izin";
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
  "storeProposalsPending",
  "fieldPromisesUnconfirmed",
  "damagedDeliveriesOpen",
  "damagedWarehouseOpen",
  "claimCorrectionsPending",
  "returnCorrectionsPending",
  "shiftSwapsPending",
  "stockRequestsUnheld",
  "spgCommissionsUnset",
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
const fsoApprove = izinTunggal(PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
const inventoryManage = izinTunggal(PERMISSIONS.INVENTORY_MANAGE);
const receivablesManage = izinTunggal(PERMISSIONS.RECEIVABLES_MANAGE);

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
  // Mutasi antar toko: menyetujui dan memutuskan selisih = field_sales_orders:approve.
  transfersPendingApproval: {
    href: "/backoffice/spg-transfers?status=DIAJUKAN",
    bolehBuka: spgView,
    bolehBertindak: fsoApprove,
  },
  transferShortfallsOpen: {
    href: "/backoffice/spg-transfers?selisih=1",
    bolehBuka: spgView,
    bolehBertindak: fsoApprove,
  },
  // Barang hilang yang belum ditetapkan penanggungnya.
  stockLossOpen: {
    href: "/backoffice/barang-hilang?status=TERBUKA",
    bolehBuka: (izin) => bolehMengelola(izin) || spgView(izin),
    bolehBertindak: bolehMengelola,
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
  // Tukar shift SPG yang sudah disetujui rekannya.
  shiftSwapsPending: {
    href: "/backoffice/jadwal-spg?tab=tukar",
    bolehBuka: spgView,
    bolehBertindak: storesManage,
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
  spgCommissionsUnset: {
    href: "/backoffice/komisi-spg?bulan=lalu",
    bolehBuka: spgView,
    bolehBertindak: receivablesManage,
  },
};

/** Jalur halaman tanpa saringan — kunci `ROUTE_PERMISSIONS`. */
export function jalurTautan(href: string): string {
  return href.split("?")[0] ?? href;
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

const HITUNG_ANTREAN: Readonly<Record<KunciAntrean, () => Promise<number>>> = {
  leavePending: () => prisma.leaveRequest.count({ where: { status: "DIAJUKAN" } }),
  expensesPendingApproval: () => prisma.expenseClaim.count({ where: { status: "DIAJUKAN" } }),
  expensesPendingPayment: () => prisma.expenseClaim.count({ where: { status: "DISETUJUI" } }),
  exchangesPendingApproval: () => prisma.storeExchange.count({ where: { status: "DIAJUKAN" } }),
  exchangesPendingCompletion: () => prisma.storeExchange.count({ where: { status: "DISETUJUI" } }),
  transfersPendingApproval: () => prisma.storeTransfer.count({ where: { status: "DIAJUKAN" } }),
  transferShortfallsOpen: () => prisma.storeTransfer.count({ where: { selisihStatus: "TERBUKA" } }),
  stockLossOpen: () => prisma.stockLoss.count({ where: { status: "TERBUKA" } }),
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
  shiftSwapsPending: async () => (await import("@/lib/spg/shift-queries")).jumlahTukarMenungguKantor(),
  stockRequestsUnheld: () => prisma.stockRequest.count({ where: { status: "BARU", store: { salesmanId: null } } }),
  // Definisi yang sama dengan "belum ditetapkan" di halaman Komisi SPG.
  spgCommissionsUnset: async () => (await import("@/lib/spg/komisi-queries")).jumlahKomisiPutusBelumDitetapkan(),
};

export type AngkaAntrean = Partial<Record<KunciAntrean, number>>;

/**
 * Hitungan antrean yang BOLEH dilihat penonton ini. Baris yang tersembunyi
 * tidak dihitung sama sekali — kuerinya tidak dijalankan.
 *
 * Satu hitungan yang gagal tidak menjatuhkan Beranda: kuncinya dibuang (baris
 * tanpa angka tidak tampil) dan galatnya dicatat. Beranda halaman pertama
 * semua orang; enam belas kueri lintas modul tidak boleh jadi enam belas
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
