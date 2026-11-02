import { prisma, type Prisma } from "@elorae/db";
import { matchKey } from "@/lib/items/match-key";
import {
  bacaBatasPesananLama,
  KUNCI_PESANAN_LAMA_SEBELUM,
  penerimaDiharapkan,
  sisaBarisLama,
  type PenerimaDiharapkan,
} from "./pesanan-lama-aturan";

/**
 * SATU-SATUNYA definisi "pesanan konsinyasi LAMA yang cadangannya masih ditahan" (keputusan
 * pemilik no. 9) — setiap layar dan penulis membacanya dari sini, tidak menulis ulang syaratnya.
 *
 * Sebuah pesanan termasuk bila SEMUA ini benar:
 * - KONSI, APPROVED, dan disetujui SEBELUM alur pengiriman per antaran sampai ke produksi
 *   (`SystemSetting["konsi.pesananLamaSebelum"]`, bawaan `BAWAAN_PESANAN_LAMA_SEBELUM`) — pesanan
 *   yang disetujui sesudahnya memakai alur pengiriman biasa dan tidak pernah mendapat tombol
 *   "sudah sampai";
 * - belum selesai (`deliveryStatus` PENDING/PARTIAL);
 * - tidak punya `DeliveryShipment` yang tidak dibatalkan — pesanan yang sudah masuk alur pengiriman
 *   (dan dengan itu `KonsiTransfer` berpengiriman) diselesaikan alur itu, tidak dicampur;
 * - minimal satu barisnya masih punya cadangan RESERVED (sumber FIELD_SALES_KONSI) dengan sisa.
 *
 * Bedanya dengan JENIS LAMA YANG LAIN (`bacaPesananKonsiLama`, `lib/spg/antaran-queries.ts`):
 * yang itu stoknya SUDAH keluar gudang saat disetujui (cadangan CONSUMED, atau tidak bercadangan
 * sama sekali) dan diterima SPG sekali per pesanan (`KONSI_ORDER`). Yang ini cadangannya masih
 * RESERVED — syarat yang justru membuat pesanan gugur dari `bacaPesananKonsiLama`. Keduanya tidak
 * pernah memuat pesanan yang sama; transfer konfirmasi sampai (`KonsiTransfer.oldOrderArrival`)
 * juga dikecualikan di sana, supaya pesanan yang sudah habis dikonfirmasi tidak berpindah jenis.
 *
 * Stok di toko (`lib/konsinyasi/stok-di-toko.ts`) dan pencocokan membaca barang yang sudah
 * dikonfirmasi lewat baris `KonsiTransfer` (bertanggal konfirmasinya); sisa yang belum dikonfirmasi
 * masih terhitung di gudang sendiri (dicadangkan) dan di "dalam proses" — tidak pernah di toko.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

export async function muatBatasPesananLama(klien: Pick<Klien, "systemSetting"> = prisma): Promise<Date> {
  const row = await klien.systemSetting.findUnique({ where: { key: KUNCI_PESANAN_LAMA_SEBELUM }, select: { value: true } });
  return bacaBatasPesananLama(row?.value);
}

export type BarisPesananLama = {
  lineId: string;
  itemId: string;
  variantSku: string;
  productName: string;
  /** Pcs yang masih bisa dikonfirmasi sampai (`sisaBarisLama`). */
  sisa: number;
};

export type PesananKonsiCadanganLama = {
  orderId: string;
  orderNo: string;
  storeId: string;
  salesmanId: string;
  approvedAt: Date;
  createdAt: Date;
  /** Hanya baris yang masih bersisa. */
  baris: BarisPesananLama[];
  jumlahPcs: number;
};

/**
 * Pesanan lama dalam cakupan ini, per id pesanan. Cakupan WAJIB diisi: `orderIds` dan/atau
 * `storeIds`; daftar kosong (atau tanpa cakupan sama sekali) mengembalikan peta kosong — fungsi ini
 * tidak pernah menyapu seluruh tabel.
 */
export async function bacaPesananKonsiCadanganLama(
  klien: Klien,
  lingkup: { orderIds?: readonly string[]; storeIds?: readonly string[] },
  opsi: { batas?: Date } = {},
): Promise<Map<string, PesananKonsiCadanganLama>> {
  const hasil = new Map<string, PesananKonsiCadanganLama>();
  const orderIds = lingkup.orderIds ? [...new Set(lingkup.orderIds.filter(Boolean))] : null;
  const storeIds = lingkup.storeIds ? [...new Set(lingkup.storeIds.filter(Boolean))] : null;
  if (orderIds === null && storeIds === null) return hasil;
  if ((orderIds !== null && orderIds.length === 0) || (storeIds !== null && storeIds.length === 0)) return hasil;

  const batas = opsi.batas ?? (await muatBatasPesananLama(klien));
  const pesanan = await klien.fieldSalesOrder.findMany({
    where: {
      ...(orderIds ? { id: { in: orderIds } } : {}),
      ...(storeIds ? { storeId: { in: storeIds } } : {}),
      orderType: "KONSI",
      status: "APPROVED",
      approvedAt: { lt: batas },
      deliveryStatus: { in: ["PENDING", "PARTIAL"] },
      shipments: { none: { status: { not: "CANCELLED" } } },
    },
    orderBy: [{ approvedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      orderNo: true,
      storeId: true,
      salesmanId: true,
      approvedAt: true,
      createdAt: true,
      lines: { select: { id: true, itemId: true, variantSku: true, productName: true, qty: true, deliveredQty: true, cancelledQty: true } },
    },
  });
  if (pesanan.length === 0) return hasil;

  const lineIds = pesanan.flatMap((o) => o.lines.map((l) => l.id));
  const cadangan = await klien.stockReservation.findMany({
    where: { fieldSalesLineId: { in: lineIds }, source: "FIELD_SALES_KONSI", state: "RESERVED" },
    select: { fieldSalesLineId: true, qty: true, consumedQty: true },
  });
  const cadanganPerBaris = new Map(
    cadangan.flatMap((r) => (r.fieldSalesLineId ? [[r.fieldSalesLineId, { qty: Number(r.qty), consumedQty: Number(r.consumedQty) }] as const] : [])),
  );

  for (const o of pesanan) {
    if (!o.approvedAt) continue;
    const baris: BarisPesananLama[] = [];
    for (const l of o.lines) {
      const sisa = sisaBarisLama(l, cadanganPerBaris.get(l.id) ?? null);
      if (sisa <= 0) continue;
      baris.push({ lineId: l.id, itemId: l.itemId, variantSku: l.variantSku ?? "", productName: l.productName, sisa });
    }
    if (baris.length === 0) continue;
    hasil.set(o.id, {
      orderId: o.id,
      orderNo: o.orderNo,
      storeId: o.storeId,
      salesmanId: o.salesmanId,
      approvedAt: o.approvedAt,
      createdAt: o.createdAt,
      baris,
      jumlahPcs: baris.reduce((n, b) => n + b.sisa, 0),
    });
  }
  return hasil;
}

/** Satu pesanan: pesanan lama yang cadangannya masih ditahan, atau null. */
export async function muatPesananKonsiCadanganLama(klien: Klien, orderId: string): Promise<PesananKonsiCadanganLama | null> {
  if (typeof orderId !== "string" || orderId === "") return null;
  return (await bacaPesananKonsiCadanganLama(klien, { orderIds: [orderId] })).get(orderId) ?? null;
}

/** Siapa yang diharapkan mengonfirmasi di toko ini (lihat `penerimaDiharapkan`). */
export async function muatPenerimaToko(
  klien: Klien,
  storeId: string,
): Promise<{ penerima: PenerimaDiharapkan; pemegangTokoId: string | null; namaPemegang: string | null; jumlahSpg: number }> {
  const [toko, jumlahSpg] = await Promise.all([
    klien.store.findUnique({ where: { id: storeId }, select: { salesmanId: true, salesman: { select: { name: true } } } }),
    klien.user.count({ where: { assignedStoreId: storeId } }),
  ]);
  const pemegangTokoId = toko?.salesmanId ?? null;
  return {
    penerima: penerimaDiharapkan({ jumlahSpg, pemegangTokoId }),
    pemegangTokoId,
    namaPemegang: toko?.salesman?.name?.trim() || null,
    jumlahSpg,
  };
}

/**
 * Opname gudang sendiri (`StockOpname` APPROVED) yang menghitung barang × varian ini SESUDAH
 * pesanannya disetujui — kunci `matchKey`-nya, ke id opname TERBARU. "Sesudah" dibaca dari
 * `snapshotAt` (saat angka hitungannya mewakili gudang): hitungan sesudah barang keluar tidak lagi
 * memuat barang itu, jadi konfirmasi sampai tidak boleh memotong gudang lagi. Hanya baris yang
 * benar-benar dihitung (`countedQty` terisi). Barang tanpa varian cocok dengan baris opname `null`
 * maupun `""`.
 */
export async function opnameGudangSesudah(
  klien: Klien,
  input: { sejak: Date; barang: ReadonlyArray<{ itemId: string; variantSku: string }> },
): Promise<Map<string, string>> {
  const hasil = new Map<string, string>();
  const itemIds = [...new Set(input.barang.map((b) => b.itemId).filter(Boolean))];
  if (itemIds.length === 0) return hasil;
  const dicari = new Set(input.barang.map((b) => kunciOpname(b.itemId, b.variantSku)));
  const rows = await klien.stockOpnameItem.findMany({
    where: {
      itemId: { in: itemIds },
      countedQty: { not: null },
      opname: { status: "APPROVED", snapshotAt: { gte: input.sejak } },
    },
    select: { itemId: true, variantSku: true, opnameId: true, opname: { select: { snapshotAt: true } } },
  });
  const terbaru = new Map<string, { opnameId: string; t: number }>();
  for (const r of rows) {
    const k = kunciOpname(r.itemId, r.variantSku);
    if (!dicari.has(k)) continue;
    const t = r.opname.snapshotAt.getTime();
    const ada = terbaru.get(k);
    if (!ada || t > ada.t || (t === ada.t && r.opnameId > ada.opnameId)) terbaru.set(k, { opnameId: r.opnameId, t });
  }
  for (const [k, v] of terbaru) hasil.set(k, v.opnameId);
  return hasil;
}

export function kunciOpname(itemId: string, variantSku: string | null): string {
  return `${itemId}::${matchKey(variantSku)}`;
}

export type KedatanganPesananLama = {
  transferId: string;
  docNo: string;
  createdAt: Date;
  oleh: string | null;
  pcs: number;
  /** Pcs yang hanya ditambahkan ke toko karena gudang sudah diopname sesudah pesanan disetujui. */
  pcsSesudahOpname: number;
  diterimaSpg: boolean;
};

/** Konfirmasi "sudah sampai" yang sudah tercatat untuk pesanan ini, terlama dulu. Tanpa harga. */
export async function muatKedatanganPesananLama(klien: Klien, orderId: string): Promise<KedatanganPesananLama[]> {
  if (typeof orderId !== "string" || orderId === "") return [];
  const transfer = await klien.konsiTransfer.findMany({
    where: { orderId, oldOrderArrival: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      docNo: true,
      createdAt: true,
      transferredBy: { select: { name: true } },
      lines: { select: { qty: true, mainCountedByOpnameId: true } },
    },
  });
  if (transfer.length === 0) return [];
  const tandaTerima = await klien.storeReceipt.findMany({
    where: { sourceType: "KONSI_TRANSFER", sourceId: { in: transfer.map((t) => t.id) } },
    select: { sourceId: true },
  });
  const diterima = new Set(tandaTerima.map((r) => r.sourceId));
  return transfer.map((t) => ({
    transferId: t.id,
    docNo: t.docNo,
    createdAt: t.createdAt,
    oleh: t.transferredBy?.name?.trim() || null,
    pcs: t.lines.reduce((n, l) => n + Math.round(Number(l.qty)), 0),
    pcsSesudahOpname: t.lines.filter((l) => l.mainCountedByOpnameId).reduce((n, l) => n + Math.round(Number(l.qty)), 0),
    diterimaSpg: diterima.has(t.id),
  }));
}
