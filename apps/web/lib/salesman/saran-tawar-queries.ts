import { prisma } from "@elorae/db";
import { aggregateInventoryValues } from "@/lib/items/queries";
import { getPrimaryImagesBatch } from "@/lib/items/images/queries";
import {
  bacaHariBaru,
  barangBaru,
  porsiBulan,
  susunSaranTawar,
  HARI_AREA,
  HARI_RIWAYAT,
  type BahanSaranTawar,
  type BarangTersedia,
  type BeliToko,
  type JualSejenis,
  type SaranTawar,
} from "./saran-tawar";

/**
 * Kueri "Yang perlu ditawarkan di toko ini". Aturannya murni di `saran-tawar.ts`;
 * di sini hanya bahan-bahannya dibaca dari basis data.
 */

const HARI_MS = 86_400_000;
const angka = (v: unknown) => Number(v ?? 0);

/** Pengaturan yang sama dengan saran konsinyasi "barang baru" (lihat CLAUDE.md). */
export const KUNCI_HARI_BARU = "konsi.newItemDays";

/**
 * Pembanding "toko sejenis": toko se-area (`Store.groupId`); toko tanpa area —
 * atau yang areanya tidak berisi toko aktif lain — dibandingkan dengan semua
 * toko aktif sejenis perjanjiannya (putus/konsinyasi).
 */
export type PembandingSaran =
  | { jenis: "AREA"; kode: string; nama: string }
  | { jenis: "JENIS"; termsType: "PUTUS" | "KONSI" };

export type SaranTawarBaris = SaranTawar & { sku: string; nama: string; gambarUrl: string | null };

export type HasilSaranTawar = {
  pembanding: PembandingSaran;
  /** Jendela penjualan toko sejenis, untuk kalimat "48 pcs/90 hari". */
  hariArea: number;
  saran: SaranTawarBaris[];
  /** Barang baru yang ada stoknya (termasuk yang pernah dikirim) — pilihan awal "Kirim katalog". */
  baru: { itemId: string; umurHari: number }[];
};

type Baris = { storeId: string; itemId: string; pcs: number };

/**
 * Pesanan toko ini per pesanan per barang, sejak `sejak`.
 *
 * Satu pesanan = satu peristiwa (aturan yang sama dengan "toko menurun"):
 *   putus terkirim       = tanggal kiriman PERTAMA, potongan yang terkirim —
 *                          pesanan yang dikirim bertahap bukan beberapa pesanan;
 *   putus belum terkirim = tanggal pesan, potongan dipesan dikurangi yang
 *                          dibatalkan — tokonya SUDAH memesan, jadi barang itu
 *                          tidak boleh ditawarkan lagi seolah terlupa;
 *   konsi disetujui      = tanggal disetujui; konsi menunggu = tanggal pesan;
 *   jual van ke toko ini = tanggal jual.
 * Pesanan yang ditolak bukan pesanan toko.
 */
export async function beliTokoIni(storeId: string, sejak: Date): Promise<BeliToko[]> {
  const [kirim, putusBelum, konsi, van] = await Promise.all([
    prisma.fieldSalesDeliveryLine.findMany({
      where: { orderLine: { isBonus: false }, delivery: { deliveredAt: { gte: sejak }, order: { storeId, orderType: "PUTUS" } } },
      select: { itemId: true, qty: true, delivery: { select: { orderId: true, deliveredAt: true } } },
    }),
    prisma.fieldSalesOrderLine.findMany({
      where: {
        isBonus: false,
        order: {
          storeId,
          orderType: "PUTUS",
          status: { not: "REJECTED" },
          createdAt: { gte: sejak },
          deliveries: { none: {} },
        },
      },
      select: { itemId: true, qty: true, cancelledQty: true, orderId: true, order: { select: { createdAt: true } } },
    }),
    prisma.fieldSalesOrderLine.findMany({
      where: {
        order: {
          storeId,
          orderType: "KONSI",
          OR: [
            { status: "APPROVED", approvedAt: { gte: sejak } },
            { status: "PENDING_APPROVAL", createdAt: { gte: sejak } },
          ],
        },
      },
      select: { itemId: true, qty: true, orderId: true, order: { select: { createdAt: true, approvedAt: true } } },
    }),
    prisma.vanSaleLine.findMany({
      where: { vanSale: { storeId, createdAt: { gte: sejak } } },
      select: { itemId: true, qty: true, vanSaleId: true, vanSale: { select: { createdAt: true } } },
    }),
  ]);

  const per = new Map<string, BeliToko>();
  const tambah = (dok: string, itemId: string, tanggal: Date, pcs: number) => {
    const k = `${dok}|${itemId}`;
    const ada = per.get(k);
    if (!ada) per.set(k, { itemId, tanggal, pcs });
    else {
      ada.pcs += pcs;
      if (tanggal < ada.tanggal) ada.tanggal = tanggal;
    }
  };
  for (const l of kirim) tambah(`o:${l.delivery.orderId}`, l.itemId, l.delivery.deliveredAt, l.qty);
  for (const l of putusBelum) tambah(`o:${l.orderId}`, l.itemId, l.order.createdAt, l.qty - l.cancelledQty);
  for (const l of konsi) tambah(`o:${l.orderId}`, l.itemId, l.order.approvedAt ?? l.order.createdAt, l.qty);
  for (const l of van) tambah(`v:${l.vanSaleId}`, l.itemId, l.vanSale.createdAt, angka(l.qty));
  // Pesanan yang seluruhnya dibatalkan tidak pernah sampai ke toko.
  return [...per.values()].filter((b) => b.pcs > 0);
}

/**
 * Penjualan per toko per barang di toko-toko pembanding, jendela `HARI_AREA`.
 *
 * "Laku" sebisa mungkin berarti laku ke PEMBELI, bukan sekadar dikirim ke toko:
 * barang yang ditimbun toko tidak membuktikan apa pun. Karena itu per toko
 * dipilih SATU sumber, yang terbaik yang tersedia — tidak pernah dijumlahkan,
 * sebab laporan konsinyasi sering disusun dari penjualan SPG yang sama:
 *   1. penjualan SPG (`SpgSaleLine`) — laku sungguhan, per hari;
 *   2. angka laku konsinyasi yang sudah dikunci (`ConsignmentSold`) — laku
 *      sungguhan, tapi per bulan; bulan di tepi jendela dihitung sebanding
 *      porsinya. Bulan berjalan biasanya belum dikunci, jadi toko ini sedikit
 *      terhitung rendah — lebih baik daripada menebak;
 *   3. selain itu barang yang DIBELI toko itu (putus terkirim, konsi disetujui,
 *      jual van) — satu-satunya yang ada untuk toko putus tanpa SPG.
 */
export async function jualTokoSejenis(peerIds: string[], hariIni: Date): Promise<JualSejenis[]> {
  if (peerIds.length === 0) return [];
  const sejak = new Date(hariIni.getTime() - HARI_AREA * HARI_MS);
  const bulan = porsiBulan(hariIni, HARI_AREA);
  const porsi = new Map(bulan.map((b) => [`${b.tahun}-${b.bulan}`, b.porsi]));

  const [spg, konsiLaku] = await Promise.all([
    prisma.spgSaleLine.findMany({
      where: { spgSale: { storeId: { in: peerIds }, createdAt: { gte: sejak } } },
      select: { itemId: true, qty: true, spgSale: { select: { storeId: true } } },
    }),
    prisma.consignmentSold.findMany({
      where: {
        itemId: { not: null },
        cycle: {
          storeId: { in: peerIds },
          lockedAt: { not: null },
          OR: bulan.map((b) => ({ periodYear: b.tahun, periodMonth: b.bulan })),
        },
      },
      select: { itemId: true, qty: true, cycle: { select: { storeId: true, periodYear: true, periodMonth: true } } },
    }),
  ]);

  const baris: Baris[] = [];
  const tokoSpg = new Set(spg.map((l) => l.spgSale.storeId));
  for (const l of spg) baris.push({ storeId: l.spgSale.storeId, itemId: l.itemId, pcs: l.qty });

  const tokoKonsi = new Set<string>();
  for (const l of konsiLaku) {
    const storeId = l.cycle.storeId;
    if (tokoSpg.has(storeId)) continue;
    tokoKonsi.add(storeId);
    const p = porsi.get(`${l.cycle.periodYear}-${l.cycle.periodMonth}`) ?? 0;
    baris.push({ storeId, itemId: l.itemId as string, pcs: l.qty * p });
  }

  const sisa = peerIds.filter((id) => !tokoSpg.has(id) && !tokoKonsi.has(id));
  if (sisa.length > 0) {
    const [kirim, konsi, van] = await Promise.all([
      prisma.fieldSalesDeliveryLine.findMany({
        where: { delivery: { deliveredAt: { gte: sejak }, order: { storeId: { in: sisa }, orderType: "PUTUS" } } },
        select: { itemId: true, qty: true, delivery: { select: { order: { select: { storeId: true } } } } },
      }),
      prisma.fieldSalesOrderLine.findMany({
        where: { order: { storeId: { in: sisa }, orderType: "KONSI", status: "APPROVED", approvedAt: { gte: sejak } } },
        select: { itemId: true, qty: true, order: { select: { storeId: true } } },
      }),
      prisma.vanSaleLine.findMany({
        where: { vanSale: { storeId: { in: sisa }, createdAt: { gte: sejak } } },
        select: { itemId: true, qty: true, vanSale: { select: { storeId: true } } },
      }),
    ]);
    for (const l of kirim) baris.push({ storeId: l.delivery.order.storeId, itemId: l.itemId, pcs: l.qty });
    for (const l of konsi) baris.push({ storeId: l.order.storeId, itemId: l.itemId, pcs: l.qty });
    for (const l of van) baris.push({ storeId: l.vanSale.storeId as string, itemId: l.itemId, pcs: angka(l.qty) });
  }

  const per = new Map<string, { pcs: number; toko: Set<string> }>();
  for (const b of baris) {
    if (b.pcs <= 0) continue;
    let a = per.get(b.itemId);
    if (!a) {
      a = { pcs: 0, toko: new Set() };
      per.set(b.itemId, a);
    }
    a.pcs += b.pcs;
    a.toko.add(b.storeId);
  }
  return [...per].map(([itemId, a]) => ({ itemId, pcs: Math.round(a.pcs), toko: a.toko.size }));
}

/**
 * Semua bahan untuk `susunSaranTawar`, plus pembandingnya dan data barang untuk
 * tampilan. null bila tokonya tidak ada.
 */
export async function bahanSaranTawar(
  storeId: string,
  hariIni: Date,
): Promise<{
  pembanding: PembandingSaran;
  bahan: BahanSaranTawar;
  infoBarang: Map<string, { sku: string; nama: string }>;
} | null> {
  const toko = await prisma.store.findUnique({
    where: { id: storeId },
    select: { termsType: true, groupId: true, group: { select: { code: true, name: true } } },
  });
  if (!toko) return null;

  let pembanding: PembandingSaran = { jenis: "JENIS", termsType: toko.termsType };
  let peers: { id: string }[] = [];
  if (toko.groupId && toko.group) {
    peers = await prisma.store.findMany({
      where: { groupId: toko.groupId, isActive: true, id: { not: storeId } },
      select: { id: true },
    });
    if (peers.length > 0) pembanding = { jenis: "AREA", kode: toko.group.code, nama: toko.group.name };
  }
  if (pembanding.jenis === "JENIS") {
    peers = await prisma.store.findMany({
      where: { termsType: toko.termsType, isActive: true, id: { not: storeId } },
      select: { id: true },
    });
  }

  const setelan = await prisma.systemSetting.findUnique({ where: { key: KUNCI_HARI_BARU }, select: { value: true } });
  const hariBaru = bacaHariBaru(setelan?.value);
  // Jendela riwayat toko ini harus mencakup umur barang "baru": barang baru yang
  // pernah dikirim sebelum awal jendela akan keliru dianggap belum pernah.
  const sejakRiwayat = new Date(hariIni.getTime() - Math.max(HARI_RIWAYAT, hariBaru) * HARI_MS);

  const [beliToko, jualSejenis, items] = await Promise.all([
    beliTokoIni(storeId, sejakRiwayat),
    jualTokoSejenis(
      peers.map((p) => p.id),
      hariIni,
    ),
    // Himpunan yang sama dengan katalog HP: barang jadi yang aktif.
    prisma.item.findMany({
      where: { isActive: true, type: "FINISHED_GOOD" },
      select: {
        id: true,
        sku: true,
        nameId: true,
        createdAt: true,
        inventoryValues: { select: { qtyOnHand: true, reservedQty: true, totalValue: true } },
      },
    }),
  ]);

  const barang: BarangTersedia[] = items.map((it) => ({
    itemId: it.id,
    tersedia: aggregateInventoryValues(it.inventoryValues)?.available ?? 0,
    dibuat: it.createdAt,
  }));
  const infoBarang = new Map(items.map((it) => [it.id, { sku: it.sku, nama: it.nameId }]));
  return { pembanding, bahan: { beliToko, jualSejenis, barang, hariBaru }, infoBarang };
}

/** Saran siap tampil untuk halaman toko dan pilihan awal "Kirim katalog". null bila tokonya tidak ada. */
export async function saranTawarToko(storeId: string, hariIni: Date): Promise<HasilSaranTawar | null> {
  const b = await bahanSaranTawar(storeId, hariIni);
  if (!b) return null;
  const saran = susunSaranTawar(b.bahan, hariIni);
  const gambar = await getPrimaryImagesBatch(saran.map((s) => ({ itemId: s.itemId, variantSku: null })));
  return {
    pembanding: b.pembanding,
    hariArea: HARI_AREA,
    saran: saran.map((s) => ({
      ...s,
      sku: b.infoBarang.get(s.itemId)?.sku ?? "—",
      nama: b.infoBarang.get(s.itemId)?.nama ?? "—",
      gambarUrl: gambar.get(`${s.itemId}|`) ?? null,
    })),
    baru: barangBaru(b.bahan.barang, hariIni, b.bahan.hariBaru),
  };
}
