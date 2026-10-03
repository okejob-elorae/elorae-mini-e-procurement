import { prisma } from "@elorae/db";
import { keadaanPesanan, nilaiTampil, type KeadaanPesanan } from "@/lib/field-sales/pwa-queries";
import type { BarisPiutang } from "@/lib/receivables/queries";
import type { KeadaanPiutang } from "@/lib/receivables/rules";
import type { KeadaanTagihan } from "./kredit";
import { bacaAturanKreditDb, keadaanTagihanToko } from "./tagihan-toko";

/**
 * Kartu ringkasan toko di aplikasi HP — yang perlu diketahui salesman sebelum
 * masuk ke toko: berapa tagihannya, apa yang biasa dibeli, kapan terakhir
 * dipesan dan didatangi.
 */

export const HARI_FAVORIT = 180;
export const BATAS_FAVORIT = 5;
export const BATAS_FAKTUR = 5;
const HARI_MS = 86_400_000;

export type FakturRingkas = {
  id: string;
  invoiceNo: string;
  keadaan: KeadaanPiutang;
  sisa: number;
  /** Tanggal yang ditunggu: janji bayar kontrabon bila ada, selain itu jatuh tempo (ISO). */
  tanggal: string;
  jenisTanggal: "janji" | "jatuhTempo";
  /** Lewat janji SESUDAH toleransi — aturan yang sama dengan `ringkasKeadaanTagihan`. */
  lewat: boolean;
};

/**
 * Faktur terbuka yang ditampilkan, paling mendesak dulu: yang lewat janji,
 * lalu yang tanggalnya paling dekat. Sisanya dihitung, tidak dibuang diam-diam.
 */
export function pilihFakturRingkas(
  baris: Pick<BarisPiutang, "id" | "invoiceNo" | "keadaan" | "outstanding" | "dueDate" | "alasan">[],
  hariToleransi: number,
  batas: number = BATAS_FAKTUR,
): { faktur: FakturRingkas[]; lebih: number } {
  const terbuka = baris
    .filter((b) => b.outstanding > 0)
    .map((b): FakturRingkas => ({
      id: b.id,
      invoiceNo: b.invoiceNo,
      keadaan: b.keadaan,
      sisa: b.outstanding,
      tanggal: b.alasan.janjiBayar ?? b.dueDate,
      jenisTanggal: b.alasan.janjiBayar ? "janji" : "jatuhTempo",
      lewat: b.keadaan === "lewat" && (b.alasan.hariTerlambat ?? 1) > hariToleransi,
    }))
    .sort(
      (a, b) =>
        Number(b.lewat) - Number(a.lewat) ||
        Date.parse(a.tanggal) - Date.parse(b.tanggal) ||
        a.invoiceNo.localeCompare(b.invoiceNo),
    );
  return { faktur: terbuka.slice(0, batas), lebih: Math.max(0, terbuka.length - batas) };
}

/** Jumlahkan potongan per barang dari beberapa sumber, ambil yang terbanyak. */
export function gabungFavorit(
  kelompok: Array<{ itemId: string; pcs: number }>,
  batas: number = BATAS_FAVORIT,
): Array<{ itemId: string; pcs: number }> {
  const per = new Map<string, number>();
  for (const k of kelompok) per.set(k.itemId, (per.get(k.itemId) ?? 0) + k.pcs);
  return [...per]
    .map(([itemId, pcs]) => ({ itemId, pcs }))
    .filter((f) => f.pcs > 0)
    .sort((a, b) => b.pcs - a.pcs || a.itemId.localeCompare(b.itemId))
    .slice(0, batas);
}

export type RingkasanToko = {
  jenisToko: "PUTUS" | "KONSI";
  /** null untuk toko konsinyasi — mereka tidak punya piutang. */
  tagihan:
    | (KeadaanTagihan & {
        faktur: FakturRingkas[];
        lebih: number;
        /**
         * Halaman tagihan per toko (`/pwa/piutang/[storeId]`) hanya terbuka bagi
         * PENAGIH-nya (pemegang toko, atau penjual selama toko belum berpemegang).
         * Tautannya disembunyikan bagi yang lain supaya tidak mendarat di 404.
         */
        bolehLihat: boolean;
      })
    | null;
  favorit: Array<{ itemId: string; sku: string; nama: string; pcs: number }>;
  pesananTerakhir: {
    id: string;
    orderNo: string;
    tanggal: Date;
    orderType: "PUTUS" | "KONSI";
    status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
    keadaan: KeadaanPesanan;
    /** null untuk konsi — nilai konsinyasi tidak pernah tampil di HP. */
    total: number | null;
    /** Hanya pesanan sendiri yang punya halaman detail di HP. */
    milikSaya: boolean;
  } | null;
  kunjunganTerakhir: { tanggal: Date; oleh: string; olehSaya: boolean } | null;
};

export async function ringkasanToko(
  storeId: string,
  opsi: { penontonId?: string; hariIni?: Date } = {},
): Promise<RingkasanToko | null> {
  const toko = await prisma.store.findUnique({ where: { id: storeId }, select: { termsType: true, salesmanId: true } });
  if (!toko) return null;
  const hariIni = opsi.hariIni ?? new Date();
  const sejak = new Date(hariIni.getTime() - HARI_FAVORIT * HARI_MS);
  const penontonId = opsi.penontonId ?? null;

  /*
   * Barang favorit memakai SUMBER YANG SAMA dengan `getStoreSentItems` ("barang
   * terkirim" di backoffice): PUTUS dihitung dari baris PENGIRIMAN, bukan dari
   * pesanan — pesanan yang disetujui bisa belum dikirim atau sisanya ditutup,
   * dan barang itu tidak pernah sampai ke toko. KONSI tidak punya dokumen kirim;
   * transfernya tercatat saat disetujui, jadi baris pesanan KONSI yang disetujui
   * yang dipakai. `SalesHistory` sengaja TIDAK dipakai: ia juga memuat penjualan
   * marketplace dan tidak menyimpan toko, sehingga tidak bisa menjawab "apa
   * yang dibeli toko INI". Van sale ke toko ini juga tidak ikut, sesuai
   * `getStoreSentItems`.
   */
  const [tagihan, putus, konsi, pesanan, kunjungan] = await Promise.all([
    toko.termsType === "KONSI" ? Promise.resolve(null) : tagihanToko(storeId, toko.salesmanId, penontonId),
    prisma.fieldSalesDeliveryLine.groupBy({
      by: ["itemId"],
      where: { delivery: { deliveredAt: { gte: sejak }, order: { storeId } } },
      _sum: { qty: true },
    }),
    prisma.fieldSalesOrderLine.groupBy({
      by: ["itemId"],
      where: { order: { storeId, status: "APPROVED", orderType: "KONSI", approvedAt: { gte: sejak } } },
      _sum: { qty: true },
    }),
    prisma.fieldSalesOrder.findFirst({
      // Sama dengan "Pesanan terakhir" di halaman toko: yang ditolak bukan pesanan toko.
      where: { storeId, status: { not: "REJECTED" } },
      orderBy: [{ createdAt: "desc" }, { orderNo: "desc" }],
      select: {
        id: true,
        orderNo: true,
        createdAt: true,
        orderType: true,
        status: true,
        deliveryStatus: true,
        total: true,
        salesmanId: true,
      },
    }),
    prisma.storeVisit.findFirst({
      /*
       * Kunjungan yang SEDANG berjalan milik penonton sendiri tidak dihitung:
       * salesman yang baru check-in ingin tahu kunjungan SEBELUM dirinya, bukan
       * diberi tahu bahwa ia sedang di sini.
       */
      where: penontonId ? { storeId, NOT: { userId: penontonId, checkoutAt: null } } : { storeId },
      orderBy: { checkinAt: "desc" },
      select: { checkinAt: true, userId: true, user: { select: { name: true, email: true } } },
    }),
  ]);

  const teratas = gabungFavorit([
    ...putus.map((g) => ({ itemId: g.itemId, pcs: g._sum.qty ?? 0 })),
    ...konsi.map((g) => ({ itemId: g.itemId, pcs: g._sum.qty ?? 0 })),
  ]);
  const barang = teratas.length
    ? await prisma.item.findMany({ where: { id: { in: teratas.map((f) => f.itemId) } }, select: { id: true, sku: true, nameId: true } })
    : [];
  const barangById = new Map(barang.map((b) => [b.id, b]));

  return {
    jenisToko: toko.termsType,
    tagihan,
    favorit: teratas.map((f) => ({
      itemId: f.itemId,
      sku: barangById.get(f.itemId)?.sku ?? "—",
      nama: barangById.get(f.itemId)?.nameId ?? "—",
      pcs: f.pcs,
    })),
    pesananTerakhir: pesanan
      ? {
          id: pesanan.id,
          orderNo: pesanan.orderNo,
          tanggal: pesanan.createdAt,
          orderType: pesanan.orderType,
          status: pesanan.status,
          keadaan: keadaanPesanan(pesanan),
          total: nilaiTampil(pesanan, Number(pesanan.total)),
          milikSaya: penontonId !== null && pesanan.salesmanId === penontonId,
        }
      : null,
    kunjunganTerakhir: kunjungan
      ? {
          tanggal: kunjungan.checkinAt,
          oleh: kunjungan.user.name ?? kunjungan.user.email,
          olehSaya: penontonId !== null && kunjungan.userId === penontonId,
        }
      : null,
  };
}

async function tagihanToko(
  storeId: string,
  pemegangId: string | null,
  penontonId: string | null,
): Promise<NonNullable<RingkasanToko["tagihan"]>> {
  const aturan = await bacaAturanKreditDb();
  const { keadaan, baris } = await keadaanTagihanToko(storeId, aturan.hariToleransi);
  const { faktur, lebih } = pilihFakturRingkas(baris, aturan.hariToleransi);

  /*
   * Aturan penagih (`penagihPiutang`): pemegang toko sekarang; selama toko
   * belum berpemegang, penjual faktur. Satu faktur yang ia tagih sudah cukup
   * membuka halaman tagihan toko itu.
   */
  let bolehLihat = false;
  if (penontonId && baris.length > 0) {
    bolehLihat =
      pemegangId !== null
        ? pemegangId === penontonId
        : (await prisma.receivable.count({ where: { id: { in: baris.map((b) => b.id) }, salesmanId: penontonId } })) > 0;
  }
  return { ...keadaan, faktur, lebih, bolehLihat };
}
