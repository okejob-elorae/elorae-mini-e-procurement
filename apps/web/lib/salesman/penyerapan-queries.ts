import { prisma } from "@elorae/db";
import { formatDisplayDate } from "@/lib/date-only";
import { akhirBulanWib, bagiSebanding, stokDiToko } from "@/lib/konsinyasi/stok-di-toko";
import { kunciStok } from "@/lib/konsinyasi/isi-ulang";
import { rentangAnalisa, type PeriodeAnalisa, type RentangAnalisa } from "./analisa-toko";
import { labelVarianSerap, susunPenyerapan, type BahanSerap, type InfoBarangSerap, type Penyerapan } from "./penyerapan";

/**
 * Kueri penyerapan per artikel di analisa toko salesman. Aturannya murni di
 * `penyerapan.ts`. Periode = periode analisa yang sedang dipilih
 * (`rentangAnalisa`), supaya kedua kartu membaca jendela yang sama.
 *
 * Sumbernya dipilih seperti `stokDiToko` — satu toko hanya dibaca dari SATU
 * sumber, tidak pernah dijumlahkan:
 *   - toko yang punya buku stok (SPG mencatat terima/jual/opname) → BUKU_TOKO,
 *     apa pun jenis tokonya;
 *   - toko konsinyasi tanpa buku → TITIPAN (pesanan konsinyasi disetujui,
 *     kiriman modul konsinyasi, mutasi yang diterima kantor; laku dari
 *     laporan konsinyasi per bulan);
 *   - toko putus tanpa buku → TANPA_LAPORAN: toko tidak melaporkan
 *     penjualannya, jadi tidak ada yang dihitung.
 */

const HARI_MS = 86_400_000;
const PERIODE_KOSONG = { masuk: 0, tambahLain: 0, laku: 0 };

export type HasilPenyerapan = Penyerapan & { jenisToko: "PUTUS" | "KONSI" };

type Kunci = { itemId: string; variantSku: string | null };

export async function penyerapanToko(storeId: string, periode: PeriodeAnalisa, hariIni: Date): Promise<HasilPenyerapan | null> {
  const toko = await prisma.store.findUnique({ where: { id: storeId }, select: { termsType: true } });
  if (!toko) return null;
  const rentang = rentangAnalisa(hariIni, periode);
  const hariPeriode = Math.round((rentang.akhir.getTime() - rentang.awal.getTime()) / HARI_MS);
  const stok = await stokDiToko(storeId, hariIni);

  if (stok.source !== "BUKU_TOKO" && toko.termsType !== "KONSI") {
    return {
      ...susunPenyerapan({ sumber: "TANPA_LAPORAN", adaDataLaku: false, bahan: [], barang: new Map(), hariPeriode, hariIni }),
      jenisToko: toko.termsType,
    };
  }

  const { bahan, adaDataLaku } =
    stok.source === "BUKU_TOKO" ? await bahanBukuToko(storeId, rentang, stok.baris) : await bahanTitipan(storeId, rentang, hariIni, stok.baris);

  const itemIds = [...new Set(bahan.map((b) => b.itemId))];
  const rows = itemIds.length
    ? await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, sku: true, nameId: true, variants: true } })
    : [];
  const barang = new Map<string, InfoBarangSerap>(rows.map((r) => [r.id, { nama: r.nameId, sku: r.sku, variants: r.variants }]));

  return {
    ...susunPenyerapan({ sumber: stok.source, adaDataLaku, bahan, barang, hariPeriode, hariIni }),
    jenisToko: toko.termsType,
  };
}

type BarisStok = { itemId: string; variantSku: string; qty: number; firstInAt: Date | null; perkiraan: boolean };

function petaKosong() {
  return new Map<string, BahanSerap>();
}

function ambil(peta: Map<string, BahanSerap>, k: Kunci): BahanSerap {
  const kunci = kunciStok(k.itemId, k.variantSku);
  let b = peta.get(kunci);
  if (!b) {
    b = { itemId: k.itemId, variantSku: k.variantSku ?? "", awal: null, ...PERIODE_KOSONG, sisa: 0, pertamaMasuk: null, perkiraan: false };
    peta.set(kunci, b);
  }
  return b;
}

/**
 * Buku stok toko: semua angka dari `StoreStockMovement`.
 *   awal  = saldo gerakan sebelum awal periode;
 *   masuk = TERIMA + MUTASI_MASUK dalam periode;
 *   tambahLain = selisih lebih opname dalam periode;
 *   laku  = −(JUAL + RETUR_PEMBELI) dalam periode — JUAL ditulis negatif,
 *           barang kembali dari pembeli positif;
 *   sisa  = saldo sekarang (dari `stokDiToko`, dengan tanggal masuk pertamanya).
 */
async function bahanBukuToko(storeId: string, rentang: RentangAnalisa, baris: BarisStok[]) {
  const dalam = { gte: rentang.awal, lt: rentang.akhir };
  const by = ["itemId", "variantSku"] as const;
  const [awal, masuk, laku, opname] = await Promise.all([
    prisma.storeStockMovement.groupBy({ by: [...by], where: { storeId, createdAt: { lt: rentang.awal } }, _sum: { qty: true } }),
    prisma.storeStockMovement.groupBy({
      by: [...by],
      where: { storeId, kind: { in: ["TERIMA", "MUTASI_MASUK"] }, createdAt: dalam },
      _sum: { qty: true },
    }),
    prisma.storeStockMovement.groupBy({
      by: [...by],
      where: { storeId, kind: { in: ["JUAL", "RETUR_PEMBELI"] }, createdAt: dalam },
      _sum: { qty: true },
    }),
    prisma.storeStockMovement.groupBy({
      by: [...by],
      where: { storeId, kind: "OPNAME", qty: { gt: 0 }, createdAt: dalam },
      _sum: { qty: true },
    }),
  ]);

  const peta = petaKosong();
  for (const s of baris) {
    const b = ambil(peta, s);
    b.sisa = s.qty;
    b.pertamaMasuk = s.firstInAt;
  }
  for (const g of awal) ambil(peta, g).awal = g._sum.qty ?? 0;
  for (const g of masuk) ambil(peta, g).masuk = g._sum.qty ?? 0;
  for (const g of laku) ambil(peta, g).laku = -(g._sum.qty ?? 0);
  for (const g of opname) ambil(peta, g).tambahLain = g._sum.qty ?? 0;
  // Buku punya saldo harian yang pasti: awal tidak pernah diturunkan.
  for (const b of peta.values()) if (b.awal === null) b.awal = 0;
  return { bahan: [...peta.values()], adaDataLaku: true };
}

/**
 * Titipan konsinyasi tanpa buku. Masuk per ukuran dari dokumen kirimnya; laku
 * hanya per BARANG (laporan konsinyasi, bertanggal akhir bulan siklusnya —
 * sama dengan `analisaToko`), lalu dibagi ke ukuran sebanding barang yang ada
 * (masuk dalam periode + sisa sekarang) dan ditandai perkiraan.
 *
 * "Ada data laku" = ada laporan laku, atau ada siklus terkunci, yang akhir
 * bulannya jatuh di periode ini. Tanpa itu toko belum melaporkan apa-apa, dan
 * barangnya tidak boleh dicap lambat hanya karena laporannya belum masuk.
 */
async function bahanTitipan(storeId: string, rentang: RentangAnalisa, hariIni: Date, baris: BarisStok[]) {
  const dalam = { gte: rentang.awal, lt: rentang.akhir };
  const [pesanan, kiriman, mutasi, terjual, terkunci] = await Promise.all([
    prisma.fieldSalesOrderLine.findMany({
      where: { order: { storeId, orderType: "KONSI", status: "APPROVED", approvedAt: dalam } },
      select: { itemId: true, variantSku: true, qty: true, cancelledQty: true },
    }),
    prisma.consignmentShipmentItem.findMany({
      where: { itemId: { not: null }, shipment: { storeId, shippedAt: dalam } },
      select: { itemId: true, qty: true },
    }),
    prisma.storeReceiptLine.findMany({
      where: {
        itemId: { not: null },
        qtyReceived: { gt: 0 },
        receipt: { storeId, sourceType: { in: ["MUTASI", "MUTASI_KEMBALI"] }, receivedAt: dalam },
      },
      select: { itemId: true, variantSku: true, qtyReceived: true },
    }),
    prisma.consignmentSold.findMany({
      where: { itemId: { not: null }, cycle: { storeId } },
      select: { itemId: true, qty: true, cycle: { select: { periodYear: true, periodMonth: true } } },
    }),
    prisma.consignmentCycle.findMany({ where: { storeId, lockedAt: { not: null } }, select: { periodYear: true, periodMonth: true } }),
  ]);

  const diPeriode = (tahun: number, bulan: number) => {
    const akhir = akhirBulanWib(tahun, bulan);
    const t = akhir > hariIni ? hariIni : akhir;
    return t >= rentang.awal && t < rentang.akhir;
  };

  const peta = petaKosong();
  for (const s of baris) {
    const b = ambil(peta, s);
    b.sisa = s.qty;
    b.pertamaMasuk = s.firstInAt;
    b.perkiraan = s.perkiraan;
  }
  for (const l of pesanan) ambil(peta, l).masuk += l.qty - l.cancelledQty;
  for (const l of kiriman) ambil(peta, { itemId: l.itemId as string, variantSku: "" }).masuk += l.qty;
  for (const l of mutasi) ambil(peta, { itemId: l.itemId as string, variantSku: l.variantSku }).masuk += l.qtyReceived;

  const lakuBarang = new Map<string, number>();
  let adaLaporan = false;
  for (const s of terjual) {
    if (!diPeriode(s.cycle.periodYear, s.cycle.periodMonth)) continue;
    adaLaporan = true;
    lakuBarang.set(s.itemId as string, (lakuBarang.get(s.itemId as string) ?? 0) + s.qty);
  }
  const adaDataLaku = adaLaporan || terkunci.some((c) => diPeriode(c.periodYear, c.periodMonth));

  for (const [itemId, laku] of lakuBarang) {
    let daftar = [...peta.values()].filter((b) => b.itemId === itemId);
    if (daftar.length === 0) daftar = [ambil(peta, { itemId, variantSku: "" })];
    const bagian = bagiSebanding(
      Math.max(0, laku),
      daftar.map((b) => Math.max(0, b.masuk) + Math.max(0, b.sisa)),
    );
    daftar.forEach((b, i) => {
      b.laku += bagian[i];
      if (daftar.length > 1 && laku > 0) b.perkiraan = true;
    });
  }
  return { bahan: [...peta.values()], adaDataLaku };
}

// ─── Dari SPG ────────────────────────────────────────────────────────────────

export const BATAS_DICARI = 5;

export type DariSpg = {
  /** Toko ini punya SPG (pengguna bertoko tetap di sini). */
  adaSpg: boolean;
  /** Barang yang dicari pembeli tapi tidak ada, dalam periode analisa — teratas menurut jumlah. */
  dicari: { kunci: string; nama: string; varian: string | null; qty: number; kali: number; terakhir: string }[];
  /** Permintaan barang SPG yang masih terbuka (BARU/DIPROSES). */
  permintaanTerbuka: number;
};

/**
 * Yang SPG laporkan dari toko ini: barang yang dicari pembeli (`LostSale`) dan
 * permintaan barangnya yang masih terbuka. Tidak ada rupiah.
 */
export async function dariSpgToko(storeId: string, periode: PeriodeAnalisa, hariIni: Date): Promise<DariSpg> {
  const rentang = rentangAnalisa(hariIni, periode);
  const [spg, dicari, terbuka] = await Promise.all([
    prisma.user.count({ where: { assignedStoreId: storeId } }),
    prisma.lostSale.findMany({
      where: { storeId, createdAt: { gte: rentang.awal, lt: rentang.akhir } },
      select: { itemId: true, variantSku: true, description: true, qty: true, createdAt: true },
    }),
    prisma.stockRequest.count({ where: { storeId, status: { in: ["BARU", "DIPROSES"] } } }),
  ]);

  const itemIds = [...new Set(dicari.map((d) => d.itemId).filter((x): x is string => !!x))];
  const items = itemIds.length
    ? await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, sku: true, nameId: true, variants: true } })
    : [];
  const barang = new Map(items.map((i) => [i.id, i]));

  const per = new Map<string, { nama: string; varian: string | null; qty: number; kali: number; terakhir: Date }>();
  for (const d of dicari) {
    const item = d.itemId ? barang.get(d.itemId) : undefined;
    // Barang yang ditautkan dikelompokkan per barang × ukuran; catatan teks bebas per teksnya.
    const kunci = item ? `item:${kunciStok(item.id, d.variantSku)}` : `teks:${d.description.trim().toLowerCase()}`;
    const ada = per.get(kunci);
    if (ada) {
      ada.qty += d.qty;
      ada.kali += 1;
      if (d.createdAt > ada.terakhir) ada.terakhir = d.createdAt;
    } else {
      per.set(kunci, {
        nama: item ? item.nameId : d.description.trim(),
        varian: item ? labelVarianSerap(item.variants, d.variantSku ?? "", item.sku) : null,
        qty: d.qty,
        kali: 1,
        terakhir: d.createdAt,
      });
    }
  }

  return {
    adaSpg: spg > 0,
    dicari: [...per]
      .sort(([, a], [, b]) => b.qty - a.qty || b.kali - a.kali || b.terakhir.getTime() - a.terakhir.getTime())
      .slice(0, BATAS_DICARI)
      .map(([kunci, x]) => ({ kunci, nama: x.nama, varian: x.varian, qty: x.qty, kali: x.kali, terakhir: formatDisplayDate(x.terakhir) })),
    permintaanTerbuka: terbuka,
  };
}
